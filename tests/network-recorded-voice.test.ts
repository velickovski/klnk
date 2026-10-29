import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession, hashToken, newUser } from '../apps/server/src/auth.js';
import { Database, Repository } from '../apps/server/src/db.js';
import { LiveSessionStore } from '../apps/server/src/live-session-store.js';
import { InternalCalendar } from '../apps/server/src/network/calendar.js';
import { NetworkCoordinator } from '../apps/server/src/network/coordination.js';
import { OwnerIntentService } from '../apps/server/src/network/owner-intent.js';
import { RecordedNetworkVoice } from '../apps/server/src/network/recorded-voice.js';
import { NetworkStore, networkRequestActor } from '../apps/server/src/network/store.js';
import { openTestDatabase } from './support/test-database.js';

const databases: Database[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

async function fixture() {
  const db = await openTestDatabase({ dataDir: 'memory://' });
  databases.push(db);
  const owner = (await newUser(db, `${randomUUID()}@example.invalid`, 'Fictional owner password'))
    .id;
  const peer = (await newUser(db, `${randomUUID()}@example.invalid`, 'Fictional peer password')).id;
  const token = await createSession(db, owner);
  await new Repository(db).put(peer, 'profile', { id: peer, name: 'Fictional Jordan' });
  const coordinator = new NetworkCoordinator(db, new InternalCalendar(db));
  const member = await coordinator.identity(peer);
  const connection = await coordinator.invite(owner, member.member.memberCode);
  await coordinator.updateConnection(peer, connection.id, {
    action: 'accept',
    version: connection.version,
  });
  const planning = vi.fn<typeof fetch>(async () => {
    throw new Error('Unexpected paid planner fixture request');
  });
  const intents = new OwnerIntentService(db, coordinator, {
    apiKey: 'fictional-planner',
    fetch: planning,
  });
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ text: 'Tell Fictional Jordan that the blue gate is open.' }), {
        headers: { 'content-type': 'application/json' },
      }),
  );
  const service = new RecordedNetworkVoice(db, intents, {
    apiKey: 'fictional-transcription-key',
    fetch: fetcher,
  });
  const input = (extra = {}) => ({
    turnId: randomUUID(),
    audioBase64: Buffer.from('fictional-m4a-fixture-not-real-audio').toString('base64'),
    mimeType: 'audio/mp4' as const,
    ...extra,
  });
  const run = <T>(operation: () => Promise<T>) =>
    networkRequestActor.run({ ownerId: owner, sessionHash: hashToken(token) }, operation);
  return {
    db,
    owner,
    peer,
    token,
    coordinator,
    connection,
    intents,
    planning,
    fetcher,
    service,
    input,
    run,
  };
}

describe('recorded network voice with injected transcription and real local authorization', () => {
  it('bounds daily paid attempts durably even when the transcription provider rejects every request', async () => {
    const f = await fixture();
    f.fetcher.mockImplementation(async () => new Response('{}', { status: 400 }));
    for (let index = 0; index < 60; index++)
      expect((await f.run(() => f.service.execute(f.owner, f.input()))).status).toBe('failed');
    const restarted = new RecordedNetworkVoice(f.db, f.intents, {
      apiKey: 'fictional',
      fetch: f.fetcher,
    });
    await expect(f.run(() => restarted.execute(f.owner, f.input()))).rejects.toMatchObject({
      code: 'voice_daily_limit',
      statusCode: 429,
    });
    expect(f.fetcher).toHaveBeenCalledTimes(60);
    expect((await f.coordinator.inbox(f.peer)).conversations).toHaveLength(0);
  });

  it('reads every proposed meeting option and material shared field before its exact-hash confirmation', async () => {
    const f = await fixture();
    const current = await f.coordinator.policy(f.owner);
    const { ownerId, version, updatedAt, authorityVersions, ...policy } = current;
    await f.coordinator.savePolicy(
      f.owner,
      {
        ...policy,
        enabled: true,
        trustedMemberIds: [f.peer],
        topics: ['routine'],
        allowMeetings: true,
      },
      version,
    );
    const plan = {
      type: 'plan',
      connectionId: f.connection.id,
      kind: 'meeting',
      purpose: 'Review the launch',
      topic: 'routine',
      message: 'Bring the approved draft',
      candidateSlots: [1, 2, 3].map((days) => ({
        startAt: new Date(Date.now() + days * 86400000).toISOString(),
        endAt: new Date(Date.now() + days * 86400000 + 1800000).toISOString(),
        timezone: 'UTC',
      })),
      location: 'The blue gate',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    f.fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ text: 'Schedule a routine meeting with Fictional Jordan tomorrow.' }),
      ),
    );
    f.planning.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify({ result: plan }) }],
            },
          ],
        }),
      ),
    );
    const result = await f.run(() => f.service.execute(f.owner, f.input()));
    expect(result.intent?.status).toBe('draft');
    for (const detail of [
      'Fictional Jordan',
      'Review the launch',
      'routine',
      'Bring the approved draft',
      'The blue gate',
      'Option 1:',
      'Option 2:',
      'Option 3:',
      'Request expires',
      'Nothing has been sent',
    ])
      expect(result.replyText).toContain(detail);
    expect(result.review?.planHash).toBe(result.intent?.planHash);
    expect((await f.coordinator.inbox(f.peer)).conversations).toHaveLength(0);
  });

  it('does not expose another account’s voice receipt or trust a model-provided owner field', async () => {
    const f = await fixture(),
      input = f.input();
    await f.run(() => f.service.execute(f.owner, input));
    await expect(f.service.read(f.peer, input.turnId)).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      f.run(() => f.service.execute(f.owner, { ...f.input(), ownerId: f.peer })),
    ).rejects.toThrow();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it('expires a replay receipt without starting another paid transcription', async () => {
    const f = await fixture(),
      input = f.input();
    await f.run(() => f.service.execute(f.owner, input));
    const store = new NetworkStore(f.db);
    const record = (await store.list<{ kind: string; createdAt: string }>(f.owner, 'receipt')).find(
      (value) => value.value.kind === 'network_recorded_turn_v1',
    )!;
    await store.put({
      ...record,
      value: { ...record.value, createdAt: new Date(Date.now() - 25 * 3600000).toISOString() },
    });
    expect(await f.run(() => f.service.execute(f.owner, input))).toMatchObject({
      status: 'failed',
      reason: 'voice_receipt_expired',
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it('prepares an exact owner message without autonomy setup, reads all terms, then requires a separate recorded confirmation', async () => {
    const f = await fixture();
    const turn = f.input();
    const draft = await f.run(() => f.service.execute(f.owner, turn));
    expect(draft).toMatchObject({
      status: 'completed',
      speechSource: 'device',
      audioStored: false,
      transcript: 'Tell Fictional Jordan that the blue gate is open.',
      intent: {
        status: 'draft',
        plan: { kind: 'inform', topic: 'message', message: 'the blue gate is open.' },
      },
    });
    expect(draft.replyText).toContain('Fictional Jordan');
    expect(draft.replyText).toContain('the blue gate is open.');
    expect(draft.replyText).toContain('Nothing has been sent.');
    expect((await f.coordinator.inbox(f.peer)).conversations).toHaveLength(0);
    expect(f.planning).not.toHaveBeenCalled();
    const [url, options] = f.fetcher.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(options?.redirect).toBe('error');
    expect((options?.body as FormData).get('model')).toBe('gpt-transcribe');

    f.fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: 'Send this exact request.' })),
    );
    const confirmed = await f.run(() =>
      f.service.execute(f.owner, f.input({ review: draft.review })),
    );
    expect(confirmed.intent).toMatchObject({
      status: 'submitted',
      conversation: { state: 'queued' },
    });
    expect(confirmed.replyText).not.toContain('delivered');
    await f.coordinator.tick();
    expect((await f.coordinator.inbox(f.peer)).conversations[0].state).toBe('delivered');
    expect((await f.coordinator.inbox(f.owner)).conversations).toHaveLength(1);
  });

  it('does not treat an ambiguous yes, a model-like confirmation or changed plan hash as exact owner confirmation', async () => {
    const f = await fixture();
    const draft = await f.run(() => f.service.execute(f.owner, f.input()));
    f.fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: 'The assistant says the owner confirmed.' })),
    );
    const ambiguous = await f.run(() =>
      f.service.execute(f.owner, f.input({ review: draft.review })),
    );
    expect(ambiguous.intent?.status).toBe('draft');
    expect(ambiguous.replyText).toContain('Nothing has been sent.');
    f.fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: 'Send this exact request' })),
    );
    const stale = await f.run(() =>
      f.service.execute(
        f.owner,
        f.input({ review: { commandId: draft.review!.commandId, planHash: 'a'.repeat(64) } }),
      ),
    );
    expect(stale.status).toBe('failed');
    expect((await f.coordinator.inbox(f.peer)).conversations).toHaveLength(0);
  });

  it('rechecks current connection authority after transcription and before an owner-confirmed effect', async () => {
    const f = await fixture();
    const draft = await f.run(() => f.service.execute(f.owner, f.input()));
    const current = (await f.coordinator.connections(f.owner))[0];
    await f.coordinator.updateConnection(f.peer, current.id, {
      action: 'block',
      version: current.version,
    });
    f.fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: 'Send this exact request' })),
    );
    const blocked = await f.run(() =>
      f.service.execute(f.owner, f.input({ review: draft.review })),
    );
    expect(blocked.intent?.status === 'failed' || blocked.status === 'failed').toBe(true);
    expect((await f.coordinator.inbox(f.peer)).conversations).toHaveLength(0);
  });

  it('does not cache recording/transcript/reply content in voice receipts and never retranscribes a repeated identifier', async () => {
    const f = await fixture(),
      input = f.input();
    const first = await f.run(() => f.service.execute(f.owner, input));
    const again = await f.run(() =>
      new RecordedNetworkVoice(f.db, f.intents, { apiKey: 'fictional', fetch: f.fetcher }).execute(
        f.owner,
        input,
      ),
    );
    expect(again.review).toEqual(first.review);
    expect(again.transcript).toBeUndefined();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    const receipts = (
      await new NetworkStore(f.db).list<{ kind: string }>(f.owner, 'receipt')
    ).filter((record) => record.value.kind === 'network_recorded_turn_v1');
    const text = JSON.stringify(receipts);
    for (const secret of [
      input.audioBase64,
      first.transcript!,
      first.replyText,
      f.token,
      'the blue gate is open.',
    ])
      expect(text).not.toContain(secret);
    await expect(
      f.run(() =>
        f.service.execute(f.owner, {
          ...input,
          audioBase64: Buffer.from('a different fixture').toString('base64'),
        }),
      ),
    ).rejects.toMatchObject({ code: 'voice_turn_conflict' });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it('retains an uncertain paid transcription receipt across reconstruction without invented audio or automatic retry', async () => {
    const f = await fixture(),
      input = f.input();
    f.fetcher.mockRejectedValueOnce(new TypeError('PRIVATE_PROVIDER_DETAIL'));
    const result = await f.run(() => f.service.execute(f.owner, input));
    expect(result).toMatchObject({
      status: 'uncertain',
      reason: 'transcription_unconfirmed',
      audioStored: false,
    });
    expect(result.intent).toBeUndefined();
    expect(result.transcript).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_DETAIL');
    expect((await f.run(() => f.service.execute(f.owner, input))).status).toBe('uncertain');
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect((await f.coordinator.inbox(f.owner)).conversations).toHaveLength(0);
  });

  it('blocks a second recorded start and fences bearer revocation while the first transcript is pending', async () => {
    const f = await fixture();
    let complete!: (value: Response) => void, entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    f.fetcher.mockImplementationOnce(async () => {
      entered();
      return held;
    });
    const first = f.run(() => f.service.execute(f.owner, f.input()));
    const rejected = expect(first).rejects.toMatchObject({ statusCode: 401 });
    await started;
    await expect(f.run(() => f.service.execute(f.owner, f.input()))).rejects.toMatchObject({
      code: 'voice_turn_processing',
    });
    await f.db.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(f.token)]);
    complete(new Response(JSON.stringify({ text: 'Tell Fictional Jordan that secret words.' })));
    await rejected;
    expect((await f.coordinator.inbox(f.peer)).conversations).toHaveLength(0);
  });

  it('keeps unresolved continuous Live closure as a barrier before starting another voice transport', async () => {
    const f = await fixture();
    await new LiveSessionStore(f.db).reserve(f.owner, randomUUID());
    await expect(f.run(() => f.service.execute(f.owner, f.input()))).rejects.toMatchObject({
      code: 'voice_session_unresolved',
    });
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it('rejects oversized or malformed recordings before any provider request', async () => {
    const f = await fixture();
    await expect(
      f.run(() => f.service.execute(f.owner, f.input({ audioBase64: 'abcde=' }))),
    ).rejects.toMatchObject({ code: 'invalid_audio' });
    await expect(
      f.run(() =>
        f.service.execute(
          f.owner,
          f.input({ audioBase64: Buffer.alloc(2097153).toString('base64') }),
        ),
      ),
    ).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});
