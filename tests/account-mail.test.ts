import nodemailer from 'nodemailer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../apps/server/src/db.js';
import { AccountService } from '../apps/server/src/account/service.js';
import {
  AccountMailError,
  AccountMailWorker,
  createSmtpMailer,
} from '../apps/server/src/account/mail.js';
import { openTestDatabase } from './support/test-database.js';

const databases: Database[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) await db.close();
});
async function fixture() {
  const db = await openTestDatabase();
  databases.push(db);
  const accounts = new AccountService(db);
  await accounts.register({
    name: 'Fictional Mail Owner',
    email: 'fictional-mail@example.invalid',
    password: 'Fictional password 42',
  });
  return { db, accounts };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('disabled-by-default durable account email', () => {
  it('constructing disabled email performs no SMTP initialization or send', async () => {
    const factory = vi.spyOn(nodemailer, 'createTransport');
    expect(createSmtpMailer({ enabled: false, host: 'never-connect.invalid' })).toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
    const { db } = await fixture(),
      send = vi.fn(async () => ({ accepted: true }));
    const worker = new AccountMailWorker(db, { enabled: false, transport: { send } });
    worker.start();
    expect(await worker.tick()).toBe(false);
    await worker.stop();
    expect(send).not.toHaveBeenCalled();
    expect((await db.query('SELECT status FROM account_mail_outbox'))[0].status).toBe('queued');
  });

  it('configures TLS, one recipient and disabled content fetching without making a network request', () => {
    const sendMail = vi.fn(async () => ({ accepted: ['fictional@example.invalid'], rejected: [] }));
    const factory = vi
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail } as unknown as ReturnType<typeof nodemailer.createTransport>);
    createSmtpMailer({
      enabled: true,
      host: 'smtp.example.invalid',
      user: 'fictional',
      password: 'fixture',
      from: 'klnk@example.invalid',
    });
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        requireTLS: true,
        secure: false,
        port: 587,
        disableFileAccess: true,
        disableUrlAccess: true,
        maxRecipients: 1,
        logger: false,
        debug: false,
      }),
    );
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('records only SMTP acceptance and erases outbound token content afterward', async () => {
    const { db } = await fixture(),
      send = vi.fn(async () => ({ accepted: true }));
    expect(await new AccountMailWorker(db, { enabled: true, transport: { send } }).tick()).toBe(
      true,
    );
    expect(send).toHaveBeenCalledTimes(1);
    const [row] = await db.query('SELECT status,payload FROM account_mail_outbox');
    expect(row.status).toBe('accepted');
    expect(db.decrypt(row.payload)).toEqual({});
    expect((await db.query('SELECT email_verified_at FROM users'))[0].email_verified_at).toBeNull();
  });

  it('backs off known connection failures and dead-letters after at most five attempts', async () => {
    const { db } = await fixture(),
      log = vi.fn(),
      send = vi.fn(async () => {
        throw new AccountMailError('retryable');
      });
    const worker = new AccountMailWorker(db, {
      enabled: true,
      transport: { send },
      logger: { error: log },
    });
    for (let i = 0; i < 5; i++) {
      await db.query('UPDATE account_mail_outbox SET run_at=clock_timestamp()');
      expect(await worker.tick()).toBe(false);
    }
    const [row] = await db.query(
      'SELECT status,attempts,payload,last_error FROM account_mail_outbox',
    );
    expect(row).toMatchObject({ status: 'failed', attempts: 5, last_error: 'delivery_failed' });
    expect(db.decrypt(row.payload)).toEqual({});
    expect(send).toHaveBeenCalledTimes(5);
    expect(await worker.tick()).toBe(false);
    expect(send).toHaveBeenCalledTimes(5);
    expect(log).toHaveBeenCalledWith({
      event: 'account_mail_stopped',
      reasonCode: 'delivery_failed',
    });
  });

  it('never automatically resends after uncertain provider errors and never logs a private exception', async () => {
    const { db } = await fixture(),
      log = vi.fn(),
      send = vi.fn(async () => {
        throw new Error('PRIVATE_PROVIDER_BODY_AND_TOKEN');
      });
    const worker = new AccountMailWorker(db, {
      enabled: true,
      transport: { send },
      logger: { error: log },
    });
    expect(await worker.tick()).toBe(false);
    expect(await worker.tick()).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await db.query('SELECT status FROM account_mail_outbox'))[0].status).toBe('unknown');
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_PROVIDER');
  });

  it.each(['expiry', 'consumption', 'deletion'] as const)(
    'rechecks current owner and challenge %s before any SMTP submission',
    async (reason) => {
      const { db } = await fixture(),
        send = vi.fn(async () => ({ accepted: true }));
      if (reason === 'expiry')
        await db.query(
          "UPDATE account_challenges SET expires_at=clock_timestamp()-interval '1 second'",
        );
      if (reason === 'consumption')
        await db.query('UPDATE account_challenges SET consumed_at=clock_timestamp()');
      if (reason === 'deletion') await db.query('UPDATE users SET deleted_at=clock_timestamp()');
      expect(await new AccountMailWorker(db, { enabled: true, transport: { send } }).tick()).toBe(
        false,
      );
      expect(send).not.toHaveBeenCalled();
      expect((await db.query('SELECT status FROM account_mail_outbox'))[0].status).toBe(
        'cancelled',
      );
    },
  );

  it('claims a queued email once across two workers and drains an active delivery on stop', async () => {
    const { db } = await fixture(),
      started = deferred(),
      finish = deferred();
    const send = vi.fn(async () => {
      started.resolve();
      await finish.promise;
      return { accepted: true };
    });
    const first = new AccountMailWorker(db, { enabled: true, transport: { send } }),
      second = new AccountMailWorker(db, { enabled: true, transport: { send } });
    const running = first.tick();
    await started.promise;
    expect(await second.tick()).toBe(false);
    let stopped = false;
    const stopping = first.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish.resolve();
    expect(await running).toBe(true);
    await stopping;
    expect(stopped).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('fences a stale sender from changing a replacement lease or claiming confirmed acceptance', async () => {
    const { db } = await fixture(),
      started = deferred(),
      finish = deferred();
    const send = vi.fn(async () => {
      started.resolve();
      await finish.promise;
      return { accepted: true };
    });
    const worker = new AccountMailWorker(db, { enabled: true, transport: { send } });
    const running = worker.tick();
    await started.promise;
    await db.query(
      "UPDATE account_mail_outbox SET lease_token='replacement',lease_until=clock_timestamp()+interval '1 minute'",
    );
    finish.resolve();
    expect(await running).toBe(false);
    expect((await db.query('SELECT status,lease_token FROM account_mail_outbox'))[0]).toEqual({
      status: 'running',
      lease_token: 'replacement',
    });
    await db.query(
      "UPDATE account_mail_outbox SET lease_until=clock_timestamp()-interval '1 second'",
    );
    expect(await worker.tick()).toBe(false);
    expect((await db.query('SELECT status FROM account_mail_outbox'))[0].status).toBe('unknown');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
