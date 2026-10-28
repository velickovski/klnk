import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database, Repository } from '../apps/server/src/db.js';
import { getConfig } from '../apps/server/src/config.js';
import { Engine } from '../apps/server/src/engine.js';
import { createRuntime } from '../apps/server/src/composition-root.js';
import { InternalCalendar } from '../apps/server/src/network/calendar.js';
import { NetworkCoordinator } from '../apps/server/src/network/coordination.js';
import type { NetworkPolicyInput, NetworkRequestInput } from '../packages/domain/src/network.js';
import { openTestDatabase } from './support/test-database.js';

const databases: Database[] = [];
const children = new Set<ChildProcess>();
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children) if (child.exitCode === null) child.kill();
  children.clear();
  await Promise.all(databases.splice(0).map((db) => db.close()));
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function database() {
  const db = await openTestDatabase({ dataDir: 'memory://' });
  databases.push(db);
  return db;
}
async function user(db: Database) {
  const id = randomUUID();
  await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
    id,
    `${id}@example.invalid`,
    'fictional-unused-hash',
  ]);
  return id;
}
function config() {
  return {
    ...getConfig(),
    production: false,
    provider: 'simulator' as const,
    liveEnabled: false,
    openaiKey: undefined,
    elevenKey: undefined,
    agentId: undefined,
    phoneId: undefined,
    twilioSid: undefined,
    twilioToken: undefined,
  };
}
async function networkFixture() {
  const db = await database();
  const a = await user(db),
    b = await user(db);
  const log = vi.fn();
  const coordinator = new NetworkCoordinator(db, new InternalCalendar(db), {
    logger: { error: log },
  });
  const identity = await coordinator.identity(b);
  const connection = await coordinator.invite(a, identity.member.memberCode);
  await coordinator.updateConnection(b, connection.id, {
    action: 'accept',
    expectedVersion: connection.version,
  });
  for (const [owner, peer] of [
    [a, b],
    [b, a],
  ]) {
    const policy = await coordinator.policy(owner);
    const { ownerId, version, updatedAt, ...input } = policy;
    const rules: NetworkPolicyInput = {
      ...input,
      enabled: true,
      trustedMemberIds: [peer],
      topics: ['routine'],
      allowMessages: true,
      allowMeetings: true,
      autoAcceptMeetings: false,
    };
    await coordinator.savePolicy(owner, rules, version);
  }
  const request = (kind: 'inform' | 'meeting' = 'inform'): NetworkRequestInput => ({
    requestId: randomUUID(),
    connectionId: connection.id,
    kind,
    topic: 'routine',
    purpose: 'Fictional reliability check',
    message: 'A fictional message.',
    candidateSlots:
      kind === 'meeting'
        ? [
            {
              startAt: new Date(Date.now() + 86400000).toISOString(),
              endAt: new Date(Date.now() + 88200000).toISOString(),
              timezone: 'UTC',
            },
          ]
        : [],
    location: 'Fictional place',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  return { db, a, b, coordinator, request, log };
}

describe('shared worker composition and failure isolation', () => {
  it('a standalone child using the production composition executes Google revocation and tool retention', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'klnk-worker-'));
    directories.push(dir);
    let db = await new Database({ dataDir: dir }).open();
    const owner = await user(db),
      repo = new Repository(db);
    const job = await repo.enqueue(owner, null, 'google_revoke', {
      token: 'fictional-revocation-token',
    });
    const trace = randomUUID();
    await repo.put(owner, 'tool_trace', { id: trace, fictional: true });
    await db.query("UPDATE resources SET created_at=now()-interval '8 days' WHERE id=$1", [trace]);
    await db.close();
    const child = fork(
      fileURLToPath(new URL('./worker-composition-child.ts', import.meta.url)),
      [],
      {
        execArgv: ['--import', 'tsx'],
        env: { ...process.env, NODE_ENV: 'test', KLNK_WORKER_FIXTURE_DIR: dir },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    );
    children.add(child);
    const message = await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('worker_fixture_timeout')), 20000);
      child.once('message', (value) => {
        clearTimeout(timeout);
        resolve(value);
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        if (code) reject(new Error('worker_fixture_exit'));
      });
    });
    expect(message).toEqual({ ok: true, revocations: 1, completed: true });
    if (child.exitCode === null)
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    children.delete(child);
    db = await new Database({ dataDir: dir }).open();
    databases.push(db);
    expect((await db.query('SELECT status,payload FROM jobs WHERE id=$1', [job]))[0].status).toBe(
      'done',
    );
    expect(
      db.decrypt((await db.query('SELECT payload FROM jobs WHERE id=$1', [job]))[0].payload),
    ).toEqual({ revoked: true });
    expect(await db.query('SELECT id FROM resources WHERE id=$1', [trace])).toEqual([]);
  });

  it('both entry paths use one runtime with identity-checked Google access', async () => {
    const db = await database();
    const runtime = createRuntime(db, config());
    vi.spyOn(runtime.google, 'access').mockResolvedValue({
      accessToken: 'fictional',
      calendarId: 'primary',
      integrationId: 'expected',
      version: 1,
    });
    expect(await runtime.engine.googleCalendarAccess?.('owner', 'expected')).toMatchObject({
      integrationId: 'expected',
    });
    await expect(runtime.engine.googleCalendarAccess?.('owner', 'another')).rejects.toMatchObject({
      code: 'integration_mismatch',
    });
    expect(runtime.engine.toolMaintenance).toBeTypeOf('function');
    expect(runtime.engine.googleRevoke).toBeTypeOf('function');
  });

  it('a failed retention sweep is attempted once and does not starve ready legacy jobs', async () => {
    const db = await database(),
      owner = await user(db),
      log = vi.fn();
    const engine = new Engine(db, config(), { logger: { error: log } });
    const sweep = vi.spyOn(engine, 'sweepRetention').mockRejectedValue(new Error('private-body'));
    engine.googleRevoke = vi.fn(async () => {});
    await engine.repo.enqueue(owner, null, 'google_revoke', { token: 'fictional-token' });
    expect(await engine.tick()).toBe(true);
    expect(await engine.tick()).toBe(false);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({
      event: 'legacy_retention_sweep_failed',
      reasonCode: 'operation_failed',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-body');
  });

  it('unreadable legacy ciphertext consumes durable attempts and allows the next job through', async () => {
    const db = await database(),
      owner = await user(db),
      log = vi.fn();
    const engine = new Engine(db, config(), { logger: { error: log } });
    const poison = await engine.repo.enqueue(owner, null, 'google_revoke', { token: 'fictional' });
    const healthy = await engine.repo.enqueue(owner, null, 'google_revoke', { token: 'fictional' });
    await db.query(
      "UPDATE jobs SET payload='unreadable',run_at=now()-interval '1 minute' WHERE id=$1",
      [poison],
    );
    engine.googleRevoke = vi.fn(async () => {});
    expect(await engine.tick()).toBe(false);
    expect(
      (await db.query('SELECT status,attempts FROM jobs WHERE id=$1', [poison]))[0],
    ).toMatchObject({ status: 'queued', attempts: 1 });
    expect(await engine.tick()).toBe(true);
    expect((await db.query('SELECT status FROM jobs WHERE id=$1', [healthy]))[0].status).toBe(
      'done',
    );
    for (let i = 1; i < 5; i++) await engine.tick(true);
    expect(
      (await db.query('SELECT status,attempts,last_error FROM jobs WHERE id=$1', [poison]))[0],
    ).toMatchObject({ status: 'failed', attempts: 5, last_error: 'operation_failed' });
  });

  it('a corrupt voice retention row does not prevent tool retention', async () => {
    const db = await database(),
      owner = await user(db),
      log = vi.fn();
    const engine = new Engine(db, config(), { logger: { error: log } });
    const id = randomUUID();
    await engine.repo.put(owner, 'voice_turn', { id });
    await db.query(
      "UPDATE resources SET payload='unreadable',updated_at=now()-interval '2 days' WHERE id=$1",
      [id],
    );
    engine.toolMaintenance = vi.fn(async () => {});
    await engine.sweepRetention();
    expect(engine.toolMaintenance).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({
      event: 'voice_retention_row_failed',
      reasonCode: 'operation_failed',
    });
  });

  it('backs off and dead-letters an unreadable network task while delivering healthy work', async () => {
    const { db, a, b, coordinator, request, log } = await networkFixture();
    const poison = randomUUID();
    await db.query(
      "INSERT INTO network_records(id,kind,owner_a,owner_b,status,payload,updated_at) VALUES($1,'task',$2,$3,'queued','unreadable',now()-interval '1 minute')",
      [poison, a, b],
    );
    const healthy = await coordinator.submit(a, request());
    await coordinator.tick();
    expect((await coordinator.detail(b, healthy.id)).state).toBe('delivered');
    const [failed] = await db.query(
      'SELECT status,failure_attempts,next_attempt_at FROM network_records WHERE id=$1',
      [poison],
    );
    expect(failed).toMatchObject({ status: 'queued', failure_attempts: 1 });
    expect(new Date(failed.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    for (let i = 1; i < 5; i++) {
      await db.query(
        "UPDATE network_records SET next_attempt_at=now()-interval '1 second' WHERE id=$1",
        [poison],
      );
      await coordinator.tick();
    }
    const [quarantined] = await db.query(
      'SELECT status,failure_attempts,dead_lettered_at FROM network_records WHERE id=$1',
      [poison],
    );
    expect(quarantined).toMatchObject({ status: 'dead_letter', failure_attempts: 5 });
    expect(quarantined.dead_lettered_at).toBeTruthy();
    expect(log).toHaveBeenCalledWith({
      event: 'network_task_dead_lettered',
      reasonCode: 'operation_failed',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('unreadable');
  });

  it('continues queue work even if a corrupted conversation breaks the periodic retention sweep', async () => {
    const { db, a, b, coordinator, request, log } = await networkFixture();
    const healthy = await coordinator.submit(a, request());
    const otherA = await user(db),
      otherB = await user(db);
    await db.query(
      "INSERT INTO network_records(id,kind,owner_a,owner_b,status,payload) VALUES($1,'conversation',$2,$3,'delivered','unreadable')",
      [randomUUID(), otherA, otherB],
    );
    await coordinator.tick();
    expect((await coordinator.detail(b, healthy.id)).state).toBe('delivered');
    expect(log).toHaveBeenCalledWith({
      event: 'network_retention_sweep_failed',
      reasonCode: 'operation_failed',
    });
  });

  it('does not overlap network ticks or rewrite unchanged waiting tasks', async () => {
    const { db, a, coordinator, request } = await networkFixture();
    const pending = await coordinator.submit(a, request('meeting'));
    await coordinator.tick();
    expect((await coordinator.detail(a, pending.id)).state).toBe('awaiting_approval');
    const before = await db.query(
      "SELECT payload,updated_at FROM network_records WHERE kind='task'",
    );
    let release!: () => void, started!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const original = db.query.bind(db);
    let selects = 0;
    vi.spyOn(db, 'query').mockImplementation(async (sql, params) => {
      if (sql.startsWith('SELECT id,owner_a,owner_b,failure_attempts')) {
        selects++;
        started();
        await blocked;
      }
      return original(sql, params);
    });
    const first = coordinator.tick();
    await entered;
    await coordinator.tick();
    expect(selects).toBe(1);
    release();
    await first;
    expect(
      await original("SELECT payload,updated_at FROM network_records WHERE kind='task'"),
    ).toEqual(before);
  });
});
