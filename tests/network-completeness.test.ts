import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '../apps/server/src/db.js';
import { NetworkCoordinator } from '../apps/server/src/network/coordination.js';
import { InternalCalendar } from '../apps/server/src/network/calendar.js';
import { networkNotifications } from '../apps/server/src/network/preferences.js';
import { policyAuthorityVersion } from '../apps/server/src/network/policy.js';
import type {
  NetworkPolicyInput,
  NetworkRequestInput,
  NetworkConnection,
} from '../packages/domain/src/network.js';
import { openTestDatabase } from './support/test-database.js';

const databases: Database[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close();
});
const future = (days = 7) => new Date(Date.now() + days * 86400000).toISOString();
const slot = (day = 1) => ({
  startAt: new Date(Date.now() + day * 86400000).toISOString(),
  endAt: new Date(Date.now() + day * 86400000 + 1800000).toISOString(),
  timezone: 'UTC',
});
async function fixture() {
  const db = await openTestDatabase();
  databases.push(db);
  const a = randomUUID(),
    b = randomUUID(),
    outsider = randomUUID();
  for (const id of [a, b, outsider])
    await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
      id,
      `${id}@example.invalid`,
      'fictional-unused-hash',
    ]);
  const calendar = new InternalCalendar(db),
    coordinator = new NetworkCoordinator(db, calendar);
  const identity = await coordinator.identity(b),
    invitation = await coordinator.invite(a, identity.member.memberCode);
  await coordinator.updateConnection(b, invitation.id, {
    action: 'accept',
    version: invitation.version,
  });
  const request = (kind: NetworkRequestInput['kind'] = 'inform', day = 1): NetworkRequestInput => ({
    requestId: randomUUID(),
    connectionId: invitation.id,
    kind,
    purpose: 'Fictional planning',
    topic: kind === 'inform' ? 'message' : 'routine',
    message: 'An exact fictional instruction.',
    candidateSlots: kind === 'meeting' ? [slot(day)] : [],
    location: 'Fictional fountain',
    expiresAt: future(2),
  });
  const save = async (owner: string, patch: Partial<NetworkPolicyInput>) => {
    const { ownerId, version, updatedAt, authorityVersions, ...input } =
      await coordinator.policy(owner);
    return coordinator.savePolicy(owner, { ...input, ...patch }, version);
  };
  const meetings = async (automatic = false) => {
    for (const [owner, peer] of [
      [a, b],
      [b, a],
    ])
      await save(owner, {
        enabled: true,
        trustedMemberIds: [peer],
        topics: ['routine'],
        allowMeetings: true,
        autoAcceptMeetings: automatic,
        minNoticeMinutes: 0,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        workStartMinute: 0,
        workEndMinute: 1440,
      });
  };
  return { db, a, b, outsider, calendar, coordinator, invitation, request, save, meetings };
}

describe('M2 usable internal network with bounded authority', () => {
  it('delivers exact information by default without topics, mutual trust or enabled delegation', async () => {
    const f = await fixture();
    expect((await f.coordinator.policy(f.b)).enabled).toBe(false);
    const input = f.request();
    const c = await f.coordinator.submit(f.a, input);
    await f.coordinator.tick();
    const received = await f.coordinator.detail(f.b, c.id);
    expect(received.state).toBe('delivered');
    expect(received.messages.map((m) => m.text)).toEqual([input.message]);
    expect((await f.calendar.list(f.a)).events).toEqual([]);
    expect((await f.coordinator.policy(f.b)).trustedMemberIds).toEqual([]);
    await expect(
      f.coordinator.submit(f.a, {
        ...f.request(),
        expiresAt: new Date(Date.now() - 1).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'network_expired' });
  });

  it('still honours message opt-out, inbound denial, blocking and current account state', async () => {
    const f = await fixture(),
      pending = await f.coordinator.submit(f.a, f.request());
    await f.save(f.b, { allowMessages: false });
    await f.coordinator.tick();
    expect((await f.coordinator.detail(f.b, pending.id)).state).toBe('paused');
    expect((await f.coordinator.detail(f.b, pending.id)).messages).toEqual([]);
    await expect(f.coordinator.submit(f.a, f.request())).rejects.toMatchObject({
      code: 'network_scope_denied',
    });
    await f.save(f.b, { allowMessages: true });
    let c: NetworkConnection = (await f.coordinator.connections(f.b))[0];
    await f.coordinator.updateConnection(f.b, c.id, { action: 'deny_inbound', version: c.version });
    await expect(f.coordinator.submit(f.a, f.request())).rejects.toMatchObject({
      code: 'network_connection_changed',
    });
    c = (await f.coordinator.connections(f.b))[0];
    await f.coordinator.updateConnection(f.b, c.id, { action: 'block', version: c.version });
    await expect(f.coordinator.submit(f.a, f.request())).rejects.toMatchObject({
      code: 'network_connection_changed',
    });
  });

  it('queues a human question without memory disclosure and lets only the recipient answer its current version', async () => {
    const f = await fixture();
    await f.coordinator.saveMemory(f.b, {
      text: 'PRIVATE_SENTINEL_DO_NOT_SHARE',
      topic: 'routine',
      sharing: 'private',
      memberIds: [],
      confirmed: true,
      expiresAt: future(),
    });
    const c = await f.coordinator.submit(f.a, f.request('ask'));
    await f.coordinator.tick();
    const pending = await f.coordinator.detail(f.b, c.id);
    expect(pending.state).toBe('awaiting_approval');
    expect(pending.proposal).toBeUndefined();
    expect(JSON.stringify(pending)).not.toContain('PRIVATE_SENTINEL');
    await expect(
      f.coordinator.answer(f.a, c.id, { version: pending.version, answer: 'Forged answer' }),
    ).rejects.toMatchObject({ code: 'network_stale_answer' });
    await expect(
      f.coordinator.answer(f.outsider, c.id, { version: pending.version, answer: 'Forged answer' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      f.coordinator.answer(f.b, c.id, { version: pending.version - 1, answer: 'Stale answer' }),
    ).rejects.toMatchObject({ code: 'network_stale_answer' });
    const result = await f.coordinator.answer(f.b, c.id, {
      version: pending.version,
      answer: 'Meet at the east entrance.',
    });
    expect(result.state).toBe('answered');
    expect(result.messages.at(-1)).toMatchObject({
      role: 'owner',
      actorId: f.b,
      text: 'Meet at the east entrance.',
    });
    expect((await f.coordinator.detail(f.a, c.id)).messages.at(-1)?.text).toBe(
      'Meet at the east entrance.',
    );
    expect((await f.calendar.list(f.a)).events).toEqual([]);
    await expect(
      f.coordinator.answer(f.b, c.id, { version: pending.version, answer: 'Duplicate answer' }),
    ).rejects.toMatchObject({ code: 'network_stale_answer' });
  });

  it('requires the original recipient disclosure epoch for automatic answers, while human answers remain possible', async () => {
    const f = await fixture(),
      pending = await f.coordinator.submit(f.a, f.request('ask'));
    const memory = await f.coordinator.saveMemory(f.b, {
      text: 'Explicitly permitted fictional answer.',
      topic: 'routine',
      sharing: 'connections',
      memberIds: [f.a],
      confirmed: true,
      expiresAt: future(),
    });
    await f.save(f.b, {
      enabled: true,
      trustedMemberIds: [f.a],
      topics: ['routine'],
      allowQuestions: true,
      sharedMemoryIds: [memory.id],
    });
    await f.coordinator.tick();
    expect((await f.coordinator.detail(f.a, pending.id)).state).toBe('awaiting_approval');
    const fresh = await f.coordinator.submit(f.a, f.request('ask'));
    await f.save(f.b, { reminderMinutes: [5], allowMeetings: true });
    await f.coordinator.tick();
    expect((await f.coordinator.detail(f.a, fresh.id)).state).toBe('answered');
    expect((await f.coordinator.detail(f.a, fresh.id)).messages.at(-1)?.text).toBe(memory.text);
    expect((await f.coordinator.policy(f.a)).enabled).toBe(false);
  });

  it('mute affects only notifications, including notices already pending, without revoking a queued delivery', async () => {
    const f = await fixture(),
      first = await f.coordinator.submit(f.a, f.request());
    await f.coordinator.tick();
    expect((await networkNotifications(f.db, f.b)).items).toHaveLength(1);
    const second = await f.coordinator.submit(f.a, f.request());
    const before = (await f.coordinator.connections(f.b))[0];
    const muted = await f.coordinator.updateConnection(f.b, before.id, {
      action: 'mute',
      version: before.version,
    });
    expect(muted.version).toBe(before.version + 1);
    expect(muted.authorityVersion).toBe(before.authorityVersion);
    await f.coordinator.tick();
    expect((await f.coordinator.detail(f.b, second.id)).state).toBe('delivered');
    expect((await networkNotifications(f.db, f.b)).items).toEqual([]);
    expect((await networkNotifications(f.db, f.a)).items.length).toBeGreaterThan(0);
    expect((await f.coordinator.detail(f.b, first.id)).state).toBe('delivered');
  });

  it('reinvites a declined or removed pair in either direction while preserving storage identity', async () => {
    const f = await fixture();
    const current = (await f.coordinator.connections(f.a))[0];
    await f.coordinator.updateConnection(f.a, current.id, {
      action: 'remove',
      version: current.version,
    });
    const alice = await f.coordinator.identity(f.a);
    let invite = await f.coordinator.invite(f.b, alice.member.memberCode);
    expect(invite.fromId).toBe(f.b);
    expect(invite.toId).toBe(f.a);
    expect(invite.id).toBe(current.id);
    await expect(
      f.coordinator.updateConnection(f.b, invite.id, { action: 'accept', version: invite.version }),
    ).rejects.toMatchObject({ code: 'network_connection_state' });
    await f.coordinator.updateConnection(f.a, invite.id, {
      action: 'decline',
      version: invite.version,
    });
    invite = await f.coordinator.invite(f.b, alice.member.memberCode);
    expect(invite.status).toBe('pending');
    await expect(
      f.coordinator.updateConnection(f.a, invite.id, {
        action: 'accept',
        version: invite.version - 1,
      }),
    ).rejects.toMatchObject({ code: 'network_version_conflict' });
    await f.coordinator.updateConnection(f.a, invite.id, {
      action: 'accept',
      version: invite.version,
    });
    expect(
      (await f.db.query("SELECT owner_a,owner_b FROM network_records WHERE kind='connection'"))[0],
    ).toEqual({ owner_a: f.a, owner_b: f.b });
    expect((await f.coordinator.connections(f.a))[0].status).toBe('accepted');
  });

  it('unblocking one owner never clears the other owner’s block or restores accepted consent', async () => {
    const f = await fixture();
    let c: NetworkConnection = (await f.coordinator.connections(f.b))[0];
    c = await f.coordinator.updateConnection(f.b, c.id, { action: 'block', version: c.version });
    await expect(
      f.coordinator.updateConnection(f.a, c.id, { action: 'unblock', version: c.version }),
    ).rejects.toMatchObject({ code: 'network_connection_state' });
    c = await f.coordinator.updateConnection(f.a, c.id, { action: 'block', version: c.version });
    c = await f.coordinator.updateConnection(f.b, c.id, { action: 'unblock', version: c.version });
    expect(c.status).toBe('blocked');
    expect(c.blockedBy).toEqual([f.a]);
    await expect(f.coordinator.submit(f.a, f.request())).rejects.toMatchObject({
      code: 'network_connection_changed',
    });
    c = await f.coordinator.updateConnection(f.a, c.id, { action: 'unblock', version: c.version });
    expect(c.status).toBe('removed');
    expect(Object.values(c.inbound)).toEqual([false, false]);
  });

  it('preserves a newly epoch-bound prepared instruction across mute while retaining strict legacy receipt fencing', async () => {
    const f = await fixture(),
      before = (await f.coordinator.connections(f.a))[0],
      policy = await f.coordinator.policy(f.a);
    await f.coordinator.updateConnection(f.b, before.id, {
      action: 'mute',
      version: before.version,
    });
    await expect(
      f.coordinator.submit(f.a, f.request(), {
        policyVersion: policy.version,
        connectionVersion: before.version,
      }),
    ).rejects.toMatchObject({ code: 'network_authority_changed' });
    const submitted = await f.coordinator.submit(f.a, f.request(), {
      policyVersion: policy.version,
      connectionVersion: before.version,
      connectionAuthorityVersion: before.authorityVersion,
    });
    await f.coordinator.tick();
    expect((await f.coordinator.detail(f.b, submitted.id)).state).toBe('delivered');
  });

  it('preserves meeting authority across question/reminder edits without rewriting existing owner receipts', async () => {
    const f = await fixture();
    await f.meetings();
    const submitted = await f.coordinator.submit(f.a, f.request('meeting'));
    await f.coordinator.tick();
    const before = await f.coordinator.policy(f.b);
    const after = await f.save(f.b, { reminderMinutes: [5], allowQuestions: true });
    expect(after.version).toBe(before.version + 1);
    expect(policyAuthorityVersion(after, 'meeting')).toBe(
      policyAuthorityVersion(before, 'meeting'),
    );
    const pending = await f.coordinator.detail(f.b, submitted.id);
    await f.coordinator.decision(f.b, submitted.id, {
      proposalHash: pending.proposal!.hash,
      proposalVersion: pending.proposal!.version,
      decision: 'approve',
    });
    const receiptBefore = await f.db.query(
      "SELECT payload FROM network_records WHERE kind='receipt' AND status='approved'",
    );
    await f.save(f.b, { reminderMinutes: [10] });
    await f.coordinator.tick();
    expect((await f.coordinator.detail(f.a, submitted.id)).state).toBe('agreed');
    expect(
      await f.db.query(
        "SELECT payload FROM network_records WHERE kind='receipt' AND status='approved'",
      ),
    ).toEqual(receiptBefore);
    expect((await f.calendar.list(f.a)).events).toHaveLength(1);
  });

  it('fences revoked-and-regranted meeting scope while hiding the peer’s private authority epoch', async () => {
    const f = await fixture();
    await f.meetings();
    const c = await f.coordinator.submit(f.a, f.request('meeting'));
    expect(Object.keys(c.authorityVersions!)).toEqual([f.a]);
    await f.save(f.b, { allowMeetings: false });
    await f.save(f.b, { allowMeetings: true });
    await f.coordinator.tick();
    expect((await f.coordinator.detail(f.a, c.id)).state).toBe('paused');
    await expect(f.coordinator.control(f.b, c.id, 'resume')).rejects.toMatchObject({
      code: 'network_policy_changed',
    });
    expect((await f.calendar.list(f.a)).events).toEqual([]);
  });

  it('never autoaccepts without an explicitly maintained availability source covering the complete slot', async () => {
    const f = await fixture();
    await f.meetings(true);
    const original = await f.coordinator.submit(f.a, f.request('meeting'));
    await f.coordinator.tick();
    expect((await f.coordinator.detail(f.b, original.id)).state).toBe('awaiting_approval');
    expect((await f.calendar.list(f.b)).availability).toBeNull();
    await f.calendar.confirmAvailability(f.b, { confirmedThrough: future(3) });
    await f.coordinator.tick();
    expect((await f.coordinator.detail(f.b, original.id)).state).toBe('awaiting_approval');
    const fresh = await f.coordinator.submit(f.a, f.request('meeting', 2));
    await f.coordinator.tick();
    expect((await f.coordinator.detail(f.a, fresh.id)).state).toBe('agreed');
    const event = (await f.calendar.list(f.a)).events[0];
    expect(event.acceptances.find((a) => a.ownerId === f.b)?.authorityVersion).toBeUndefined();
    await expect(
      f.calendar.confirmAvailability(f.b, { confirmedThrough: future(31) }),
    ).rejects.toMatchObject({ code: 'network_availability_range' });
  });

  it('blocks conflicts with private busy intervals and requires an owner/version match for deletion', async () => {
    const f = await fixture();
    await f.meetings(true);
    await f.calendar.confirmAvailability(f.b, { confirmedThrough: future() });
    const input = f.request('meeting'),
      busy = await f.calendar.saveBusy(f.b, {
        slot: input.candidateSlots[0],
        label: 'PRIVATE_BUSY_LABEL',
      });
    expect((await f.calendar.list(f.b)).busyBlocks[0].label).toBe('PRIVATE_BUSY_LABEL');
    expect((await f.calendar.list(f.a)).busyBlocks).toEqual([]);
    await expect(f.calendar.deleteBusy(f.a, busy.id, busy.version)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(f.calendar.deleteBusy(f.b, busy.id, busy.version + 1)).rejects.toMatchObject({
      code: 'network_busy_changed',
    });
    const first = await f.coordinator.submit(f.a, input);
    await f.coordinator.tick();
    expect((await f.coordinator.detail(f.a, first.id)).state).toBe('unresolved');
    expect(JSON.stringify(await f.coordinator.detail(f.a, first.id))).not.toContain(
      'PRIVATE_BUSY_LABEL',
    );
    await f.calendar.deleteBusy(f.b, busy.id, busy.version);
    const second = await f.coordinator.submit(f.a, { ...input, requestId: randomUUID() });
    await f.coordinator.tick();
    expect((await f.coordinator.detail(f.a, second.id)).state).toBe('agreed');
  });

  it('requires availability confirmation through the end of a proposed time and rejects stale or invalid busy edits', async () => {
    const f = await fixture();
    await f.meetings(true);
    await f.calendar.confirmAvailability(f.b, {
      confirmedThrough: new Date(Date.now() + 12 * 3600000).toISOString(),
    });
    const c = await f.coordinator.submit(f.a, f.request('meeting'));
    await f.coordinator.tick();
    expect((await f.coordinator.detail(f.a, c.id)).state).toBe('awaiting_approval');
    const block = await f.calendar.saveBusy(f.b, { slot: slot(3), label: 'Private' });
    await expect(
      f.calendar.saveBusy(f.a, { slot: slot(4), label: 'Changed' }, block.id, block.version),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      f.calendar.saveBusy(f.b, { slot: slot(4), label: 'Changed' }, block.id, block.version + 1),
    ).rejects.toMatchObject({ code: 'network_busy_changed' });
    await expect(
      f.calendar.confirmAvailability(f.b, {
        confirmedThrough: new Date(Date.now() - 1).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'network_availability_range' });
  });

  it('counterproposes a new exact time, clears previous acceptances and requires two new matching personal receipts', async () => {
    const f = await fixture();
    await f.meetings();
    const original = await f.coordinator.submit(f.a, f.request('meeting'));
    await f.coordinator.tick();
    const old = await f.coordinator.detail(f.b, original.id);
    await expect(
      f.coordinator.counterpropose(f.a, original.id, { version: old.version, slot: slot(2) }),
    ).rejects.toMatchObject({ code: 'network_stale_decision' });
    const counter = await f.coordinator.counterpropose(f.b, original.id, {
      version: old.version,
      slot: slot(2),
    });
    expect(counter.proposal?.version).toBe(old.proposal!.version + 1);
    expect(counter.proposal?.hash).not.toBe(old.proposal!.hash);
    expect(counter.acceptances.map((a) => a.ownerId)).toEqual([f.b]);
    expect(counter.decisionOwnerIds).toEqual([f.a]);
    expect(
      (await networkNotifications(f.db, f.a)).items.some(
        (n) => n.conversationId === original.id && n.kind === 'decision',
      ),
    ).toBe(true);
    await expect(
      f.coordinator.decision(f.a, original.id, {
        proposalHash: old.proposal!.hash,
        proposalVersion: old.proposal!.version,
        decision: 'approve',
      }),
    ).rejects.toMatchObject({ code: 'network_stale_decision' });
    await f.coordinator.decision(f.a, original.id, {
      proposalHash: counter.proposal!.hash,
      proposalVersion: counter.proposal!.version,
      decision: 'approve',
    });
    await f.coordinator.tick();
    const agreed = await f.coordinator.detail(f.a, original.id);
    expect(agreed.state).toBe('agreed');
    expect(agreed.acceptances.every((acceptance) => acceptance.source === 'owner_approval')).toBe(
      true,
    );
    expect((await f.calendar.list(f.a)).events[0].terms.slot).toEqual(counter.proposal!.terms.slot);
    expect((await f.calendar.list(f.b)).events[0].id).toBe(agreed.eventId);
  });
});
