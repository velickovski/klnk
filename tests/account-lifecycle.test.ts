import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '../apps/server/src/db.js';
import {
  checkPassword,
  createSession,
  hashToken,
  ownerFromToken,
} from '../apps/server/src/auth.js';
import { AccountService } from '../apps/server/src/account/service.js';
import { openTestDatabase } from './support/test-database.js';

const password = 'Fictional owner password 42';
const databases: Database[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close();
});
async function fixture() {
  const db = await openTestDatabase();
  databases.push(db);
  const accounts = new AccountService(db, {
    publicAppUrl: 'http://localhost:8081/',
    mailEnabled: false,
  });
  const email = `${randomUUID()}@example.invalid`;
  const registration = await accounts.register({ name: 'Fictional Owner', email, password });
  const [{ id: owner }] = await db.query<{ id: string }>('SELECT id FROM users WHERE email=$1', [
    email,
  ]);
  const token = await createSession(db, owner),
    sessionHash = hashToken(token);
  return { db, accounts, email, owner, registration, token, sessionHash };
}
async function link(db: Database, owner: string, kind: string) {
  const [mail] = await db.query<{ payload: string }>(
    "SELECT payload FROM account_mail_outbox WHERE owner_id=$1 AND kind=$2 AND status='queued' ORDER BY created_at DESC,id DESC LIMIT 1",
    [owner, kind],
  );
  const value = db.decrypt<{ to: string; text: string }>(mail.payload);
  const url = new URL(value.text.match(/https?:\/\/[^\s]+/)![0]);
  return { token: new URLSearchParams(url.hash.slice(1)).get('token')!, to: value.to };
}

describe('owner-bound account lifecycle', () => {
  it('returns the identical pending response for new, duplicate and existing verified registration without issuing a session', async () => {
    const f = await fixture();
    const duplicate = await f.accounts.register({
      name: 'Another Name',
      email: f.email,
      password: 'Different fictional password 43',
    });
    expect(duplicate).toEqual(f.registration);
    expect(duplicate).toMatchObject({ accepted: true, status: 'pending', delivery: 'disabled' });
    expect(await f.db.query('SELECT id FROM users WHERE email=$1', [f.email])).toHaveLength(1);
    expect(
      await f.db.query('SELECT token_hash FROM sessions WHERE owner_id=$1', [f.owner]),
    ).toHaveLength(1); // Only the fixture's explicit createSession.
    const current = await link(f.db, f.owner, 'verify_email');
    await f.accounts.verify({ token: current.token, password });
    expect(await f.accounts.register({ name: 'Ignored', email: f.email, password })).toEqual(
      f.registration,
    );
    expect(
      await f.db.query('SELECT token_hash FROM sessions WHERE owner_id=$1', [f.owner]),
    ).toEqual([]);
  });

  it('stores only a token hash plus encrypted outbound content; verification requires the chosen password and is one-use', async () => {
    const f = await fixture(),
      current = await link(f.db, f.owner, 'verify_email');
    const [challenge] = await f.db.query(
      'SELECT token_hash,payload FROM account_challenges WHERE owner_id=$1 AND consumed_at IS NULL',
      [f.owner],
    );
    expect(challenge.token_hash).toBe(hashToken(current.token));
    expect(JSON.stringify(challenge)).not.toContain(current.token);
    expect(JSON.stringify(challenge)).not.toContain(password);
    await expect(
      f.accounts.verify({ token: current.token, password: 'An attacker-chosen wrong password' }),
    ).rejects.toMatchObject({ code: 'account_link_invalid' });
    expect(
      (await f.db.query('SELECT email_verified_at FROM users WHERE id=$1', [f.owner]))[0]
        .email_verified_at,
    ).toBeNull();
    expect(await f.accounts.verify({ token: current.token, password })).toEqual({
      ok: true,
      requiresSignIn: true,
    });
    expect(
      (await f.db.query('SELECT email_verified_at FROM users WHERE id=$1', [f.owner]))[0]
        .email_verified_at,
    ).toBeTruthy();
    await expect(f.accounts.verify({ token: current.token, password })).rejects.toMatchObject({
      code: 'account_link_invalid',
    });
    expect(await ownerFromToken(f.db, `Bearer ${f.token}`)).toBeUndefined();
  });

  it('makes password-reset request responses identical for known and unknown email addresses', async () => {
    const f = await fixture();
    expect(await f.accounts.requestReset(f.email)).toEqual(
      await f.accounts.requestReset('unknown-account@example.invalid'),
    );
    expect(
      await f.db.query(
        "SELECT id FROM account_challenges WHERE kind='password_reset' AND consumed_at IS NULL",
      ),
    ).toHaveLength(1);
  });

  it('reset email proof rotates the password, verifies the email and revokes every old session and pending challenge', async () => {
    const f = await fixture(),
      oldVerification = await link(f.db, f.owner, 'verify_email');
    const another = await createSession(f.db, f.owner);
    await f.accounts.requestReset(f.email);
    const reset = await link(f.db, f.owner, 'password_reset');
    await expect(f.accounts.verify({ token: reset.token, password })).rejects.toMatchObject({
      code: 'account_link_invalid',
    });
    const newPassword = 'A different fictional password 99';
    expect(await f.accounts.reset({ token: reset.token, newPassword })).toEqual({
      ok: true,
      requiresSignIn: true,
    });
    const [user] = await f.db.query(
      'SELECT password_hash,email_verified_at FROM users WHERE id=$1',
      [f.owner],
    );
    expect(await checkPassword(newPassword, user.password_hash)).toBe(true);
    expect(await checkPassword(password, user.password_hash)).toBe(false);
    expect(user.email_verified_at).toBeTruthy();
    expect(await ownerFromToken(f.db, `Bearer ${another}`)).toBeUndefined();
    expect(await ownerFromToken(f.db, `Bearer ${f.token}`)).toBeUndefined();
    await expect(
      f.accounts.verify({ token: oldVerification.token, password: newPassword }),
    ).rejects.toMatchObject({ code: 'account_link_invalid' });
    await expect(
      f.accounts.reset({ token: reset.token, newPassword: password }),
    ).rejects.toMatchObject({ code: 'account_link_invalid' });
  });

  it('expires links by the database clock and never lets a deleted account redeem a pending token', async () => {
    const f = await fixture(),
      verification = await link(f.db, f.owner, 'verify_email');
    await f.db.query(
      "UPDATE account_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",
      [hashToken(verification.token)],
    );
    await expect(f.accounts.verify({ token: verification.token, password })).rejects.toMatchObject({
      code: 'account_link_invalid',
    });
    await f.accounts.requestReset(f.email);
    const reset = await link(f.db, f.owner, 'password_reset');
    await f.db.query('UPDATE users SET deleted_at=clock_timestamp() WHERE id=$1', [f.owner]);
    await expect(
      f.accounts.reset({ token: reset.token, newPassword: 'A fresh fictional password 55' }),
    ).rejects.toMatchObject({ code: 'account_link_invalid' });
  });

  it('binds fresh reauthentication to one exact current session, with idle and absolute expiry checked again', async () => {
    const f = await fixture(),
      second = await createSession(f.db, f.owner);
    await f.db.query('UPDATE sessions SET reauth_until=NULL WHERE owner_id=$1', [f.owner]);
    await expect(f.accounts.requireReauthentication(f.owner, f.sessionHash)).rejects.toMatchObject({
      code: 'reauthentication_required',
    });
    await f.accounts.reauthenticate(f.owner, f.sessionHash, password);
    await f.accounts.requireReauthentication(f.owner, f.sessionHash);
    await expect(
      f.accounts.requireReauthentication(f.owner, hashToken(second)),
    ).rejects.toMatchObject({ code: 'reauthentication_required' });
    await f.db.query(
      "UPDATE sessions SET last_used_at=clock_timestamp()-interval '31 minutes' WHERE token_hash=$1",
      [f.sessionHash],
    );
    await expect(f.accounts.requireReauthentication(f.owner, f.sessionHash)).rejects.toMatchObject({
      code: 'reauthentication_required',
    });
    expect(await ownerFromToken(f.db, `Bearer ${f.token}`)).toBeUndefined();
    await f.db.query(
      "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",
      [hashToken(second)],
    );
    await expect(
      f.accounts.reauthenticate(f.owner, hashToken(second), password),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('changes a password only with current credentials and invalidates all sessions and old links', async () => {
    const f = await fixture(),
      verification = await link(f.db, f.owner, 'verify_email');
    await createSession(f.db, f.owner);
    await expect(
      f.accounts.changePassword(f.owner, f.sessionHash, {
        currentPassword: 'Wrong fictional password 22',
        newPassword: 'New fictional password 55',
      }),
    ).rejects.toMatchObject({ code: 'password_incorrect' });
    await f.accounts.changePassword(f.owner, f.sessionHash, {
      currentPassword: password,
      newPassword: 'New fictional password 55',
    });
    expect(
      await f.db.query('SELECT token_hash FROM sessions WHERE owner_id=$1', [f.owner]),
    ).toEqual([]);
    await expect(
      f.accounts.verify({ token: verification.token, password: 'New fictional password 55' }),
    ).rejects.toMatchObject({ code: 'account_link_invalid' });
  });

  it('keeps the current email until new-address proof succeeds and then revokes all sessions', async () => {
    const f = await fixture(),
      nextEmail = `${randomUUID()}@example.invalid`;
    await f.accounts.requestEmailChange(f.owner, f.sessionHash, { email: nextEmail, password });
    const change = await link(f.db, f.owner, 'email_change');
    expect(change.to).toBe(nextEmail);
    expect((await f.db.query('SELECT email FROM users WHERE id=$1', [f.owner]))[0].email).toBe(
      f.email,
    );
    await f.accounts.verify({ token: change.token, password });
    expect((await f.db.query('SELECT email FROM users WHERE id=$1', [f.owner]))[0].email).toBe(
      nextEmail,
    );
    expect(await ownerFromToken(f.db, `Bearer ${f.token}`)).toBeUndefined();
    await expect(f.accounts.verify({ token: change.token, password })).rejects.toMatchObject({
      code: 'account_link_invalid',
    });
  });

  it('does not reveal whether a requested new email is occupied and cannot change another account', async () => {
    const f = await fixture(),
      occupied = `${randomUUID()}@example.invalid`;
    await f.accounts.register({ name: 'Other Owner', email: occupied, password });
    const result = await f.accounts.requestEmailChange(f.owner, f.sessionHash, {
      email: occupied,
      password,
    });
    expect(result).toEqual(f.registration);
    expect(
      await f.db.query(
        "SELECT id FROM account_mail_outbox WHERE owner_id=$1 AND kind='email_change'",
        [f.owner],
      ),
    ).toEqual([]);
    const [{ id: other }] = await f.db.query<{ id: string }>(
      'SELECT id FROM users WHERE email=$1',
      [occupied],
    );
    await expect(f.accounts.status(other, f.sessionHash)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('signs out all sessions only for the current authenticated owner', async () => {
    const f = await fixture();
    await createSession(f.db, f.owner);
    await expect(f.accounts.signOutAll(f.owner, hashToken('forged-session'))).rejects.toMatchObject(
      { statusCode: 401 },
    );
    expect(
      await f.db.query('SELECT token_hash FROM sessions WHERE owner_id=$1', [f.owner]),
    ).toHaveLength(2);
    expect(await f.accounts.signOutAll(f.owner, f.sessionHash)).toEqual({
      ok: true,
      requiresSignIn: true,
    });
    expect(
      await f.db.query('SELECT token_hash FROM sessions WHERE owner_id=$1', [f.owner]),
    ).toEqual([]);
  });

  it('notifies trusted Live cleanup after credential revocation commits and contains cleanup failures', async () => {
    const f = await fixture();
    let callbacks = 0;
    const accounts = new AccountService(f.db, {
      onSessionsRevoked: async (owner) => {
        callbacks++;
        expect(owner).toBe(f.owner);
        expect(
          await f.db.query('SELECT token_hash FROM sessions WHERE owner_id=$1', [owner]),
        ).toEqual([]);
        await f.db.transaction(async (sql) => {
          expect(
            (await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [owner]))[0].id,
          ).toBe(owner);
        });
        throw new Error('PRIVATE_PROVIDER_CLOSE_BODY');
      },
    });
    expect(await accounts.signOutAll(f.owner, f.sessionHash)).toEqual({
      ok: true,
      requiresSignIn: true,
    });
    expect(callbacks).toBe(1);
    expect(await ownerFromToken(f.db, `Bearer ${f.token}`)).toBeUndefined();
  });

  it('expires private link content and excludes challenges/outbound authentication links from backups', async () => {
    const f = await fixture(),
      current = await link(f.db, f.owner, 'verify_email');
    const backup = f.db.decrypt<{ tables: Record<string, unknown> }>(
      (await f.db.createBackup()).payload,
    );
    expect(backup.tables.account_challenges).toBeUndefined();
    expect(backup.tables.account_mail_outbox).toBeUndefined();
    await f.accounts.sweep(new Date(Date.now() + 3600000));
    for (const row of await f.db.query<{ payload: string }>(
      'SELECT payload FROM account_challenges WHERE owner_id=$1',
      [f.owner],
    ))
      expect(f.db.decrypt(row.payload)).toEqual({});
    for (const row of await f.db.query<{ payload: string }>(
      'SELECT payload FROM account_mail_outbox WHERE owner_id=$1',
      [f.owner],
    ))
      expect(f.db.decrypt(row.payload)).toEqual({});
    await expect(f.accounts.verify({ token: current.token, password })).rejects.toMatchObject({
      code: 'account_link_invalid',
    });
    await f.accounts.sweep(new Date(Date.now() + 25 * 3600000));
    expect(
      await f.db.query('SELECT id FROM account_challenges WHERE owner_id=$1', [f.owner]),
    ).toEqual([]);
    expect(
      await f.db.query('SELECT id FROM account_mail_outbox WHERE owner_id=$1', [f.owner]),
    ).toEqual([]);
  });

  it('limits account recovery requests per email even across two service instances', async () => {
    const f = await fixture(),
      other = new AccountService(f.db);
    for (let i = 0; i < 3; i++) await (i % 2 ? other : f.accounts).requestReset(f.email);
    await expect(other.requestReset(f.email)).rejects.toMatchObject({ statusCode: 429 });
  });
});
