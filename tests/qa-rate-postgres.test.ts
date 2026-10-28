import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import { createSession } from '../apps/server/src/auth.js';
import { getConfig } from '../apps/server/src/config.js';
import { Database } from '../apps/server/src/db.js';
import { consumeLimit } from '../apps/server/src/request-limits.js';
import { guardedPostgresFixture } from './support/postgres-fixture.js';

const connectionFile = process.env.KLNK_POSTGRES_TEST_CONNECTION_FILE;

describe.skipIf(!connectionFile)('independent shared rate limits on real PostgreSQL', () => {
  let fixture: ReturnType<typeof guardedPostgresFixture>, admin: pg.Pool;
  const schemas: string[] = [],
    databases: Database[] = [];
  const apps: Awaited<ReturnType<typeof createApp>>['app'][] = [];

  beforeAll(async () => {
    fixture = guardedPostgresFixture(JSON.parse(await readFile(resolve(connectionFile!), 'utf8')));
    admin = new pg.Pool({ connectionString: fixture.url.href, max: 2 });
  });
  afterAll(async () => {
    for (const app of apps) await app.close();
    await Promise.all(databases.map((db) => db.close()));
    for (const schema of schemas) {
      if (!/^qa_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe rate-limit fixture cleanup.');
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
    await admin?.end();
  });

  async function pair() {
    const schema = `qa_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemas.push(schema);
    const url = new URL(fixture.url);
    url.searchParams.set('options', `-c search_path=${schema}`);
    url.searchParams.set('application_name', schema);
    const first = await new Database({ url: url.href, key: fixture.key, production: true }).open();
    databases.push(first);
    const second = await new Database({ url: url.href, key: fixture.key, production: true }).open();
    databases.push(second);
    return [first, second] as const;
  }

  it('atomically enforces one exact cap over concurrent independent connection pools', async () => {
    const [first, second] = await pair();
    const replies = await Promise.all(
      Array.from({ length: 80 }, async (_, index) => {
        try {
          await consumeLimit(index % 2 ? first : second, 'same-owner-and-action', 25, 60000);
          return 'allowed';
        } catch (error) {
          expect(error).toMatchObject({ statusCode: 429, code: 'rate_limited' });
          return 'blocked';
        }
      }),
    );
    expect(replies.filter((result) => result === 'allowed')).toHaveLength(25);
    expect(replies.filter((result) => result === 'blocked')).toHaveLength(55);
    const rows = await first.query('SELECT * FROM request_limits');
    expect(rows).toHaveLength(1);
    expect(rows[0].hits).toBe(80);
    expect(JSON.stringify(rows)).not.toContain('same-owner-and-action');
    await expect(
      consumeLimit(second, 'another-owner-and-action', 25, 60000),
    ).resolves.toBeUndefined();
  });

  it('shares owner and login limits across actual Fastify instances using separate PostgreSQL pools', async () => {
    const [first, second] = await pair();
    const config = {
      ...getConfig({ NODE_ENV: 'test' }),
      demoEnabled: false,
      legacyEnabled: false,
      embeddedWorker: false,
    };
    const a = (await createApp({ db: first, config, worker: false })).app;
    const b = (await createApp({ db: second, config, worker: false })).app;
    apps.push(a, b);
    for (const app of [a, b]) app.get('/qa-shared-owner', async () => ({ ok: true }));
    async function member(db: Database) {
      const owner = randomUUID();
      await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
        owner,
        `${owner}@example.invalid`,
        'fictional-unused-password-hash',
      ]);
      return createSession(db, owner);
    }
    const token = await member(first),
      other = await member(second);
    const replies = await Promise.all(
      Array.from({ length: 101 }, (_, index) =>
        (index % 2 ? a : b).inject({
          method: 'GET',
          url: '/qa-shared-owner',
          remoteAddress: '203.0.113.22',
          headers: { authorization: `Bearer ${token}` },
        }),
      ),
    );
    expect(replies.filter((reply) => reply.statusCode === 200)).toHaveLength(100);
    expect(replies.filter((reply) => reply.statusCode === 429)).toHaveLength(1);
    expect(
      (
        await b.inject({
          method: 'GET',
          url: '/qa-shared-owner',
          remoteAddress: '203.0.113.22',
          headers: { authorization: `Bearer ${other}` },
        })
      ).statusCode,
    ).toBe(200);

    const logins = await Promise.all(
      Array.from({ length: 11 }, (_, index) =>
        (index % 2 ? a : b).inject({
          method: 'POST',
          url: '/auth/login',
          remoteAddress: `198.51.100.${index + 1}`,
          payload: {
            email: index % 2 ? 'TARGET@example.invalid' : 'target@example.invalid',
            password: 'Fictional incorrect password',
          },
        }),
      ),
    );
    expect(logins.filter((reply) => reply.statusCode === 401)).toHaveLength(10);
    expect(logins.filter((reply) => reply.statusCode === 429)).toHaveLength(1);
    expect(JSON.stringify(await first.query('SELECT * FROM request_limits'))).not.toContain(
      'target@example.invalid',
    );
  });
});
