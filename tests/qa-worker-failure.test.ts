import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../apps/server/src/db.js';
import { InternalCalendar } from '../apps/server/src/network/calendar.js';
import { NetworkCoordinator } from '../apps/server/src/network/coordination.js';
import type { NetworkRequestInput } from '../packages/domain/src/network.js';
import { openTestDatabase } from './support/test-database.js';

const databases: Database[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

async function fixture() {
  const db = await openTestDatabase({ dataDir: 'memory://' });
  databases.push(db);
  const a = randomUUID(),
    b = randomUUID();
  for (const owner of [a, b])
    await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
      owner,
      `${owner}@example.invalid`,
      'fictional-unused-password-hash',
    ]);
  const errors = vi.fn();
  const calendar = new InternalCalendar(db);
  const coordinator = new NetworkCoordinator(db, calendar, { logger: { error: errors } });
  const member = await coordinator.identity(b);
  const connection = await coordinator.invite(a, member.member.memberCode);
  await coordinator.updateConnection(b, connection.id, {
    action: 'accept',
    version: connection.version,
  });
  for (const [owner, peer] of [
    [a, b],
    [b, a],
  ]) {
    const { ownerId, version, updatedAt, ...policy } = await coordinator.policy(owner);
    await coordinator.savePolicy(
      owner,
      {
        ...policy,
        enabled: true,
        trustedMemberIds: [peer],
        topics: ['routine'],
        allowMessages: true,
        allowMeetings: true,
        autoAcceptMeetings: false,
      },
      version,
    );
  }
  const input = (kind: NetworkRequestInput['kind']): NetworkRequestInput => ({
    requestId: randomUUID(),
    connectionId: connection.id,
    kind,
    purpose: 'Fictional isolated failure',
    topic: 'routine',
    message: kind === 'inform' ? 'Approved fictional message' : '',
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
    location: '',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  return { db, a, b, calendar, coordinator, errors, input };
}

describe('independent worker failure boundaries', () => {
  it('rolls back partially started work, persists backoff across coordinator reconstruction and continues another task', async () => {
    const f = await fixture();
    const failure = await f.coordinator.submit(f.a, f.input('meeting'));
    const healthy = await f.coordinator.submit(f.a, f.input('inform'));
    vi.spyOn(f.calendar, 'available').mockRejectedValueOnce(new Error('PRIVATE_CALENDAR_ERROR_qa'));
    await f.coordinator.tick();
    expect((await f.coordinator.detail(f.b, healthy.id)).state).toBe('delivered');
    const unfinished = await f.coordinator.detail(f.a, failure.id);
    expect(unfinished.state).toBe('queued');
    expect(unfinished.proposal).toBeUndefined();
    expect(unfinished.messages).toEqual([]);
    const [task] = await f.db.query(
      "SELECT * FROM network_records WHERE kind='task' AND status='queued'",
    );
    expect(task.failure_attempts).toBe(1);
    expect(new Date(task.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(f.errors.mock.calls)).not.toContain('PRIVATE_CALENDAR_ERROR_qa');
    // A process restart does not erase or circumvent the persisted retry delay.
    const reconstructed = new NetworkCoordinator(f.db, new InternalCalendar(f.db));
    await reconstructed.tick();
    expect((await reconstructed.detail(f.a, failure.id)).state).toBe('queued');
    await f.db.query(
      "UPDATE network_records SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [task.id],
    );
    await reconstructed.tick();
    expect((await reconstructed.detail(f.a, failure.id)).state).toBe('awaiting_approval');
    expect((await reconstructed.detail(f.b, healthy.id)).state).toBe('delivered');
  });

  it('releases the overlap guard after a transient queue-query failure so a subsequent tick progresses', async () => {
    const f = await fixture();
    const healthy = await f.coordinator.submit(f.a, f.input('inform'));
    const query = f.db.query.bind(f.db);
    let failOnce = true;
    vi.spyOn(f.db, 'query').mockImplementation(async (sql, params) => {
      if (failOnce && sql.startsWith('SELECT id,owner_a,owner_b,failure_attempts')) {
        failOnce = false;
        throw new Error('PRIVATE_TRANSIENT_DATABASE_ERROR_qa');
      }
      return query(sql, params);
    });
    await expect(f.coordinator.tick()).rejects.toThrow('PRIVATE_TRANSIENT_DATABASE_ERROR_qa');
    await f.coordinator.tick();
    expect((await f.coordinator.detail(f.a, healthy.id)).state).toBe('delivered');
  });
});
