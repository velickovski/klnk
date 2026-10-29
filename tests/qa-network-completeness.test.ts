import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database } from '../apps/server/src/db.js';
import { InternalCalendar } from '../apps/server/src/network/calendar.js';
import { NetworkCoordinator } from '../apps/server/src/network/coordination.js';
import {
  deleteNetworkAccount,
  exportNetworkAccount,
  lockNetworkDeletion,
} from '../apps/server/src/network/data-lifecycle.js';
import type { NetworkPolicyInput, NetworkRequestInput } from '../packages/domain/src/network.js';
import { openTestDatabase } from './support/test-database.js';
import { createApp } from '../apps/server/src/app.js';
import { getConfig } from '../apps/server/src/config.js';
import { createSession } from '../apps/server/src/auth.js';

const databases: Database[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close();
});

const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
function interval(days = 1) {
  const start = Date.now() + days * 86400000;
  return {
    startAt: new Date(start).toISOString(),
    endAt: new Date(start + 1800000).toISOString(),
    timezone: 'UTC',
  };
}
async function fixture() {
  const db = await openTestDatabase();
  databases.push(db);
  const a = randomUUID(),
    b = randomUUID(),
    outsider = randomUUID();
  for (const owner of [a, b, outsider])
    await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
      owner,
      `${owner}@example.invalid`,
      'unused-fictional-password-hash',
    ]);
  const calendar = new InternalCalendar(db),
    coordinator = new NetworkCoordinator(db, calendar);
  const identity = await coordinator.identity(b);
  const invitation = await coordinator.invite(a, identity.member.memberCode);
  await coordinator.updateConnection(b, invitation.id, {
    action: 'accept',
    version: invitation.version,
  });
  const save = async (owner: string, patch: Partial<NetworkPolicyInput>) => {
    const { ownerId, version, updatedAt, authorityVersions, ...input } =
      await coordinator.policy(owner);
    return coordinator.savePolicy(owner, { ...input, ...patch }, version);
  };
  const request = (kind: NetworkRequestInput['kind'] = 'meeting'): NetworkRequestInput => ({
    requestId: randomUUID(),
    connectionId: invitation.id,
    kind,
    purpose: 'Independent fictional QA meeting',
    topic: 'routine',
    message: 'Exact fictional QA instruction.',
    candidateSlots: kind === 'meeting' ? [interval()] : [],
    location: 'Fictional QA fountain',
    expiresAt: future(5),
  });
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
  return { db, a, b, outsider, coordinator, calendar, save, request, meetings };
}

describe('independent M2 network authority and private calendar QA', () => {
  it('does not reuse an automatic disclosure grant after revocation and regrant', async () => {
    const f = await fixture();
    const memory = await f.coordinator.saveMemory(f.b, {
      text: 'PERMITTED_ONLY_UNDER_CURRENT_GRANT',
      topic: 'routine',
      sharing: 'connections',
      memberIds: [f.a],
      confirmed: true,
      expiresAt: future(7),
    });
    await f.save(f.b, {
      enabled: true,
      trustedMemberIds: [f.a],
      topics: ['routine'],
      allowQuestions: true,
      sharedMemoryIds: [memory.id],
    });
    const old = await f.coordinator.submit(f.a, f.request('ask'));
    await f.save(f.b, { allowQuestions: false });
    await f.save(f.b, { allowQuestions: true });
    await f.coordinator.tick();
    const waiting = await f.coordinator.detail(f.b, old.id);
    expect(waiting.state).toBe('awaiting_approval');
    expect(JSON.stringify(waiting)).not.toContain(memory.text);
    const fresh = await f.coordinator.submit(f.a, f.request('ask'));
    await f.coordinator.tick();
    expect((await f.coordinator.detail(f.a, fresh.id)).messages.at(-1)?.text).toBe(memory.text);
    const answered = await f.coordinator.answer(f.b, old.id, {
      version: waiting.version,
      answer: 'Personally approved alternate reply.',
    });
    expect(answered.state).toBe('answered');
    expect(answered.messages.at(-1)?.role).toBe('owner');
  });

  it('invalidates existing personal meeting receipts across material revoke/regrant', async () => {
    const f = await fixture();
    await f.meetings();
    const c = await f.coordinator.submit(f.a, f.request());
    await f.coordinator.tick();
    const pending = await f.coordinator.detail(f.b, c.id);
    await f.coordinator.decision(f.b, c.id, {
      proposalHash: pending.proposal!.hash,
      proposalVersion: pending.proposal!.version,
      decision: 'approve',
    });
    await f.save(f.b, { allowMeetings: false });
    await f.save(f.b, { allowMeetings: true });
    await f.coordinator.tick();
    expect((await f.coordinator.detail(f.a, c.id)).state).toBe('paused');
    expect((await f.calendar.list(f.a)).events).toEqual([]);
    await expect(f.coordinator.control(f.b, c.id, 'resume')).rejects.toMatchObject({
      code: 'network_policy_changed',
    });
  });

  it('does not let an old proposal version approve a counterproposal cycling to the same hash', async () => {
    const f = await fixture();
    await f.meetings();
    const request = f.request(),
      c = await f.coordinator.submit(f.a, request);
    await f.coordinator.tick();
    const original = await f.coordinator.detail(f.b, c.id);
    const second = await f.coordinator.counterpropose(f.b, c.id, {
      version: original.version,
      slot: interval(2),
    });
    const third = await f.coordinator.counterpropose(f.a, c.id, {
      version: second.version,
      slot: request.candidateSlots[0],
    });
    expect(third.proposal!.hash).toBe(original.proposal!.hash);
    expect(third.proposal!.version).toBeGreaterThan(original.proposal!.version);
    expect(third.acceptances).toHaveLength(1);
    expect(third.acceptances[0].ownerId).toBe(f.a);
    await expect(
      f.coordinator.decision(f.b, c.id, {
        proposalHash: original.proposal!.hash,
        proposalVersion: original.proposal!.version,
        decision: 'approve',
      }),
    ).rejects.toMatchObject({ code: 'network_stale_decision' });
    await expect(
      f.coordinator.counterpropose(f.outsider, c.id, { version: third.version, slot: interval(3) }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect((await f.calendar.list(f.a)).events).toEqual([]);
    await f.coordinator.decision(f.b, c.id, {
      proposalHash: third.proposal!.hash,
      proposalVersion: third.proposal!.version,
      decision: 'approve',
    });
    await f.coordinator.tick();
    const event = (await f.calendar.list(f.a)).events[0];
    expect(event.proposalVersion).toBe(third.proposal!.version);
    expect(
      event.acceptances.every(
        (acceptance) => acceptance.proposalVersion === third.proposal!.version,
      ),
    ).toBe(true);
    expect((await f.calendar.list(f.b)).events[0].id).toBe(event.id);
  });

  it('rechecks a newly occupied private calendar after approval and never invents an event', async () => {
    const f = await fixture();
    await f.meetings();
    const request = f.request(),
      c = await f.coordinator.submit(f.a, request);
    await f.coordinator.tick();
    const pending = await f.coordinator.detail(f.b, c.id);
    await f.coordinator.decision(f.b, c.id, {
      proposalHash: pending.proposal!.hash,
      proposalVersion: pending.proposal!.version,
      decision: 'approve',
    });
    await f.calendar.saveBusy(f.b, {
      slot: request.candidateSlots[0],
      label: 'PRIVATE_NEW_CONFLICT',
    });
    await f.coordinator.tick();
    const result = await f.coordinator.detail(f.a, c.id);
    expect(result.state).toBe('unresolved');
    expect(result.eventId).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('PRIVATE_NEW_CONFLICT');
    expect((await f.calendar.list(f.a)).events).toEqual([]);
    expect((await f.calendar.list(f.b)).events).toEqual([]);
  });

  it('treats adjacent busy intervals as free and shortened maintenance coverage as insufficient', async () => {
    const f = await fixture();
    await f.meetings(true);
    const request = f.request(),
      desired = request.candidateSlots[0];
    await f.calendar.confirmAvailability(f.b, { confirmedThrough: future(7) });
    const busy = await f.calendar.saveBusy(f.b, {
      label: 'PRIVATE_ADJACENT',
      slot: {
        ...desired,
        startAt: new Date(Date.parse(desired.startAt) - 1800000).toISOString(),
        endAt: desired.startAt,
      },
    });
    const c = await f.coordinator.submit(f.a, request);
    await f.calendar.confirmAvailability(f.b, {
      confirmedThrough: new Date(Date.parse(desired.endAt) - 1).toISOString(),
    });
    await f.coordinator.tick();
    const pending = await f.coordinator.detail(f.b, c.id);
    expect(pending.state).toBe('awaiting_approval');
    expect(pending.proposal?.terms.slot).toEqual(desired);
    await expect(
      f.calendar.saveBusy(f.a, { slot: interval(3), label: 'forged' }, busy.id, busy.version),
    ).rejects.toMatchObject({ statusCode: 404 });
    await f.coordinator.decision(f.b, c.id, {
      proposalHash: pending.proposal!.hash,
      proposalVersion: pending.proposal!.version,
      decision: 'approve',
    });
    await f.coordinator.tick();
    expect((await f.calendar.list(f.a)).events).toHaveLength(1);
  });

  it('exports only own private calendar/policy/memory and removes shared text on account deletion', async () => {
    const f = await fixture();
    await f.meetings(true);
    await f.calendar.confirmAvailability(f.b, { confirmedThrough: future(7) });
    const busy = await f.calendar.saveBusy(f.b, {
      slot: interval(3),
      label: 'PRIVATE_PEER_BUSY_SENTINEL',
    });
    await f.coordinator.saveMemory(f.b, {
      text: 'PRIVATE_PEER_MEMORY_SENTINEL',
      topic: 'routine',
      sharing: 'private',
      memberIds: [],
      confirmed: true,
      expiresAt: future(7),
    });
    const c = await f.coordinator.submit(f.a, {
      ...f.request(),
      purpose: 'SHARED_DELETE_SENTINEL',
    });
    await f.coordinator.tick();
    const own = await exportNetworkAccount(f.db, f.a);
    const serialized = JSON.stringify(own);
    expect(serialized).not.toContain('PRIVATE_PEER_BUSY_SENTINEL');
    expect(serialized).not.toContain('PRIVATE_PEER_MEMORY_SENTINEL');
    expect(own.busy).toEqual([]);
    expect(own.availability).toEqual([]);
    expect(own.policy).toHaveLength(1);
    const conversation = (
      own.conversation as {
        id: string;
        authorityVersions?: Record<string, number>;
        acceptances: { ownerId: string; authorityVersion?: number }[];
      }[]
    ).find((entry) => entry.id === c.id)!;
    expect(Object.keys(conversation.authorityVersions!)).toEqual([f.a]);
    expect(
      conversation.acceptances.find((entry) => entry.ownerId === f.b)?.authorityVersion,
    ).toBeUndefined();
    const peer = await exportNetworkAccount(f.db, f.b);
    expect(JSON.stringify(peer)).toContain('PRIVATE_PEER_BUSY_SENTINEL');
    expect(JSON.stringify(peer)).toContain('PRIVATE_PEER_MEMORY_SENTINEL');
    await f.db.transaction(async (sql) => {
      await lockNetworkDeletion(sql, f.a);
      await deleteNetworkAccount(f.db, sql, f.a);
    });
    const remaining = await exportNetworkAccount(f.db, f.b);
    expect(JSON.stringify(remaining)).not.toContain('SHARED_DELETE_SENTINEL');
    expect(JSON.stringify(remaining)).toContain('PRIVATE_PEER_BUSY_SENTINEL');
    expect((await f.calendar.list(f.b)).busyBlocks[0].id).toBe(busy.id);
  });

  it('binds busy and availability HTTP writes to the bearer and conceals another owner’s block', async () => {
    const f = await fixture();
    const service = await createApp({
      db: f.db,
      worker: false,
      config: {
        ...getConfig(),
        production: false,
        demoEnabled: false,
        embeddedWorker: false,
        provider: 'simulator',
        liveEnabled: false,
        openaiKey: undefined,
        elevenKey: undefined,
        twilioToken: undefined,
        googleClientSecret: undefined,
        mailEnabled: false,
      },
    });
    try {
      const a = await createSession(f.db, f.a),
        b = await createSession(f.db, f.b);
      const headers = { authorization: `Bearer ${b}` };
      const payload = { slot: interval(3), label: 'HTTP_PRIVATE_BUSY' };
      expect(
        (await service.app.inject({ method: 'POST', url: '/network/calendar/busy', payload }))
          .statusCode,
      ).toBe(401);
      expect(
        (
          await service.app.inject({
            method: 'POST',
            url: '/network/calendar/busy',
            headers,
            payload: { ...payload, ownerId: f.a },
          })
        ).statusCode,
      ).toBe(400);
      const created = await service.app.inject({
        method: 'POST',
        url: '/network/calendar/busy',
        headers,
        payload,
      });
      expect(created.statusCode, created.body).toBe(200);
      const busy = created.json();
      expect(busy.ownerId).toBe(f.b);
      const foreign = await service.app.inject({
        method: 'DELETE',
        url: `/network/calendar/busy/${busy.id}`,
        headers: { authorization: `Bearer ${a}` },
        payload: { version: busy.version },
      });
      expect(foreign.statusCode).toBe(404);
      const availability = await service.app.inject({
        method: 'PUT',
        url: '/network/calendar/availability',
        headers,
        payload: { confirmedThrough: future(7) },
      });
      expect(availability.statusCode, availability.body).toBe(200);
      const own = await service.app.inject({ url: '/network/calendar', headers });
      expect(own.headers['cache-control']).toBe('no-store');
      expect(own.json().busyBlocks).toHaveLength(1);
      expect(own.json().availability.source).toBe('manual');
      const peer = await service.app.inject({
        url: '/network/calendar',
        headers: { authorization: `Bearer ${a}` },
      });
      expect(peer.json().busyBlocks).toEqual([]);
      expect(peer.json().availability).toBeNull();
      expect(peer.body).not.toContain('HTTP_PRIVATE_BUSY');
    } finally {
      await service.app.close();
    }
  });
});
