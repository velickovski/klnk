import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import { createSession, hashToken, newUser } from '../apps/server/src/auth.js';
import { getConfig } from '../apps/server/src/config.js';
import { Database } from '../apps/server/src/db.js';
import type { LiveSocket } from '../apps/server/src/openai-live.js';
import { openTestDatabase } from './support/test-database.js';

class FixtureSocket extends EventEmitter implements LiveSocket {
  readyState = 1;
  constructor() {
    super();
    queueMicrotask(() => {
      this.emit('open');
      this.emit('message', Buffer.from(JSON.stringify({ type: 'session.started' })));
    });
  }
  send(data: string) {
    if (JSON.parse(data).type === 'session.close')
      queueMicrotask(() =>
        this.emit(
          'message',
          Buffer.from(JSON.stringify({ type: 'session.closed', reason: 'fixture' })),
        ),
      );
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  terminate() {
    this.close();
  }
}
const applications: Awaited<ReturnType<typeof createApp>>[] = [];
const databases: Database[] = [];
afterEach(async () => {
  for (const built of applications.splice(0)) await built.app.close();
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

async function fixture() {
  const db = await openTestDatabase({ dataDir: 'memory://' });
  databases.push(db);
  const owner = (
    await newUser(db, `${randomUUID()}@example.invalid`, 'Fictional voice-owner password')
  ).id;
  // Explicit fictional verification fixture, not a registration/authentication bypass.
  await db.query('UPDATE users SET email_verified_at=clock_timestamp() WHERE id=$1', [owner]);
  const token = await createSession(db, owner);
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          session: { id: `fictional-live-${randomUUID()}` },
          transport: { type: 'webrtc', sdp: 'v=0\r\nm=audio fixture-answer' },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
  );
  const config = {
    ...getConfig({ NODE_ENV: 'test' }),
    production: true,
    demoEnabled: false,
    legacyEnabled: false,
    openaiKey: 'fictional-server-project-key',
    origins: ['https://app.example.invalid'],
    trustProxy: ['127.0.0.1/32'],
    embeddedWorker: false,
  };
  const built = await createApp({
    db,
    config,
    worker: false,
    openaiLiveDependencies: { fetch: fetcher, socket: () => new FixtureSocket() },
  });
  applications.push(built);
  const headers = {
    host: 'api.example.invalid',
    origin: 'https://app.example.invalid',
    authorization: `Bearer ${token}`,
    'x-forwarded-proto': 'https',
    'x-forwarded-for': '198.51.100.50',
  };
  const start = (patch = {}) =>
    built.app.inject({
      method: 'POST',
      url: '/voice/live/session',
      remoteAddress: '127.0.0.1',
      headers: { ...headers, ...patch },
      payload: { requestId: randomUUID(), sdp: 'v=0\r\nm=audio fixture-offer' },
    });
  return { ...built, owner, token, headers, fetcher, start };
}

describe('production-capable authenticated GPT-Live broker without a paid provider', () => {
  it('allows an HTTPS trusted-proxy owner session outside loopback demo mode and keeps the project key server-side', async () => {
    const f = await fixture();
    const readiness = await f.app.inject({ url: '/voice/live/status', headers: f.headers });
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json()).toMatchObject({ configured: true, model: 'gpt-live-1' });
    const result = await f.start();
    expect(result.statusCode).toBe(201);
    expect(result.json().maxDurationSeconds).toBeLessThanOrEqual(300);
    expect(result.body).not.toContain('fictional-server-project-key');
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.fetcher.mock.calls[0][0]).toBe('https://api.openai.com/v1/live/sessions');
    expect(f.fetcher.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer fictional-server-project-key',
    });
    const duplicate = await f.start();
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toBe('voice_session_unresolved');
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects plaintext production transport, hostile browser origins and missing owner authentication before any provider request', async () => {
    const f = await fixture();
    const plaintext = await f.start({ 'x-forwarded-proto': 'http' });
    expect(plaintext.statusCode).toBe(403);
    expect(plaintext.json().error).toBe('https_required');
    expect((await f.start({ origin: 'https://attacker.example.invalid' })).statusCode).toBe(403);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/voice/live/session',
          headers: { host: f.headers.host, origin: f.headers.origin, 'x-forwarded-proto': 'https' },
          payload: { requestId: randomUUID(), sdp: 'v=0\r\nm=audio fixture-offer' },
        })
      ).statusCode,
    ).toBe(401);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it('rechecks a revoked bearer in the owner-locked durable reservation before a paid session can start', async () => {
    const f = await fixture();
    await f.db.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(f.token)]);
    await expect(
      f.openaiLive.create(
        f.owner,
        { requestId: randomUUID(), sdp: 'v=0\r\nm=audio fixture-offer' },
        `Bearer ${f.token}`,
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(await f.db.query('SELECT id FROM live_sessions')).toEqual([]);
  });
});
