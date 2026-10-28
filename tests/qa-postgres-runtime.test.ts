import { guardedPostgresFixture } from './support/postgres-fixture.js';
import { fork, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Database } from '../apps/server/src/db.js';
import { LiveSessionStore } from '../apps/server/src/live-session-store.js';
import { Engine } from '../apps/server/src/engine.js';
import { VoiceService } from '../apps/server/src/voice.js';
import { seedOwner } from '../apps/server/src/seed.js';
import { createApp } from '../apps/server/src/app.js';
import { newUser, createSession, ownerFromToken } from '../apps/server/src/auth.js';
import type { Config } from '../apps/server/src/config.js';

const connectionFile = process.env.KLNK_POSTGRES_TEST_CONNECTION_FILE;
const simulator: Config = {
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
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
type ChildResult = {
  ok: boolean;
  code?: string;
  created?: boolean;
  receiptId?: string;
  migrations?: number;
  firstEffects?: number;
  secondEffects?: number;
  completed?: boolean;
  terminalAccepted?: boolean;
  failureCode?: string;
  renewed?: number;
};

describe.skipIf(!connectionFile)('opt-in isolated PostgreSQL multiprocess QA', () => {
  let privateConnection: { url: string; key: string }, admin: pg.Pool;
  const schemas: string[] = [],
    databases: Database[] = [],
    children = new Set<ChildProcess>();
  beforeAll(async () => {
    privateConnection = JSON.parse(await readFile(resolve(connectionFile!), 'utf8'));
    guardedPostgresFixture(privateConnection);
    admin = new pg.Pool({ connectionString: privateConnection.url, max: 4 });
  });
  afterAll(async () => {
    for (const child of children) if (child.exitCode === null) child.kill();
    await Promise.all(databases.splice(0).map((db) => db.close()));
    for (const schema of schemas) {
      if (!/^qa_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe cleanup namespace.');
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
    await admin?.end();
  });
  async function fixture(open = true) {
    const schema = `qa_${randomUUID().replace(/-/g, '')}`;
    schemas.push(schema);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(privateConnection.url);
    url.searchParams.set('options', `-c search_path=${schema}`);
    url.searchParams.set('application_name', `parent_${schema}`);
    const address = url.toString();
    let db: Database | undefined;
    if (open) {
      db = await new Database({
        url: address,
        key: privateConnection.key,
        production: true,
      }).open();
      databases.push(db);
    }
    return { schema, address, db: db!, key: privateConnection.key };
  }
  function task(input: Record<string, unknown>) {
    const first = deferred();
    let finish!: (result: ChildResult) => void;
    let fail!: (error: Error) => void;
    const done = new Promise<ChildResult>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    let announce!: (value: { receiptId: string }) => void;
    const ready = new Promise<{ receiptId: string }>((resolve) => {
      announce = resolve;
    });
    const env: Record<string, string> = {
      NODE_ENV: 'test',
      KLNK_POSTGRES_TEST_CONNECTION_FILE: resolve(connectionFile!),
    };
    for (const key of ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'KLNK_TEST_POSTGRES_URL'])
      if (process.env[key]) env[key] = process.env[key]!;
    const child = fork(
      fileURLToPath(new URL('../scripts/qa-postgres-child.ts', import.meta.url)),
      [JSON.stringify(input)],
      { execArgv: ['--import', 'tsx'], env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
    );
    children.add(child);
    const timeout = setTimeout(() => {
      child.kill();
      fail(new Error('QA child timeout; no diagnostic payload retained.'));
    }, 20000);
    child.on('message', (message) => {
      if (!message || typeof message !== 'object') return;
      const value = message as ChildResult & { type: string };
      if (value.type === 'effect_started') first.resolve();
      if (value.type === 'controller_ready' && value.receiptId)
        announce({ receiptId: value.receiptId });
      if (value.type === 'result') {
        clearTimeout(timeout);
        finish(value);
      }
    });
    child.on('error', () => {
      clearTimeout(timeout);
      fail(new Error('QA child failed to launch.'));
    });
    child.on('exit', () => {
      children.delete(child);
      clearTimeout(timeout);
      fail(new Error('QA child exited before reporting.'));
    });
    return {
      child,
      done,
      ready,
      started: first.promise,
      continue: () => child.send({ type: 'continue' }),
    };
  }
  async function owner(db: Database) {
    const id = randomUUID();
    await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
      id,
      `${id}@example.invalid`,
      'fictional-unused-hash',
    ]);
    return id;
  }

  it('OPS-01 two processes apply each migration once on one fresh schema', async () => {
    const f = await fixture(false);
    const a = task({ operation: 'migrate', schema: f.schema }),
      b = task({ operation: 'migrate', schema: f.schema });
    const results = await Promise.all([a.done, b.done]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results[0].migrations).toBeGreaterThanOrEqual(4);
    expect(results[0].migrations).toBe(results[1].migrations);
    const rows = await admin.query(
      `SELECT name,count(*)::int AS total FROM "${f.schema}".schema_migrations GROUP BY name`,
    );
    expect(rows.rows.every((row) => row.total === 1)).toBe(true);
  });
  it('VOICE-03 two processes reserve a duplicate UUID once for the same owner', async () => {
    const f = await fixture(),
      id = await owner(f.db),
      requestId = randomUUID();
    const results = await Promise.all([
      task({ operation: 'reserve', schema: f.schema, owner: id, requestId }).done,
      task({ operation: 'reserve', schema: f.schema, owner: id, requestId }).done,
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.receiptId)).size).toBe(1);
  });
  it('VOICE-03 global capacity remains atomic across processes and owners', async () => {
    const f = await fixture(),
      a = await owner(f.db),
      b = await owner(f.db);
    const results = await Promise.all(
      [a, b].map(
        (id) =>
          task({
            operation: 'reserve',
            schema: f.schema,
            owner: id,
            requestId: randomUUID(),
            maxConcurrent: 1,
          }).done,
      ),
    );
    expect(results.filter((result) => result.ok && result.created)).toHaveLength(1);
    expect(results.filter((result) => !result.ok).map((result) => result.code)).toEqual([
      'voice_concurrency_limit',
    ]);
  });
  it('VOICE-04 a separate expired controller cannot renew or persist terminal authority after takeover', async () => {
    const f = await fixture(),
      id = await owner(f.db),
      requestId = randomUUID();
    const stale = task({ operation: 'controller', schema: f.schema, owner: id, requestId });
    const started = await stale.ready;
    await f.db.query(
      "UPDATE live_sessions SET controller_lease_until=now()-interval '1 second' WHERE id=$1",
      [started.receiptId],
    );
    const replacement = new LiveSessionStore(f.db);
    const claimed = (await replacement.claimUnresolved()).find(
      (receipt) => receipt.id === started.receiptId,
    )!;
    expect(claimed).toBeDefined();
    expect(replacement.ownsController(claimed)).toBe(true);
    stale.continue();
    expect(await stale.done).toMatchObject({
      ok: true,
      terminalAccepted: false,
      failureCode: 'voice_controller_lost',
      renewed: 0,
    });
    expect((await replacement.get(id, claimed.id))?.status).toBe('active');
    expect(await replacement.get(randomUUID(), claimed.id)).toBeUndefined();
    const closed = await replacement.transition(id, claimed.id, claimed.version, 'closed', {
      source: 'provider_event',
      event: 'session.closed',
    });
    expect(closed.status).toBe('closed');
    expect(closed.terminalEvidence?.event).toBe('session.closed');
    expect(
      (await replacement.recordProviderObservation(id, claimed.id, claimed.providerSessionId!))
        .status,
    ).toBe('closed');
  });
  it('OPS-02 a separate stale worker cannot dispatch its next effect or finish replacement work', async () => {
    const f = await fixture(),
      id = await owner(f.db),
      engine = new Engine(f.db, simulator);
    const job = await engine.repo.enqueue(id, null, 'provider_delete', {
      conversationId: 'fictional-conversation',
      voiceId: 'fictional-voice',
    });
    const worker = task({ operation: 'worker', schema: f.schema });
    await worker.started;
    await f.db.query(
      "UPDATE jobs SET lease_token='fictional-replacement',worker_id='fictional-replacement-worker',lease_until=now()+interval '1 minute' WHERE id=$1",
      [job],
    );
    worker.continue();
    expect(await worker.done).toMatchObject({
      ok: true,
      firstEffects: 1,
      secondEffects: 0,
      completed: false,
    });
    expect(
      (await f.db.query('SELECT status,lease_token FROM jobs WHERE id=$1', [job]))[0],
    ).toMatchObject({ status: 'running', lease_token: 'fictional-replacement' });
  });
  it('DATA-01 deletion notices a separate process reservation inserted after preflight', async () => {
    const f = await fixture(),
      service = await createApp({ db: f.db, config: simulator, worker: false });
    const entered = deferred(),
      resume = deferred();
    try {
      const account = (
        await service.app.inject({
          method: 'POST',
          url: '/auth/register',
          payload: {
            email: 'qa-pg-delete@example.invalid',
            name: 'Fictional PG Owner',
            password: 'Fictional PostgreSQL password',
          },
        })
      ).json();
      const list = service.repo.list.bind(service.repo);
      let held = false;
      vi.spyOn(service.repo, 'list').mockImplementation(
        async (...args: Parameters<typeof service.repo.list>) => {
          if (!held && args[1] === 'mission') {
            held = true;
            entered.resolve();
            await resume.promise;
          }
          return list(...args);
        },
      );
      const deleting = service.app
        .inject({
          method: 'DELETE',
          url: '/account',
          headers: { authorization: `Bearer ${account.token}` },
        })
        .then((value) => value);
      await entered.promise;
      expect(
        await task({
          operation: 'reserve',
          schema: f.schema,
          owner: account.user.id,
          requestId: randomUUID(),
        }).done,
      ).toMatchObject({ ok: true, created: true });
      resume.resolve();
      expect((await deleting).statusCode).toBe(409);
      expect(
        (await f.db.query('SELECT deleted_at FROM users WHERE id=$1', [account.user.id]))[0]
          .deleted_at,
      ).toBeNull();
    } finally {
      resume.resolve();
      vi.restoreAllMocks();
      await service.app.close();
    }
  });
  it('DATA-01 deletion removes a personal write committed while deletion waits for its owner lock', async () => {
    const f = await fixture(),
      service = await createApp({ db: f.db, config: simulator, worker: false });
    const entered = deferred(),
      resume = deferred();
    let writing: Promise<unknown> | undefined;
    try {
      const account = (
        await service.app.inject({
          method: 'POST',
          url: '/auth/register',
          payload: {
            email: 'qa-pg-latewrite@example.invalid',
            name: 'Fictional PG Writer',
            password: 'Fictional PG writer password',
          },
        })
      ).json();
      writing = f.db.transaction(async (sql) => {
        await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [account.user.id]);
        entered.resolve();
        await resume.promise;
        return service.repo.in(sql).put(account.user.id, 'memory', {
          id: randomUUID(),
          text: 'Fictional concurrent private write',
        });
      });
      await entered.promise;
      const deleting = service.app
        .inject({
          method: 'DELETE',
          url: '/account',
          headers: { authorization: `Bearer ${account.token}` },
        })
        .then((value) => value);
      await vi.waitFor(
        async () => {
          const result = await admin.query(
            "SELECT count(*)::int AS total FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
            [`parent_${f.schema}`],
          );
          expect(result.rows[0].total).toBeGreaterThan(0);
        },
        { timeout: 5000, interval: 20 },
      );
      resume.resolve();
      await writing;
      expect((await deleting).statusCode).toBe(200);
      expect(
        (
          await f.db.query('SELECT count(*)::int AS total FROM resources WHERE owner_id=$1', [
            account.user.id,
          ])
        )[0].total,
      ).toBe(0);
      expect(
        (await f.db.query('SELECT deleted_at FROM users WHERE id=$1', [account.user.id]))[0]
          .deleted_at,
      ).toBeTruthy();
    } finally {
      resume.resolve();
      await writing?.catch(() => undefined);
      await service.app.close();
    }
  });
  it('DATA-01 voice clearing does not hold a session row while waiting for the owner lock', async () => {
    const f = await fixture(),
      user = await newUser(f.db, 'qa-pg-voice@example.invalid', 'Fictional voice password');
    const engine = new Engine(f.db, simulator);
    await seedOwner(engine.repo, user.id, 'Fictional PG Voice Owner', false);
    const voice = new VoiceService(engine);
    const reply = await voice.turn(user.id, {
      requestId: randomUUID(),
      text: 'Hello fictional QA',
    });
    const holder = new pg.Client({ connectionString: f.address }),
      probe = new pg.Client({ connectionString: f.address });
    await holder.connect();
    await probe.connect();
    let clearing: Promise<unknown> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
      clearing = voice.clearSession(user.id, reply.sessionId);
      await vi.waitFor(
        async () => {
          const result = await admin.query(
            "SELECT count(*)::int AS total FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
            [`parent_${f.schema}`],
          );
          expect(result.rows[0].total).toBeGreaterThan(0);
        },
        { timeout: 5000, interval: 20 },
      );
      await probe.query('BEGIN');
      const visible = await probe.query(
        'SELECT id FROM resources WHERE owner_id=$1 AND id=$2 FOR UPDATE NOWAIT',
        [user.id, reply.sessionId],
      );
      expect(visible.rows).toHaveLength(1);
      await probe.query('COMMIT');
      await holder.query('COMMIT');
      await clearing;
    } finally {
      await probe.query('ROLLBACK').catch(() => undefined);
      await holder.query('ROLLBACK').catch(() => undefined);
      await clearing?.catch(() => undefined);
      await probe.end();
      await holder.end();
    }
  });
  it('OPS-01 real PostgreSQL encrypted restore preserves deletion policy and drops credentials/leases', async () => {
    const source = await fixture(),
      target = await fixture(),
      a = await owner(source.db),
      b = await owner(source.db);
    const engine = new Engine(source.db, simulator);
    await engine.repo.put(a, 'memory', {
      id: randomUUID(),
      text: 'Fictional deleted private record',
    });
    await engine.repo.put(b, 'memory', { id: randomUUID(), text: 'Fictional retained record' });
    const token = await createSession(source.db, b);
    const store = new LiveSessionStore(source.db);
    await store.reserve(b, randomUUID());
    const backup = await source.db.createBackup();
    expect(JSON.stringify(backup)).not.toContain('Fictional retained record');
    const result = await target.db.restoreBackup(backup, { deletedOwnerIds: [a] });
    expect(result).toMatchObject({ owners: 2, resources: 1, unresolvedLive: 1 });
    expect(await ownerFromToken(target.db, `Bearer ${token}`)).toBeUndefined();
    expect(
      (await target.db.query('SELECT deleted_at FROM users WHERE id=$1', [a]))[0].deleted_at,
    ).toBeTruthy();
    expect(
      (
        await target.db.query(
          'SELECT status,controller_id,controller_lease_until FROM live_sessions',
        )
      )[0],
    ).toMatchObject({ status: 'unconfirmed', controller_id: null, controller_lease_until: null });
  });
});
