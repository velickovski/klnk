import { openTestDatabase } from './support/test-database.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { Database, Repository } from '../apps/server/src/db.js';
import { createSession, newUser, ownerFromToken } from '../apps/server/src/auth.js';
import { demoDate } from '../apps/server/src/seed.js';
import { LiveSessionStore } from '../apps/server/src/live-session-store.js';
import { randomUUID } from 'node:crypto';

describe('durable PostgreSQL development storage', () => {
  it('resolves next-day demonstration dates with the target-day daylight-saving offset', () => {
    expect(demoDate(1, 13, new Date('2026-10-31T15:00:00Z'))).toBe('2026-11-01T13:00:00-05:00');
    expect(demoDate(1, 13, new Date('2026-03-07T15:00:00Z'))).toBe('2026-03-08T13:00:00-04:00');
  });
  it('reopens encrypted resources and queued work with the same persisted key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'personal-agent-test-'));
    let db: Database | undefined;
    try {
      db = await new Database({ dataDir: directory }).open();
      const user = await newUser(
        db,
        'storage-test@example.invalid',
        'A long enough storage test password',
      );
      const repo = new Repository(db);
      await repo.put(user.id, 'memory', {
        id: 'memory-persist',
        text: 'A sensitive relationship note',
        ownerId: user.id,
      });
      await repo.enqueue(
        user.id,
        'mission-persist',
        'start',
        { scenario: 'normal' },
        0,
        'job-persist',
      );
      const reservation = await new LiveSessionStore(db).reserve(user.id, randomUUID());
      const [row] = await db.query('SELECT payload FROM resources WHERE id=$1', ['memory-persist']);
      expect(row.payload).not.toContain('sensitive');
      await db.close();
      db = await new Database({ dataDir: directory }).open();
      const restored = await new Repository(db).get<any>(user.id, 'memory', 'memory-persist');
      expect(restored.text).toBe('A sensitive relationship note');
      const [job] = await db.query('SELECT * FROM jobs WHERE id=$1', ['job-persist']);
      expect(job.status).toBe('queued');
      expect(db.decrypt(job.payload)).toEqual({ scenario: 'normal' });
      const receipts = await new LiveSessionStore(db).listUnresolved(user.id);
      expect(receipts[0].id).toBe(reservation.receipt.id);
      expect(receipts[0].status).toBe('creating');
      const ledger = await db.query('SELECT name,checksum FROM schema_migrations ORDER BY name');
      expect(ledger.map((row) => row.name)).toEqual(
        expect.arrayContaining([
          '001_initial.sql',
          '002_voice_sessions.sql',
          '003_runtime.sql',
          '004_live_controller.sql',
          '005_application_tools.sql',
        ]),
      );
      expect(ledger.every((row) => /^[a-f0-9]{64}$/.test(row.checksum))).toBe(true);
    } finally {
      await db?.close();
      // directory was created by mkdtemp under the OS temporary directory; no computed workspace removal.
      if (!directory.startsWith(join(tmpdir(), 'personal-agent-test-')))
        throw new Error('Unexpected test directory');
      await rm(directory, { recursive: true, force: true });
    }
  });
  it.each(['checksum', 'future'])(
    'fails safely on incompatible migration ledger %s',
    async (kind) => {
      const directory = await mkdtemp(join(tmpdir(), 'personal-agent-test-'));
      let db: Database | undefined;
      try {
        db = await new Database({ dataDir: directory }).open();
        if (kind === 'checksum')
          await db.query(
            "UPDATE schema_migrations SET checksum='modified' WHERE name='001_initial.sql'",
          );
        else
          await db.query(
            "INSERT INTO schema_migrations(name,checksum) VALUES('999_future.sql','future')",
          );
        await db.close();
        db = undefined;
        await expect(new Database({ dataDir: directory }).open()).rejects.toThrow(
          kind === 'checksum' ? 'checksum mismatch' : 'schema is newer',
        );
      } finally {
        await db?.close();
        if (!directory.startsWith(join(tmpdir(), 'personal-agent-test-')))
          throw new Error('Unexpected test directory');
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
  it('restores encrypted state without reviving sessions, deleted-owner data or stale controller authority', async () => {
    const key = 'a1'.repeat(32);
    const source = await openTestDatabase({ dataDir: 'memory://', key });
    const target = await openTestDatabase({ dataDir: 'memory://', key });
    try {
      const a = await newUser(source, 'restore-a@example.invalid', 'A fictional restore password');
      const b = await newUser(source, 'restore-b@example.invalid', 'A fictional restore password');
      const repo = new Repository(source);
      await repo.put(a.id, 'memory', { id: 'restore-kept', text: 'Fictional retained note' });
      await repo.put(b.id, 'memory', { id: 'restore-deleted', text: 'Fictional removed note' });
      const oldToken = await createSession(source, a.id);
      const job = await repo.enqueue(a.id, null, 'start', {});
      await source.query(
        "UPDATE jobs SET status='running',lease_token='stale-token',worker_id='stale-worker',lease_until=now()+interval '1 minute' WHERE id=$1",
        [job],
      );
      await repo.enqueue(b.id, null, 'start', {});
      await repo.enqueue(b.id, null, 'provider_delete', { conversationId: 'fictional-cleanup' });
      const store = new LiveSessionStore(source);
      let { receipt } = await store.reserve(a.id, randomUUID());
      receipt = await store.attachProvider(
        a.id,
        receipt.id,
        receipt.version,
        'fictional-restored-provider',
      );
      const backup = await source.createBackup();
      expect(JSON.stringify(backup)).not.toContain('Fictional retained note');
      expect(JSON.stringify(backup)).not.toContain('restore-a@example.invalid');
      const result = await target.restoreBackup(backup, { deletedOwnerIds: [b.id] });
      expect(result).toEqual({ owners: 2, resources: 1, unresolvedLive: 1 });
      expect(await new Repository(target).get(a.id, 'memory', 'restore-kept')).toBeTruthy();
      expect(await new Repository(target).get(b.id, 'memory', 'restore-deleted')).toBeUndefined();
      expect(await ownerFromToken(target, `Bearer ${oldToken}`)).toBeUndefined();
      await expect(createSession(target, b.id)).rejects.toMatchObject({ statusCode: 401 });
      const [restoredJob] = await target.query(
        'SELECT status,lease_token,worker_id FROM jobs WHERE id=$1',
        [job],
      );
      expect(restoredJob).toEqual({ status: 'queued', lease_token: null, worker_id: null });
      const restoredLive = await new LiveSessionStore(target).get(a.id, receipt.id);
      expect(restoredLive).toMatchObject({
        status: 'unconfirmed',
        providerSessionId: 'fictional-restored-provider',
      });
      expect(restoredLive?.controllerId).toBeUndefined();
      const deletedJobs = await target.query('SELECT kind FROM jobs WHERE owner_id=$1', [b.id]);
      expect(deletedJobs.map((row) => row.kind)).toEqual(['provider_delete']);
      await expect(target.restoreBackup(backup, { deletedOwnerIds: [] })).rejects.toThrow(
        'empty offline database',
      );
    } finally {
      await source.close();
      await target.close();
    }
  });
  it('rejects a restore with another key before any application state is written', async () => {
    const source = await openTestDatabase({ dataDir: 'memory://', key: 'b2'.repeat(32) });
    const target = await openTestDatabase({ dataDir: 'memory://', key: 'c3'.repeat(32) });
    try {
      const backup = await source.createBackup();
      await expect(target.restoreBackup(backup, { deletedOwnerIds: [] })).rejects.toThrow(
        'Backup decryption failed',
      );
      expect((await target.query('SELECT count(*)::int AS total FROM users'))[0].total).toBe(0);
    } finally {
      await source.close();
      await target.close();
    }
  });
});
