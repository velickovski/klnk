import { guardedPostgresFixture } from './support/postgres-fixture.js';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Database } from '../apps/server/src/db.js';
import { newUser, createSession } from '../apps/server/src/auth.js';
import { createApp } from '../apps/server/src/app.js';
import { getConfig } from '../apps/server/src/config.js';
import { InternalCalendar } from '../apps/server/src/network/calendar.js';
import { NetworkCoordinator } from '../apps/server/src/network/coordination.js';
import { lockNetworkOwners, NetworkStore } from '../apps/server/src/network/store.js';
import { deleteNetworkAccount } from '../apps/server/src/network/data-lifecycle.js';
import type {
  NetworkPolicy,
  NetworkPolicyInput,
  NetworkRequestInput,
} from '../packages/domain/src/network.js';

const connectionFile = process.env.KLNK_POSTGRES_TEST_CONNECTION_FILE;
const signal = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
describe.skipIf(!connectionFile)(
  'independent internal-network multiprocess PostgreSQL adversaries',
  () => {
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
      await Promise.all(databases.map((db) => db.close()));
      for (const schema of schemas) {
        if (!/^qa_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe cleanup namespace.');
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
      await admin?.end();
    });
    async function fixture() {
      const schema = `qa_${randomUUID().replace(/-/g, '')}`;
      schemas.push(schema);
      await admin.query(`CREATE SCHEMA "${schema}"`);
      const url = new URL(privateConnection.url);
      url.searchParams.set('options', `-c search_path=${schema}`);
      url.searchParams.set('application_name', `network_parent_${schema}`);
      const db = await new Database({
        url: url.toString(),
        key: privateConnection.key,
        production: true,
      }).open();
      databases.push(db);
      const calendar = new InternalCalendar(db),
        coordinator = new NetworkCoordinator(db, calendar),
        a = (await newUser(db, `${randomUUID()}@example.invalid`, 'Fictional network PG password'))
          .id,
        b = (await newUser(db, `${randomUUID()}@example.invalid`, 'Fictional network PG password'))
          .id;
      const identity = await coordinator.identity(b),
        connection = await coordinator.invite(a, identity.member.memberCode);
      await coordinator.updateConnection(b, connection.id, {
        action: 'accept',
        version: connection.version,
      });
      for (const [owner, peer] of [
        [a, b],
        [b, a],
      ]) {
        const { ownerId, version, updatedAt, ...old } = await coordinator.policy(owner);
        await coordinator.savePolicy(
          owner,
          {
            ...old,
            enabled: true,
            trustedMemberIds: [peer],
            topics: ['routine'],
            allowQuestions: true,
            allowMeetings: true,
            autoAcceptMeetings: true,
            minNoticeMinutes: 0,
            workStartMinute: 0,
            workEndMinute: 1440,
            weekdays: [0, 1, 2, 3, 4, 5, 6],
          },
          version,
        );
      }
      const input = (kind: NetworkRequestInput['kind'] = 'meeting'): NetworkRequestInput => ({
        requestId: randomUUID(),
        connectionId: connection.id,
        kind,
        purpose: 'Fictional PG coordination',
        topic: 'routine',
        message: 'Exact fictional request.',
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
        expiresAt: new Date(Date.now() + 3 * 86400000).toISOString(),
      });
      return { schema, db, a, b, calendar, coordinator, input };
    }
    function task(schema: string, operation: 'tick' | 'crash_after_event' = 'tick') {
      const ready = signal(),
        uncommitted = signal();
      let finish!: (value: { ok: boolean; code?: string }) => void, fail!: (error: Error) => void;
      const done = new Promise<{ ok: boolean; code?: string }>((r, j) => {
        finish = r;
        fail = j;
      });
      void done.catch(() => undefined);
      const env: Record<string, string> = {
        NODE_ENV: 'test',
        KLNK_POSTGRES_TEST_CONNECTION_FILE: resolve(connectionFile!),
      };
      for (const key of ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'KLNK_TEST_POSTGRES_URL'])
        if (process.env[key]) env[key] = process.env[key]!;
      const child = fork(
        fileURLToPath(new URL('./qa-network-child.ts', import.meta.url)),
        [JSON.stringify({ schema, operation })],
        { execArgv: ['--import', 'tsx'], env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
      );
      children.add(child);
      const timer = setTimeout(() => {
        child.kill();
        fail(new Error('Network QA subprocess timeout.'));
      }, 30000);
      child.on('message', (message) => {
        const value = message as { type: string; ok: boolean; code?: string };
        if (value.type === 'ready') ready.resolve();
        if (value.type === 'uncommitted_event') uncommitted.resolve();
        if (value.type === 'result') {
          clearTimeout(timer);
          finish(value);
        }
      });
      child.on('error', () => {
        clearTimeout(timer);
        fail(new Error('Network QA subprocess launch failed.'));
      });
      child.on('exit', () => {
        children.delete(child);
        clearTimeout(timer);
        fail(new Error('Network QA subprocess exited.'));
      });
      return {
        child,
        done,
        ready: ready.promise,
        uncommitted: uncommitted.promise,
        continue: () => child.send({ type: 'continue' }),
        kill: () =>
          new Promise<void>((r) => {
            child.once('exit', () => r());
            child.kill();
          }),
      };
    }
    async function race(schema: string) {
      const a = task(schema),
        b = task(schema);
      await Promise.all([a.ready, b.ready]);
      a.continue();
      b.continue();
      expect(await Promise.all([a.done, b.done])).toEqual([
        { type: 'result', ok: true },
        { type: 'result', ok: true },
      ]);
    }
    async function counts(db: Database) {
      return Object.fromEntries(
        (
          await db.query('SELECT kind,count(*)::int AS total FROM network_records GROUP BY kind')
        ).map((r) => [r.kind, r.total]),
      );
    }
    it('two independently connected workers commit the same queued agreement once with matching receipts', async () => {
      const f = await fixture(),
        c = await f.coordinator.submit(f.a, f.input());
      await race(f.schema);
      const a = await f.calendar.list(f.a),
        b = await f.calendar.list(f.b),
        event = a.events[0]!;
      expect(a.events).toHaveLength(1);
      expect(b.events[0]!.id).toBe(event.id);
      expect(event.acceptances).toHaveLength(2);
      expect(
        event.acceptances.every(
          (a) =>
            a.proposalHash === event.proposalHash && a.proposalVersion === event.proposalVersion,
        ),
      ).toBe(true);
      expect(new Set(event.acceptances.map((a) => a.ownerId)).size).toBe(2);
      expect((await f.coordinator.detail(f.a, c.id)).state).toBe('agreed');
      expect(await counts(f.db)).toMatchObject({ event: 1, reminder: 2, outbox: 2 });
    });
    it('overlapping distinct requests across processes yield one event and one unresolved result', async () => {
      const f = await fixture(),
        body = f.input(),
        one = await f.coordinator.submit(f.a, body),
        two = await f.coordinator.submit(f.a, { ...body, requestId: randomUUID() });
      await race(f.schema);
      expect((await f.calendar.list(f.a)).events).toHaveLength(1);
      expect(
        [
          (await f.coordinator.detail(f.a, one.id)).state,
          (await f.coordinator.detail(f.a, two.id)).state,
        ].sort(),
      ).toEqual(['agreed', 'unresolved']);
      expect(await counts(f.db)).toMatchObject({ event: 1, reminder: 2, outbox: 4 });
    });
    it('different accepted connections sharing one owner cannot double-book that owner across processes', async () => {
      const f = await fixture(),
        third = (
          await newUser(
            f.db,
            `${randomUUID()}@example.invalid`,
            'Fictional third PG owner password',
          )
        ).id,
        identity = await f.coordinator.identity(third),
        connection = await f.coordinator.invite(f.a, identity.member.memberCode);
      await f.coordinator.updateConnection(third, connection.id, {
        action: 'accept',
        version: connection.version,
      });
      for (const [owner, peers] of [
        [f.a, [f.b, third]],
        [third, [f.a]],
      ] as const) {
        const { ownerId, version, updatedAt, ...old } = await f.coordinator.policy(owner);
        await f.coordinator.savePolicy(
          owner,
          {
            ...old,
            enabled: true,
            trustedMemberIds: [...peers],
            topics: ['routine'],
            allowMeetings: true,
            autoAcceptMeetings: true,
            minNoticeMinutes: 0,
            workStartMinute: 0,
            workEndMinute: 1440,
            weekdays: [0, 1, 2, 3, 4, 5, 6],
          },
          version,
        );
      }
      const input = f.input(),
        first = await f.coordinator.submit(f.a, input),
        second = await f.coordinator.submit(f.a, {
          ...input,
          requestId: randomUUID(),
          connectionId: connection.id,
        });
      await race(f.schema);
      expect((await f.calendar.list(f.a)).events).toHaveLength(1);
      expect(
        [
          (await f.coordinator.detail(f.a, first.id)).state,
          (await f.coordinator.detail(f.a, second.id)).state,
        ].sort(),
      ).toEqual(['agreed', 'unresolved']);
      expect(
        (await f.calendar.list(f.b)).events.length + (await f.calendar.list(third)).events.length,
      ).toBe(1);
    });
    it('process death after uncommitted event/reminder writes rolls back; restart commits exactly once', async () => {
      const f = await fixture(),
        c = await f.coordinator.submit(f.a, f.input()),
        crashing = task(f.schema, 'crash_after_event');
      await crashing.ready;
      crashing.continue();
      await crashing.uncommitted;
      expect(
        (
          await f.db.query(
            "SELECT count(*)::int AS n FROM network_records WHERE kind IN ('event','reminder','outbox')",
          )
        )[0].n,
      ).toBe(0);
      await crashing.kill();
      expect((await f.coordinator.detail(f.a, c.id)).state).toBe('queued');
      expect((await f.calendar.list(f.a)).events).toEqual([]);
      await race(f.schema);
      expect((await f.coordinator.detail(f.a, c.id)).state).toBe('agreed');
      expect(await counts(f.db)).toMatchObject({ event: 1, reminder: 2, outbox: 2 });
    });
    it('a blocked worker rereads revoked policy after its database owner lock becomes available', async () => {
      const f = await fixture(),
        c = await f.coordinator.submit(f.a, f.input('inform')),
        worker = task(f.schema);
      await worker.ready;
      await f.db.transaction(async (sql) => {
        await lockNetworkOwners(sql, [f.a, f.b]);
        worker.continue();
        await vi.waitFor(
          async () => {
            const r = await admin.query(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
              [`network_child_${f.schema}`],
            );
            expect(r.rows[0].n).toBeGreaterThan(0);
          },
          { timeout: 7000, interval: 20 },
        );
        const store = new NetworkStore(f.db, sql),
          record = (await store.list<NetworkPolicy>(f.b, 'policy'))[0]!;
        await store.put({
          ...record,
          status: 'disabled',
          version: record.version + 1,
          value: { ...record.value, enabled: false, version: record.version + 1 },
        });
      });
      expect((await worker.done).ok).toBe(true);
      const result = await f.coordinator.detail(f.a, c.id);
      expect(result.state).toBe('paused');
      expect(result.messages).toEqual([]);
      expect((await f.calendar.list(f.a)).events).toEqual([]);
    });
    it('cancellation after a crashed attempt prevents a restarted worker from finalizing', async () => {
      const f = await fixture(),
        c = await f.coordinator.submit(f.a, f.input()),
        worker = task(f.schema, 'crash_after_event');
      await worker.ready;
      worker.continue();
      await worker.uncommitted;
      await worker.kill();
      await f.coordinator.control(f.b, c.id, 'cancel');
      await race(f.schema);
      expect((await f.coordinator.detail(f.a, c.id)).state).toBe('cancelled');
      expect((await f.calendar.list(f.a)).events).toEqual([]);
      expect((await counts(f.db)).event ?? 0).toBe(0);
    });
    it('deleting a participant after rollback removes queued work; another process cannot resurrect it', async () => {
      const f = await fixture(),
        c = await f.coordinator.submit(f.a, f.input()),
        worker = task(f.schema, 'crash_after_event');
      await worker.ready;
      worker.continue();
      await worker.uncommitted;
      await worker.kill();
      await f.db.transaction(async (sql) => {
        await lockNetworkOwners(sql, [f.a, f.b]);
        await sql.query('UPDATE users SET deleted_at=clock_timestamp() WHERE id=$1', [f.a]);
        await deleteNetworkAccount(f.db, sql, f.a);
      });
      await race(f.schema);
      expect((await f.calendar.list(f.b)).events).toEqual([]);
      expect(
        (
          await f.db.query(
            "SELECT count(*)::int AS n FROM network_records WHERE kind IN ('conversation','task','event','reminder','outbox')",
          )
        )[0].n,
      ).toBe(0);
      await expect(f.coordinator.detail(f.b, c.id)).rejects.toMatchObject({ statusCode: 404 });
    });
    it.each(['revoked', 'expired'] as const)(
      'real authenticated API rechecks a %s bearer after waiting for an owner lock',
      async (mode) => {
        const f = await fixture(),
          token = await createSession(f.db, f.a),
          service = await createApp({
            db: f.db,
            worker: false,
            config: {
              ...getConfig(),
              production: false,
              demoEnabled: true,
              provider: 'simulator',
              liveEnabled: false,
              embeddedWorker: false,
              openaiKey: undefined,
              elevenKey: undefined,
              twilioToken: undefined,
              googleClientSecret: undefined,
              webhookSecret: undefined,
            },
          });
        let pending: Promise<Awaited<ReturnType<typeof service.app.inject>>> | undefined;
        try {
          await f.db.transaction(async (sql) => {
            await lockNetworkOwners(sql, [f.a, f.b]);
            pending = service.app
              .inject({
                url: '/network/conversations',
                method: 'POST',
                headers: { authorization: `Bearer ${token}` },
                payload: f.input('inform'),
              })
              .then((value) => value);
            await vi.waitFor(
              async () => {
                const r = await admin.query(
                  "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
                  [`network_parent_${f.schema}`],
                );
                expect(r.rows[0].n).toBeGreaterThan(0);
              },
              { timeout: 7000, interval: 20 },
            );
            if (mode === 'revoked')
              await sql.query('DELETE FROM sessions WHERE owner_id=$1', [f.a]);
            else
              await sql.query(
                "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE owner_id=$1",
                [f.a],
              );
          });
          const response = await pending!;
          expect(response.statusCode).toBe(401);
          expect(response.json().error).toBe('session_expired');
          expect(
            (
              await f.db.query(
                "SELECT count(*)::int AS n FROM network_records WHERE kind='conversation'",
              )
            )[0].n,
          ).toBe(0);
        } finally {
          await service.app.close();
        }
      },
    );
  },
);
