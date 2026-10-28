import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Database, Repository } from '../apps/server/src/db.js';
import { createSession, hashToken } from '../apps/server/src/auth.js';
import { Engine } from '../apps/server/src/engine.js';
import type { Config } from '../apps/server/src/config.js';
import { LiveSessionStore } from '../apps/server/src/live-session-store.js';
import { ApplicationToolGateway } from '../apps/server/src/integrations/gateway.js';
import { GoogleCalendarConnections } from '../apps/server/src/integrations/google-calendar.js';
import { guardedLocalConnection } from '../scripts/operations-rehearsal.js';

const connectionFile = process.env.KLNK_POSTGRES_TEST_CONNECTION_FILE;
const config: Config = {
  production: false,
  port: 4000,
  host: '127.0.0.1',
  databaseUrl: undefined,
  dataDir: 'memory://',
  key: undefined,
  demoEnabled: true,
  openaiKey: undefined,
  provider: 'simulator',
  liveEnabled: false,
  liveOwnerId: undefined,
  publicBaseUrl: undefined,
  recipients: [],
  origins: [],
  embeddedWorker: false,
  elevenKey: undefined,
  agentId: undefined,
  phoneId: undefined,
  webhookSecret: undefined,
  twilioSid: undefined,
  twilioToken: undefined,
  standardVoice: undefined,
  retentionVerified: false,
  llmProvider: undefined,
  retentionDisclosure: undefined,
  ownerAgentId: undefined,
};

describe.skipIf(!connectionFile)(
  'real PostgreSQL current credential expiry after owner-lock waits',
  () => {
    let admin: pg.Pool, connection: ReturnType<typeof guardedLocalConnection>;
    const fixtures: { schema: string; db: Database; pool: pg.Pool }[] = [];
    beforeAll(async () => {
      connection = guardedLocalConnection(
        JSON.parse(await readFile(resolve(connectionFile!), 'utf8')),
      );
      admin = new pg.Pool({ connectionString: connection.url.toString(), max: 2 });
      const server = (
        await admin.query(
          'SELECT host(inet_server_addr()) AS host,inet_server_port() AS port,current_database() AS database',
        )
      ).rows[0];
      expect(server).toMatchObject({ host: '127.0.0.1', port: 55432, database: 'klnk_qa' });
    });
    afterAll(async () => {
      for (const { db, pool } of fixtures) {
        await db.close();
        await pool.end();
      }
      for (const { schema } of fixtures) {
        if (!/^qa_[a-f0-9]{32}$/.test(schema))
          throw new Error('Unsafe credential fixture cleanup.');
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
      await admin?.end();
    });
    async function fixture() {
      const schema = `qa_${randomUUID().replaceAll('-', '')}`;
      await admin.query(`CREATE SCHEMA "${schema}"`);
      const url = new URL(connection.url);
      url.searchParams.set('options', `-c search_path=${schema}`);
      url.searchParams.set('application_name', schema);
      const db = await new Database({
        url: url.toString(),
        key: connection.key,
        production: true,
      }).open();
      const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
      fixtures.push({ schema, db, pool });
      const owner = randomUUID();
      await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
        owner,
        `${owner}@example.invalid`,
        'fictional-unused-hash',
      ]);
      const token = await createSession(db, owner);
      return { schema, db, pool, owner, token };
    }
    async function expiresDuringWait<T>(
      f: Awaited<ReturnType<typeof fixture>>,
      invoke: () => Promise<T>,
    ): Promise<T> {
      const blocker = await f.pool.connect();
      let pending: Promise<T> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [f.owner]);
        await f.db.query(
          "UPDATE sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE token_hash=$1",
          [hashToken(f.token)],
        );
        pending = invoke();
        // Observe the actual blocked transaction, not a timer assumption. Its
        // transaction-start time precedes expiry while wall-clock time passes it.
        let observed = false;
        const deadline = Date.now() + 6000;
        while (Date.now() < deadline) {
          const state = (
            await admin.query(
              `SELECT a.xact_start<s.expires_at AS began_valid,clock_timestamp()>s.expires_at AS expired
          FROM pg_stat_activity a CROSS JOIN "${f.schema}".sessions s
          WHERE a.application_name=$1 AND a.wait_event_type='Lock' AND a.query LIKE 'SELECT id,deleted_at FROM users%'`,
              [f.schema],
            )
          ).rows[0];
          if (state?.began_valid && state.expired) {
            observed = true;
            break;
          }
          await new Promise((done) => setTimeout(done, 25));
        }
        expect(
          observed,
          'A valid-at-start transaction must remain blocked until after real credential expiry.',
        ).toBe(true);
        await blocker.query('ROLLBACK');
        return await pending;
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
        await pending?.catch(() => undefined);
      }
    }
    it('OAuth begin rejects the expired initiating session without writing state or contacting Google', async () => {
      const f = await fixture(),
        fetcher = vi.fn(async () => {
          throw new Error('Network forbidden in credential regression.');
        });
      const service = new GoogleCalendarConnections(
        f.db,
        {
          clientId: 'fictional-clock-client',
          clientSecret: 'fictional-clock-secret',
          redirectUri: 'http://127.0.0.1/integrations/google-calendar/callback',
        },
        { fetch: fetcher },
      );
      const result = await expiresDuringWait(f, () =>
        service.begin(f.owner, `Bearer ${f.token}`).then(
          () => ({ allowed: true }),
          (error) => ({ allowed: false, code: error.code }),
        ),
      );
      expect(result).toEqual({ allowed: false, code: 'oauth_session_expired' });
      expect(await new Repository(f.db).list(f.owner, 'integration')).toEqual([]);
      expect(fetcher).not.toHaveBeenCalled();
    });
    it('gateway denies a tool after the same wait without receipt, trace, job or returned data', async () => {
      const f = await fixture(),
        engine = new Engine(f.db, config),
        store = new LiveSessionStore(f.db);
      let { receipt } = await store.reserve(f.owner, randomUUID());
      receipt = await store.attachProvider(
        f.owner,
        receipt.id,
        receipt.version,
        'fictional-clock-session',
      );
      await engine.repo.put(f.owner, 'tool_access', {
        id: `tool-access:${f.owner}`,
        ownerId: f.owner,
        version: 1,
        enabled: true,
        tools: ['memory_lookup'],
        updatedAt: new Date().toISOString(),
      });
      const gateway = new ApplicationToolGateway(engine, store);
      const outcome = await expiresDuringWait(f, () =>
        gateway.invoke(
          {
            ownerId: f.owner,
            liveReceiptId: receipt.id,
            authSessionHash: hashToken(f.token),
            callId: `clock-${randomUUID()}`,
          },
          'memory_lookup',
          JSON.stringify({ query: '', contactId: null, limit: 1 }),
        ),
      );
      expect(outcome).toMatchObject({
        status: 'blocked',
        reasonCode: 'session_expired',
        verification: 'policy_denial',
      });
      expect(outcome.data).toBeUndefined();
      expect(await engine.repo.list(f.owner, 'tool_receipt')).toEqual([]);
      expect(await engine.repo.list(f.owner, 'tool_trace')).toEqual([]);
      expect(Number((await f.db.query('SELECT count(*) AS n FROM jobs'))[0].n)).toBe(0);
    });
  },
);
