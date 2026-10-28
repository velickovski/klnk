import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '../apps/server/src/db.js';
import {
  deletionJournal,
  guardedDatabaseName,
  guardedLocalConnection,
} from '../scripts/operations-rehearsal.js';

describe('operator restore boundaries', () => {
  let db: Database | undefined;
  afterEach(async () => {
    await db?.close();
    db = undefined;
  });
  it('cannot create/drop an existing or injected database reference even with its name supplied by a caller', () => {
    const fresh = `klnk_qa_ops_${randomUUID()}`,
      allocated = new Set([fresh]);
    expect(guardedDatabaseName(fresh, allocated)).toBe(`"${fresh}"`);
    for (const name of [
      'klnk_qa',
      'postgres',
      'public',
      'klnk_qa_ops_old',
      `${fresh}"; DROP DATABASE klnk_qa;--`,
      `klnk_qa_ops_${randomUUID()}`,
    ]) {
      expect(() => guardedDatabaseName(name, allocated)).toThrow();
    }
    expect(() => guardedDatabaseName('klnk_qa', new Set(['klnk_qa']))).toThrow();
  });
  it('rejects remote endpoints and inherited connection options before accessing any server', () => {
    const key = randomBytes(32).toString('hex'),
      good = 'postgresql://fixture:fictional@127.0.0.1:55432/klnk_qa';
    expect(guardedLocalConnection({ url: good, key }).url.hostname).toBe('127.0.0.1');
    for (const url of [
      good.replace('127.0.0.1', 'localhost'),
      good.replace('55432', '5432'),
      good.replace('/klnk_qa', '/production'),
      good.replace('127.0.0.1', '192.0.2.1'),
      `${good}?options=-c%20search_path=public`,
      `${good}#hidden`,
    ]) {
      expect(() => guardedLocalConnection({ url, key })).toThrow();
    }
    expect(() => guardedLocalConnection({ url: good, key: 'wrong-key' })).toThrow();
    expect(() => guardedLocalConnection(null)).toThrow();
  });
  it('exports only account tombstones since the authenticated backup time without email, resources or credentials', async () => {
    db = await new Database({ dataDir: 'memory://' }).open();
    const active = randomUUID(),
      before = randomUUID(),
      after = randomUUID();
    await db.query(
      'INSERT INTO users(id,email,password_hash,deleted_at) VALUES($1,$2,$3,NULL),($4,$5,$3,$6),($7,$8,$3,$9)',
      [
        active,
        'active@example.invalid',
        'fictional-secret-hash',
        before,
        'older@example.invalid',
        '2026-10-25T00:00:00.000Z',
        after,
        'deleted@example.invalid',
        '2026-10-27T00:00:00.000Z',
      ],
    );
    const journal = await deletionJournal(db, '2026-10-26T00:00:00.000Z');
    expect(journal.deletedOwnerIds).toEqual([after]);
    expect(JSON.stringify(journal)).not.toMatch(/example\.invalid|fictional-secret-hash/);
    await expect(deletionJournal(db, '2026')).rejects.toThrow();
    await expect(deletionJournal(db, '2026-02-30T00:00:00.000Z')).rejects.toThrow();
    await expect(
      deletionJournal(db, "2026-10-26T00:00:00.000Z';DELETE FROM users;--"),
    ).rejects.toThrow();
    expect((await db.query('SELECT id FROM users')).length).toBe(3);
  });
});
