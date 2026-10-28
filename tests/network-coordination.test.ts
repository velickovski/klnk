import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../apps/server/src/db.js';
import { newUser } from '../apps/server/src/auth.js';
import { NetworkCoordinator } from '../apps/server/src/network/coordination.js';
import { InternalCalendar } from '../apps/server/src/network/calendar.js';
import type { NetworkPolicyInput, NetworkRequestInput } from '../packages/domain/src/network.js';

const databases: Database[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) await db.close();
});
async function fixture() {
  const db = await new Database({ dataDir: 'memory://' }).open();
  databases.push(db);
  const a = (await newUser(db, `${randomUUID()}@example.invalid`, 'Fictional owner password')).id,
    b = (await newUser(db, `${randomUUID()}@example.invalid`, 'Fictional peer password')).id;
  const calendar = new InternalCalendar(db),
    coordinator = new NetworkCoordinator(db, calendar);
  const identity = await coordinator.identity(b),
    connection = await coordinator.invite(a, identity.member.memberCode);
  await coordinator.updateConnection(b, connection.id, {
    action: 'accept',
    expectedVersion: connection.version,
  });
  for (const [owner, peer] of [
    [a, b],
    [b, a],
  ]) {
    const old = await coordinator.policy(owner);
    await coordinator.savePolicy(
      owner,
      {
        ...policyInput(old),
        enabled: true,
        trustedMemberIds: [peer],
        topics: ['routine'],
        allowQuestions: true,
        allowMeetings: true,
        autoAcceptMeetings: true,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        workStartMinute: 0,
        workEndMinute: 1440,
        minNoticeMinutes: 0,
      },
      old.version,
    );
  }
  const request = (kind: NetworkRequestInput['kind'] = 'inform'): NetworkRequestInput => ({
    requestId: randomUUID(),
    connectionId: connection.id,
    kind,
    purpose: 'Fictional update',
    topic: 'routine',
    message: 'Meet near the fictional fountain.',
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
  return { db, a, b, calendar, coordinator, connection, request };
}
function policyInput(
  policy: NetworkPolicyInput & { ownerId?: string; version?: number; updatedAt?: string },
): NetworkPolicyInput {
  const { ownerId, version, updatedAt, ...input } = policy;
  return input;
}
describe('internal durable coordination', () => {
  it('I1 routes exact messages by opaque member identity, independently of sessions, and deduplicates requests', async () => {
    const { db, a, b, coordinator, request } = await fixture(),
      input = request();
    const submitted = await coordinator.submit(a, input);
    expect(submitted.state).toBe('queued');
    expect((await coordinator.submit(a, input)).id).toBe(submitted.id);
    await expect(
      coordinator.submit(a, { ...input, message: 'Changed message' }),
    ).rejects.toMatchObject({ code: 'network_request_conflict' });
    await Promise.all([
      coordinator.tick(),
      new NetworkCoordinator(db, new InternalCalendar(db)).tick(),
    ]);
    const received = await coordinator.detail(b, submitted.id);
    expect(received.state).toBe('delivered');
    expect(received.messages.filter((m) => m.kind === 'inform')).toHaveLength(1);
    expect(received.messages[0].text).toBe(input.message);
    expect((await coordinator.inbox(b)).unread).toBe(1);
    await coordinator.markRead(b, submitted.id);
    expect((await coordinator.inbox(b)).unread).toBe(0);
    await expect(coordinator.invite(a, 'someone@example.invalid')).rejects.toMatchObject({
      code: 'member_not_found',
    });
  });
  it('I1 denies unconnected, blocked, muted and foreign-owner access', async () => {
    const { db, a, b, coordinator, request, connection } = await fixture();
    await expect(
      coordinator.submit(a, { ...request(), connectionId: randomUUID() }),
    ).rejects.toMatchObject({ statusCode: 404 });
    const submitted = await coordinator.submit(a, request());
    const outsider = (await newUser(db, 'outsider@example.invalid', 'Fictional outsider password'))
      .id;
    await expect(coordinator.detail(outsider, submitted.id)).rejects.toMatchObject({
      statusCode: 404,
    });
    const c = (await coordinator.connections(b))[0];
    await coordinator.updateConnection(b, connection.id, {
      action: 'mute',
      expectedVersion: c.version,
    });
    await coordinator.tick();
    expect((await coordinator.detail(a, submitted.id)).state).toBe('paused');
    const muted = (await coordinator.connections(b))[0];
    await coordinator.updateConnection(b, connection.id, {
      action: 'block',
      expectedVersion: muted.version,
    });
    await expect(coordinator.submit(a, request())).rejects.toMatchObject({
      code: 'network_connection_changed',
    });
  });
  it('I2 stops revoked policy snapshots, expiry, cancellation and denied inbound before disclosure', async () => {
    const { a, b, coordinator, request } = await fixture(),
      pending = await coordinator.submit(a, request());
    const old = await coordinator.policy(b);
    await coordinator.savePolicy(b, { ...policyInput(old), allowMessages: false }, old.version);
    await coordinator.tick();
    const stopped = await coordinator.detail(a, pending.id);
    expect(stopped.state).toBe('paused');
    expect(stopped.messages).toEqual([]);
    await expect(coordinator.control(b, pending.id, 'resume')).rejects.toMatchObject({
      code: 'network_policy_changed',
    });
    await expect(
      coordinator.submit(a, { ...request(), expiresAt: new Date(Date.now() - 1000).toISOString() }),
    ).rejects.toMatchObject({ code: 'network_expired' });
    const aPolicy = await coordinator.policy(a);
    await coordinator.savePolicy(
      a,
      { ...policyInput(aPolicy), allowMessages: false },
      aPolicy.version,
    );
    const meeting = await coordinator.submit(a, request('meeting'));
    await coordinator.control(a, meeting.id, 'cancel');
    await coordinator.tick();
    expect((await coordinator.detail(b, meeting.id)).state).toBe('cancelled');
  });
  it('I2 answers only explicitly permitted, scoped, confirmed, unexpired memories without peer policy leakage', async () => {
    const { a, b, coordinator, request } = await fixture(),
      future = new Date(Date.now() + 3600000).toISOString();
    const common = {
      topic: 'routine',
      sharing: 'connections',
      memberIds: [a],
      expiresAt: future,
      confirmed: true,
    };
    const permitted = await coordinator.saveMemory(b, {
      ...common,
      text: 'Fictional team meets at the blue gate.',
    });
    const privateMemory = await coordinator.saveMemory(b, {
      ...common,
      sharing: 'private',
      text: 'PRIVATE SECRET',
    });
    const expired = await coordinator.saveMemory(b, {
      ...common,
      expiresAt: new Date(Date.now() - 1).toISOString(),
      text: 'EXPIRED SECRET',
    });
    const unconfirmed = await coordinator.saveMemory(b, {
      ...common,
      confirmed: false,
      text: 'UNCONFIRMED SECRET',
    });
    const otherMember = await coordinator.saveMemory(b, {
      ...common,
      memberIds: [],
      text: 'OTHER SECRET',
    });
    const p = await coordinator.policy(b);
    await coordinator.savePolicy(
      b,
      {
        ...policyInput(p),
        sharedMemoryIds: [
          permitted.id,
          privateMemory.id,
          expired.id,
          unconfirmed.id,
          otherMember.id,
        ],
      },
      p.version,
    );
    const c = await coordinator.submit(a, request('ask'));
    await coordinator.tick();
    const result = await coordinator.detail(a, c.id),
      serialized = JSON.stringify(result);
    expect(result.state).toBe('answered');
    expect(serialized).toContain(permitted.text);
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('sharedMemoryIds');
    expect(await coordinator.memories(a)).toEqual([]);
    await expect(coordinator.deleteMemory(a, permitted.id)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
  it('I3 commits one canonical event after restart and concurrent ticks, without implicit initiator autonomy', async () => {
    const { db, a, b, coordinator, request, calendar } = await fixture(),
      p = await coordinator.policy(a);
    await coordinator.savePolicy(a, { ...policyInput(p), autoAcceptMeetings: false }, p.version);
    const c = await coordinator.submit(a, request('meeting'));
    await Promise.all([coordinator.tick(), new NetworkCoordinator(db, calendar).tick()]);
    const result = await coordinator.detail(b, c.id),
      tasks = await db.query("SELECT payload FROM network_records WHERE kind='task'");
    expect(result.state, JSON.stringify(tasks.map((t) => db.decrypt(t.payload)))).toBe('agreed');
    expect(result.acceptances.find((a) => a.ownerId === result.initiatorId)?.source).toBe(
      'owner_request',
    );
    expect((await calendar.list(a)).events).toHaveLength(1);
    expect((await calendar.list(b)).events[0].id).toBe(result.eventId);
    await coordinator.tick();
    expect((await calendar.list(a)).events).toHaveLength(1);
  });
  it('I3 requires recipient personal approval of matching canonical terms and rejects changed/late approvals', async () => {
    const { a, b, coordinator, request, calendar } = await fixture(),
      p = await coordinator.policy(b);
    await coordinator.savePolicy(b, { ...policyInput(p), autoAcceptMeetings: false }, p.version);
    const c = await coordinator.submit(a, request('meeting'));
    await coordinator.tick();
    const pending = await coordinator.detail(b, c.id);
    expect(pending.state).toBe('awaiting_approval');
    expect((await calendar.list(a)).events).toHaveLength(0);
    await expect(
      coordinator.decision(a, c.id, {
        decision: 'approve',
        proposalHash: pending.proposal!.hash,
        proposalVersion: pending.proposal!.version,
      }),
    ).rejects.toMatchObject({ code: 'network_stale_decision' });
    await expect(
      coordinator.decision(b, c.id, {
        decision: 'approve',
        proposalHash: 'f'.repeat(64),
        proposalVersion: pending.proposal!.version,
      }),
    ).rejects.toMatchObject({ code: 'network_stale_decision' });
    await coordinator.decision(b, c.id, {
      decision: 'approve',
      proposalHash: pending.proposal!.hash,
      proposalVersion: pending.proposal!.version,
    });
    await coordinator.tick();
    const agreed = await coordinator.detail(a, c.id);
    expect(agreed.state).toBe('agreed');
    expect(agreed.acceptances.find((a) => a.ownerId === b)?.source).toBe('owner_approval');
    await expect(
      coordinator.decision(b, c.id, {
        decision: 'approve',
        proposalHash: pending.proposal!.hash,
        proposalVersion: pending.proposal!.version,
      }),
    ).rejects.toMatchObject({ code: 'network_stale_decision' });
  });
  it('I3 asks the recipient for an exact exception to routine bounds and records personal consent', async () => {
    const { a, b, coordinator, request, calendar } = await fixture(),
      p = await coordinator.policy(b);
    await coordinator.savePolicy(
      b,
      {
        ...policyInput(p),
        maxDurationMinutes: 5,
        minNoticeMinutes: 43200,
        workStartMinute: 540,
        workEndMinute: 541,
      },
      p.version,
    );
    const c = await coordinator.submit(a, request('meeting'));
    await coordinator.tick();
    const pending = await coordinator.detail(b, c.id);
    expect(pending.state).toBe('awaiting_approval');
    expect(pending.decisionOwnerIds).toEqual([b]);
    expect((await calendar.list(a)).events).toHaveLength(0);
    await coordinator.decision(b, c.id, {
      decision: 'approve',
      proposalHash: pending.proposal!.hash,
      proposalVersion: pending.proposal!.version,
    });
    await coordinator.tick();
    expect((await coordinator.detail(a, c.id)).state).toBe('agreed');
    expect((await calendar.list(a)).events).toHaveLength(1);
  });
  it('I3 prefers a submitted slot covered by recipient autonomy before requesting an exception', async () => {
    const { a, b, coordinator, request } = await fixture(),
      p = await coordinator.policy(b);
    await coordinator.savePolicy(b, { ...policyInput(p), minNoticeMinutes: 120 }, p.version);
    const input = request('meeting'),
      second = input.candidateSlots[0];
    input.candidateSlots = [
      {
        ...second,
        startAt: new Date(Date.now() + 3600000).toISOString(),
        endAt: new Date(Date.now() + 5400000).toISOString(),
      },
      second,
    ];
    const c = await coordinator.submit(a, input);
    await coordinator.tick();
    const result = await coordinator.detail(a, c.id);
    expect(result.state).toBe('agreed');
    expect(result.proposal!.terms.slot).toEqual(second);
    expect(result.turns).toBe(2);
  });
  it('I2 expires a pending recipient decision durably without requiring the owner to return', async () => {
    const { a, b, coordinator, request, calendar } = await fixture(),
      p = await coordinator.policy(b);
    await coordinator.savePolicy(b, { ...policyInput(p), autoAcceptMeetings: false }, p.version);
    const input = request('meeting'),
      c = await coordinator.submit(a, input);
    await coordinator.tick();
    expect((await coordinator.detail(b, c.id)).state).toBe('awaiting_approval');
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(input.expiresAt) + 1);
    await coordinator.tick();
    const expired = await coordinator.detail(a, c.id);
    expect(expired.state).toBe('expired');
    expect(expired.decisionOwnerIds).toEqual([]);
    expect((await calendar.list(a)).events).toEqual([]);
  });
  it('I3 closes bounded no-progress attempts and cancels an agreed event through the request control', async () => {
    const { a, b, coordinator, request, calendar } = await fixture(),
      first = request('meeting'),
      c = await coordinator.submit(a, first);
    await coordinator.tick();
    const next = {
        ...first,
        requestId: randomUUID(),
        candidateSlots: [first.candidateSlots[0], first.candidateSlots[0], first.candidateSlots[0]],
      },
      second = await coordinator.submit(a, next);
    await coordinator.tick();
    const unresolved = await coordinator.detail(b, second.id);
    expect(unresolved.state).toBe('unresolved');
    expect(unresolved.turns).toBe(3);
    expect(unresolved.proposal).toBeUndefined();
    expect((await calendar.list(a)).events).toHaveLength(1);
    const cancelled = await coordinator.control(a, c.id, 'cancel');
    expect(cancelled.state).toBe('cancelled');
    expect((await calendar.list(b)).events[0].status).toBe('cancelled');
    expect((await calendar.list(b)).reminders.every((r) => r.status === 'cancelled')).toBe(true);
  });
});
