import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../apps/server/src/db.js';
import { guardedPostgresFixture } from './support/postgres-fixture.js';
import { openTestDatabase } from './support/test-database.js';

const databases: Database[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe('independent migrated embedded test fixtures', () => {
  it('clones the migrated schema without sharing owner data or encryption keys', async () => {
    const first = await openTestDatabase();
    const second = await openTestDatabase();
    databases.push(first, second);
    const id = randomUUID();
    await first.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
      id,
      `${id}@example.invalid`,
      'fictional-unused-hash',
    ]);
    expect(await second.query('SELECT id FROM users')).toEqual([]);
    const migrations = await first.query(
      'SELECT name,checksum FROM schema_migrations ORDER BY name',
    );
    expect(migrations.length).toBeGreaterThanOrEqual(8);
    expect(await second.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).toEqual(
      migrations,
    );
    const encrypted = first.encrypt({ private: 'fictional first fixture content' });
    expect(() => second.decrypt(encrypted)).toThrow();
  });

  it('still rejects a corrupt migration checksum in a loaded template', async () => {
    const first = await openTestDatabase();
    databases.push(first);
    await first.query(
      "UPDATE schema_migrations SET checksum='corrupt' WHERE name=(SELECT min(name) FROM schema_migrations)",
    );
    const template = await first.dumpEmbeddedTemplate();
    await expect(
      new Database({ dataDir: 'memory://', embeddedTemplate: template }).open(),
    ).rejects.toThrow('Migration checksum mismatch');
  });

  it('cannot apply the test template to a real database or persistent data directory', async () => {
    await expect(openTestDatabase({ url: 'postgresql://fictional.invalid/app' })).rejects.toThrow(
      'only for isolated',
    );
    await expect(openTestDatabase({ dataDir: '.data' })).rejects.toThrow('only for isolated');
  });
});

describe('explicit disposable PostgreSQL test endpoint', () => {
  const url = 'postgresql://fixture:fictional@127.0.0.1:5432/klnk_qa';
  const key = 'af'.repeat(32);
  it('accepts the configured loopback port while keeping the database dedicated to QA', () => {
    vi.stubEnv('KLNK_TEST_POSTGRES_URL', url);
    expect(guardedPostgresFixture({ url, key }).url.port).toBe('5432');
  });
  it('rejects remote, alternate and option-bearing endpoints before a socket is opened', () => {
    vi.stubEnv('KLNK_TEST_POSTGRES_URL', url);
    for (const candidate of [
      url.replace('127.0.0.1', '192.0.2.1'),
      url.replace('/klnk_qa', '/production'),
      url.replace(':5432/', ':55432/'),
      `${url}?options=-c%20search_path=public`,
      `${url}#hidden`,
    ])
      expect(() => guardedPostgresFixture({ url: candidate, key })).toThrow();
    expect(() => guardedPostgresFixture({ url, key: 'invalid' })).toThrow();
    expect(() => guardedPostgresFixture(null)).toThrow();
  });
});
