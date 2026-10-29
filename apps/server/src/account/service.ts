import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ProfileSchema } from '../../../../packages/domain/src/index.js';
import { Database, Repository, type SQL } from '../db.js';
import { checkPassword, hashPassword, hashToken } from '../auth.js';
import { HttpError } from '../errors.js';
import { consumeLimit } from '../request-limits.js';
import { logger } from '../logging.js';

export const AccountEmailSchema = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
export const AccountPasswordSchema = z.string().min(12).max(128);
export const AccountLinkTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const registerInput = z
  .object({
    name: ProfileSchema.shape.name,
    email: AccountEmailSchema,
    password: AccountPasswordSchema,
  })
  .strict();
const linkPayloadSchema = z
  .object({
    version: z.literal(1),
    email: AccountEmailSchema,
    credentialBinding: z.string().regex(/^[a-f0-9]{64}$/),
    nextEmail: AccountEmailSchema.optional(),
  })
  .strict();
type ChallengeKind = 'verify_email' | 'password_reset' | 'email_change';
type LinkPayload = z.infer<typeof linkPayloadSchema>;
type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  email_verified_at: string | Date | null;
  deleted_at: string | Date | null;
};
type ChallengeRow = { id: string; owner_id: string; kind: ChallengeKind; payload: string };
export interface AccountConfiguration {
  production?: boolean;
  publicAppUrl?: string;
  mailEnabled?: boolean;
  onSessionsRevoked?: (owner: string) => Promise<void>;
}

const invalidLink = () =>
  new HttpError(
    400,
    'account_link_invalid',
    'This account link is invalid or expired. Request a new link.',
  );
const unauthorized = () =>
  new HttpError(401, 'unauthorized', 'Sign in again to manage this account.');
const requestMessage =
  'If eligible, an account link is queued. Delivery requires configured email.';

/** Reauthentication is bound to this exact bearer, never a global owner flag. */
export async function requireRecentReauthentication(
  db: Database,
  owner: string,
  sessionHash: string,
  sql: SQL = db,
): Promise<void> {
  if (sql === db)
    return db.transaction(async (scoped) => {
      await scoped.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [owner]);
      await requireRecentReauthentication(db, owner, sessionHash, scoped);
    });
  const rows = await sql.query(
    `SELECT s.token_hash FROM sessions s JOIN users u ON u.id=s.owner_id WHERE s.owner_id=$1 AND s.token_hash=$2 AND u.deleted_at IS NULL AND s.expires_at>clock_timestamp() AND s.last_used_at>clock_timestamp()-interval '30 minutes' AND s.reauth_until>clock_timestamp()`,
    [owner, sessionHash],
  );
  if (!rows.length)
    throw new HttpError(
      403,
      'reauthentication_required',
      'Confirm your current password again before this action.',
    );
}

/** Account links contain no authority beyond their one explicit, short-lived
 * operation. Tokens are hashed; their outbound email content is encrypted. */
export class AccountService {
  private readonly appUrl?: string;
  constructor(
    private db: Database,
    private config: AccountConfiguration = {},
  ) {
    if (config.production && !config.publicAppUrl && !config.mailEnabled) return;
    const url = new URL(config.publicAppUrl ?? 'http://localhost:8081/');
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (config.production && url.protocol !== 'https:')
    )
      throw new Error('PUBLIC_APP_URL must be a trusted app URL using HTTPS in production.');
    this.appUrl = url.href;
  }
  private accepted() {
    return {
      accepted: true as const,
      status: 'pending' as const,
      delivery: this.config.mailEnabled ? ('configured' as const) : ('disabled' as const),
      message: requestMessage,
    };
  }
  private async sessionsRevoked(owner: string) {
    // Provider cleanup runs after the credential transaction releases all locks.
    // An uncertain close cannot undo revocation or imply a provider session ended.
    try {
      await this.config.onSessionsRevoked?.(owner);
    } catch {
      logger.error({ event: 'account_session_close_unconfirmed', reasonCode: 'operation_failed' });
    }
  }
  private async activeUser(sql: SQL, owner: string): Promise<UserRow> {
    const [user] = await sql.query<UserRow>(
      'SELECT id,email,password_hash,email_verified_at,deleted_at FROM users WHERE id=$1 FOR UPDATE',
      [owner],
    );
    if (!user || user.deleted_at) throw unauthorized();
    return user;
  }
  private async activeSession(sql: SQL, owner: string, sessionHash: string) {
    const [row] = await sql.query<{ token_hash: string; reauthenticated: boolean }>(
      `SELECT token_hash,(reauth_until>clock_timestamp()) AS reauthenticated FROM sessions WHERE owner_id=$1 AND token_hash=$2 AND expires_at>clock_timestamp() AND last_used_at>clock_timestamp()-interval '30 minutes' FOR UPDATE`,
      [owner, sessionHash],
    );
    if (!row) throw unauthorized();
    return row;
  }
  private async verifyPassword(user: UserRow, password: string) {
    if (!(await checkPassword(password, user.password_hash)))
      throw new HttpError(403, 'password_incorrect', 'The current password is incorrect.');
  }

  async register(input: unknown) {
    const parsed = registerInput.parse(input);
    await consumeLimit(this.db, `account-register:${parsed.email}`, 3, 3600000);
    // Pay the same password work factor for new and duplicate registrations.
    const passwordHash = await hashPassword(parsed.password),
      id = randomUUID();
    await this.db.transaction(async (sql) => {
      const inserted = await sql.query<{ id: string }>(
        'INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id',
        [id, parsed.email, passwordHash],
      );
      const [existing] = await sql.query<UserRow>(
        'SELECT id,email,password_hash,email_verified_at,deleted_at FROM users WHERE email=$1 FOR UPDATE',
        [parsed.email],
      );
      if (!existing || existing.deleted_at) return;
      if (inserted.length)
        await new Repository(this.db, sql).put(
          id,
          'profile',
          ProfileSchema.parse({ id, name: parsed.name, timezone: 'UTC' }),
        );
      if (!existing.email_verified_at) await this.issue(sql, existing, 'verify_email');
    });
    return this.accepted();
  }

  async requestReset(emailInput: unknown) {
    const email = AccountEmailSchema.parse(emailInput);
    await consumeLimit(this.db, `account-reset:${email}`, 3, 3600000);
    // Unknown addresses use the same expensive work factor and generic response.
    await hashPassword(randomBytes(24).toString('base64url'));
    await this.db.transaction(async (sql) => {
      const [user] = await sql.query<UserRow>(
        'SELECT id,email,password_hash,email_verified_at,deleted_at FROM users WHERE email=$1 FOR UPDATE',
        [email],
      );
      if (user && !user.deleted_at) await this.issue(sql, user, 'password_reset');
    });
    return this.accepted();
  }

  async requestVerification(owner: string, sessionHash: string, passwordInput: unknown) {
    const password = AccountPasswordSchema.parse(passwordInput);
    await consumeLimit(this.db, `account-verify:${owner}`, 3, 3600000);
    await this.db.transaction(async (sql) => {
      const user = await this.activeUser(sql, owner);
      await this.verifyPassword(user, password);
      await this.activeSession(sql, owner, sessionHash);
      if (!user.email_verified_at) await this.issue(sql, user, 'verify_email');
    });
    return this.accepted();
  }

  async status(owner: string, sessionHash: string) {
    return this.db.transaction(async (sql) => {
      const user = await this.activeUser(sql, owner),
        session = await this.activeSession(sql, owner, sessionHash);
      return {
        email: user.email,
        emailVerified: !!user.email_verified_at,
        mailDelivery: this.config.mailEnabled ? ('configured' as const) : ('disabled' as const),
        reauthenticated: session.reauthenticated === true,
      };
    });
  }

  async reauthenticate(owner: string, sessionHash: string, passwordInput: unknown) {
    const password = AccountPasswordSchema.parse(passwordInput);
    await consumeLimit(
      this.db,
      `account-reauth:${owner}:${sessionHash}`,
      5,
      15 * 60000,
      30 * 60000,
    );
    return this.db.transaction(async (sql) => {
      const user = await this.activeUser(sql, owner);
      await this.verifyPassword(user, password);
      await this.activeSession(sql, owner, sessionHash);
      const [row] = await sql.query<{ reauth_until: Date | string }>(
        "UPDATE sessions SET reauth_until=LEAST(expires_at,clock_timestamp()+interval '5 minutes') WHERE owner_id=$1 AND token_hash=$2 RETURNING reauth_until",
        [owner, sessionHash],
      );
      return {
        ok: true as const,
        reauthenticated: true as const,
        expiresAt: new Date(row.reauth_until).toISOString(),
      };
    });
  }
  requireReauthentication(owner: string, sessionHash: string, sql: SQL = this.db) {
    return requireRecentReauthentication(this.db, owner, sessionHash, sql);
  }

  async requestEmailChange(owner: string, sessionHash: string, input: unknown) {
    const parsed = z
      .object({ email: AccountEmailSchema, password: AccountPasswordSchema })
      .strict()
      .parse(input);
    await consumeLimit(this.db, `account-email-change:${owner}`, 3, 3600000);
    await this.db.transaction(async (sql) => {
      const user = await this.activeUser(sql, owner);
      await this.verifyPassword(user, parsed.password);
      await this.activeSession(sql, owner, sessionHash);
      if (parsed.email === user.email) return;
      const occupied = await sql.query('SELECT id FROM users WHERE email=$1', [parsed.email]);
      if (occupied.length) return;
      await this.issue(sql, user, 'email_change', parsed.email);
    });
    return this.accepted();
  }

  async changePassword(owner: string, sessionHash: string, input: unknown) {
    const parsed = z
      .object({ currentPassword: AccountPasswordSchema, newPassword: AccountPasswordSchema })
      .strict()
      .parse(input);
    const passwordHash = await hashPassword(parsed.newPassword);
    await consumeLimit(this.db, `account-password-change:${owner}`, 5, 15 * 60000);
    await this.db.transaction(async (sql) => {
      const user = await this.activeUser(sql, owner);
      await this.verifyPassword(user, parsed.currentPassword);
      await this.activeSession(sql, owner, sessionHash);
      await sql.query('UPDATE users SET password_hash=$2 WHERE id=$1', [owner, passwordHash]);
      await this.invalidate(sql, owner);
      await sql.query('DELETE FROM sessions WHERE owner_id=$1', [owner]);
    });
    await this.sessionsRevoked(owner);
    return { ok: true as const, requiresSignIn: true as const };
  }
  async signOutAll(owner: string, sessionHash: string) {
    await this.db.transaction(async (sql) => {
      await this.activeUser(sql, owner);
      await this.activeSession(sql, owner, sessionHash);
      await sql.query('DELETE FROM sessions WHERE owner_id=$1', [owner]);
    });
    await this.sessionsRevoked(owner);
    return { ok: true as const, requiresSignIn: true as const };
  }

  async verify(input: unknown) {
    const parsed = z
      .object({ token: AccountLinkTokenSchema, password: AccountPasswordSchema })
      .strict()
      .parse(input);
    return this.consume(
      parsed.token,
      ['verify_email', 'email_change'],
      async (sql, user, challenge, payload) => {
        // Knowing an email-link token cannot validate an attacker-chosen password
        // on an unsolicited pre-registration. The recipient must know that password.
        if (!(await checkPassword(parsed.password, user.password_hash))) throw invalidLink();
        if (challenge.kind === 'email_change') {
          if (!payload.nextEmail) throw invalidLink();
          const used = await sql.query('SELECT id FROM users WHERE email=$1 AND id<>$2', [
            payload.nextEmail,
            user.id,
          ]);
          if (used.length) throw invalidLink();
          await sql.query(
            'UPDATE users SET email=$2,email_verified_at=clock_timestamp() WHERE id=$1',
            [user.id, payload.nextEmail],
          );
          await this.invalidate(sql, user.id);
        } else
          await sql.query('UPDATE users SET email_verified_at=clock_timestamp() WHERE id=$1', [
            user.id,
          ]);
        await sql.query('DELETE FROM sessions WHERE owner_id=$1', [user.id]);
      },
    );
  }
  async reset(input: unknown) {
    const parsed = z
      .object({ token: AccountLinkTokenSchema, newPassword: AccountPasswordSchema })
      .strict()
      .parse(input);
    const passwordHash = await hashPassword(parsed.newPassword);
    return this.consume(parsed.token, ['password_reset'], async (sql, user) => {
      await sql.query(
        'UPDATE users SET password_hash=$2,email_verified_at=clock_timestamp() WHERE id=$1',
        [user.id, passwordHash],
      );
      await this.invalidate(sql, user.id);
      await sql.query('DELETE FROM sessions WHERE owner_id=$1', [user.id]);
    });
  }

  private async consume(
    token: string,
    kinds: ChallengeKind[],
    effect: (
      sql: SQL,
      user: UserRow,
      challenge: ChallengeRow,
      payload: LinkPayload,
    ) => Promise<void>,
  ) {
    const digest = hashToken(token);
    await consumeLimit(this.db, `account-link:${digest}`, 5, 15 * 60000);
    const [hint] = await this.db.query<{ owner_id: string }>(
      'SELECT owner_id FROM account_challenges WHERE token_hash=$1',
      [digest],
    );
    if (!hint) throw invalidLink();
    try {
      await this.db.transaction(async (sql) => {
        const [user] = await sql.query<UserRow>(
          'SELECT id,email,password_hash,email_verified_at,deleted_at FROM users WHERE id=$1 FOR UPDATE',
          [hint.owner_id],
        );
        if (!user || user.deleted_at) throw invalidLink();
        const [challenge] = await sql.query<ChallengeRow>(
          'SELECT id,owner_id,kind,payload FROM account_challenges WHERE token_hash=$1 AND owner_id=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE',
          [digest, user.id],
        );
        if (!challenge || !kinds.includes(challenge.kind)) throw invalidLink();
        const payload = linkPayloadSchema.parse(this.db.decrypt(challenge.payload));
        if (
          payload.email !== user.email ||
          payload.credentialBinding !== hashToken(user.password_hash)
        )
          throw invalidLink();
        await effect(sql, user, challenge, payload);
        await sql.query(
          'UPDATE account_challenges SET consumed_at=clock_timestamp(),payload=$2 WHERE id=$1',
          [challenge.id, this.db.encrypt({})],
        );
        await sql.query(
          "UPDATE account_mail_outbox SET status=CASE WHEN status='accepted' THEN status ELSE 'cancelled' END,payload=$2,lease_until=NULL,lease_token=NULL,updated_at=clock_timestamp() WHERE challenge_id=$1",
          [challenge.id, this.db.encrypt({})],
        );
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
        throw invalidLink();
      throw error;
    }
    await this.sessionsRevoked(hint.owner_id);
    return { ok: true as const, requiresSignIn: true as const };
  }

  private async issue(sql: SQL, user: UserRow, kind: ChallengeKind, nextEmail?: string) {
    // Production without an approved app origin cannot mint a useful email
    // link. No placeholder destination is ever sent after later configuration.
    if (!this.appUrl) return;
    await this.invalidate(sql, user.id, kind);
    const id = randomUUID(),
      token = randomBytes(32).toString('base64url');
    const payload: LinkPayload = {
      version: 1,
      email: user.email,
      credentialBinding: hashToken(user.password_hash),
      ...(nextEmail ? { nextEmail } : {}),
    };
    await sql.query(
      "INSERT INTO account_challenges(id,owner_id,kind,token_hash,expires_at,payload) VALUES($1,$2,$3,$4,clock_timestamp()+interval '15 minutes',$5)",
      [id, user.id, kind, hashToken(token), this.db.encrypt(payload)],
    );
    const link = new URL(this.appUrl);
    link.hash = new URLSearchParams({
      account:
        kind === 'password_reset' ? 'reset' : kind === 'email_change' ? 'email-change' : 'verify',
      token,
    }).toString();
    const subject =
      kind === 'password_reset'
        ? 'Reset your klnk password'
        : kind === 'email_change'
          ? 'Confirm your new klnk email'
          : 'Verify your klnk email';
    const text = `${subject}.\n\nOpen this link to continue: ${link.href}\n\nThis link expires in 15 minutes and can be used once. Never forward it. If you did not request this, ignore it.`;
    await sql.query(
      'INSERT INTO account_mail_outbox(id,owner_id,challenge_id,kind,payload) VALUES($1,$2,$3,$4,$5)',
      [
        randomUUID(),
        user.id,
        id,
        kind,
        this.db.encrypt({ to: nextEmail ?? user.email, subject, text }),
      ],
    );
  }
  private async invalidate(sql: SQL, owner: string, kind?: ChallengeKind) {
    const params: unknown[] = [owner, this.db.encrypt({})];
    if (kind) params.push(kind);
    await sql.query(
      `UPDATE account_challenges SET consumed_at=clock_timestamp(),payload=$2 WHERE owner_id=$1 AND consumed_at IS NULL${kind ? ' AND kind=$3' : ''}`,
      params,
    );
    await sql.query(
      `UPDATE account_mail_outbox SET status='cancelled',payload=$2,lease_until=NULL,lease_token=NULL,updated_at=clock_timestamp() WHERE owner_id=$1 AND status IN ('queued','running','unknown')${kind ? ' AND kind=$3' : ''}`,
      params,
    );
  }
  async sweep(now = new Date()) {
    const owners = await this.db.query<{ owner_id: string }>(
      'SELECT DISTINCT owner_id FROM account_challenges WHERE expires_at<=$1 OR consumed_at IS NOT NULL ORDER BY owner_id',
      [now.toISOString()],
    );
    for (const { owner_id: owner } of owners)
      await this.db.transaction(async (sql) => {
        // Match issuance/change/deletion lock order: owner, challenges, outbox.
        await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [owner]);
        await sql.query(
          'UPDATE account_challenges SET payload=$3,consumed_at=COALESCE(consumed_at,clock_timestamp()) WHERE owner_id=$1 AND expires_at<=$2',
          [owner, now.toISOString(), this.db.encrypt({})],
        );
        await sql.query(
          "UPDATE account_mail_outbox SET status='cancelled',payload=$3,lease_until=NULL,lease_token=NULL,updated_at=clock_timestamp() WHERE owner_id=$1 AND status IN ('queued','running','unknown') AND challenge_id IN (SELECT id FROM account_challenges WHERE owner_id=$1 AND (expires_at<=$2 OR consumed_at IS NOT NULL))",
          [owner, now.toISOString(), this.db.encrypt({})],
        );
        await sql.query(
          "DELETE FROM account_challenges WHERE owner_id=$1 AND expires_at<$2::timestamptz-interval '24 hours'",
          [owner, now.toISOString()],
        );
      });
  }
}
