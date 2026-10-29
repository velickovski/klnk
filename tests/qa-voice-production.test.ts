import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import { createSession, hashToken, newUser } from '../apps/server/src/auth.js';
import { getConfig } from '../apps/server/src/config.js';
import { type Database } from '../apps/server/src/db.js';
import { LiveSessionStore } from '../apps/server/src/live-session-store.js';
import { OpenAILive } from '../apps/server/src/openai-live.js';
import {
  BrowserLiveController,
  type LiveEnvironment,
} from '../apps/mobile/src/features/live/browser-live.js';
import { openTestDatabase } from './support/test-database.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const origin = 'https://app.example.invalid';
const config = () => ({
  ...getConfig(),
  production: true,
  demoEnabled: false,
  legacyEnabled: false,
  openaiKey: 'fictional-server-key',
  origins: [origin],
  trustProxy: ['127.0.0.1'],
  mailEnabled: false,
  publicAppUrl: origin,
});
async function members(db: Database) {
  const owner = (await newUser(db, `${randomUUID()}@example.invalid`, 'Fictional owner password'))
    .id;
  const peer = (await newUser(db, `${randomUUID()}@example.invalid`, 'Fictional peer password')).id;
  await db.query('UPDATE users SET email_verified_at=clock_timestamp() WHERE id=ANY($1::text[])', [
    [owner, peer],
  ]);
  return {
    owner,
    peer,
    token: await createSession(db, owner),
    peerToken: await createSession(db, peer),
  };
}
async function fixture() {
  const db = await openTestDatabase();
  const provider = vi.fn<typeof fetch>(
    async () => new Response('private fictional provider rejection', { status: 400 }),
  );
  const service = await createApp({
    db,
    config: config(),
    worker: false,
    openaiLiveDependencies: { fetch: provider },
    recordedVoiceDependencies: { fetch: provider },
    networkIntentDependencies: {
      fetch: vi.fn(async () => {
        throw new Error('Unexpected planner access');
      }),
    },
  });
  cleanups.push(() => service.app.close());
  return { ...service, ...(await members(db)), provider };
}
const headers = (token?: string, extras: Record<string, string> = {}) => ({
  host: 'api.example.invalid',
  'x-forwarded-proto': 'https',
  origin,
  ...(token ? { authorization: `Bearer ${token}` } : {}),
  ...extras,
});
const turn = () => ({
  turnId: randomUUID(),
  audioBase64: Buffer.from('fictional recording, not audio').toString('base64'),
  mimeType: 'audio/mp4',
});

describe('independent production voice authority without audio hardware or provider access', () => {
  it('requires authenticated HTTPS and exact allowed origins on product voice status while legacy demos stay disabled', async () => {
    const f = await fixture();
    for (const path of ['/voice/live/status', '/network/voice/status']) {
      expect((await f.app.inject({ url: path, headers: headers() })).statusCode).toBe(401);
      expect(
        (
          await f.app.inject({
            url: path,
            headers: headers(f.token, { 'x-forwarded-proto': 'http' }),
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await f.app.inject({
            url: path,
            headers: headers(f.token, { origin: 'https://untrusted.example.invalid' }),
          })
        ).statusCode,
      ).toBe(403);
      const status = await f.app.inject({ url: path, headers: headers(f.token) });
      expect(status.statusCode).toBe(200);
      expect(status.headers['cache-control']).toBe('no-store');
      expect(status.body).not.toContain('fictional-server-key');
    }
    expect(
      (await f.app.inject({ url: '/demo/status', headers: headers(f.token) })).statusCode,
    ).toBe(404);
    expect(f.provider).not.toHaveBeenCalled();
  });

  it('counts rejected Live starts against the owner route budget, keeps canonical receipts private and never returns provider bodies', async () => {
    const f = await fixture();
    const requestId = randomUUID();
    for (let index = 0; index < 4; index++) {
      const response = await f.app.inject({
        method: 'POST',
        url: '/voice/live/session',
        headers: headers(f.token),
        payload: { requestId: index === 0 ? requestId : randomUUID(), sdp },
      });
      expect(response.statusCode).toBe(502);
      expect(response.body).not.toContain('private fictional');
      expect(response.body).not.toContain('fictional-server-key');
    }
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/voice/live/session',
          headers: headers(f.token),
          payload: { requestId: randomUUID(), sdp },
        })
      ).statusCode,
    ).toBe(429);
    expect(f.provider).toHaveBeenCalledTimes(4);
    const own = await f.app.inject({
      url: `/voice/live/requests/${requestId}`,
      headers: headers(f.token),
    });
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({ requestId, status: 'rejected' });
    expect(
      (
        await f.app.inject({
          url: `/voice/live/requests/${requestId}`,
          headers: headers(f.peerToken),
        })
      ).statusCode,
    ).toBe(404);
    expect(f.provider).toHaveBeenCalledTimes(4);
  });

  it('fences foreign, idle and expired bearer hashes before reserving or paying for a Live start', async () => {
    const db = await openTestDatabase();
    const f = await members(db),
      provider = vi.fn<typeof fetch>();
    const live = new OpenAILive(config(), { store: new LiveSessionStore(db), fetch: provider });
    cleanups.push(
      () => db.close(),
      () => live.dispose(),
    );
    for (const mode of ['foreign', 'idle', 'expired', 'missing'] as const) {
      await db.query(
        "UPDATE sessions SET last_used_at=clock_timestamp(),expires_at=clock_timestamp()+interval '1 day' WHERE owner_id=$1",
        [f.owner],
      );
      if (mode === 'idle')
        await db.query(
          "UPDATE sessions SET last_used_at=clock_timestamp()-interval '31 minutes' WHERE owner_id=$1",
          [f.owner],
        );
      if (mode === 'expired')
        await db.query(
          "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE owner_id=$1",
          [f.owner],
        );
      await expect(
        live.create(
          f.owner,
          { requestId: randomUUID(), sdp },
          mode === 'missing' ? undefined : `Bearer ${mode === 'foreign' ? f.peerToken : f.token}`,
        ),
      ).rejects.toMatchObject({ statusCode: 401 });
    }
    expect(await db.query('SELECT id FROM live_sessions')).toEqual([]);
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects an idle bearer on both voice transports and cannot read another owner recorded turn', async () => {
    const f = await fixture(),
      input = turn();
    const first = await f.app.inject({
      method: 'POST',
      url: '/network/voice/turn',
      headers: headers(f.token),
      payload: input,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      turnId: input.turnId,
      status: 'failed',
      audioStored: false,
    });
    expect(
      (
        await f.app.inject({
          url: `/network/voice/turns/${input.turnId}`,
          headers: headers(f.peerToken),
        })
      ).statusCode,
    ).toBe(404);
    await f.db.query(
      "UPDATE sessions SET last_used_at=clock_timestamp()-interval '31 minutes' WHERE token_hash=$1",
      [hashToken(f.token)],
    );
    for (const path of [
      '/voice/live/status',
      '/network/voice/status',
      `/network/voice/turns/${input.turnId}`,
    ])
      expect((await f.app.inject({ url: path, headers: headers(f.token) })).statusCode).toBe(401);
    expect(f.provider).toHaveBeenCalledTimes(1);
  });

  it('bounds recorded HTTP attempts and rejects unsafe transports before paid transcription', async () => {
    const f = await fixture();
    const unsafeHeaders: Record<string, string>[] = [
      { 'x-forwarded-proto': 'http' },
      { origin: 'null' },
    ];
    for (const extras of unsafeHeaders) {
      const result = await f.app.inject({
        method: 'POST',
        url: '/network/voice/turn',
        headers: headers(f.token, extras),
        payload: turn(),
      });
      expect(result.statusCode).toBe(403);
      expect(result.json().error).toBe(extras.origin ? 'origin_not_allowed' : 'https_required');
    }
    expect(f.provider).not.toHaveBeenCalled();
  });

  it('rechecks the exact bearer idle bound after a paid transcription returns, before creating an owner intent', async () => {
    const f = await fixture();
    let deliver!: (response: Response) => void;
    f.provider.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const pending = f.app.inject({
      method: 'POST',
      url: '/network/voice/turn',
      headers: headers(f.token),
      payload: turn(),
    });
    const finished = pending.then((response) => response);
    await vi.waitFor(() => expect(f.provider).toHaveBeenCalledTimes(1));
    await f.db.query(
      "UPDATE sessions SET last_used_at=clock_timestamp()-interval '31 minutes' WHERE token_hash=$1",
      [hashToken(f.token)],
    );
    deliver(
      new Response(JSON.stringify({ text: 'Tell Fictional Jordan that the fountain is nearby.' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect((await finished).statusCode).toBe(401);
    const receipts = await f.db.query<{ payload: string }>(
      "SELECT payload FROM network_records WHERE kind='receipt' AND owner_a=$1",
      [f.owner],
    );
    expect(receipts.map((row) => f.db.decrypt<{ kind: string }>(row.payload).kind)).toEqual([
      'network_recorded_turn_v1',
    ]);
    expect(await f.db.query("SELECT id FROM network_records WHERE kind='conversation'")).toEqual(
      [],
    );
    expect(f.provider).toHaveBeenCalledTimes(1);
  });

  it('bounds recorded HTTP attempts without counting receipt reads as new paid starts', async () => {
    const f = await fixture();
    for (let index = 0; index < 6; index++)
      expect(
        (
          await f.app.inject({
            method: 'POST',
            url: '/network/voice/turn',
            headers: headers(f.token),
            payload: turn(),
          })
        ).statusCode,
      ).toBe(200);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/network/voice/turn',
          headers: headers(f.token),
          payload: turn(),
        })
      ).statusCode,
    ).toBe(429);
    expect(f.provider).toHaveBeenCalledTimes(6);
  });

  it('keeps signed-out browser start entirely before microphone, identity creation and paid network work', async () => {
    const capture = vi.fn(),
      request = vi.fn(),
      fetcher = vi.fn(),
      saveToken = vi.fn();
    const controller = new BrowserLiveController({
      supported: true,
      capture,
      request,
      fetcher,
      saveToken,
      identity: () => ({ generation: 1, url: 'https://api.example.invalid', token: null }),
      connection: () => ({ address: 'https://api.example.invalid' }),
      peer: vi.fn(),
      audio: vi.fn(),
    } as LiveEnvironment);
    await controller.start();
    expect(controller.getSnapshot()).toMatchObject({ state: 'error', closureUnconfirmed: false });
    expect(controller.getSnapshot().error).toMatch(/sign in/i);
    for (const fn of [capture, request, fetcher, saveToken]) expect(fn).not.toHaveBeenCalled();
    await controller.dispose();
  });
});
