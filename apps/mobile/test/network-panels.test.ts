import { describe, expect, it, vi } from 'vitest';
import type {
  NetworkConnection,
  NetworkConversation,
  NetworkPolicyInput,
  NetworkRequestInput,
} from '@personal-agent/domain';
import {
  acceptedConnections,
  buildMemory,
  buildPolicy,
  buildRequest,
  canDecide,
  inboxLabel,
  memoryDraft,
  requestDraft,
  RequestSubmission,
  ResponseFence,
} from '../src/features/network/panel-state';

const owner = '00000000-0000-4000-8000-000000000001',
  member = '00000000-0000-4000-8000-000000000002',
  connectionId = '00000000-0000-4000-8000-000000000003',
  nonce = '00000000-0000-4000-8000-000000000004';
const now = Date.parse('2026-10-27T12:00:00Z'),
  expiry = '2026-11-10T12:00:00Z';
const connection: NetworkConnection = {
  id: connectionId,
  fromId: owner,
  toId: member,
  status: 'accepted',
  version: 1,
  inbound: { [owner]: true, [member]: true },
  mutedBy: [],
  createdAt: new Date(now).toISOString(),
  updatedAt: new Date(now).toISOString(),
};
const slot = {
  startAt: '2026-11-01T15:00:00Z',
  endAt: '2026-11-01T15:30:00Z',
  timezone: 'America/New_York',
};
const draft = () => ({
  ...requestDraft(now),
  connectionId,
  purpose: 'Coordinate the fictional project review',
  topic: 'project planning',
  message: 'Fictional data only',
  expiresAt: expiry,
});
const payload = (): NetworkRequestInput => buildRequest(draft(), [connection], nonce, now);
const conversation = (changes: Partial<NetworkConversation> = {}): NetworkConversation => ({
  id: connectionId,
  protocolVersion: 1,
  initiatorId: owner,
  recipientId: member,
  connectionId,
  request: payload(),
  state: 'queued',
  version: 1,
  connectionVersion: 1,
  policyVersions: {},
  messages: [],
  acceptances: [],
  decisionOwnerIds: [],
  summary: 'Queued for internal processing.',
  nextAction: 'Wait for recipient agent.',
  turns: 0,
  createdAt: new Date(now).toISOString(),
  updatedAt: new Date(now).toISOString(),
  readBy: [],
  ...changes,
});
const policy = (): NetworkPolicyInput => ({
  enabled: false,
  trustedMemberIds: [],
  topics: [],
  allowMessages: false,
  allowQuestions: false,
  allowMeetings: false,
  autoAcceptMeetings: false,
  timezone: 'Europe/Skopje',
  weekdays: [1, 2, 3, 4, 5],
  workStartMinute: 540,
  workEndMinute: 1020,
  maxDurationMinutes: 30,
  minNoticeMinutes: 1440,
  schedulingWindowDays: 14,
  expiresAt: expiry,
  sharedMemoryIds: [],
  reminderMinutes: [30],
});

describe('network panel request validation', () => {
  it('requires an accepted member and never selects a fictional person automatically', () => {
    expect(requestDraft(now).connectionId).toBe('');
    expect(() => buildRequest(draft(), [], nonce, now)).toThrow('accepted connection');
    for (const status of ['pending', 'declined', 'blocked'] as const)
      expect(() => buildRequest(draft(), [{ ...connection, status }], nonce, now)).toThrow(
        'accepted connection',
      );
    expect(acceptedConnections([connection, { ...connection, status: 'blocked' }])).toEqual([
      connection,
    ]);
  });
  it('keeps exact purpose/message and narrower scopes distinct from meeting authority', () => {
    expect(payload()).toMatchObject({
      purpose: draft().purpose,
      message: draft().message,
      kind: 'inform',
      candidateSlots: [],
    });
    expect(() =>
      buildRequest({ ...draft(), candidateSlots: [slot] }, [connection], nonce, now),
    ).toThrow('Meetings need');
    expect(() => buildRequest({ ...draft(), kind: 'meeting' }, [connection], nonce, now)).toThrow(
      'Meetings need',
    );
    expect(() => buildRequest({ ...draft(), purpose: '   ' }, [connection], nonce, now)).toThrow(
      'purpose',
    );
    expect(() => buildRequest({ ...draft(), message: '' }, [connection], nonce, now)).toThrow(
      'exact information',
    );
  });
  it('accepts an explicit UTC instant and IANA timezone through a DST transition', () => {
    const request = buildRequest(
      { ...draft(), kind: 'meeting', candidateSlots: [slot] },
      [connection],
      nonce,
      now,
    );
    expect(request.candidateSlots[0]).toEqual(slot);
    expect(() =>
      buildRequest(
        {
          ...draft(),
          kind: 'meeting',
          candidateSlots: [{ ...slot, startAt: '2026-11-01T01:30:00' }],
        },
        [connection],
        nonce,
        now,
      ),
    ).toThrow();
    expect(() =>
      buildRequest(
        { ...draft(), kind: 'meeting', candidateSlots: [{ ...slot, timezone: 'Invented/Zone' }] },
        [connection],
        nonce,
        now,
      ),
    ).toThrow('IANA');
  });
  it('rejects expired requests, past/long/overflowing candidate slots and missing end bounds', () => {
    expect(() =>
      buildRequest(
        { ...draft(), expiresAt: new Date(now).toISOString() },
        [connection],
        nonce,
        now,
      ),
    ).toThrow('future');
    expect(() =>
      buildRequest({ ...draft(), expiresAt: '2026-12-31T00:00:00Z' }, [connection], nonce, now),
    ).toThrow('thirty days');
    for (const candidate of [
      { ...slot, startAt: '2026-10-25T15:00:00Z', endAt: '2026-10-25T15:30:00Z' },
      { ...slot, endAt: '2026-11-01T20:00:00Z' },
      { ...slot, endAt: '' },
      { ...slot, startAt: '2026-11-10T15:00:00Z', endAt: '2026-11-10T15:30:00Z' },
    ])
      expect(() =>
        buildRequest(
          { ...draft(), kind: 'meeting', candidateSlots: [candidate] },
          [connection],
          nonce,
          now,
        ),
      ).toThrow();
  });
});

describe('network panel memory and authority scope', () => {
  it('starts private and unconfirmed, and rejects accidental scope expansion', () => {
    expect(memoryDraft(now)).toMatchObject({ sharing: 'private', memberIds: [], confirmed: false });
    const memory = {
      ...memoryDraft(now),
      text: 'Fictional preference',
      topic: 'project planning',
      expiresAt: expiry,
    };
    expect(buildMemory(memory, [], now)).toEqual(memory);
    expect(() => buildMemory({ ...memory, memberIds: [member] }, [member], now)).toThrow(
      'Private memory',
    );
    expect(() => buildMemory({ ...memory, sharing: 'connections' }, [member], now)).toThrow(
      'at least one',
    );
    expect(() =>
      buildMemory({ ...memory, sharing: 'connections', memberIds: [member] }, [], now),
    ).toThrow('current accepted');
    expect(
      buildMemory(
        { ...memory, sharing: 'connections', memberIds: [member], confirmed: true },
        [member],
        now,
      ),
    ).toMatchObject({ memberIds: [member], confirmed: true });
    expect(() =>
      buildMemory({ ...memory, expiresAt: new Date(now).toISOString() }, [], now),
    ).toThrow('future');
  });
  it('requires explicit member/topic/capability limits and future expiry for enabled autonomy', () => {
    expect(buildPolicy(policy(), [], now).enabled).toBe(false);
    const enabled = { ...policy(), enabled: true };
    expect(() => buildPolicy(enabled, [member], now)).toThrow('Select current accepted');
    expect(() => buildPolicy({ ...enabled, trustedMemberIds: [member] }, [member], now)).toThrow(
      'topic',
    );
    expect(() =>
      buildPolicy({ ...enabled, trustedMemberIds: [member], topics: ['planning'] }, [member], now),
    ).toThrow('capability');
    expect(
      buildPolicy(
        { ...enabled, trustedMemberIds: [member], topics: ['planning'], allowMessages: true },
        [member],
        now,
      ).enabled,
    ).toBe(true);
    expect(() =>
      buildPolicy(
        {
          ...enabled,
          trustedMemberIds: [member],
          topics: ['planning'],
          allowMessages: true,
          expiresAt: new Date(now).toISOString(),
        },
        [member],
        now,
      ),
    ).toThrow('future');
  });
  it('revocation may disable an expired grant and cannot enable meetings through messages', () => {
    expect(
      buildPolicy({ ...policy(), expiresAt: new Date(now).toISOString() }, [], now).enabled,
    ).toBe(false);
    expect(() =>
      buildPolicy(
        {
          ...policy(),
          enabled: true,
          trustedMemberIds: [member],
          topics: ['planning'],
          allowMessages: true,
          autoAcceptMeetings: true,
        },
        [member],
        now,
      ),
    ).toThrow('Meeting acceptance requires');
    expect(() =>
      buildPolicy({ ...policy(), workStartMinute: 1020, workEndMinute: 540 }, [], now),
    ).toThrow('Working hours');
  });
  it('distinguishes unread, waiting for peer, agent handling and own unexpired decision', () => {
    expect(inboxLabel(conversation({ state: 'processing' }), owner)).toBe('Agents coordinating');
    const proposal = {
      id: nonce,
      version: 2,
      hash: 'a'.repeat(64),
      terms: {
        version: 1 as const,
        participants: [owner, member],
        purpose: 'Planning',
        topic: 'planning',
        slot,
        location: 'Internal room',
        obligations: [],
      },
      expiresAt: expiry,
    };
    const waiting = conversation({
      state: 'awaiting_approval',
      decisionOwnerIds: [member],
      proposal,
    });
    expect(inboxLabel(waiting, owner)).toBe('Waiting for the other owner');
    expect(canDecide(waiting, owner, now)).toBe(false);
    const own = { ...waiting, decisionOwnerIds: [owner] };
    expect(inboxLabel(own, owner)).toBe('Your decision needed');
    expect(canDecide(own, owner, now)).toBe(true);
    expect(canDecide({ ...own, readBy: [owner] }, owner, now)).toBe(true);
    expect(
      canDecide(
        { ...own, proposal: { ...proposal, expiresAt: new Date(now).toISOString() } },
        owner,
        now,
      ),
    ).toBe(false);
    expect(canDecide({ ...own, state: 'agreed' }, owner, now)).toBe(false);
  });
});

describe('network request lost-save recovery', () => {
  it('reads back before sending and never resends an already recorded request', async () => {
    const pending = new RequestSubmission(),
      item = conversation();
    pending.stage(payload());
    const send = vi.fn();
    expect(await pending.send(send, async () => [item])).toBe(item);
    expect(send).not.toHaveBeenCalled();
    expect(pending.pending).toBeNull();
  });
  it('recovers a successful server save when its response was lost without claiming a second send', async () => {
    const pending = new RequestSubmission(),
      item = conversation();
    pending.stage(payload());
    const send = vi.fn(async () => {
        throw new Error('response lost');
      }),
      read = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([item]);
    expect(await pending.send(send, read)).toBe(item);
    expect(send).toHaveBeenCalledTimes(1);
    expect(pending.pending).toBeNull();
  });
  it('retains the exact payload and nonce through offline readback, edits and an explicit retry', async () => {
    const pending = new RequestSubmission(),
      input = payload();
    pending.stage(input);
    input.message = 'Changed externally';
    const read = vi.fn(async () => []),
      lost = vi.fn(async () => {
        throw new Error('timeout');
      });
    await expect(pending.send(lost, read)).rejects.toThrow('timeout');
    const original = pending.pending;
    pending.stage({
      ...payload(),
      requestId: connectionId,
      message: 'Attempted different instruction',
    });
    expect(pending.pending).toBe(original);
    expect(pending.pending?.message).toBe('Fictional data only');
    expect(pending.pending?.requestId).toBe(nonce);
    const success = vi.fn(async () => conversation());
    await pending.send(success, read);
    expect(success).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: nonce, message: 'Fictional data only' }),
    );
  });
  it('fails closed when initial readback is unavailable and retains the draft identifier', async () => {
    const pending = new RequestSubmission();
    pending.stage(payload());
    const send = vi.fn();
    await expect(
      pending.send(send, async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    expect(send).not.toHaveBeenCalled();
    expect(pending.pending?.requestId).toBe(nonce);
  });
  it('allows correction only after a definite rejection; ambiguous conflicts/timeouts remain retained', async () => {
    for (const status of [400, 401, 403, 404, 408, 409, 429, 500]) {
      const pending = new RequestSubmission();
      pending.stage(payload());
      await expect(
        pending.send(
          async () => {
            throw Object.assign(new Error('rejected'), { status });
          },
          async () => [],
        ),
      ).rejects.toThrow('rejected');
      expect(pending.pending === null).toBe([400, 401, 403, 404].includes(status));
    }
    const denied = new RequestSubmission();
    denied.stage(payload());
    await expect(
      denied.send(
        async () => {
          throw Object.assign(new Error('scope denied'), {
            status: 409,
            code: 'network_scope_denied',
          });
        },
        async () => [],
      ),
    ).rejects.toThrow('scope denied');
    expect(denied.pending).toBeNull();
  });
});

describe('network owner reply fences used by mounted panels', () => {
  it('ignores earlier responses and all responses after owner subtree disposal', () => {
    const fence = new ResponseFence(),
      first = fence.begin(),
      next = fence.begin();
    expect(fence.current(first)).toBe(false);
    expect(fence.current(next)).toBe(true);
    fence.dispose();
    expect(fence.current(next)).toBe(false);
    expect(fence.current(fence.begin())).toBe(false);
    const nextOwner = new ResponseFence(),
      ticket = nextOwner.begin();
    expect(nextOwner.current(ticket)).toBe(true);
    expect(fence.current(ticket)).toBe(false);
  });
});
