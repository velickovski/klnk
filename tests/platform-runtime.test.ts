import { openTestDatabase } from './support/test-database.js';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '../apps/server/src/db.js';
import { Engine } from '../apps/server/src/engine.js';
import type { Config } from '../apps/server/src/config.js';
import { runtimeReadiness } from '../apps/server/src/readiness.js';
import { createSession, ownerFromToken } from '../apps/server/src/auth.js';

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
  googleClientId: undefined,
  googleClientSecret: undefined,
  googleRedirectUri: undefined,
};
const databases: Database[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(
  payload = { conversationId: 'fictional-conversation' } as Record<string, string>,
) {
  const db = await openTestDatabase({ dataDir: 'memory://' });
  databases.push(db);
  const owner = randomUUID();
  await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
    owner,
    `${owner}@example.invalid`,
    'unused-fictional-hash',
  ]);
  const engine = new Engine(db, config, { leaseMs: 200, heartbeatMs: 40 });
  const job = await engine.repo.enqueue(owner, null, 'provider_delete', payload);
  return { db, engine, owner, job };
}

describe('OPS-02 renewable worker ownership', () => {
  it('renews a long provider job while another engine polls without dispatching it twice', async () => {
    const { db, engine, job } = await fixture();
    const started = deferred(),
      finish = deferred();
    let dispatches = 0;
    engine.eleven = {
      deleteConversation: async () => {
        dispatches++;
        started.resolve();
        await finish.promise;
      },
    } as any;
    const second = new Engine(db, config, { leaseMs: 200, heartbeatMs: 40 });
    second.eleven = engine.eleven;
    const running = engine.tick(true);
    await started.promise;
    const [initial] = await db.query('SELECT lease_until FROM jobs WHERE id=$1', [job]);
    // Wait until the original lease would have expired. This exercises actual
    // renewal rather than hoping that a fixed delay crosses the right clock.
    await expect
      .poll(
        async () => {
          const [clock] = await db.query('SELECT clock_timestamp() AS observed_at');
          return new Date(clock.observed_at).getTime() > new Date(initial.lease_until).getTime();
        },
        { timeout: 3000, interval: 20 },
      )
      .toBe(true);
    expect(await second.tick(true)).toBe(false);
    const [active] = await db.query(
      'SELECT status,heartbeat_at,lease_until,lease_token FROM jobs WHERE id=$1',
      [job],
    );
    expect(active.status).toBe('running');
    expect(active.lease_token).toBeTruthy();
    expect(new Date(active.lease_until).getTime()).toBeGreaterThan(Date.now());
    finish.resolve();
    expect(await running).toBe(true);
    expect(dispatches).toBe(1);
    const [done] = await db.query('SELECT status,lease_token,worker_id FROM jobs WHERE id=$1', [
      job,
    ]);
    expect(done).toMatchObject({ status: 'done', lease_token: null, worker_id: null });
  });
  it('a fenced stale worker cannot dispatch the next effect or mark its replacement done', async () => {
    const { db, engine, job } = await fixture({
      conversationId: 'fictional-conversation',
      voiceId: 'fictional-voice',
    });
    const started = deferred(),
      finish = deferred();
    let voiceDeletes = 0;
    engine.eleven = {
      deleteConversation: async () => {
        started.resolve();
        await finish.promise;
      },
      deleteVoice: async () => {
        voiceDeletes++;
      },
    } as any;
    const running = engine.tick(true);
    await started.promise;
    await db.query(
      "UPDATE jobs SET lease_token='replacement-lease',worker_id='replacement-worker',lease_until=now()+interval '1 minute' WHERE id=$1",
      [job],
    );
    finish.resolve();
    expect(await running).toBe(false);
    expect(voiceDeletes).toBe(0);
    const [active] = await db.query('SELECT status,lease_token,last_error FROM jobs WHERE id=$1', [
      job,
    ]);
    expect(active).toMatchObject({
      status: 'running',
      lease_token: 'replacement-lease',
      last_error: null,
    });
  });
  it('cancellation during an in-flight provider operation prevents later effects', async () => {
    const { db, engine, job } = await fixture({
      conversationId: 'fictional-conversation',
      voiceId: 'fictional-voice',
    });
    const started = deferred(),
      finish = deferred();
    let voiceDeletes = 0;
    engine.eleven = {
      deleteConversation: async () => {
        started.resolve();
        await finish.promise;
      },
      deleteVoice: async () => {
        voiceDeletes++;
      },
    } as any;
    const running = engine.tick(true);
    await started.promise;
    await db.query("UPDATE jobs SET status='cancelled' WHERE id=$1", [job]);
    finish.resolve();
    expect(await running).toBe(false);
    expect(voiceDeletes).toBe(0);
    expect((await db.query('SELECT status FROM jobs WHERE id=$1', [job]))[0].status).toBe(
      'cancelled',
    );
  });
  it('expired ownership at the retry limit becomes operator-visible failure without another dispatch', async () => {
    const { db, engine, job } = await fixture();
    let dispatches = 0;
    engine.eleven = {
      deleteConversation: async () => {
        dispatches++;
      },
    } as any;
    await db.query(
      "UPDATE jobs SET status='running',attempts=5,lease_until=now()-interval '1 second',lease_token='dead-worker' WHERE id=$1",
      [job],
    );
    expect(await engine.tick(true)).toBe(false);
    expect(dispatches).toBe(0);
    expect(
      (await db.query('SELECT status,last_error,lease_token FROM jobs WHERE id=$1', [job]))[0],
    ).toMatchObject({
      status: 'failed',
      last_error: 'lease_expired_retry_exhausted',
      lease_token: null,
    });
  });
  it('provider errors persist fixed error codes instead of private provider messages', async () => {
    const { db, engine, job } = await fixture();
    engine.eleven = {
      deleteConversation: async () => {
        throw new Error('fictional-secret-provider-body');
      },
    } as any;
    expect(await engine.tick(true)).toBe(false);
    const [row] = await db.query('SELECT status,last_error,attempts FROM jobs WHERE id=$1', [job]);
    expect(row).toMatchObject({ status: 'queued', last_error: 'operation_failed', attempts: 1 });
    expect(JSON.stringify(row)).not.toContain('fictional-secret-provider-body');
  });
  it('readiness shows cleanup failure and database outage without provider messages', async () => {
    const { db, engine } = await fixture();
    engine.eleven = {
      deleteConversation: async () => {
        throw new Error('fictional-private-provider-body');
      },
    } as any;
    expect(await runtimeReadiness(db)).toMatchObject({
      ready: true,
      status: 'ready',
      cleanup: { status: 'pending', pending: 1, failed: 0 },
    });
    for (let attempt = 0; attempt < 5; attempt++) await engine.tick(true);
    const report = await runtimeReadiness(db);
    expect(report).toMatchObject({
      ready: true,
      status: 'degraded',
      cleanup: { status: 'attention', pending: 0, failed: 1 },
    });
    expect(JSON.stringify(report)).not.toContain('fictional-private-provider-body');
    await db.close();
    databases.splice(databases.indexOf(db), 1);
    expect(await runtimeReadiness(db)).toMatchObject({
      ready: false,
      status: 'not_ready',
      database: 'unavailable',
    });
  });
  it('rejects expired and deleted-account sessions and resource identity collisions honestly', async () => {
    const { db, engine, owner } = await fixture();
    const token = await createSession(db, owner);
    expect(await ownerFromToken(db, `Bearer ${token}`)).toBe(owner);
    await db.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE owner_id=$1", [
      owner,
    ]);
    expect(await ownerFromToken(db, `Bearer ${token}`)).toBeUndefined();
    const other = randomUUID();
    await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
      other,
      `${other}@example.invalid`,
      'unused-fictional-hash',
    ]);
    await engine.repo.put(owner, 'memory', {
      id: 'identity-collision',
      text: 'Fictional first owner note',
    });
    await expect(
      engine.repo.put(other, 'memory', {
        id: 'identity-collision',
        text: 'Fictional second owner note',
      }),
    ).rejects.toMatchObject({ code: 'resource_identity_conflict' });
    expect(await engine.repo.get(other, 'memory', 'identity-collision')).toBeUndefined();
    expect((await engine.repo.get(owner, 'memory', 'identity-collision')).text).toBe(
      'Fictional first owner note',
    );
    await db.query('UPDATE users SET deleted_at=now() WHERE id=$1', [owner]);
    await expect(createSession(db, owner)).rejects.toMatchObject({ statusCode: 401 });
  });
});
