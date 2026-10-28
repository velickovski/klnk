import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../apps/server/src/db.js';
import { newUser } from '../apps/server/src/auth.js';
import { NetworkCoordinator } from '../apps/server/src/network/coordination.js';
import { InternalCalendar } from '../apps/server/src/network/calendar.js';
import { OwnerIntentService } from '../apps/server/src/network/owner-intent.js';
import type { NetworkPolicy, NetworkPolicyInput } from '../packages/domain/src/network.js';

const databases: Database[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) await db.close();
});
function input(p: NetworkPolicy): NetworkPolicyInput {
  const { ownerId, version, updatedAt, ...value } = p;
  return value;
}
async function fixture() {
  const db = await new Database({ dataDir: 'memory://' }).open();
  databases.push(db);
  const a = (await newUser(db, `${randomUUID()}@example.invalid`, 'Fictional password for owner'))
      .id,
    b = (await newUser(db, `${randomUUID()}@example.invalid`, 'Fictional password for peer')).id;
  const coordinator = new NetworkCoordinator(db, new InternalCalendar(db));
  await db.query("INSERT INTO resources(id,owner_id,kind,payload) VALUES($1,$1,'profile',$2)", [
    b,
    db.encrypt({ id: b, name: 'Fictional Jordan' }),
  ]);
  const peer = await coordinator.identity(b),
    connection = await coordinator.invite(a, peer.member.memberCode);
  await coordinator.updateConnection(b, connection.id, {
    action: 'accept',
    version: connection.version,
  });
  for (const [owner, other] of [
    [a, b],
    [b, a],
  ]) {
    const p = await coordinator.policy(owner);
    await coordinator.savePolicy(
      owner,
      {
        ...input(p),
        enabled: true,
        trustedMemberIds: [other],
        topics: ['routine'],
        allowMeetings: true,
        allowQuestions: true,
        autoAcceptMeetings: true,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        workStartMinute: 0,
        workEndMinute: 1440,
        minNoticeMinutes: 0,
      },
      p.version,
    );
  }
  const plan = {
    type: 'plan' as const,
    connectionId: connection.id,
    kind: 'meeting' as const,
    purpose: 'Fictional routine meeting',
    topic: 'routine',
    message: '',
    candidateSlots: [
      {
        startAt: new Date(Date.now() + 86400000).toISOString(),
        endAt: new Date(Date.now() + 88200000).toISOString(),
        timezone: 'UTC',
      },
    ],
    location: '',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: JSON.stringify({ result: plan }) }],
            },
          ],
        }),
        { status: 200 },
      ),
  );
  const service = new OwnerIntentService(db, coordinator, {
    apiKey: 'fictional-test-key',
    fetch: fetcher,
  });
  return { db, a, b, coordinator, connection, plan, fetcher, service };
}
describe('owner intent planning', () => {
  it('uses one bounded stateless Responses request with own context and submits only current permitted routine authority', async () => {
    const { a, b, service, fetcher, coordinator } = await fixture(),
      commandId = randomUUID(),
      text = 'Schedule a routine meeting with Fictional Jordan tomorrow.';
    const peerPolicy = await coordinator.policy(b);
    await coordinator.savePolicy(
      b,
      { ...input(peerPolicy), topics: ['routine', 'PEER_PRIVATE_POLICY_MARKER'] },
      peerPolicy.version,
    );
    await coordinator.saveMemory(b, {
      text: 'PEER_PRIVATE_MEMORY_MARKER',
      topic: 'routine',
      sharing: 'private',
      memberIds: [],
      confirmed: true,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    const result = await service.execute(a, { commandId, text });
    expect(result.status).toBe('submitted');
    expect(result.conversation?.state).toBe('queued');
    await coordinator.tick();
    expect((await service.read(a, commandId)).conversation?.state).toBe('agreed');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0],
      body = JSON.parse(String(options?.body));
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(options?.redirect).toBe('error');
    expect(body.model).toBe('gpt-6.1-sol');
    expect(body.store).toBe(false);
    expect(body.max_output_tokens).toBeLessThanOrEqual(2000);
    expect(body.tools).toEqual([]);
    expect(body.previous_response_id).toBeUndefined();
    expect(body.conversation).toBeUndefined();
    expect(body.text.format.strict).toBe(true);
    expect(JSON.stringify(body)).not.toContain('sharedMemoryIds');
    expect(JSON.stringify(body)).not.toContain('PEER_PRIVATE');
    expect((await service.execute(a, { commandId, text })).conversation?.id).toBe(
      result.conversation?.id,
    );
    await expect(
      service.execute(a, { commandId, text: 'Changed owner instructions' }),
    ).rejects.toMatchObject({ code: 'owner_intent_conflict' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(service.read(b, commandId)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('keeps plans as exact drafts when owner autonomy is off, and requires matching confirmation', async () => {
    const { a, service, coordinator } = await fixture(),
      p = await coordinator.policy(a);
    await coordinator.savePolicy(a, { ...input(p), autoAcceptMeetings: false }, p.version);
    const commandId = randomUUID(),
      result = await service.execute(a, {
        commandId,
        text: 'Schedule a routine meeting with Fictional Jordan tomorrow.',
      });
    expect(result.status).toBe('draft');
    expect((await coordinator.inbox(a)).conversations).toHaveLength(0);
    await expect(service.confirm(a, commandId, 'a'.repeat(64))).rejects.toMatchObject({
      code: 'owner_intent_stale_plan',
    });
    const confirmed = await service.confirm(a, commandId, result.planHash!);
    expect(confirmed.status).toBe('submitted');
    expect((await coordinator.inbox(a)).conversations).toHaveLength(1);
  });
  it('retains unknown paid starts across reconstruction and never automatically retries', async () => {
    const { db, a, coordinator } = await fixture(),
      fetcher = vi.fn<typeof fetch>(async () => {
        throw new Error('private provider details must not leak');
      }),
      commandId = randomUUID(),
      text = 'Schedule a routine meeting with Fictional Jordan tomorrow.';
    const service = new OwnerIntentService(db, coordinator, { apiKey: 'fixture', fetch: fetcher });
    expect((await service.execute(a, { commandId, text })).status).toBe('uncertain');
    const reconstructed = new OwnerIntentService(db, coordinator, {
        apiKey: 'fixture',
        fetch: fetcher,
      }),
      retry = await reconstructed.execute(a, { commandId, text });
    expect(retry.status).toBe('uncertain');
    expect(JSON.stringify(retry)).not.toContain('private provider');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await coordinator.inbox(a)).conversations).toHaveLength(0);
  });
  it('deduplicates concurrent planning and fences a policy change before any model effect', async () => {
    const { db, a, coordinator, plan } = await fixture();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((r) => (entered = r)),
      hold = new Promise<void>((r) => (release = r));
    const fetcher = vi.fn<typeof fetch>(async () => {
        entered();
        await hold;
        return new Response(
          JSON.stringify({
            status: 'completed',
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: JSON.stringify({ result: plan }) }],
              },
            ],
          }),
        );
      }),
      service = new OwnerIntentService(db, coordinator, { apiKey: 'fixture', fetch: fetcher }),
      command = {
        commandId: randomUUID(),
        text: 'Schedule a routine meeting with Fictional Jordan tomorrow.',
      };
    const pending = service.execute(a, command);
    await started;
    expect((await service.execute(a, command)).status).toBe('processing');
    const p = await coordinator.policy(a);
    await coordinator.savePolicy(a, { ...input(p), autoAcceptMeetings: false }, p.version);
    release();
    const result = await pending;
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('current_authority_denied');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await coordinator.inbox(a)).conversations).toHaveLength(0);
    expect((await service.execute(a, command)).status).toBe('failed');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['refusal', 'incomplete', 'malformed', 'foreign', 'tools'] as const)(
    'rejects %s model output without tools or fabricated effects',
    async (mode) => {
      const { db, a, coordinator, plan } = await fixture();
      let body: unknown = {
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify({ result: plan }) }],
          },
        ],
      };
      if (mode === 'refusal')
        body = {
          status: 'completed',
          output: [
            { type: 'message', content: [{ type: 'refusal', refusal: 'Private raw refusal' }] },
          ],
        };
      if (mode === 'incomplete') body = { status: 'incomplete', output: [] };
      if (mode === 'malformed')
        body = {
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'not json private response' }],
            },
          ],
        };
      if (mode === 'foreign')
        body = {
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({ result: { ...plan, connectionId: randomUUID() } }),
                },
              ],
            },
          ],
        };
      if (mode === 'tools')
        body = {
          status: 'completed',
          output: [
            { type: 'function_call', name: 'external_effect', arguments: 'private payload' },
          ],
        };
      const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body))),
        service = new OwnerIntentService(db, coordinator, { apiKey: 'fixture', fetch: fetcher }),
        command = {
          commandId: randomUUID(),
          text: 'Schedule a routine meeting with Fictional Jordan tomorrow.',
        };
      const result = await service.execute(a, command);
      expect(result.status).toBe('failed');
      expect((await coordinator.inbox(a)).conversations).toHaveLength(0);
      expect(JSON.stringify(result)).not.toContain('private');
      await service.execute(a, command);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it('delivers the exact locally recognized information without asking the model to rewrite authority', async () => {
    const { a, service, fetcher, coordinator } = await fixture(),
      text = 'Tell Fictional Jordan that I will meet you near the blue gate in ten minutes.',
      result = await service.execute(a, { commandId: randomUUID(), text });
    expect(result.status).toBe('submitted');
    expect(result.conversation?.request.kind).toBe('inform');
    expect(result.conversation?.request.message).toBe(
      'I will meet you near the blue gate in ten minutes.',
    );
    expect(fetcher).not.toHaveBeenCalled();
    await coordinator.tick();
    const detail = await coordinator.detail(a, result.conversation!.id);
    expect(detail.state).toBe('delivered');
    expect(detail.eventId).toBeUndefined();
  });
  it('keeps model-rewritten information as a draft and clarifies unknown recipients before paid planning', async () => {
    const { a, plan, fetcher, service, coordinator } = await fixture();
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    result: {
                      ...plan,
                      kind: 'inform',
                      candidateSlots: [],
                      message: 'A model rewrite that requires review.',
                    },
                  }),
                },
              ],
            },
          ],
        }),
      ),
    );
    const draft = await service.execute(a, {
      commandId: randomUUID(),
      text: 'Give Fictional Jordan a routine update about the blue gate.',
    });
    expect(draft.status).toBe('draft');
    expect((await coordinator.inbox(a)).conversations).toHaveLength(0);
    const unknown = await service.execute(a, {
      commandId: randomUUID(),
      text: 'Schedule with a guessed person tomorrow.',
    });
    expect(unknown.status).toBe('clarification');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('fails closed without a configured key and never uses the global transport in an injected test', async () => {
    const { db, a, coordinator } = await fixture(),
      transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        throw new Error('Unexpected global network');
      });
    const service = new OwnerIntentService(db, coordinator),
      result = await service.execute(a, {
        commandId: randomUUID(),
        text: 'Schedule a routine meeting with Fictional Jordan tomorrow.',
      });
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('model_unavailable');
    expect(transport).not.toHaveBeenCalled();
  });
  it('does not accept late model output after a durable unknown-result fence', async () => {
    const { db, a, coordinator, plan } = await fixture();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((r) => (entered = r)),
      hold = new Promise<void>((r) => (release = r)),
      clock = Date.now();
    const fetcher = vi.fn<typeof fetch>(async () => {
        entered();
        await hold;
        return new Response(
          JSON.stringify({
            status: 'completed',
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: JSON.stringify({ result: plan }) }],
              },
            ],
          }),
        );
      }),
      service = new OwnerIntentService(db, coordinator, { apiKey: 'fixture', fetch: fetcher }),
      command = {
        commandId: randomUUID(),
        text: 'Schedule a routine meeting with Fictional Jordan tomorrow.',
      };
    const pending = service.execute(a, command);
    await started;
    vi.spyOn(Date, 'now').mockReturnValue(clock + 40000);
    expect((await service.read(a, command.commandId)).status).toBe('uncertain');
    release();
    expect((await pending).status).toBe('uncertain');
    expect((await coordinator.inbox(a)).conversations).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rechecks the model authority snapshot inside the coordinator effect transaction', async () => {
    const { a, coordinator, service } = await fixture(),
      original = coordinator.submit.bind(coordinator);
    let paused = false;
    vi.spyOn(coordinator, 'submit').mockImplementation(async (owner, request, authority) => {
      if (!paused) {
        paused = true;
        const p = await coordinator.policy(a);
        await coordinator.savePolicy(a, { ...input(p), autoAcceptMeetings: false }, p.version);
      }
      return original(owner, request, authority);
    });
    const result = await service.execute(a, {
      commandId: randomUUID(),
      text: 'Schedule a routine meeting with Fictional Jordan tomorrow.',
    });
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('current_authority_denied');
    expect((await coordinator.inbox(a)).conversations).toHaveLength(0);
  });
  it.each(['2026-11-01 01:30', '2027-03-14 02:30'])(
    'clarifies repeated or nonexistent ISO local time %s before paid planning',
    async (local) => {
      const { a, coordinator, service, fetcher } = await fixture(),
        p = await coordinator.policy(a);
      await coordinator.savePolicy(a, { ...input(p), timezone: 'America/New_York' }, p.version);
      const result = await service.execute(a, {
        commandId: randomUUID(),
        text: `Schedule a routine meeting with Fictional Jordan on ${local} for 30 minutes.`,
      });
      expect(result.status).toBe('clarification');
      expect(result.reason).toBe('ambiguous_local_time');
      expect(fetcher).not.toHaveBeenCalled();
      expect((await coordinator.inbox(a)).conversations).toHaveLength(0);
    },
  );
});
