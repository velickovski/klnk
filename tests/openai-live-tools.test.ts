import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenAIToolDelegation,
  type ResolveLiveToolAccess,
} from '../apps/server/src/openai-tool-delegation.js';
import {
  toolRequestId,
  type OwnerToolGateway,
  type ToolActorContext,
  type ToolOutcome,
} from '../apps/server/src/integrations/tool-contract.js';
import { OpenAILive, type LiveSocket } from '../apps/server/src/openai-live.js';
import { Database } from '../apps/server/src/db.js';
import { LiveSessionStore } from '../apps/server/src/live-session-store.js';
import { getConfig } from '../apps/server/src/config.js';
import { ApplicationToolGateway } from '../apps/server/src/integrations/gateway.js';
import { Engine } from '../apps/server/src/engine.js';
import { createSession, hashToken, newUser } from '../apps/server/src/auth.js';
import { seedOwner } from '../apps/server/src/seed.js';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const responseEvent = (delegationId: string, event: unknown) => ({
  type: 'response.event',
  delegation_id: delegationId,
  event,
});
const callEvent = (
  id: string,
  name = 'contacts_lookup',
  args: unknown = '{"query":"","limit":1}',
) => ({
  type: 'response.output_item.done',
  item: { type: 'function_call', call_id: id, name, arguments: args },
});
const outcome = (
  context: ToolActorContext,
  name = 'contacts_lookup',
  data?: Record<string, unknown>,
): ToolOutcome => ({
  schemaVersion: 1,
  requestId: toolRequestId(context),
  toolName: name as ToolOutcome['toolName'],
  status: 'succeeded',
  reasonCode: 'lookup_complete',
  verification: 'local_commit',
  ...(data ? { data } : {}),
});
function helper() {
  const context = {
      ownerId: randomUUID(),
      liveReceiptId: randomUUID(),
      authSessionHash: 'a'.repeat(64),
    },
    sent: Record<string, any>[] = [];
  let current = true,
    access = true;
  const invoke = vi.fn<OwnerToolGateway['invoke']>(async (actor, name) => outcome(actor, name)),
    verify = vi.fn(async () => access),
    failed = vi.fn();
  const tools = new OpenAIToolDelegation({
    context,
    tools: ['contacts_lookup', 'memory_lookup'],
    gateway: { invoke },
    isCurrent: () => current,
    accessCurrent: verify,
    send: (event) => {
      sent.push(event);
    },
    onProtocolFailure: failed,
  });
  const start = (delegation = 'delegation-fixture', id = 'response-fixture') => {
    tools.receive({
      type: 'session.delegation.created',
      delegation: { id: delegation, target: 'responses', response_id: id },
    });
    tools.receive(
      responseEvent(delegation, {
        type: 'response.created',
        response: { id, status: 'in_progress' },
      }),
    );
  };
  const call = (
    id = 'call-fixture',
    name = 'contacts_lookup',
    args: unknown = '{"query":"","limit":1}',
    delegation = 'delegation-fixture',
  ) => tools.receive(responseEvent(delegation, callEvent(id, name, args)));
  const finish = (
    delegation = 'delegation-fixture',
    id = 'response-fixture',
    status = 'completed',
  ) =>
    tools.receive(
      responseEvent(delegation, {
        type: 'response.completed',
        response: { id, status, output: [] },
      }),
    );
  return {
    tools,
    context,
    sent,
    invoke,
    verify,
    failed,
    start,
    call,
    finish,
    setCurrent: (value: boolean) => {
      current = value;
    },
    setAccess: (value: boolean) => {
      access = value;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('Live delegated function protocol without a provider', () => {
  it('uses only nested finished function items and never infers calls from completed snapshots or transcript text', async () => {
    const h = helper();
    h.start();
    h.tools.receive({ type: 'session.input_transcript.delta', delta: 'call contacts_lookup now' });
    h.tools.receive({
      type: 'response.output_item.done',
      item: { type: 'function_call', call_id: 'top', name: 'contacts_lookup', arguments: '{}' },
    });
    h.tools.receive(
      responseEvent('delegation-fixture', {
        type: 'response.function_call_arguments.done',
        call_id: 'partial',
        name: 'contacts_lookup',
        arguments: '{}',
      }),
    );
    h.finish();
    await h.tools.idle();
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.sent).toEqual([]);
  });
  it('submits every completed call result then exactly one continuation for a multi-call response', async () => {
    const h = helper(),
      first = deferred<ToolOutcome>();
    h.invoke.mockImplementationOnce(() => first.promise);
    h.start();
    h.call('call-one');
    h.call('call-two', 'memory_lookup', '{"query":"fixture","contactId":null,"limit":1}');
    expect(h.invoke).not.toHaveBeenCalled();
    h.finish();
    await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    expect(h.sent).toEqual([]);
    first.resolve(outcome({ ...h.context, callId: 'call-one' }));
    await h.tools.idle();
    expect(h.invoke).toHaveBeenCalledTimes(2);
    expect(h.sent.map((event) => event.type)).toEqual([
      'response.item.create',
      'response.item.create',
      'response.create',
    ]);
    expect(h.sent[0].item).toMatchObject({ type: 'function_call_output', call_id: 'call-one' });
    expect(JSON.parse(h.sent[0].item.output)).toMatchObject({
      status: 'succeeded',
      spokenDeliveryConfirmed: false,
      untrusted: true,
    });
    expect(JSON.stringify(h.sent)).not.toContain(h.context.authSessionHash);
  });
  it('deduplicates repeated finished calls and completed events without duplicate execution or result append', async () => {
    const h = helper();
    h.start();
    h.call();
    h.call();
    h.finish();
    h.finish();
    await h.tools.idle();
    h.call();
    h.finish();
    await h.tools.idle();
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.sent).toHaveLength(2);
  });
  it('continues only after all concurrently observed response batches have their pending results', async () => {
    const h = helper();
    h.start('first', 'response-one');
    h.start('second', 'response-two');
    h.call('one', 'contacts_lookup', '{}', 'first');
    h.call('two', 'contacts_lookup', '{}', 'second');
    h.finish('first', 'response-one');
    await h.tools.idle();
    expect(h.sent.map((event) => event.type)).toEqual(['response.item.create']);
    h.finish('second', 'response-two');
    await h.tools.idle();
    expect(h.sent.map((event) => event.type)).toEqual([
      'response.item.create',
      'response.item.create',
      'response.create',
    ]);
  });
  it('can continue an already-returned batch after another response is cancelled', async () => {
    const h = helper();
    h.start('first', 'response-one');
    h.start('second', 'response-two');
    h.call('one', 'contacts_lookup', '{}', 'first');
    h.finish('first', 'response-one');
    await h.tools.idle();
    h.finish('second', 'response-two', 'cancelled');
    await h.tools.idle();
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.sent.map((event) => event.type)).toEqual(['response.item.create', 'response.create']);
  });
  it('blocks unknown tools and malformed argument values without invoking a gateway', async () => {
    const h = helper();
    h.start();
    h.call('unknown', 'arbitrary_http', '{"url":"https://fixture.invalid"}');
    h.call('malformed', 'contacts_lookup', { query: 'fixture' });
    h.finish();
    await h.tools.idle();
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.sent.filter((event) => event.type === 'response.item.create')).toHaveLength(2);
    expect(JSON.parse(h.sent[0].item.output)).toMatchObject({
      status: 'blocked',
      reasonCode: 'tool_not_allowed',
    });
  });
  it.each([
    (h: ReturnType<typeof helper>) =>
      h.tools.receive(responseEvent('unknown-delegation', callEvent('unbound'))),
    (h: ReturnType<typeof helper>) =>
      h.tools.receive(
        responseEvent('delegation-fixture', {
          ...callEvent('mismatch'),
          response_id: 'other-response',
        }),
      ),
    (h: ReturnType<typeof helper>) => h.call('', 'contacts_lookup'),
  ])('fails closed for an uncorrelatable function item', async (receive) => {
    const h = helper();
    h.start();
    receive(h);
    h.finish();
    await h.tools.idle();
    expect(h.failed).toHaveBeenCalledTimes(1);
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.sent).toEqual([]);
  });
  it('rejects a changed duplicate call identity before effects', async () => {
    const h = helper();
    h.start();
    h.call('same', 'contacts_lookup', '{"query":"first","limit":1}');
    h.call('same', 'contacts_lookup', '{"query":"changed","limit":1}');
    h.finish();
    await h.tools.idle();
    expect(h.failed).toHaveBeenCalledWith('duplicate_call_conflict');
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it('does not reuse a call identity in a later backend response', async () => {
    const h = helper();
    h.start();
    h.call('same');
    h.finish();
    await h.tools.idle();
    h.start('delegation-fixture', 'second-response');
    h.call('same');
    expect(h.failed).toHaveBeenCalledWith('duplicate_call_conflict');
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });
  it('stops before execution when one response exceeds the bounded function count', async () => {
    const h = helper();
    h.start();
    for (let index = 0; index < 5; index++) h.call(`fixture-${index}`);
    h.finish();
    await h.tools.idle();
    expect(h.failed).toHaveBeenCalledWith('tool_budget_exceeded');
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it('does not continue a cancelled response or start its queued functions', async () => {
    const h = helper();
    h.start();
    h.call();
    h.finish('delegation-fixture', 'response-fixture', 'cancelled');
    await h.tools.idle();
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.sent).toEqual([]);
  });
  it('awaits a started callback on stop while suppressing late results and subsequent calls', async () => {
    const h = helper(),
      pending = deferred<ToolOutcome>();
    h.invoke.mockImplementationOnce(() => pending.promise);
    h.start();
    h.call('one');
    h.call('two');
    h.finish();
    await vi.waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    const stopping = h.tools.stop();
    pending.resolve(outcome({ ...h.context, callId: 'one' }));
    await stopping;
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.sent).toEqual([]);
  });
  it('drops delayed results when the response fails during execution', async () => {
    const h = helper(),
      pending = deferred<ToolOutcome>();
    h.invoke.mockImplementationOnce(() => pending.promise);
    h.start();
    h.call();
    h.finish();
    await vi.waitFor(() => expect(h.invoke).toHaveBeenCalled());
    h.tools.receive(
      responseEvent('delegation-fixture', {
        type: 'response.failed',
        response: { id: 'response-fixture', status: 'failed' },
      }),
    );
    pending.resolve(outcome({ ...h.context, callId: 'call-fixture' }));
    await h.tools.idle();
    expect(h.sent).toEqual([]);
  });
  it('never invokes after access revocation and never forwards a result revoked before delivery', async () => {
    const before = helper();
    before.setAccess(false);
    before.start();
    before.call();
    before.finish();
    await before.tools.idle();
    expect(before.invoke).not.toHaveBeenCalled();
    const after = helper();
    after.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    after.start();
    after.call();
    after.finish();
    await after.tools.idle();
    expect(after.invoke).toHaveBeenCalledTimes(1);
    expect(after.sent).toEqual([]);
  });
  it('does not return even a blocked unknown-tool result after the actor expires', async () => {
    const h = helper();
    h.setAccess(false);
    h.start();
    h.call('unknown', 'arbitrary_http');
    h.finish();
    await h.tools.idle();
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.sent).toEqual([]);
  });
  it('returns uncertainty for gateway failures or malformed results without retrying an effect', async () => {
    const h = helper();
    h.invoke.mockRejectedValueOnce(new Error('fixture-secret-do-not-forward'));
    h.start();
    h.call();
    h.finish();
    await h.tools.idle();
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(JSON.parse(h.sent[0].item.output)).toMatchObject({
      status: 'unknown',
      reasonCode: 'operation_failed',
    });
    expect(JSON.stringify(h.sent)).not.toContain('fixture-secret');
  });
  it('requires a matching gateway result identity and redacts accidental authentication-hash output', async () => {
    const h = helper();
    h.invoke.mockImplementationOnce(async (actor) => ({
      ...outcome(actor),
      requestId: randomUUID(),
    }));
    h.start();
    h.call();
    h.finish();
    await h.tools.idle();
    expect(JSON.parse(h.sent[0].item.output).reasonCode).toBe('invalid_tool_result');
    const secret = helper();
    secret.invoke.mockImplementationOnce(async (actor) =>
      outcome(actor, 'contacts_lookup', { unintended: secret.context.authSessionHash }),
    );
    secret.start();
    secret.call();
    secret.finish();
    await secret.tools.idle();
    expect(JSON.stringify(secret.sent)).not.toContain(secret.context.authSessionHash);
    expect(JSON.parse(secret.sent[0].item.output).status).toBe('unknown');
  });
  it('preserves proposed/blocked/unknown results instead of converting them to completion', async () => {
    for (const status of ['proposed', 'blocked', 'unknown'] as const) {
      const h = helper();
      h.invoke.mockImplementationOnce(async (actor) => ({ ...outcome(actor), status }));
      h.start();
      h.call();
      h.finish();
      await h.tools.idle();
      expect(JSON.parse(h.sent[0].item.output)).toMatchObject({
        status,
        spokenDeliveryConfirmed: false,
      });
    }
  });
  it('bounds continuation loops before a ninth batch can invoke another tool', async () => {
    const h = helper();
    for (let index = 0; index < 9; index++) {
      h.start('delegation-fixture', `response-${index}`);
      h.call(`call-${index}`);
      h.finish('delegation-fixture', `response-${index}`);
      await h.tools.idle();
    }
    expect(h.invoke).toHaveBeenCalledTimes(8);
    expect(h.failed).toHaveBeenCalledWith('tool_budget_exceeded');
  });
  it('handles a correlated provider command error without retrying results or continuation', async () => {
    const h = helper();
    h.start();
    h.call();
    h.finish();
    await h.tools.idle();
    const eventId = h.sent[0].event_id;
    h.tools.receive({
      type: 'error',
      error: {
        code: 'fixture_command_rejected',
        client_event_id: eventId,
        message: 'private provider fixture',
      },
    });
    h.start('new', 'new-response');
    h.call('new-call', 'contacts_lookup', '{}', 'new');
    h.finish('new', 'new-response');
    await h.tools.idle();
    expect(h.failed).toHaveBeenCalledWith('tool_transport_failed');
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.sent).toHaveLength(2);
  });
  it('stops delegated tools on asynchronous Responses configuration rejection', async () => {
    const h = helper();
    h.start();
    h.tools.receive({
      type: 'error',
      error: { code: 'responses_validation_failed', message: 'private config fixture' },
    });
    h.call();
    h.finish();
    await h.tools.idle();
    expect(h.failed).toHaveBeenCalledWith('tool_transport_failed');
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.sent).toEqual([]);
  });
  it('bounds orphan announcements and rejects conflicting response associations before callbacks', async () => {
    const h = helper();
    for (let index = 0; index < 1000; index++)
      h.tools.receive({
        type: 'session.delegation.created',
        delegation: {
          id: `orphan-${index}`,
          target: 'responses',
          response_id: `response-${index}`,
        },
      });
    await h.tools.idle();
    expect(h.failed).toHaveBeenCalledExactlyOnceWith('tool_budget_exceeded');
    expect(h.invoke).not.toHaveBeenCalled();
    const conflict = helper();
    conflict.tools.receive({
      type: 'session.delegation.created',
      delegation: { id: 'one', target: 'responses', response_id: 'first' },
    });
    conflict.tools.receive({
      type: 'session.delegation.created',
      delegation: { id: 'one', target: 'responses', response_id: 'changed' },
    });
    expect(conflict.failed).toHaveBeenCalledExactlyOnceWith('invalid_correlation');
  });
});

class Socket extends EventEmitter implements LiveSocket {
  readyState = 0;
  sent: Record<string, any>[] = [];
  constructor() {
    super();
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open');
      this.emit('message', JSON.stringify({ type: 'session.started' }));
    });
  }
  send(raw: string) {
    const event = JSON.parse(raw);
    this.sent.push(event);
    if (event.type === 'session.close')
      queueMicrotask(() => this.emit('message', JSON.stringify({ type: 'session.closed' })));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  terminate() {
    this.close();
  }
  receive(event: unknown) {
    this.emit('message', JSON.stringify(event));
  }
}
const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
describe('Live broker trusted tool binding', () => {
  const cleanup: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of cleanup.splice(0)) await close();
  });
  async function fixture() {
    const db = await new Database({ dataDir: 'memory://' }).open();
    const owner = await newUser(
        db,
        `${randomUUID()}@example.invalid`,
        'Fictional live tool password',
      ),
      token = await createSession(db, owner.id),
      store = new LiveSessionStore(db);
    const sockets: Socket[] = [],
      fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(
          async () =>
            new Response(
              JSON.stringify({
                session: { id: `live-${randomUUID()}` },
                transport: { type: 'webrtc', sdp },
              }),
              { status: 201 },
            ),
        );
    const gateway = {
        invoke: vi.fn<OwnerToolGateway['invoke']>(async (context, name) => outcome(context, name)),
      },
      access = vi.fn<ResolveLiveToolAccess>(async () => ({
        authSessionHash: hashToken(token),
        tools: ['contacts_lookup'],
      }));
    const config = {
      ...getConfig(),
      production: false,
      demoEnabled: true,
      provider: 'simulator' as const,
      openaiKey: 'fictional-project-key',
    };
    const live = new OpenAILive(config, {
      store,
      fetch: fetcher,
      socket: () => {
        const socket = new Socket();
        sockets.push(socket);
        return socket;
      },
      toolGateway: gateway,
      resolveToolAccess: access,
    });
    cleanup.push(async () => {
      await live.dispose();
      await db.close();
    });
    return { db, owner: owner.id, token, store, sockets, fetcher, gateway, access, config, live };
  }
  it('advertises only callback-granted schemas without exposing actor credentials or allowing client tools', async () => {
    const h = await fixture();
    await h.live.create(h.owner, { sdp, requestId: randomUUID() }, `Bearer ${h.token}`);
    expect(h.access).toHaveBeenCalledWith(h.owner, `Bearer ${h.token}`, undefined);
    const body = JSON.parse(String(h.fetcher.mock.calls[0][1]?.body));
    expect(body.session.model).toBe('gpt-live-1');
    expect(body.session.audio.output.voice).toBe('marin');
    expect(body.session.delegation.responses).toMatchObject({
      model: 'gpt-6.1-sol',
      tool_choice: 'auto',
      parallel_tool_calls: false,
    });
    expect(body.session.delegation.responses.tools.map((tool: any) => tool.name)).toEqual([
      'contacts_lookup',
    ]);
    expect(body.session.client.data_channel.allowed_client_events).toEqual([
      'session.close',
      'session.input_audio.mute',
      'session.input_audio.unmute',
    ]);
    for (const secret of [h.token, hashToken(h.token), h.owner])
      expect(JSON.stringify(body)).not.toContain(secret);
  });
  it('retains honest no-tools configuration with no grant and rejects binding failures before paid reserve', async () => {
    const h = await fixture();
    h.access.mockResolvedValueOnce(undefined);
    await h.live.create(h.owner, { sdp, requestId: randomUUID() });
    const body = JSON.parse(String(h.fetcher.mock.calls[0][1]?.body));
    expect(body.session.delegation.responses).toMatchObject({ tools: [], tool_choice: 'none' });
    expect(body.session.instructions).toContain('no access to contacts');
    await h.live.close(h.owner, (await h.live.readRecovery(h.owner)).requests[0].sessionId!);
    h.access.mockRejectedValueOnce(new Error('Fictional denied binding'));
    await expect(
      h.live.create(h.owner, { sdp, requestId: randomUUID() }, `Bearer ${h.token}`),
    ).rejects.toThrow('Fictional denied binding');
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects an arbitrary or mismatched approved-request binding before paying for a session', async () => {
    const h = await fixture();
    await expect(
      h.live.create(
        h.owner,
        { sdp, requestId: randomUUID(), authorizedMissionId: 'not-a-uuid' },
        `Bearer ${h.token}`,
      ),
    ).rejects.toThrow();
    expect(h.fetcher).not.toHaveBeenCalled();
    h.access.mockResolvedValueOnce({
      authSessionHash: hashToken(h.token),
      tools: ['contacts_lookup'],
      authorizedMissionId: randomUUID(),
    });
    await expect(
      h.live.create(
        h.owner,
        { sdp, requestId: randomUUID(), authorizedMissionId: randomUUID() },
        `Bearer ${h.token}`,
      ),
    ).rejects.toMatchObject({ code: 'tool_binding_invalid' });
    expect(h.fetcher).not.toHaveBeenCalled();
    h.access.mockResolvedValueOnce(undefined);
    await expect(
      h.live.create(
        h.owner,
        { sdp, requestId: randomUUID(), authorizedMissionId: randomUUID() },
        `Bearer ${h.token}`,
      ),
    ).rejects.toMatchObject({ code: 'tool_binding_invalid' });
    const missionId = randomUUID();
    h.access.mockResolvedValueOnce({
      authSessionHash: hashToken(h.token),
      tools: [],
      authorizedMissionId: missionId,
    });
    await expect(
      h.live.create(
        h.owner,
        { sdp, requestId: randomUUID(), authorizedMissionId: missionId },
        `Bearer ${h.token}`,
      ),
    ).rejects.toMatchObject({ code: 'tool_binding_invalid' });
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(await h.store.listUnresolved(h.owner)).toEqual([]);
  });
  it('binds gateway actor from server context and suppresses continuation after broker close', async () => {
    const h = await fixture(),
      pending = deferred<ToolOutcome>();
    h.gateway.invoke.mockImplementationOnce(() => pending.promise);
    const created = await h.live.create(
        h.owner,
        { sdp, requestId: randomUUID() },
        `Bearer ${h.token}`,
      ),
      socket = h.sockets[0];
    socket.receive(
      responseEvent('delegation', { type: 'response.created', response: { id: 'response' } }),
    );
    socket.receive(responseEvent('delegation', callEvent('call')));
    socket.receive(
      responseEvent('delegation', {
        type: 'response.completed',
        response: { id: 'response', output: [] },
      }),
    );
    await vi.waitFor(() => expect(h.gateway.invoke).toHaveBeenCalledTimes(1));
    const context = h.gateway.invoke.mock.calls[0][0];
    expect(context).toMatchObject({
      ownerId: h.owner,
      authSessionHash: hashToken(h.token),
      callId: 'call',
    });
    expect(context.liveReceiptId).toMatch(/^[0-9a-f-]{36}$/);
    const closing = h.live.close(h.owner, created.session.id);
    await vi.waitFor(() =>
      expect(socket.sent.some((event) => event.type === 'session.close')).toBe(true),
    );
    pending.resolve(outcome(context));
    await closing;
    expect(
      socket.sent.some(
        (event) => event.type === 'response.item.create' || event.type === 'response.create',
      ),
    ).toBe(false);
  });
  it('keeps malformed authority arguments inside the gateway schema boundary without side effects', async () => {
    const h = await fixture(),
      engine = new Engine(h.db, h.config);
    await seedOwner(engine.repo, h.owner, 'Fictional Live Owner', true);
    await engine.repo.put(h.owner, 'tool_access', {
      id: `tool-access:${h.owner}`,
      ownerId: h.owner,
      version: 1,
      enabled: true,
      tools: ['contacts_lookup'],
      updatedAt: new Date().toISOString(),
    });
    const gateway = new ApplicationToolGateway(engine, h.store);
    h.gateway.invoke.mockImplementation((context, name, args) =>
      gateway.invoke(context, name, args),
    );
    await h.live.create(h.owner, { sdp, requestId: randomUUID() }, `Bearer ${h.token}`);
    const socket = h.sockets[0];
    socket.receive(
      responseEvent('delegation', { type: 'response.created', response: { id: 'response' } }),
    );
    socket.receive(
      responseEvent(
        'delegation',
        callEvent(
          'call',
          'contacts_lookup',
          JSON.stringify({ query: '', limit: 1, ownerId: randomUUID() }),
        ),
      ),
    );
    socket.receive(
      responseEvent('delegation', {
        type: 'response.completed',
        response: { id: 'response', output: [] },
      }),
    );
    await vi.waitFor(() =>
      expect(socket.sent.some((event) => event.type === 'response.create')).toBe(true),
    );
    expect(
      JSON.parse(socket.sent.find((event) => event.type === 'response.item.create')!.item.output),
    ).toMatchObject({ status: 'blocked', reasonCode: 'invalid_arguments' });
    expect(await engine.repo.list(h.owner, 'mission')).toHaveLength(0);
  });
  it('returns a real gateway lookup and sanitized trace through the documented provider result envelope', async () => {
    const h = await fixture(),
      engine = new Engine(h.db, h.config);
    await seedOwner(engine.repo, h.owner, 'Fictional Lookup Owner', true);
    await engine.repo.put(h.owner, 'tool_access', {
      id: `tool-access:${h.owner}`,
      ownerId: h.owner,
      version: 1,
      enabled: true,
      tools: ['contacts_lookup'],
      updatedAt: new Date().toISOString(),
    });
    const gateway = new ApplicationToolGateway(engine, h.store);
    h.gateway.invoke.mockImplementation((context, name, args) =>
      gateway.invoke(context, name, args),
    );
    await h.live.create(h.owner, { sdp, requestId: randomUUID() }, `Bearer ${h.token}`);
    const socket = h.sockets[0];
    socket.receive(
      responseEvent('delegation', { type: 'response.created', response: { id: 'response' } }),
    );
    socket.receive(responseEvent('delegation', callEvent('call')));
    socket.receive(
      responseEvent('delegation', {
        type: 'response.completed',
        response: { id: 'response', output: [] },
      }),
    );
    await vi.waitFor(() =>
      expect(socket.sent.some((event) => event.type === 'response.create')).toBe(true),
    );
    const result = JSON.parse(
      socket.sent.find((event) => event.type === 'response.item.create')!.item.output,
    );
    expect(result).toMatchObject({
      toolName: 'contacts_lookup',
      status: 'succeeded',
      data: { untrusted: true },
      spokenDeliveryConfirmed: false,
    });
    expect(result.data.contacts).toHaveLength(1);
    const traces = await gateway.traces(h.owner);
    expect(
      traces.some(
        (trace) => trace.toolName === 'contacts_lookup' && trace.event === 'tool_succeeded',
      ),
    ).toBe(true);
    expect(JSON.stringify(traces)).not.toContain(h.token);
    expect(await engine.repo.list(h.owner, 'mission')).toHaveLength(0);
  });
  it('lists only the authenticated owner recovery receipts without new provider work', async () => {
    const h = await fixture(),
      requestId = randomUUID();
    await h.live.create(h.owner, { sdp, requestId }, `Bearer ${h.token}`);
    const before = h.fetcher.mock.calls.length;
    const recovery = await h.live.readRecovery(h.owner);
    expect(recovery.requests).toHaveLength(1);
    expect(recovery.requests[0]).toMatchObject({ requestId, status: 'active' });
    expect(await h.live.readRecovery(randomUUID())).toEqual({ requests: [] });
    expect(h.fetcher).toHaveBeenCalledTimes(before);
    expect(JSON.stringify(recovery)).not.toContain(h.token);
  });
});
