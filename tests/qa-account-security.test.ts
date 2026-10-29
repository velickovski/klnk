import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database, Row, SQL } from '../apps/server/src/db.js';
import type { FastifyInstance, InjectOptions } from 'fastify';
import * as auth from '../apps/server/src/auth.js';
import { createApp } from '../apps/server/src/app.js';
import { getConfig } from '../apps/server/src/config.js';
import { logger } from '../apps/server/src/logging.js';
import { AccountService } from '../apps/server/src/account/service.js';
import { AccountMailWorker, createSmtpMailer } from '../apps/server/src/account/mail.js';
import { openTestDatabase } from './support/test-database.js';

const password = 'Fictional QA owner password 42';
const databases: Database[] = [];
const applications: FastifyInstance[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of applications.splice(0)) await app.close();
  for (const db of databases.splice(0)) await db.close();
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const db = await openTestDatabase();
  databases.push(db);
  const accounts = new AccountService(db, {
    mailEnabled: false,
    publicAppUrl: 'https://app.example.invalid/',
  });
  const email = `${randomUUID()}@example.invalid`;
  const response = await accounts.register({ name: 'Fictional QA owner', email, password });
  const [{ id: owner }] = await db.query<{ id: string }>('SELECT id FROM users WHERE email=$1', [
    email,
  ]);
  const token = await auth.createSession(db, owner);
  return { db, accounts, email, owner, token, sessionHash: auth.hashToken(token), response };
}
async function latestLink(db: Database, owner: string, kind: string) {
  const [row] = await db.query<{ payload: string }>(
    'SELECT m.payload FROM account_mail_outbox m JOIN account_challenges c ON c.id=m.challenge_id WHERE m.owner_id=$1 AND m.kind=$2 AND c.consumed_at IS NULL ORDER BY m.created_at DESC,m.id DESC LIMIT 1',
    [owner, kind],
  );
  const payload = db.decrypt<{ to: string; text: string }>(row.payload);
  const link = new URL(payload.text.match(/https?:\/\/\S+/)![0]);
  return { ...payload, token: new URLSearchParams(link.hash.slice(1)).get('token')! };
}
async function httpFixture(db: Database, production = true) {
  const service = await createApp({
    db,
    worker: false,
    config: {
      ...getConfig(),
      production,
      demoEnabled: false,
      legacyEnabled: false,
      embeddedWorker: false,
      provider: 'simulator',
      liveEnabled: false,
      openaiKey: undefined,
      elevenKey: undefined,
      twilioToken: undefined,
      googleClientSecret: undefined,
      mailEnabled: false,
      publicAppUrl: 'https://app.example.invalid/',
      trustProxy: ['127.0.0.1', '::1'],
    },
  });
  applications.push(service.app);
  return service;
}
function secureRequest(app: FastifyInstance, options: InjectOptions) {
  return app.inject({
    ...options,
    remoteAddress: '127.0.0.1',
    headers: { 'x-forwarded-proto': 'https', ...options.headers },
  });
}

describe('independent account security adversaries', () => {
  it('does not replace a preregistered account password or profile and lets email proof recover it safely', async () => {
    const f = await fixture();
    const attackerPassword = 'Fictional attacker password 99';
    const before = (await f.db.query('SELECT password_hash FROM users WHERE id=$1', [f.owner]))[0]
      .password_hash;
    const profileBefore = await f.db.query(
      "SELECT payload FROM resources WHERE owner_id=$1 AND kind='profile'",
      [f.owner],
    );
    expect(
      await f.accounts.register({
        name: 'Attacker Profile',
        email: f.email.toUpperCase(),
        password: attackerPassword,
      }),
    ).toEqual(f.response);
    const [{ password_hash: after }] = await f.db.query(
      'SELECT password_hash FROM users WHERE id=$1',
      [f.owner],
    );
    expect(after).toBe(before);
    expect(
      await f.db.query("SELECT payload FROM resources WHERE owner_id=$1 AND kind='profile'", [
        f.owner,
      ]),
    ).toEqual(profileBefore);
    const verification = await latestLink(f.db, f.owner, 'verify_email');
    await expect(
      f.accounts.verify({ token: verification.token, password: attackerPassword }),
    ).rejects.toMatchObject({ code: 'account_link_invalid' });
    await f.accounts.requestReset(f.email);
    const reset = await latestLink(f.db, f.owner, 'password_reset');
    await f.accounts.reset({
      token: reset.token,
      newPassword: 'New victim controlled password 87',
    });
    expect(await auth.ownerFromToken(f.db, `Bearer ${f.token}`)).toBeUndefined();
    const [user] = await f.db.query(
      'SELECT password_hash,email_verified_at FROM users WHERE id=$1',
      [f.owner],
    );
    expect(await auth.checkPassword('New victim controlled password 87', user.password_hash)).toBe(
      true,
    );
    expect(user.email_verified_at).toBeTruthy();
    await expect(f.accounts.verify({ token: verification.token, password })).rejects.toMatchObject({
      code: 'account_link_invalid',
    });
  });

  it('pays password hashing for both unknown and known recovery requests and returns identical public data', async () => {
    const f = await fixture();
    const work = vi.spyOn(auth, 'hashPassword');
    const known = await f.accounts.requestReset(f.email);
    const unknown = await f.accounts.requestReset(`${randomUUID()}@example.invalid`);
    expect(known).toEqual(unknown);
    expect(work).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(known)).not.toContain(f.email);
    expect(JSON.stringify(known)).not.toMatch(/token|ownerId|userId/);
  });

  it('accepts exactly one simultaneous redemption and invalidates a competing email-change proof', async () => {
    const f = await fixture();
    await f.accounts.requestEmailChange(f.owner, f.sessionHash, {
      email: `${randomUUID()}@example.invalid`,
      password,
    });
    const change = await latestLink(f.db, f.owner, 'email_change');
    await f.accounts.requestReset(f.email);
    const reset = await latestLink(f.db, f.owner, 'password_reset');
    const attempts = await Promise.allSettled([
      f.accounts.reset({ token: reset.token, newPassword: 'First fictional reset password 66' }),
      f.accounts.reset({ token: reset.token, newPassword: 'Second fictional reset password 77' }),
    ]);
    expect(attempts.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    const failed = attempts.find((entry) => entry.status === 'rejected');
    expect(failed?.status === 'rejected' && failed.reason).toMatchObject({
      code: 'account_link_invalid',
    });
    await expect(f.accounts.verify({ token: change.token, password })).rejects.toMatchObject({
      code: 'account_link_invalid',
    });
    expect((await f.db.query('SELECT email FROM users WHERE id=$1', [f.owner]))[0].email).toBe(
      f.email,
    );
  });

  it('serializes competing reset and email-change proofs against the same credential binding', async () => {
    const f = await fixture(),
      target = `${randomUUID()}@example.invalid`;
    await f.accounts.requestEmailChange(f.owner, f.sessionHash, { email: target, password });
    const change = await latestLink(f.db, f.owner, 'email_change');
    await f.accounts.requestReset(f.email);
    const reset = await latestLink(f.db, f.owner, 'password_reset');
    const outcomes = await Promise.allSettled([
      f.accounts.verify({ token: change.token, password }),
      f.accounts.reset({ token: reset.token, newPassword: 'Fictional concurrent reset 26' }),
    ]);
    expect(outcomes.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((entry) => entry.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
      code: 'account_link_invalid',
    });
    expect(await auth.ownerFromToken(f.db, `Bearer ${f.token}`)).toBeUndefined();
    const [user] = await f.db.query('SELECT email,password_hash FROM users WHERE id=$1', [f.owner]);
    if (outcomes[0].status === 'fulfilled') {
      expect(user.email).toBe(target);
      expect(await auth.checkPassword(password, user.password_hash)).toBe(true);
    } else {
      expect(user.email).toBe(f.email);
      expect(await auth.checkPassword('Fictional concurrent reset 26', user.password_hash)).toBe(
        true,
      );
    }
  });

  it('never lets two accounts claim the same new address or exposes the competing owner', async () => {
    const f = await fixture();
    const secondEmail = `${randomUUID()}@example.invalid`,
      target = `${randomUUID()}@example.invalid`;
    await f.accounts.register({ name: 'Second fictional owner', email: secondEmail, password });
    const [{ id: second }] = await f.db.query<{ id: string }>(
      'SELECT id FROM users WHERE email=$1',
      [secondEmail],
    );
    const secondToken = await auth.createSession(f.db, second);
    await f.accounts.requestEmailChange(f.owner, f.sessionHash, { email: target, password });
    await f.accounts.requestEmailChange(second, auth.hashToken(secondToken), {
      email: target,
      password,
    });
    const firstLink = await latestLink(f.db, f.owner, 'email_change'),
      secondLink = await latestLink(f.db, second, 'email_change');
    const outcomes = await Promise.allSettled([
      f.accounts.verify({ token: firstLink.token, password }),
      f.accounts.verify({ token: secondLink.token, password }),
    ]);
    expect(outcomes.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((entry) => entry.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
      code: 'account_link_invalid',
    });
    expect(await f.db.query('SELECT id FROM users WHERE email=$1', [target])).toHaveLength(1);
  });

  it('reauthenticates one exact session and rechecks idle expiry after acquiring the owner lock', async () => {
    const f = await fixture(),
      second = await auth.createSession(f.db, f.owner);
    await f.db.query('UPDATE sessions SET reauth_until=NULL WHERE owner_id=$1', [f.owner]);
    await f.accounts.reauthenticate(f.owner, f.sessionHash, password);
    await f.accounts.requireReauthentication(f.owner, f.sessionHash);
    await expect(
      f.accounts.requireReauthentication(f.owner, auth.hashToken(second)),
    ).rejects.toMatchObject({ code: 'reauthentication_required' });
    const locked = gate(),
      proceed = gate();
    const original = f.db.transaction.bind(f.db);
    vi.spyOn(f.db, 'transaction').mockImplementation((effect) =>
      original(async (sql) => {
        const query = sql.query.bind(sql);
        const wrapped: SQL = {
          ...sql,
          query: async <T extends Row = Row>(statement: string, params?: unknown[]) => {
            const result = await sql.query<T>(statement, params);
            if (statement === 'SELECT id FROM users WHERE id=$1 FOR UPDATE') {
              await query(
                "UPDATE sessions SET last_used_at=clock_timestamp()-interval '31 minutes' WHERE token_hash=$1",
                [f.sessionHash],
              );
              locked.resolve();
              await proceed.promise;
            }
            return result;
          },
        };
        return effect(wrapped);
      }),
    );
    const check = f.accounts.requireReauthentication(f.owner, f.sessionHash);
    await locked.promise;
    proceed.resolve();
    await expect(check).rejects.toMatchObject({ code: 'reauthentication_required' });
  });

  it('does not initialize SMTP when disabled and never replays an expired in-flight lease', async () => {
    const factory = vi.spyOn(nodemailer, 'createTransport');
    expect(
      createSmtpMailer({ enabled: false, host: 'do-not-connect.example.invalid' }),
    ).toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
    const f = await fixture(),
      started = gate(),
      finish = gate();
    const send = vi.fn(async () => {
      started.resolve();
      await finish.promise;
      return { accepted: true };
    });
    const first = new AccountMailWorker(f.db, { enabled: true, transport: { send } });
    const second = new AccountMailWorker(f.db, { enabled: true, transport: { send } });
    const active = first.tick();
    await started.promise;
    await f.db.query(
      "UPDATE account_mail_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE status='running'",
    );
    expect(await second.tick()).toBe(false);
    finish.resolve();
    expect(await active).toBe(false);
    expect(await first.tick()).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    const [row] = await f.db.query('SELECT status,payload FROM account_mail_outbox');
    expect(row.status).toBe('unknown');
    expect(f.db.decrypt(row.payload)).toEqual({});
  });

  it('cancels a claimed link before SMTP when credentials change', async () => {
    const f = await fixture(),
      claimed = gate(),
      release = gate();
    const query = f.db.query.bind(f.db);
    vi.spyOn(f.db, 'query').mockImplementation(async (...args: Parameters<typeof f.db.query>) => {
      if (args[0].includes('SELECT m.id FROM account_mail_outbox')) {
        claimed.resolve();
        await release.promise;
      }
      return query(...args);
    });
    const send = vi.fn(async () => ({ accepted: true }));
    const worker = new AccountMailWorker(f.db, { enabled: true, transport: { send } });
    const active = worker.tick();
    await claimed.promise;
    await f.accounts.changePassword(f.owner, f.sessionHash, {
      currentPassword: password,
      newPassword: 'A changed fictional password 92',
    });
    release.resolve();
    expect(await active).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect((await query('SELECT status FROM account_mail_outbox'))[0].status).toBe('cancelled');
  });

  it.each(['credentials', 'deletion'] as const)(
    'cannot restore acceptance from a late SMTP result after %s invalidation',
    async (reason) => {
      const f = await fixture(),
        started = gate(),
        finish = gate();
      const send = vi.fn(async () => {
        started.resolve();
        await finish.promise;
        return { accepted: true };
      });
      const worker = new AccountMailWorker(f.db, { enabled: true, transport: { send } });
      const running = worker.tick();
      await started.promise;
      if (reason === 'credentials')
        await f.accounts.changePassword(f.owner, f.sessionHash, {
          currentPassword: password,
          newPassword: 'Fictional changed password 62',
        });
      else
        await f.db.transaction(async (sql) => {
          await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [f.owner]);
          await sql.query('UPDATE users SET deleted_at=clock_timestamp() WHERE id=$1', [f.owner]);
          await sql.query('DELETE FROM account_mail_outbox WHERE owner_id=$1', [f.owner]);
          await sql.query('DELETE FROM account_challenges WHERE owner_id=$1', [f.owner]);
        });
      finish.resolve();
      expect(await running).toBe(false);
      expect(await worker.tick()).toBe(false);
      expect(send).toHaveBeenCalledTimes(1);
      expect(
        await f.db.query(
          "SELECT id FROM account_mail_outbox WHERE status='accepted' AND owner_id=$1",
          [f.owner],
        ),
      ).toEqual([]);
      if (reason === 'credentials') {
        const [row] = await f.db.query(
          'SELECT payload,status FROM account_mail_outbox WHERE owner_id=$1',
          [f.owner],
        );
        expect(row.status).toBe('cancelled');
        expect(f.db.decrypt(row.payload)).toEqual({});
      }
    },
  );

  it('does not resend an unknown SMTP outcome and logs only fixed metadata', async () => {
    const f = await fixture(),
      log = vi.fn();
    const link = await latestLink(f.db, f.owner, 'verify_email');
    const send = vi.fn(async () => {
      throw new Error(`${f.email} ${link.token} ${password} PRIVATE_SMTP_RESPONSE`);
    });
    const worker = new AccountMailWorker(f.db, {
      enabled: true,
      transport: { send },
      logger: { error: log },
    });
    expect(await worker.tick()).toBe(false);
    expect(await worker.tick()).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(log.mock.calls).toEqual([
      [{ event: 'account_mail_stopped', reasonCode: 'delivery_unconfirmed' }],
    ]);
    const [row] = await f.db.query('SELECT status,payload,last_error FROM account_mail_outbox');
    expect(row.status).toBe('unknown');
    expect(f.db.decrypt(row.payload)).toEqual({});
    expect(JSON.stringify(row)).not.toContain(link.token);
  });

  it('finishes credential revocation before cleanup and sanitizes an uncertain cleanup error', async () => {
    const f = await fixture();
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const close = vi.fn(async (owner: string) => {
      expect(owner).toBe(f.owner);
      expect(
        await f.db.query('SELECT token_hash FROM sessions WHERE owner_id=$1', [owner]),
      ).toEqual([]);
      await f.db.transaction(async (sql) => {
        await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [owner]);
      });
      throw new Error(`${f.email} ${f.token} PRIVATE_CLOSE_BODY`);
    });
    const accounts = new AccountService(f.db, { onSessionsRevoked: close });
    expect(await accounts.signOutAll(f.owner, f.sessionHash)).toEqual({
      ok: true,
      requiresSignIn: true,
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(error.mock.calls).toEqual([
      [{ event: 'account_session_close_unconfirmed', reasonCode: 'operation_failed' }],
    ]);
    expect(await auth.ownerFromToken(f.db, `Bearer ${f.token}`)).toBeUndefined();
  });

  it('production HTTP registration remains generic and cannot authenticate an unverified preregistration', async () => {
    const f = await fixture(),
      { app } = await httpFixture(f.db);
    const newcomer = `${randomUUID()}@example.invalid`;
    const register = (email: string) =>
      secureRequest(app, {
        method: 'POST',
        url: '/auth/register',
        payload: { name: 'Fictional HTTP owner', email, password },
      });
    const fresh = await register(newcomer),
      duplicate = await register(f.email);
    expect(fresh.statusCode, fresh.body).toBe(202);
    expect(duplicate.statusCode, duplicate.body).toBe(202);
    expect(fresh.json()).toEqual(duplicate.json());
    expect(fresh.json()).not.toHaveProperty('token');
    expect(fresh.headers['cache-control']).toBe('no-store');
    const unverified = await secureRequest(app, {
      method: 'POST',
      url: '/auth/login',
      payload: { email: newcomer, password },
    });
    expect([401, 403]).toContain(unverified.statusCode);
    expect(unverified.json()).not.toHaveProperty('token');
    expect((await secureRequest(app, { method: 'POST', url: '/auth/demo' })).statusCode).toBe(404);
    const wrong = await secureRequest(app, {
      method: 'POST',
      url: '/auth/login',
      payload: { email: f.email, password: 'Fictional wrong password 45' },
    });
    const unknown = await secureRequest(app, {
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: `${randomUUID()}@example.invalid`,
        password: 'Fictional wrong password 45',
      },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('HTTP export/delete require reauthentication of this bearer and reject an idle credential', async () => {
    const f = await fixture(),
      second = await auth.createSession(f.db, f.owner);
    await f.db.query('UPDATE users SET email_verified_at=clock_timestamp() WHERE id=$1', [f.owner]);
    await f.db.query('UPDATE sessions SET reauth_until=NULL WHERE owner_id=$1', [f.owner]);
    const { app } = await httpFixture(f.db);
    const firstHeaders = { authorization: `Bearer ${f.token}` },
      secondHeaders = { authorization: `Bearer ${second}` };
    expect((await secureRequest(app, { url: '/export', headers: firstHeaders })).statusCode).toBe(
      403,
    );
    expect(
      (await secureRequest(app, { method: 'DELETE', url: '/account', headers: secondHeaders }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await secureRequest(app, {
          method: 'POST',
          url: '/account/reauth',
          headers: firstHeaders,
          payload: { password },
        })
      ).statusCode,
    ).toBe(200);
    const exported = await secureRequest(app, { url: '/export', headers: firstHeaders });
    expect(exported.statusCode, exported.body).toBe(200);
    expect(exported.headers['cache-control']).toBe('no-store');
    expect(exported.body).not.toContain('credentialBinding');
    expect(exported.body).not.toContain('password_hash');
    expect(exported.body).not.toContain('account_challenges');
    expect((await secureRequest(app, { url: '/export', headers: secondHeaders })).statusCode).toBe(
      403,
    );
    await f.db.query(
      "UPDATE sessions SET last_used_at=clock_timestamp()-interval '31 minutes' WHERE token_hash=$1",
      [f.sessionHash],
    );
    expect(
      (await secureRequest(app, { method: 'DELETE', url: '/account', headers: firstHeaders }))
        .statusCode,
    ).toBe(401);
    expect(
      (await f.db.query('SELECT deleted_at FROM users WHERE id=$1', [f.owner]))[0].deleted_at,
    ).toBeNull();
  });

  it.each(['/export', '/account'] as const)(
    'rechecks a revoked bearer after HTTP authentication before %s effects',
    async (path) => {
      const f = await fixture();
      await f.db.query('UPDATE users SET email_verified_at=clock_timestamp() WHERE id=$1', [
        f.owner,
      ]);
      const { app } = await httpFixture(f.db);
      let passedAuthentication = false;
      app.addHook('preHandler', async (req) => {
        if (req.url === path && req.ownerId === f.owner) {
          passedAuthentication = true;
          await f.db.query('DELETE FROM sessions WHERE token_hash=$1', [f.sessionHash]);
        }
      });
      const result = await secureRequest(app, {
        url: path,
        method: path === '/account' ? 'DELETE' : 'GET',
        headers: { authorization: `Bearer ${f.token}` },
      });
      expect([401, 403]).toContain(result.statusCode);
      expect(passedAuthentication).toBe(true);
      expect(result.json().error).toMatch(/reauthentication_required|unauthorized|session_expired/);
      expect(result.body).not.toContain('exportedAt');
      expect(
        (await f.db.query('SELECT deleted_at FROM users WHERE id=$1', [f.owner]))[0].deleted_at,
      ).toBeNull();
    },
  );
});
