import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Database, Repository, type SQL } from '../db.js';
import { hashToken } from '../auth.js';
import { HttpError } from '../errors.js';
import { GoogleIdentityVerifier } from './google-identity.js';

export const GOOGLE_CALENDAR_SCOPES = ['openid', 'https://www.googleapis.com/auth/calendar.events.owned'] as const;
const AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_PROBE_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1&fields=kind%2CaccessRole%2Citems(id)';
const tokenSchema = z.object({ access_token: z.string().min(1).max(8192), token_type: z.string().regex(/^Bearer$/i), expires_in: z.number().int().min(1).max(86400), refresh_token: z.string().min(1).max(8192).optional(), id_token: z.string().min(1).max(20000).optional(), scope: z.string().max(4096).optional() });
type Tokens = z.infer<typeof tokenSchema>;
type State = { id: string; kind: 'google_calendar_oauth_state'; ownerId: string; status: 'pending' | 'exchanging' | 'consumed' | 'denied' | 'cancelled' | 'failed'; expiresAt: number; sessionHash?: string; verifier?: string; nonce?: string; reasonCode?: string };
type Connection = { id: string; kind: 'google_calendar'; ownerId: string; version: number; status: 'connected' | 'refreshing' | 'refresh_unknown' | 'insufficient_scope' | 'revoked' | 'revoke_pending' | 'error'; calendarId: 'primary'; googleSubject?: string; scopes: string[]; accessToken?: string; refreshToken?: string; tokenExpiresAt?: number; refreshExpiresAt?: number; operationId?: string; operationStartedAt?: number; verifiedAt?: string; reasonCode?: string; revocationToken?: string; revocationJobId?: string };
export type GoogleCalendarConfiguration = { clientId?: string; clientSecret?: string; redirectUri?: string; production?: boolean };
export type GoogleCalendarConnectionStatus = { id: string; kind: 'google_calendar'; name: 'Google Calendar'; status: 'unavailable' | 'disconnected' | 'connecting' | 'connected' | 'expired' | 'insufficient_scope' | 'revoked' | 'revoke_pending' | 'error'; available: boolean; reasonCode: string; detail: string; capabilities: { readExisting: boolean; updateExisting: boolean }; tokenExpiresAt?: string; verifiedAt?: string };
const missing = () => new HttpError(503, 'google_oauth_unavailable', 'Google Calendar authorization is not configured on this server. No service is connected.');
const unavailable = (code = 'google_provider_unavailable') => new HttpError(503, code, 'Google Calendar could not be reached. No Calendar action was assumed successful.');
const stateId = (state: string) => `google-oauth:${createHash('sha256').update(state).digest('hex')}`;

/** Per-owner server authorization. Public methods never return credentials except
 * access(), which is restricted to the server adapter/authorized worker boundary. */
export class GoogleCalendarConnections {
  private repo: Repository;
  private fetcher: typeof fetch;
  private identity: GoogleIdentityVerifier;
  private refreshes = new Map<string, Promise<Connection>>();
  constructor(private db: Database, private config: GoogleCalendarConfiguration, dependencies: { fetch?: typeof fetch } = {}) {
    this.repo = new Repository(db); this.fetcher = dependencies.fetch ?? fetch;
    this.identity = new GoogleIdentityVerifier(config.clientId ?? '', this.fetcher);
  }
  private id(owner: string) { return `${owner}:google-calendar`; }
  private configured() {
    if (!this.config.clientId?.trim() || !this.config.clientSecret?.trim() || !this.config.redirectUri) return false;
    try {
      const url = new URL(this.config.redirectUri);
      return !url.username && !url.password && !url.search && !url.hash && url.pathname === '/integrations/google-calendar/callback' && (url.protocol === 'https:' || !this.config.production && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    } catch { return false; }
  }
  private async owner(sql: SQL, owner: string) {
    const [user] = await sql.query('SELECT id,deleted_at FROM users WHERE id=$1 FOR UPDATE', [owner]);
    if (!user || user.deleted_at) throw new HttpError(401, 'unauthorized', 'Sign in to continue.');
  }
  private async session(sql: SQL, owner: string, sessionHash: string) {
    const rows = await sql.query('SELECT token_hash FROM sessions WHERE owner_id=$1 AND token_hash=$2 AND expires_at>clock_timestamp() FOR UPDATE', [owner, sessionHash]);
    if (!rows.length) throw new HttpError(401, 'oauth_session_expired', 'The sign-in that started this connection expired or was revoked. Start again after signing in.');
  }
  private scopes(scopes: string[]) { return GOOGLE_CALENDAR_SCOPES.every(scope => scopes.includes(scope)); }
  private async connection(owner: string) { return this.repo.get<Connection>(owner, 'integration', this.id(owner)); }
  async begin(owner: string, authorization?: string): Promise<{ authorizationUrl: string; expiresAt: number }> {
    if (!this.configured()) throw missing();
    if (!authorization?.startsWith('Bearer ')) throw new HttpError(401, 'unauthorized', 'Sign in to continue.');
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + 10 * 60000;
    await this.db.transaction(async sql => {
      await this.owner(sql, owner); await this.session(sql, owner, hashToken(authorization.slice(7)));
      const repo = this.repo.in(sql), existing = await repo.get<Connection>(owner, 'integration', this.id(owner));
      if (existing?.status === 'revoke_pending') throw new HttpError(409, 'google_revoke_pending', 'Finish revoking the previous connection before connecting another account.');
      if (existing?.status === 'refreshing' && Date.now()-(existing.operationStartedAt ?? 0)<=60000) throw new HttpError(409, 'google_refresh_in_progress', 'Finish the existing authorization refresh before reconnecting.');
      if (existing?.status === 'refreshing') await repo.put(owner,'integration',{ ...existing, version: existing.version+1, status: 'refresh_unknown', accessToken: undefined, operationId: undefined, operationStartedAt: undefined, reasonCode: 'refresh_unconfirmed' });
      for (const pending of await repo.list<State>(owner, 'integration')) if (pending.kind === 'google_calendar_oauth_state' && ['pending','exchanging'].includes(pending.status)) await repo.put(owner, 'integration', { id: pending.id, kind: pending.kind, ownerId: owner, status: 'cancelled', expiresAt: pending.expiresAt });
      await repo.put(owner, 'integration', { id: stateId(state), kind: 'google_calendar_oauth_state', ownerId: owner, status: 'pending', expiresAt, sessionHash: hashToken(authorization.slice(7)), verifier, nonce } satisfies State);
    });
    const url = new URL(AUTHORIZATION_URL);
    url.search = new URLSearchParams({ client_id: this.config.clientId!, redirect_uri: this.config.redirectUri!, response_type: 'code', scope: GOOGLE_CALENDAR_SCOPES.join(' '), access_type: 'offline', prompt: 'consent select_account', state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString();
    return { authorizationUrl: url.toString(), expiresAt };
  }
  async cancel(owner: string) {
    await this.db.transaction(async sql => {
      await this.owner(sql, owner); const repo = this.repo.in(sql);
      for (const state of await repo.list<State>(owner, 'integration')) if (state.kind === 'google_calendar_oauth_state' && ['pending','exchanging'].includes(state.status)) await repo.put(owner, 'integration', { id: state.id, kind: state.kind, ownerId: owner, status: 'cancelled', expiresAt: state.expiresAt });
    });
    return this.status(owner);
  }
  private async token(parameters: Record<string, string>, cleanup: { owner: string; id: string }): Promise<Tokens> {
    let response: Response;
    try { response = await this.fetcher(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ client_id: this.config.clientId!, client_secret: this.config.clientSecret!, ...parameters }).toString(), redirect: 'error', signal: AbortSignal.timeout(10000) }); }
    catch { throw unavailable('google_token_unconfirmed'); }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 400 && body && typeof body === 'object' && (body as any).error === 'invalid_grant') throw new HttpError(401, 'google_token_revoked', 'Google access expired or was revoked. Reconnect this account.');
      throw unavailable(response.status === 429 ? 'google_rate_limited' : 'google_token_rejected');
    }
    const parsed = tokenSchema.safeParse(body); if (!parsed.success) {
      const candidate = body && typeof body === 'object' ? (body as Record<string, unknown>).refresh_token ?? (body as Record<string, unknown>).access_token : undefined;
      if (typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 8192) await this.revokeWithReceipt(cleanup.owner, candidate, cleanup.id);
      throw new HttpError(502, 'google_token_invalid', 'Google returned an incomplete authorization response. Reconnect before using Calendar.');
    }
    return parsed.data;
  }
  private async probe(accessToken: string) {
    let response: Response;
    try { response = await this.fetcher(CALENDAR_PROBE_URL, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000) }); }
    catch { throw unavailable(); }
    if (response.status === 401) throw new HttpError(401, 'google_token_revoked', 'Google access expired or was revoked. Reconnect this account.');
    if (response.status === 403) throw new HttpError(403, 'google_scope_missing', 'Google did not grant the Calendar access required for this operation. Reconnect with the required scope.');
    if (!response.ok) throw unavailable(response.status === 429 ? 'google_rate_limited' : undefined);
    const parsed = z.object({ kind: z.literal('calendar#events'), accessRole: z.literal('owner'), items: z.array(z.object({ id: z.string() })) }).safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new HttpError(502, 'google_calendar_invalid', 'Google did not return a verified owner-calendar response. No connected state was assumed.');
  }
  async callback(raw: unknown): Promise<GoogleCalendarConnectionStatus> {
    if (!this.configured()) throw missing();
    const query = z.object({ state: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code: z.string().min(1).max(4096).optional(), error: z.string().max(128).optional() }).parse(raw);
    if (!!query.code === !!query.error) throw new HttpError(400, 'oauth_invalid_callback', 'The authorization response is incomplete. Start the connection again.');
    const id = stateId(query.state);
    const state = await this.db.transaction(async sql => {
      const [row] = await sql.query("SELECT owner_id FROM resources WHERE id=$1 AND kind='integration'", [id]);
      if (!row) throw new HttpError(400, 'oauth_state_invalid', 'This authorization request is invalid or expired.');
      await this.owner(sql, row.owner_id);
      await sql.query("SELECT id FROM resources WHERE owner_id=$1 AND kind='integration' AND id=$2 FOR UPDATE", [row.owner_id, id]);
      const repo = this.repo.in(sql), current = await repo.get<State>(row.owner_id, 'integration', id);
      if (!current || current.kind !== 'google_calendar_oauth_state' || current.status !== 'pending' || current.expiresAt <= Date.now() || !current.verifier || !current.nonce || !current.sessionHash) throw new HttpError(400, 'oauth_state_invalid', 'This authorization request is invalid or expired.');
      await this.session(sql, current.ownerId, current.sessionHash);
      await repo.put(current.ownerId, 'integration', { ...current, status: query.error ? 'denied' : 'exchanging', ...(query.error ? { verifier: undefined, nonce: undefined, sessionHash: undefined } : {}) }); return current;
    });
    if (query.error) return { ...await this.status(state.ownerId), reasonCode: 'oauth_denied', detail: 'Google authorization was declined. You can reconnect when ready.' };
    let tokens: Tokens | undefined;
    try {
      tokens = await this.token({ code: query.code!, code_verifier: state.verifier!, grant_type: 'authorization_code', redirect_uri: this.config.redirectUri! }, { owner: state.ownerId, id: `${state.id}:revoke` });
      if (!tokens.id_token || !tokens.scope) throw new HttpError(502, 'google_identity_invalid', 'Google did not return account and scope verification. Reconnect Calendar.');
      const subject = await this.identity.subject(tokens.id_token, tokens.access_token, { nonce: state.nonce });
      const scopes = tokens.scope.split(/\s+/).filter(Boolean);
      if (!this.scopes(scopes)) throw new HttpError(403, 'google_scope_missing', 'The required Calendar scope was not granted.');
      await this.probe(tokens.access_token);
      await this.db.transaction(async sql => {
        await this.owner(sql, state.ownerId); await this.session(sql, state.ownerId, state.sessionHash!);
        const repo = this.repo.in(sql), current = await repo.get<State>(state.ownerId, 'integration', id);
        if (current?.status !== 'exchanging') throw new HttpError(409, 'oauth_cancelled', 'This connection was cancelled. Start a new authorization.');
        const previous = await repo.get<Connection>(state.ownerId, 'integration', this.id(state.ownerId));
        if (previous?.status === 'revoke_pending') throw new HttpError(409, 'google_revoke_pending', 'Previous Calendar authorization is still being revoked.');
        if (previous?.googleSubject && previous.googleSubject !== subject && previous.status !== 'revoked') throw new HttpError(409, 'google_account_changed', 'Disconnect the existing Calendar account before connecting another one.');
        await repo.put(state.ownerId, 'integration', { id: this.id(state.ownerId), kind: 'google_calendar', ownerId: state.ownerId, version: (previous?.version ?? 0) + 1, status: 'connected', calendarId: 'primary', googleSubject: subject, scopes, accessToken: tokens!.access_token, refreshToken: tokens!.refresh_token ?? (previous?.googleSubject === subject ? previous.refreshToken : undefined), tokenExpiresAt: Date.now() + tokens!.expires_in * 1000, verifiedAt: new Date().toISOString(), reasonCode: 'authorized' } satisfies Connection);
        await repo.put(state.ownerId, 'integration', { id, kind: state.kind, ownerId: state.ownerId, status: 'consumed', expiresAt: state.expiresAt });
        await repo.audit(state.ownerId, this.id(state.ownerId), 'google_oauth_connected');
      });
      return this.status(state.ownerId);
    } catch (error) {
      if (tokens) await this.revokeWithReceipt(state.ownerId, tokens.refresh_token ?? tokens.access_token, `${state.id}:revoke`);
      await this.db.transaction(async sql => {
        const repo = this.repo.in(sql), current = await repo.get<State>(state.ownerId, 'integration', id);
        if (current?.status === 'exchanging') await repo.put(state.ownerId, 'integration', { id, kind: state.kind, ownerId: state.ownerId, status: 'failed', expiresAt: state.expiresAt, reasonCode: error instanceof HttpError ? error.code : 'oauth_failed' });
        const previous = await repo.get<Connection>(state.ownerId, 'integration', this.id(state.ownerId));
        // Google revocation can invalidate an earlier grant for the same account.
        // Reauthorization failure must never leave a possibly revoked old token usable.
        if (tokens && previous && !['revoked','revoke_pending'].includes(previous.status)) await repo.put(state.ownerId, 'integration', { ...previous, version: previous.version + 1, status: 'error', accessToken: undefined, reasonCode: 'oauth_reauthorization_failed' });
      });
      if (error instanceof HttpError) throw error;
      throw unavailable();
    }
  }
  async status(owner: string): Promise<GoogleCalendarConnectionStatus> {
    const connection = await this.connection(owner);
    const base = { id: this.id(owner), kind: 'google_calendar' as const, name: 'Google Calendar' as const, available: false, capabilities: { readExisting: false, updateExisting: false } };
    if (!this.configured()) return { ...base, status: 'unavailable', reasonCode: 'oauth_not_configured', detail: 'Google Calendar authorization is not configured. No account is connected.' };
    if (!connection) {
      const states = (await this.repo.list<State>(owner, 'integration')).filter(state => state.kind === 'google_calendar_oauth_state');
      const pending = states.some(state => ['pending','exchanging'].includes(state.status) && state.expiresAt > Date.now());
      if (!pending && states.at(-1)?.reasonCode === 'google_scope_missing') return { ...base, status: 'insufficient_scope', reasonCode: 'google_scope_missing', detail: 'Google did not grant the required owned-events Calendar scope.' };
      return { ...base, status: pending ? 'connecting' : 'disconnected', reasonCode: pending ? 'oauth_pending' : 'not_connected', detail: pending ? 'Finish or cancel Google authorization in the browser.' : 'Connect a Google account before using Calendar.' };
    }
    if (connection.status === 'revoked') return { ...base, status: 'revoked', reasonCode: connection.reasonCode ?? 'revoked', detail: 'This Calendar connection is revoked. Reconnect to use it.' };
    if (connection.status === 'revoke_pending') {
      const [job] = connection.revocationJobId ? await this.db.query('SELECT status FROM jobs WHERE owner_id=$1 AND id=$2',[owner,connection.revocationJobId]) : [];
      if (job?.status === 'done') {
        await this.db.transaction(async sql => {
          await this.owner(sql,owner); const repo = this.repo.in(sql), current = await repo.get<Connection>(owner,'integration',this.id(owner));
          if (current?.status === 'revoke_pending' && current.revocationJobId === connection.revocationJobId) await repo.put(owner,'integration',{ id: current.id, ownerId: owner, kind: 'google_calendar', calendarId: 'primary', scopes: [], version: current.version+1, status: 'revoked', reasonCode: 'provider_revoked' });
        });
        return { ...base, status: 'revoked', reasonCode: 'provider_revoked', detail: 'Google confirmed this Calendar authorization was revoked.' };
      }
      return { ...base, status: 'revoke_pending', reasonCode: 'revocation_pending', detail: 'App access is blocked. Google revocation still needs confirmation; retry disconnect.' };
    }
    if (connection.kind !== 'google_calendar' || !connection.googleSubject || !Array.isArray(connection.scopes)) return { ...base, status: 'disconnected', reasonCode: 'legacy_connection_unverified', detail: 'Reconnect Calendar to verify this account and its permissions.' };
    if (!this.scopes(connection.scopes) || connection.status === 'insufficient_scope') return { ...base, status: 'insufficient_scope', reasonCode: 'google_scope_missing', detail: 'Reconnect and grant the required owned-events Calendar scope.' };
    if (connection.status === 'refreshing') return Date.now()-(connection.operationStartedAt ?? 0)>60000 ? { ...base, status: 'expired', reasonCode: 'refresh_unconfirmed', detail: 'A previous token refresh was interrupted. Reconnect before using Calendar.' } : { ...base, status: 'connecting', reasonCode: 'token_refreshing', detail: 'Refreshing Google authorization. No Calendar action has been executed.' };
    if (!connection.accessToken || (connection.tokenExpiresAt ?? 0) <= Date.now() || connection.status === 'refresh_unknown') return { ...base, status: 'expired', reasonCode: connection.reasonCode ?? 'token_expired', detail: connection.status === 'refresh_unknown' ? 'Token refresh was unconfirmed. Reconnect before another Calendar action.' : 'Google authorization needs refresh or reconnection.' };
    if (connection.status !== 'connected') return { ...base, status: 'error', reasonCode: connection.reasonCode ?? 'connection_error', detail: 'Calendar access needs attention before use.' };
    return { ...base, status: 'connected', available: true, capabilities: { readExisting: true, updateExisting: true }, reasonCode: 'authorized', detail: 'Primary owner calendar authorized. Provider access is checked before use.', tokenExpiresAt: new Date(connection.tokenExpiresAt!).toISOString(), verifiedAt: connection.verifiedAt };
  }
  async list(owner: string) { return [await this.status(owner)]; }
  private async refresh(owner: string): Promise<Connection> {
    const existing = this.refreshes.get(owner); if (existing) return existing;
    const operation = this.runRefresh(owner).finally(() => { this.refreshes.delete(owner); }); this.refreshes.set(owner, operation); return operation;
  }
  private async runRefresh(owner: string): Promise<Connection> {
    const claimed = await this.db.transaction(async sql => {
      await this.owner(sql, owner); await sql.query("SELECT id FROM resources WHERE owner_id=$1 AND kind='integration' AND id=$2 FOR UPDATE", [owner, this.id(owner)]);
      const repo = this.repo.in(sql), connection = await repo.get<Connection>(owner, 'integration', this.id(owner));
      if (!connection || connection.kind !== 'google_calendar' || !connection.googleSubject || !this.scopes(connection.scopes ?? [])) throw new HttpError(409, 'google_reconnect_required', 'Reconnect a verified Google Calendar account before use.');
      if (connection.status === 'refreshing') {
        if (Date.now()-(connection.operationStartedAt ?? 0)<=60000) return { wait: true as const, connection };
        const unknown: Connection = { ...connection, version: connection.version+1, status: 'refresh_unknown', accessToken: undefined, operationId: undefined, operationStartedAt: undefined, reasonCode: 'refresh_unconfirmed' };
        await repo.put(owner,'integration',unknown); return { wait: false as const, connection: unknown };
      }
      if (connection.status !== 'connected') throw new HttpError(409, 'google_reconnect_required', 'Calendar authorization needs attention before use.');
      if ((connection.tokenExpiresAt ?? 0) > Date.now() + 60000 && connection.accessToken) return { wait: false as const, connection };
      if (!connection.refreshToken) throw new HttpError(401, 'google_reconnect_required', 'Reconnect Google Calendar to renew its authorization.');
      const refreshing: Connection = { ...connection, status: 'refreshing', operationId: randomUUID(), operationStartedAt: Date.now(), version: connection.version + 1 };
      await repo.put(owner, 'integration', refreshing); return { wait: false as const, connection: refreshing };
    });
    if (claimed.wait) {
      for (let attempt = 0; attempt < 240; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50)); const current = await this.connection(owner);
        if (!current || current.status !== 'refreshing') {
          if (current?.status === 'connected' && current.accessToken && (current.tokenExpiresAt ?? 0) > Date.now()) return current;
          throw new HttpError(409, 'google_reconnect_required', 'Calendar refresh did not produce a usable authorization. Reconnect before use.');
        }
      }
      throw new HttpError(409, 'google_refresh_in_progress', 'The existing token refresh is still unresolved. No duplicate refresh was sent.');
    }
    const connection = claimed.connection;
    if (connection.status !== 'refreshing') {
      if (connection.status !== 'connected') throw new HttpError(409,'google_reconnect_required','A previous Calendar refresh was unconfirmed. Reconnect before use.');
      return connection;
    }
    let tokens: Tokens | undefined;
    try {
      tokens = await this.token({ grant_type: 'refresh_token', refresh_token: connection.refreshToken! }, { owner, id: `${connection.id}:refresh:${connection.operationId}:revoke` });
      if (tokens.id_token) await this.identity.subject(tokens.id_token, tokens.access_token, { expectedSubject: connection.googleSubject });
      const scopes = tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : connection.scopes;
      if (!this.scopes(scopes)) throw new HttpError(403, 'google_scope_missing', 'Calendar access was not granted after refresh.');
      return await this.db.transaction(async sql => {
        await this.owner(sql, owner); const repo = this.repo.in(sql), current = await repo.get<Connection>(owner, 'integration', this.id(owner));
        if (current?.status !== 'refreshing' || current.operationId !== connection.operationId) throw new HttpError(409, 'google_refresh_cancelled', 'The connection changed while Google authorization was refreshing.');
        const updated: Connection = { ...current, version: current.version + 1, status: 'connected', accessToken: tokens!.access_token, refreshToken: tokens!.refresh_token ?? current.refreshToken, tokenExpiresAt: Date.now() + tokens!.expires_in * 1000, scopes, operationId: undefined, operationStartedAt: undefined, reasonCode: 'authorized' };
        await repo.put(owner, 'integration', updated); return updated;
      });
    } catch (error) {
      if (tokens) await this.revokeWithReceipt(owner, tokens.refresh_token ?? tokens.access_token, `${connection.id}:refresh:${connection.operationId}:revoke`);
      await this.db.transaction(async sql => {
        const repo = this.repo.in(sql), current = await repo.get<Connection>(owner, 'integration', this.id(owner));
        if (current?.status !== 'refreshing' || current.operationId !== connection.operationId) return;
        const revoked = error instanceof HttpError && error.code === 'google_token_revoked', insufficient = error instanceof HttpError && error.code === 'google_scope_missing';
        await repo.put(owner, 'integration', { ...current, status: revoked ? 'revoked' : insufficient ? 'insufficient_scope' : 'refresh_unknown', accessToken: undefined, ...(revoked ? { refreshToken: undefined } : {}), version: current.version + 1, operationId: undefined, operationStartedAt: undefined, reasonCode: revoked ? 'google_token_revoked' : insufficient ? 'google_scope_missing' : 'refresh_unconfirmed' });
      });
      if (error instanceof HttpError) throw error; throw unavailable();
    }
  }
  async access(owner: string): Promise<{ accessToken: string; calendarId: 'primary'; integrationId: string; version: number }> {
    if (!this.configured()) throw missing(); const connection = await this.refresh(owner);
    try { await this.probe(connection.accessToken!); }
    catch (error) {
      if (error instanceof HttpError && ['google_token_revoked','google_scope_missing'].includes(error.code)) await this.db.transaction(async sql => {
        await this.owner(sql, owner); const repo = this.repo.in(sql), current = await repo.get<Connection>(owner, 'integration', this.id(owner));
        if (current?.version === connection.version) await repo.put(owner, 'integration', { ...current, version: current.version + 1, status: error.code === 'google_token_revoked' ? 'revoked' : 'insufficient_scope', accessToken: undefined, reasonCode: error.code });
      });
      throw error;
    }
    const current = await this.connection(owner);
    if (current?.status !== 'connected' || current.version !== connection.version || !current.accessToken) throw new HttpError(409, 'google_connection_changed', 'Calendar connection changed during verification. No action was dispatched.');
    return { accessToken: current.accessToken, calendarId: 'primary', integrationId: current.id, version: current.version };
  }
  private async revokeToken(token: string) {
    let response: Response;
    try { response = await this.fetcher(REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString(), redirect: 'error', signal: AbortSignal.timeout(10000) }); }
    catch { throw unavailable('google_revocation_unconfirmed'); }
    if (response.status !== 200) throw unavailable('google_revocation_unconfirmed');
  }
  /** Worker-only fixed-endpoint cleanup; valid for tombstoned owners. */
  async cleanupToken(token: string): Promise<void> { z.string().min(1).max(8192).parse(token); await this.revokeToken(token); }
  private async revokeWithReceipt(owner: string, token: string, id: string) {
    await this.repo.enqueue(owner, null, 'google_revoke', { token }, 30000, id);
    try {
      await this.revokeToken(token);
      // Authoritative remote completion fences a concurrent cleanup worker too.
      await this.db.query("UPDATE jobs SET status='done',payload=$3,lease_until=NULL,lease_token=NULL,worker_id=NULL,last_error=NULL WHERE owner_id=$1 AND id=$2 AND status IN ('queued','running','failed')", [owner,id,this.db.encrypt({revoked:true})]);
    } catch { /* Durable encrypted cleanup remains pending; no false remote success. */ }
  }
  async queueAccountCleanup(owner: string, sql?: SQL): Promise<void> {
    if (!sql) return this.db.transaction(scoped => this.queueAccountCleanup(owner,scoped));
    const repo = this.repo.in(sql), seen = new Set<string>();
    for (const connection of await repo.list<Connection>(owner,'integration')) {
      if (connection.kind !== 'google_calendar') continue;
      const token = [connection.revocationToken,connection.refreshToken,connection.accessToken].find(value => typeof value === 'string' && value.length > 0 && value.length <= 8192);
      if (!token || seen.has(token)) continue; seen.add(token);
      await repo.enqueue(owner,null,'google_revoke',{ token },0,connection.revocationJobId ?? `${connection.id}:revoke:${connection.version ?? 0}`);
    }
  }
  async disconnect(owner: string): Promise<GoogleCalendarConnectionStatus> {
    const pending = await this.db.transaction(async sql => {
      await this.owner(sql, owner); const repo = this.repo.in(sql), connection = await repo.get<Connection>(owner, 'integration', this.id(owner));
      for (const state of await repo.list<State>(owner, 'integration')) if (state.kind === 'google_calendar_oauth_state' && ['pending','exchanging'].includes(state.status)) await repo.put(owner, 'integration', { id: state.id, kind: state.kind, ownerId: owner, status: 'cancelled', expiresAt: state.expiresAt });
      if (!connection) return undefined;
      const revocationToken = connection.revocationToken ?? connection.refreshToken ?? connection.accessToken;
      const next: Connection = { ...connection, version: connection.version + 1, status: revocationToken ? 'revoke_pending' : 'revoked', revocationToken, revocationJobId: connection.revocationJobId ?? `${connection.id}:revoke:${connection.version + 1}`, accessToken: undefined, refreshToken: undefined, operationId: undefined, operationStartedAt: undefined, reasonCode: revocationToken ? 'revocation_pending' : 'disconnected' };
      await repo.put(owner, 'integration', next); return next;
    });
    if (pending?.revocationToken) {
      try {
        await this.revokeWithReceipt(owner,pending.revocationToken,pending.revocationJobId!);
        const [cleanup] = await this.db.query('SELECT status FROM jobs WHERE owner_id=$1 AND id=$2', [owner,pending.revocationJobId]);
        if (cleanup?.status !== 'done') return this.status(owner);
        await this.db.transaction(async sql => {
          await this.owner(sql, owner); const repo = this.repo.in(sql), current = await repo.get<Connection>(owner, 'integration', this.id(owner));
          if (current?.status === 'revoke_pending' && current.revocationToken === pending.revocationToken) await repo.put(owner, 'integration', { id: current.id, ownerId: owner, kind: 'google_calendar', calendarId: 'primary', scopes: [], version: current.version + 1, status: 'revoked', reasonCode: 'provider_revoked' });
        });
      } catch { /* Local use remains blocked; retry the same revocation token. */ }
    }
    return this.status(owner);
  }
}
