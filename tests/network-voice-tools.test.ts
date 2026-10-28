import { openTestDatabase } from './support/test-database.js';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApplicationToolArguments,
  applicationToolDefinitions,
  NETWORK_VOICE_TOOLS,
  type NetworkConnection,
  type NetworkRequestInput,
} from '../packages/domain/src/index.js';
import { createSession, hashToken, newUser } from '../apps/server/src/auth.js';
import { Database, Repository } from '../apps/server/src/db.js';
import { LiveSessionStore } from '../apps/server/src/live-session-store.js';
import {
  toolRequestId,
  type ToolActorContext,
} from '../apps/server/src/integrations/tool-contract.js';
import { InternalCalendar } from '../apps/server/src/network/calendar.js';
import { NetworkCoordinator } from '../apps/server/src/network/coordination.js';
import { NetworkStore } from '../apps/server/src/network/store.js';
import { NetworkVoiceTools } from '../apps/server/src/network/voice-tools.js';
import { OpenAIToolDelegation } from '../apps/server/src/openai-tool-delegation.js';

const databases: Database[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(databases.splice(0).map((db) => db.close()));
});
async function fixture() {
  const db = await openTestDatabase({ dataDir: 'memory://' });
  databases.push(db);
  const repo = new Repository(db),
    owner = (await newUser(db, `${randomUUID()}@example.invalid`, 'Fictional owner password 123'))
      .id,
    peer = (await newUser(db, `${randomUUID()}@example.invalid`, 'Fictional peer password 123')).id;
  await repo.put(owner, 'profile', { id: owner, name: 'Fictional Owner' });
  await repo.put(peer, 'profile', { id: peer, name: 'Fictional Member' });
  const token = await createSession(db, owner),
    live = new LiveSessionStore(db);
  let { receipt } = await live.reserve(owner, randomUUID());
  receipt = await live.attachProvider(
    owner,
    receipt.id,
    receipt.version,
    `fictional-live-${randomUUID()}`,
  );
  const coordinator = new NetworkCoordinator(db, new InternalCalendar(db));
  await coordinator.identity(owner);
  const identity = await coordinator.identity(peer);
  let connection: NetworkConnection = await coordinator.invite(owner, identity.member.memberCode);
  connection = await coordinator.updateConnection(peer, connection.id, {
    action: 'accept',
    version: connection.version,
  });
  for (const [id, other] of [
    [owner, peer],
    [peer, owner],
  ]) {
    const current = await coordinator.policy(id),
      { ownerId: _owner, updatedAt: _updated, version: _version, ...input } = current;
    await coordinator.savePolicy(
      id,
      {
        ...input,
        enabled: true,
        trustedMemberIds: [other],
        topics: ['project planning'],
        allowMessages: true,
        allowQuestions: true,
        allowMeetings: true,
        autoAcceptMeetings: true,
        timezone: 'UTC',
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        workStartMinute: 0,
        workEndMinute: 1440,
        minNoticeMinutes: 0,
      },
      current.version,
    );
  }
  const grant = {
    id: `tool-access:${owner}`,
    ownerId: owner,
    version: 1 as const,
    enabled: true,
    tools: [...NETWORK_VOICE_TOOLS],
    updatedAt: new Date().toISOString(),
  };
  await repo.put(owner, 'tool_access', grant);
  const legacy = {
    invoke: vi.fn(async () => ({
      schemaVersion: 1 as const,
      requestId: randomUUID(),
      toolName: 'contacts_lookup' as const,
      status: 'succeeded' as const,
      reasonCode: 'lookup_complete',
      verification: 'local_commit' as const,
    })),
  };
  const gateway = new NetworkVoiceTools(db, live, coordinator, legacy),
    context: ToolActorContext = {
      ownerId: owner,
      liveReceiptId: receipt.id,
      authSessionHash: hashToken(token),
      callId: `fictional-call-${randomUUID()}`,
    };
  const input = {
    connectionId: connection.id,
    kind: 'meeting' as const,
    purpose: 'Deliver a fictional project update',
    topic: 'project planning',
    message: 'Fictional exact owner-approved words',
    candidateSlots: [
      {
        startAt: new Date(Date.now() + 86400000).toISOString(),
        endAt: new Date(Date.now() + 88200000).toISOString(),
        timezone: 'UTC',
      },
    ],
    location: '',
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  const invoke = (name: string, args: unknown, patch: Partial<ToolActorContext> = {}) =>
    gateway.invoke({ ...context, ...patch }, name, JSON.stringify(args));
  const records = () => new NetworkStore(db).list(owner, 'conversation');
  return {
    db,
    repo,
    owner,
    peer,
    token,
    live,
    receipt,
    coordinator,
    connection,
    grant,
    legacy,
    gateway,
    context,
    input,
    invoke,
    records,
  };
}

describe('strict internal owner voice tools', () => {
  it.each(['inform', 'ask'] as const)(
    'requires independent owner readback approval for a voice %s instead of trusting model text',
    async (kind) => {
      const f = await fixture();
      const proposed = {
        ...f.input,
        kind,
        candidateSlots: [],
        message: 'Model-added private conversation material',
      };
      const result = await f.invoke('network_request_submit', proposed);
      expect(result).toMatchObject({
        status: 'blocked',
        reasonCode: 'review_required',
        data: {
          needsOwnerReview: true,
          proposedRequest: { connectionId: f.connection.id, kind, message: proposed.message },
          spokenDeliveryConfirmed: false,
        },
      });
      expect(await f.records()).toHaveLength(0);
      expect(
        await f.invoke(
          'network_request_submit',
          { ...proposed, ownerConfirmed: true },
          { callId: 'pretend-owner-confirmation' },
        ),
      ).toMatchObject({ status: 'blocked', reasonCode: 'invalid_arguments' });
      const traces = await f.repo.list<{ event: string }>(f.owner, 'tool_trace');
      expect(traces.map((trace) => trace.event)).toContain('tool_blocked');
      expect(traces.map((trace) => trace.event)).not.toContain('tool_succeeded');
      expect(JSON.stringify(traces)).not.toContain(proposed.message);
    },
  );
  it('does not resolve a substring name and requires an exact full name or immutable member identifier', async () => {
    const f = await fixture();
    expect(
      await f.invoke('network_connections_lookup', { query: 'Fictional', limit: 10 }),
    ).toMatchObject({
      status: 'succeeded',
      data: { connections: [], needsRecipientClarification: true },
    });
    expect(
      await f.invoke(
        'network_connections_lookup',
        { query: f.peer, limit: 10 },
        { callId: 'exact-member-id' },
      ),
    ).toMatchObject({
      data: {
        connections: [{ memberId: f.peer, connectionId: f.connection.id }],
        needsRecipientClarification: false,
      },
    });
  });
  it('has strict required argument schemas, no model-supplied owner/grant/nonce, and explicit meeting intervals', () => {
    const definitions = applicationToolDefinitions(NETWORK_VOICE_TOOLS);
    expect(definitions.map((value) => value.name)).toEqual([...NETWORK_VOICE_TOOLS]);
    for (const definition of definitions) {
      expect(definition.strict).toBe(true);
      expect(definition.parameters.additionalProperties).toBe(false);
    }
    const args = {
      connectionId: randomUUID(),
      kind: 'inform',
      purpose: 'Fictional purpose',
      topic: 'planning',
      message: 'Fictional message',
      candidateSlots: [],
      location: '',
      expiresAt: '2026-12-31T12:00:00Z',
    };
    expect(ApplicationToolArguments.network_request_submit.safeParse(args).success).toBe(true);
    for (const extra of [
      { ownerId: randomUUID() },
      { requestId: randomUUID() },
      { authorization: true },
      { url: 'https://example.invalid' },
    ])
      expect(
        ApplicationToolArguments.network_request_submit.safeParse({ ...args, ...extra }).success,
      ).toBe(false);
    expect(
      ApplicationToolArguments.network_request_submit.safeParse({ ...args, kind: 'meeting' })
        .success,
    ).toBe(false);
    expect(
      ApplicationToolArguments.network_request_submit.safeParse({
        ...args,
        kind: 'meeting',
        candidateSlots: [
          {
            startAt: '2026-11-01T01:30:00',
            endAt: '2026-11-01T02:00:00',
            timezone: 'America/New_York',
          },
        ],
      }).success,
    ).toBe(false);
  });
  it('delegates legacy names unchanged and returns accepted-member projections without codes/private rules', async () => {
    const f = await fixture();
    const legacyArgs = '{"query":"fictional","limit":1}';
    await f.gateway.invoke(f.context, 'contacts_lookup', legacyArgs);
    expect(f.legacy.invoke).toHaveBeenCalledWith(f.context, 'contacts_lookup', legacyArgs);
    const lookup = await f.invoke('network_connections_lookup', {
      query: 'Fictional Member',
      limit: 10,
    });
    expect(lookup).toMatchObject({
      status: 'succeeded',
      data: {
        untrusted: true,
        connections: [
          { connectionId: f.connection.id, memberId: f.peer, name: 'Fictional Member' },
        ],
      },
    });
    const serialized = JSON.stringify(lookup);
    for (const hidden of ['memberCode', 'policy', 'inbound', 'trustedMemberIds', 'memory'])
      expect(serialized).not.toContain(hidden);
    await f.coordinator.updateConnection(f.owner, f.connection.id, {
      action: 'block',
      version: f.connection.version,
    });
    expect(
      await f.invoke(
        'network_connections_lookup',
        { query: '', limit: 10 },
        { callId: 'fictional-after-block' },
      ),
    ).toMatchObject({ data: { connections: [] } });
  });
  it('creates one internal request for repeated/restarted same-call submissions and never executes external fetch', async () => {
    const f = await fixture(),
      fetch = vi.fn(async () => {
        throw new Error('External network is forbidden');
      });
    vi.stubGlobal('fetch', fetch);
    const first = await f.invoke('network_request_submit', f.input),
      again = await f.invoke('network_request_submit', f.input);
    const restarted = new NetworkVoiceTools(f.db, f.live, f.coordinator, f.legacy),
      third = await restarted.invoke(f.context, 'network_request_submit', JSON.stringify(f.input));
    expect(first).toMatchObject({
      status: 'queued',
      requestId: toolRequestId(f.context),
      data: { state: 'queued', externalEffectsEnabled: false, spokenDeliveryConfirmed: false },
    });
    expect(again.data?.conversationId).toBe(first.data?.conversationId);
    expect(third.data?.conversationId).toBe(first.data?.conversationId);
    expect(await f.records()).toHaveLength(1);
    const saved = (await f.records())[0].value as { request: NetworkRequestInput };
    expect(saved.request.requestId).toBe(toolRequestId(f.context));
    expect(saved.request.message).toBe(f.input.message);
    expect(fetch).not.toHaveBeenCalled();
    expect(
      await f.invoke('network_request_submit', { ...f.input, message: 'Different instructions' }),
    ).toMatchObject({ status: 'blocked', reasonCode: 'receipt_conflict' });
    const receipts = JSON.stringify(await f.repo.list(f.owner, 'tool_receipt')),
      traces = JSON.stringify(await f.repo.list(f.owner, 'tool_trace'));
    for (const value of [
      f.input.message,
      f.input.purpose,
      f.context.authSessionHash,
      'fictional-live-',
    ]) {
      expect(receipts).not.toContain(value);
      expect(traces).not.toContain(value);
    }
  });
  it('routes a completed Live function item through the real internal gateway and returns queued evidence before continuation', async () => {
    const f = await fixture(),
      sent: Record<string, any>[] = [],
      failed = vi.fn();
    const bridge = new OpenAIToolDelegation({
      context: {
        ownerId: f.owner,
        liveReceiptId: f.receipt.id,
        authSessionHash: f.context.authSessionHash,
      },
      tools: NETWORK_VOICE_TOOLS,
      gateway: f.gateway,
      isCurrent: () => true,
      accessCurrent: async () => true,
      send: (event) => {
        sent.push(event);
      },
      onProtocolFailure: failed,
    });
    const event = (nested: Record<string, unknown>) => ({
      type: 'response.event',
      delegation_id: 'fictional-delegation',
      event: nested,
    });
    bridge.receive({
      type: 'session.delegation.created',
      delegation: {
        id: 'fictional-delegation',
        target: 'responses',
        response_id: 'fictional-response',
      },
    });
    bridge.receive(
      event({
        type: 'response.created',
        response: { id: 'fictional-response', status: 'in_progress' },
      }),
    );
    bridge.receive(
      event({
        type: 'response.output_item.done',
        response_id: 'fictional-response',
        item: {
          type: 'function_call',
          call_id: f.context.callId,
          name: 'network_request_submit',
          arguments: JSON.stringify(f.input),
        },
      }),
    );
    bridge.receive(
      event({
        type: 'response.completed',
        response: { id: 'fictional-response', status: 'completed', output: [] },
      }),
    );
    await bridge.idle();
    expect(failed).not.toHaveBeenCalled();
    expect(sent.map((item) => item.type)).toEqual(['response.item.create', 'response.create']);
    expect(JSON.parse(sent[0].item.output)).toMatchObject({
      toolName: 'network_request_submit',
      status: 'queued',
      spokenDeliveryConfirmed: false,
      data: { state: 'queued', externalEffectsEnabled: false },
    });
    expect(await f.records()).toHaveLength(1);
    await bridge.stop();
  });
  it('reads canonical status without turning read state into approval or leaking private context', async () => {
    const f = await fixture(),
      sent = await f.invoke('network_request_submit', f.input),
      id = sent.data!.conversationId;
    const status = await f.invoke(
      'network_request_status',
      { conversationId: id },
      { callId: 'fictional-status-call' },
    );
    expect(status).toMatchObject({
      status: 'succeeded',
      data: { state: 'queued', needsYourDecision: false, conversationId: id },
    });
    expect(JSON.stringify(status)).not.toContain('policyVersions');
    expect(JSON.stringify(status)).not.toContain('trustedMemberIds');
    const other = (
      await newUser(f.db, `${randomUUID()}@example.invalid`, 'Other fictional owner 123')
    ).id;
    expect(
      await f.invoke(
        'network_request_status',
        { conversationId: id },
        { ownerId: other, callId: 'fictional-wrong-owner' },
      ),
    ).toMatchObject({ status: 'blocked', reasonCode: 'session_expired' });
    expect(
      await f.invoke(
        'network_request_status',
        { conversationId: randomUUID() },
        { callId: 'fictional-missing' },
      ),
    ).toMatchObject({ status: 'blocked', reasonCode: 'not_found' });
  });
  it('requires both explicit tool permission and current enabled owner network policy', async () => {
    const f = await fixture();
    await f.repo.put(f.owner, 'tool_access', { ...f.grant, enabled: false });
    expect(await f.invoke('network_request_submit', f.input)).toMatchObject({
      status: 'blocked',
      reasonCode: 'tool_access_required',
    });
    await f.repo.put(f.owner, 'tool_access', { ...f.grant, tools: ['network_connections_lookup'] });
    expect(await f.invoke('network_request_submit', f.input)).toMatchObject({
      status: 'blocked',
      reasonCode: 'tool_not_allowed',
    });
    await f.repo.put(f.owner, 'tool_access', f.grant);
    const policy = await f.coordinator.policy(f.owner),
      { ownerId: _o, version: _v, updatedAt: _u, ...input } = policy;
    await f.coordinator.savePolicy(f.owner, { ...input, enabled: false }, policy.version);
    expect(await f.invoke('network_request_submit', f.input)).toMatchObject({
      status: 'blocked',
      reasonCode: 'network_policy_changed',
    });
    expect(await f.records()).toHaveLength(0);
  });
  it('cannot turn model-produced meeting terms into an owner exception to saved scheduling bounds', async () => {
    const f = await fixture(),
      start = Date.now() + 3600000,
      candidate = {
        startAt: new Date(start).toISOString(),
        endAt: new Date(start + 90 * 60000).toISOString(),
        timezone: 'UTC',
      };
    const meeting = { ...f.input, kind: 'meeting', candidateSlots: [candidate] };
    expect(await f.invoke('network_request_submit', meeting)).toMatchObject({
      status: 'blocked',
      reasonCode: 'review_required',
      data: { needsOwnerReview: true },
    });
    expect(await f.records()).toHaveLength(0);
    const current = await f.coordinator.policy(f.owner),
      { ownerId: _o, version: _v, updatedAt: _u, ...policy } = current;
    await f.coordinator.savePolicy(
      f.owner,
      { ...policy, autoAcceptMeetings: false },
      current.version,
    );
    const inBounds = {
      ...meeting,
      candidateSlots: [{ ...candidate, endAt: new Date(start + 30 * 60000).toISOString() }],
    };
    expect(
      await f.invoke('network_request_submit', inBounds, { callId: 'fictional-in-bounds-meeting' }),
    ).toMatchObject({ status: 'queued' });
    expect(await f.records()).toHaveLength(1);
  });
  it('rejects invalid arguments and an inactive or superseded live actor before creating work', async () => {
    const f = await fixture();
    expect(await f.invoke('network_request_submit', { ...f.input, ownerId: f.peer })).toMatchObject(
      { status: 'blocked', reasonCode: 'invalid_arguments' },
    );
    await f.db.query(
      "UPDATE live_sessions SET controller_lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [f.receipt.id],
    );
    expect(await f.invoke('network_request_submit', f.input)).toMatchObject({
      status: 'blocked',
      reasonCode: 'controller_lost',
    });
    await f.db.query("UPDATE live_sessions SET status='closing' WHERE id=$1", [f.receipt.id]);
    expect(await f.invoke('network_request_submit', f.input)).toMatchObject({
      status: 'blocked',
      reasonCode: 'live_session_inactive',
    });
    expect(await f.records()).toHaveLength(0);
  });
  it.each(['grant', 'bearer', 'controller', 'policy', 'block'] as const)(
    'rechecks %s after durable reservation inside the sorted-owner effect transaction',
    async (kind) => {
      const f = await fixture(),
        transaction = f.db.transaction.bind(f.db);
      let count = 0;
      vi.spyOn(f.db, 'transaction').mockImplementation(async (operation) => {
        const result = await transaction(operation);
        count++;
        if (count === 1) {
          if (kind === 'grant')
            await transaction((sql) =>
              f.repo.in(sql).put(f.owner, 'tool_access', { ...f.grant, enabled: false }),
            );
          if (kind === 'bearer')
            await f.db.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(f.token)]);
          if (kind === 'controller')
            await f.db.query(
              "UPDATE live_sessions SET controller_lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
              [f.receipt.id],
            );
          if (kind === 'policy') {
            const current = await f.coordinator.policy(f.owner),
              { ownerId: _o, version: _v, updatedAt: _u, ...input } = current;
            await f.coordinator.savePolicy(f.owner, { ...input, enabled: false }, current.version);
          }
          if (kind === 'block')
            await f.coordinator.updateConnection(f.peer, f.connection.id, {
              action: 'block',
              version: f.connection.version,
            });
        }
        return result;
      });
      const result = await f.invoke('network_request_submit', f.input);
      expect(result.status).toBe('blocked');
      expect(result.reasonCode).toBe(
        {
          grant: 'tool_access_required',
          bearer: 'session_expired',
          controller: 'controller_lost',
          policy: 'network_policy_changed',
          block: 'network_connection_changed',
        }[kind],
      );
      expect(await f.records()).toHaveLength(0);
    },
  );
  it('recovers a lost post-commit result with the original deterministic request identity', async () => {
    const f = await fixture(),
      submit = f.coordinator.submit.bind(f.coordinator);
    let first = true;
    vi.spyOn(f.coordinator, 'submit').mockImplementation(async (owner, input) => {
      const result = await submit(owner, input);
      if (first) {
        first = false;
        throw new Error('Fictional lost response after durable save');
      }
      return result;
    });
    expect(await f.invoke('network_request_submit', f.input)).toMatchObject({
      status: 'unknown',
      reasonCode: 'operation_failed',
    });
    expect(await f.records()).toHaveLength(1);
    const replay = await f.invoke('network_request_submit', f.input);
    expect(replay).toMatchObject({ status: 'queued', data: { state: 'queued' } });
    expect(await f.records()).toHaveLength(1);
  });
});
