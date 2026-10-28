import { openTestDatabase } from './support/test-database.js';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database, Repository } from '../apps/server/src/db.js';
import { createSession, hashToken, newUser } from '../apps/server/src/auth.js';
import {
  GoogleCalendarConnections,
  GOOGLE_CALENDAR_SCOPES,
} from '../apps/server/src/integrations/google-calendar.js';
import { Engine } from '../apps/server/src/engine.js';
import type { Config } from '../apps/server/src/config.js';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = {
  ...keys.publicKey.export({ format: 'jwk' }),
  kid: 'fixture-key',
  alg: 'RS256',
  use: 'sig',
};
const config = {
  clientId: 'fictional-client.apps.googleusercontent.com',
  clientSecret: 'fictional-server-secret',
  redirectUri: 'https://klnk.example/integrations/google-calendar/callback',
  production: true,
};
const databases: Database[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});
const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
function jwt(nonce: string, claims: Record<string, unknown> = {}) {
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: 'fixture-key', typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: config.clientId,
      sub: 'fictional-google-subject',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce,
      ...claims,
    }),
  ).toString('base64url');
  return `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), keys.privateKey).toString('base64url')}`;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const db = await openTestDatabase({ dataDir: 'memory://' });
  databases.push(db);
  const owner = await newUser(
    db,
    `${randomUUID()}@example.invalid`,
    'A fictional OAuth fixture password',
  );
  const session = await createSession(db, owner.id);
  const state = {
    nonce: '',
    browserBinding: '',
    challenge: '',
    tokenCalls: 0,
    refreshCalls: 0,
    revokes: 0,
    scopes: GOOGLE_CALENDAR_SCOPES.join(' '),
    claims: {} as Record<string, unknown>,
    revokeStatus: 200,
    probeStatus: 200,
    refresh: undefined as ((parameters: URLSearchParams) => Promise<Response>) | undefined,
    exchange: undefined as ((parameters: URLSearchParams) => Promise<Response>) | undefined,
  };
  const fetcher = vi.fn(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      expect(init?.redirect).toBe('error');
      if (url === 'https://accounts.google.com/.well-known/openid-configuration')
        return json({
          issuer: 'https://accounts.google.com',
          jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
        });
      if (url === 'https://www.googleapis.com/oauth2/v3/certs')
        return json({ keys: [publicKey] }, 200, { 'cache-control': 'max-age=600' });
      if (url === 'https://oauth2.googleapis.com/token') {
        const parameters = new URLSearchParams(init?.body as string);
        expect(parameters.get('client_secret')).toBe(config.clientSecret);
        if (parameters.get('grant_type') === 'refresh_token') {
          state.refreshCalls++;
          return state.refresh
            ? state.refresh(parameters)
            : json({
                access_token: 'fictional-refreshed-access',
                token_type: 'Bearer',
                expires_in: 3600,
                refresh_token: 'fictional-rotated-refresh',
                scope: state.scopes,
              });
        }
        state.tokenCalls++;
        expect(
          createHash('sha256').update(parameters.get('code_verifier')!).digest('base64url'),
        ).toBe(state.challenge);
        return state.exchange
          ? state.exchange(parameters)
          : json({
              access_token: 'fictional-access',
              token_type: 'Bearer',
              expires_in: 3600,
              refresh_token: 'fictional-refresh',
              scope: state.scopes,
              id_token: jwt(state.nonce, state.claims),
            });
      }
      if (url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events?'))
        return state.probeStatus === 200
          ? json({ kind: 'calendar#events', accessRole: 'owner', items: [] })
          : json({ error: 'fictional-private-provider-body' }, state.probeStatus);
      if (url === 'https://oauth2.googleapis.com/revoke') {
        state.revokes++;
        return json({}, state.revokeStatus);
      }
      throw new Error('Unexpected fixture network URL');
    },
  );
  const service = new GoogleCalendarConnections(db, config, { fetch: fetcher as typeof fetch });
  async function begin() {
    const result = await service.begin(owner.id, `Bearer ${session}`);
    const url = new URL(result.authorizationUrl);
    state.nonce = url.searchParams.get('nonce')!;
    state.challenge = url.searchParams.get('code_challenge')!;
    state.browserBinding = result.browserBinding;
    return { result, url, state: url.searchParams.get('state')! };
  }
  async function connected() {
    const flow = await begin();
    await service.callback({ state: flow.state, code: 'fictional-code' }, state.browserBinding);
    return flow;
  }
  async function expire() {
    const repo = new Repository(db),
      connection = await repo.get<any>(owner.id, 'integration', `${owner.id}:google-calendar`);
    await repo.put(owner.id, 'integration', { ...connection, tokenExpiresAt: Date.now() - 1000 });
  }
  return { db, owner: owner.id, session, service, state, fetcher, begin, connected, expire };
}

describe('CAL-01 owner-bound Google OAuth lifecycle', () => {
  it('rejects a forwarded consent URL without the initiating browser cookie before any token exchange', async () => {
    const f = await fixture();
    const flow = await f.begin();
    expect(flow.url.toString()).not.toContain(flow.result.browserBinding);
    const states = await new Repository(f.db).list<{ browserBindingHash: string }>(
      f.owner,
      'integration',
    );
    expect(states[0].browserBindingHash).toBe(hashToken(flow.result.browserBinding));

    for (const binding of [undefined, 'x'.repeat(43), '', `${flow.result.browserBinding};extra`]) {
      await expect(
        f.service.callback({ state: flow.state, code: 'victim-google-consent' }, binding),
      ).rejects.toMatchObject({ code: 'oauth_browser_mismatch' });
      expect(f.state.tokenCalls).toBe(0);
      expect((await f.service.status(f.owner)).status).toBe('connecting');
    }
    // Invalid browsers cannot consume the real browser's pending flow.
    await expect(
      f.service.callback({ state: flow.state, code: 'fictional-code' }, flow.result.browserBinding),
    ).resolves.toMatchObject({ status: 'connected' });
    expect(f.state.tokenCalls).toBe(1);
  });
  it('keeps missing or unsafe OAuth configuration unavailable without a provider request', async () => {
    const f = await fixture();
    const service = new GoogleCalendarConnections(f.db, {}, { fetch: f.fetcher as typeof fetch });
    expect(await service.status(f.owner)).toMatchObject({
      status: 'unavailable',
      available: false,
    });
    await expect(service.begin(f.owner, `Bearer ${f.session}`)).rejects.toMatchObject({
      code: 'google_oauth_unavailable',
    });
    expect(f.fetcher).not.toHaveBeenCalled();
    const unsafe = new GoogleCalendarConnections(f.db, {
      ...config,
      redirectUri: 'http://evil.example/callback',
    });
    expect((await unsafe.status(f.owner)).status).toBe('unavailable');
  });
  it('uses PKCE/state/nonce and binds verified tokens to the owner without exposing credentials', async () => {
    const f = await fixture();
    const flow = await f.begin();
    expect(flow.url.origin + flow.url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(flow.url.searchParams.get('scope')).toBe(GOOGLE_CALENDAR_SCOPES.join(' '));
    expect(flow.url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(flow.url.searchParams.has('client_secret')).toBe(false);
    expect((await f.service.list(f.owner))[0]).toMatchObject({
      status: 'connecting',
      available: false,
    });
    const result = await f.service.callback(
      { state: flow.state, code: 'fictional-code' },
      f.state.browserBinding,
    );
    expect(result).toMatchObject({ status: 'connected', available: true });
    const visible = JSON.stringify(await f.service.list(f.owner));
    for (const secret of [
      'fictional-access',
      'fictional-refresh',
      'fictional-google-subject',
      hashToken(f.session),
      f.state.nonce,
    ])
      expect(visible).not.toContain(secret);
    const rows = await f.db.query(
      "SELECT payload FROM resources WHERE owner_id=$1 AND kind='integration'",
      [f.owner],
    );
    expect(JSON.stringify(rows)).not.toContain('fictional-access');
    expect(f.state.tokenCalls).toBe(1);
    expect(await f.service.access(f.owner)).toMatchObject({
      accessToken: 'fictional-access',
      calendarId: 'primary',
    });
    await expect(
      f.service.callback({ state: flow.state, code: 'fictional-code' }, f.state.browserBinding),
    ).rejects.toMatchObject({ code: 'oauth_state_invalid' });
    expect(f.state.tokenCalls).toBe(1);
  });
  it('does not exchange a state after initiating session logout or expiry', async () => {
    const f = await fixture();
    const flow = await f.begin();
    await f.db.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(f.session)]);
    await expect(
      f.service.callback({ state: flow.state, code: 'fictional-code' }, f.state.browserBinding),
    ).rejects.toMatchObject({ code: 'oauth_session_expired' });
    expect(f.state.tokenCalls).toBe(0);
  });
  it('rejects an invented state, cross-owner session and expired state before exchange', async () => {
    const f = await fixture();
    await expect(f.service.begin(randomUUID(), `Bearer ${f.session}`)).rejects.toMatchObject({
      statusCode: 401,
    });
    const other = await newUser(
      f.db,
      'oauth-other@example.invalid',
      'Another fictional OAuth password',
    );
    await expect(f.service.begin(other.id, `Bearer ${f.session}`)).rejects.toMatchObject({
      code: 'oauth_session_expired',
    });
    await expect(
      f.service.callback({ state: 'a'.repeat(43), code: 'fictional-code' }),
    ).rejects.toMatchObject({ code: 'oauth_state_invalid' });
    const flow = await f.begin(),
      repo = new Repository(f.db);
    const states = await repo.list<any>(f.owner, 'integration');
    const saved = states.find((value) => value.kind === 'google_calendar_oauth_state');
    await repo.put(f.owner, 'integration', { ...saved, expiresAt: Date.now() - 1 });
    await expect(
      f.service.callback({ state: flow.state, code: 'fictional-code' }, f.state.browserBinding),
    ).rejects.toMatchObject({ code: 'oauth_state_invalid' });
    expect(f.state.tokenCalls).toBe(0);
  });
  it('consumes denial or cancellation without a token request', async () => {
    const f = await fixture();
    let flow = await f.begin();
    expect(
      await f.service.callback(
        { state: flow.state, error: 'access_denied' },
        f.state.browserBinding,
      ),
    ).toMatchObject({
      available: false,
      reasonCode: 'oauth_denied',
    });
    flow = await f.begin();
    await f.service.cancel(f.owner);
    await expect(
      f.service.callback({ state: flow.state, code: 'fictional-code' }, f.state.browserBinding),
    ).rejects.toMatchObject({ code: 'oauth_state_invalid' });
    expect(f.state.tokenCalls).toBe(0);
  });
  it.each([
    { aud: 'another-client' },
    { iss: 'https://evil.example' },
    { nonce: 'wrong-nonce' },
    { exp: 1 },
    { at_hash: 'wrong-access-token-binding' },
  ])('rejects signed identity with incorrect claims %j', async (claims) => {
    const f = await fixture();
    f.state.claims = claims;
    const flow = await f.begin();
    await expect(
      f.service.callback({ state: flow.state, code: 'fictional-code' }, f.state.browserBinding),
    ).rejects.toMatchObject({ code: 'google_identity_invalid' });
    expect((await f.service.status(f.owner)).available).toBe(false);
  });
  it('does not present a partial scope as a connected Calendar account', async () => {
    const f = await fixture();
    f.state.scopes = 'openid';
    const flow = await f.begin();
    await expect(
      f.service.callback({ state: flow.state, code: 'fictional-code' }, f.state.browserBinding),
    ).rejects.toMatchObject({ code: 'google_scope_missing' });
    expect(await f.service.status(f.owner)).toMatchObject({
      status: 'insufficient_scope',
      available: false,
    });
  });
  it('coalesces refresh across service instances and persists rotating refresh tokens', async () => {
    const f = await fixture();
    await f.connected();
    await f.expire();
    const pending = deferred<Response>();
    f.state.refresh = async (parameters) => {
      expect(parameters.get('refresh_token')).toBe('fictional-refresh');
      return pending.promise;
    };
    const second = new GoogleCalendarConnections(f.db, config, {
      fetch: f.fetcher as typeof fetch,
    });
    const a = f.service.access(f.owner),
      b = second.access(f.owner);
    while (!f.state.refreshCalls) await new Promise((resolve) => setTimeout(resolve, 5));
    pending.resolve(
      json({
        access_token: 'fictional-new-access',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'fictional-new-refresh',
        scope: GOOGLE_CALENDAR_SCOPES.join(' '),
      }),
    );
    const results = await Promise.all([a, b]);
    expect(results.every((result) => result.accessToken === 'fictional-new-access')).toBe(true);
    expect(f.state.refreshCalls).toBe(1);
    await f.expire();
    f.state.refresh = async (parameters) => {
      expect(parameters.get('refresh_token')).toBe('fictional-new-refresh');
      return json({
        access_token: 'fictional-next-access',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    };
    await f.service.access(f.owner);
    expect(f.state.refreshCalls).toBe(2);
  });
  it('revoked refresh tokens require reconnect without another automatic refresh', async () => {
    const f = await fixture();
    await f.connected();
    await f.expire();
    f.state.refresh = async () => json({ error: 'invalid_grant' }, 400);
    await expect(f.service.access(f.owner)).rejects.toMatchObject({ code: 'google_token_revoked' });
    expect((await f.service.status(f.owner)).status).toBe('revoked');
    await expect(f.service.access(f.owner)).rejects.toMatchObject({
      code: 'google_reconnect_required',
    });
    expect(f.state.refreshCalls).toBe(1);
  });
  it('ambiguous refresh remains blocked and does not replay after reconstructing the service', async () => {
    const f = await fixture();
    await f.connected();
    await f.expire();
    f.state.refresh = async () => {
      throw new TypeError('fictional private provider detail');
    };
    await expect(f.service.access(f.owner)).rejects.toMatchObject({
      code: 'google_token_unconfirmed',
    });
    expect(await f.service.status(f.owner)).toMatchObject({
      status: 'expired',
      available: false,
      reasonCode: 'refresh_unconfirmed',
    });
    const restarted = new GoogleCalendarConnections(f.db, config, {
      fetch: f.fetcher as typeof fetch,
    });
    await expect(restarted.access(f.owner)).rejects.toMatchObject({
      code: 'google_reconnect_required',
    });
    expect(f.state.refreshCalls).toBe(1);
  });
  it('an interrupted process refresh becomes reconnect-required without repeating the token request', async () => {
    const f = await fixture();
    await f.connected();
    const repo = new Repository(f.db),
      connection = await repo.get<any>(f.owner, 'integration', `${f.owner}:google-calendar`);
    await repo.put(f.owner, 'integration', {
      ...connection,
      status: 'refreshing',
      operationId: randomUUID(),
      operationStartedAt: Date.now() - 120000,
    });
    const restarted = new GoogleCalendarConnections(f.db, config, {
      fetch: f.fetcher as typeof fetch,
    });
    await expect(restarted.access(f.owner)).rejects.toMatchObject({
      code: 'google_reconnect_required',
    });
    expect(await restarted.status(f.owner)).toMatchObject({
      status: 'expired',
      reasonCode: 'refresh_unconfirmed',
      available: false,
    });
    expect(f.state.refreshCalls).toBe(0);
  });
  it('disconnect blocks local use immediately, retains failed revocation and retries the same grant', async () => {
    const f = await fixture();
    await f.connected();
    f.state.revokeStatus = 503;
    expect(await f.service.disconnect(f.owner)).toMatchObject({
      status: 'revoke_pending',
      available: false,
    });
    await expect(f.service.access(f.owner)).rejects.toMatchObject({
      code: 'google_reconnect_required',
    });
    await expect(f.begin()).rejects.toMatchObject({ code: 'google_revoke_pending' });
    f.state.revokeStatus = 200;
    expect(await f.service.disconnect(f.owner)).toMatchObject({
      status: 'revoked',
      available: false,
    });
    expect(f.state.revokes).toBe(2);
  });
  it('worker-confirmed revocation clears retained credentials and updates the public status', async () => {
    const f = await fixture();
    await f.connected();
    f.state.revokeStatus = 503;
    await f.service.disconnect(f.owner);
    f.state.revokeStatus = 200;
    const engine = new Engine(f.db, { provider: 'simulator', embeddedWorker: false } as Config);
    engine.googleRevoke = (token) => f.service.cleanupToken(token);
    expect(await engine.tick(true)).toBe(true);
    expect(await f.service.status(f.owner)).toMatchObject({ status: 'revoked', available: false });
    const connection = await new Repository(f.db).get<any>(
      f.owner,
      'integration',
      `${f.owner}:google-calendar`,
    );
    expect(connection.revocationToken).toBeUndefined();
    expect(connection.refreshToken).toBeUndefined();
    const [job] = await f.db.query(
      "SELECT payload FROM jobs WHERE owner_id=$1 AND kind='google_revoke'",
      [f.owner],
    );
    expect(f.db.decrypt(job.payload)).toEqual({ revoked: true });
  });
  it('preserves one encrypted cleanup intent for tombstoned accounts including duplicate legacy grants', async () => {
    const f = await fixture();
    await f.connected();
    const repo = new Repository(f.db);
    await repo.put(f.owner, 'integration', {
      id: 'legacy-google-grant',
      kind: 'google_calendar',
      refreshToken: 'fictional-refresh',
    });
    await f.db.transaction(async (sql) => {
      await f.service.queueAccountCleanup(f.owner, sql);
      await sql.query('DELETE FROM resources WHERE owner_id=$1', [f.owner]);
      await sql.query('UPDATE users SET deleted_at=now() WHERE id=$1', [f.owner]);
    });
    const jobs = await f.db.query(
      "SELECT id FROM jobs WHERE owner_id=$1 AND kind='google_revoke'",
      [f.owner],
    );
    expect(jobs).toHaveLength(1);
    const engine = new Engine(f.db, { provider: 'simulator', embeddedWorker: false } as Config);
    engine.googleRevoke = (token) => f.service.cleanupToken(token);
    expect(await engine.tick(true)).toBe(true);
    const [job] = await f.db.query('SELECT status,payload FROM jobs WHERE id=$1', [jobs[0].id]);
    expect(job.status).toBe('done');
    expect(f.db.decrypt(job.payload)).toEqual({ revoked: true });
    expect(
      (
        await f.db.query('SELECT count(*)::int AS total FROM resources WHERE owner_id=$1', [
          f.owner,
        ])
      )[0].total,
    ).toBe(0);
  });
  it('a late token response after logout cannot save a connected account', async () => {
    const f = await fixture();
    const flow = await f.begin(),
      pending = deferred<Response>();
    f.state.exchange = async () => pending.promise;
    const callback = f.service.callback(
      { state: flow.state, code: 'fictional-code' },
      f.state.browserBinding,
    );
    const rejected = expect(callback).rejects.toMatchObject({ code: 'oauth_session_expired' });
    while (!f.state.tokenCalls) await new Promise((resolve) => setTimeout(resolve, 5));
    await f.db.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(f.session)]);
    pending.resolve(
      json({
        access_token: 'fictional-late-access',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'fictional-late-refresh',
        scope: GOOGLE_CALENDAR_SCOPES.join(' '),
        id_token: jwt(f.state.nonce),
      }),
    );
    await rejected;
    expect((await f.service.status(f.owner)).available).toBe(false);
    expect(f.state.revokes).toBe(1);
  });
  it('retains encrypted revocation work when a late authorization cannot be remotely cleaned up', async () => {
    const f = await fixture();
    const flow = await f.begin(),
      pending = deferred<Response>();
    f.state.exchange = async () => pending.promise;
    f.state.revokeStatus = 503;
    const callback = f.service.callback(
      { state: flow.state, code: 'fictional-code' },
      f.state.browserBinding,
    );
    const rejected = expect(callback).rejects.toMatchObject({ code: 'oauth_session_expired' });
    while (!f.state.tokenCalls) await new Promise((resolve) => setTimeout(resolve, 5));
    await f.db.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(f.session)]);
    pending.resolve(
      json({
        access_token: 'fictional-late-access',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'fictional-late-refresh',
        scope: GOOGLE_CALENDAR_SCOPES.join(' '),
        id_token: jwt(f.state.nonce),
      }),
    );
    await rejected;
    const jobs = await f.db.query(
      'SELECT kind,status,payload,last_error FROM jobs WHERE owner_id=$1',
      [f.owner],
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'google_revoke', status: 'queued', last_error: null });
    expect(JSON.stringify(jobs)).not.toContain('fictional-late-refresh');
    expect(f.db.decrypt(jobs[0].payload)).toEqual({ token: 'fictional-late-refresh' });
  });
});
