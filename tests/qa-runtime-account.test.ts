import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import { getConfig } from '../apps/server/src/config.js';
import { Database } from '../apps/server/src/db.js';
import { LiveSessionStore } from '../apps/server/src/live-session-store.js';

const fixtureConfig = () => ({
  ...getConfig(),
  production: false,
  demoEnabled: true,
  provider: 'simulator' as const,
  liveEnabled: false,
  recipients: [],
  databaseUrl: undefined,
  dataDir: 'memory://',
  key: undefined,
  openaiKey: undefined,
  elevenKey: undefined,
  agentId: undefined,
  phoneId: undefined,
  ownerAgentId: undefined,
  twilioSid: undefined,
  twilioToken: undefined,
  embeddedWorker: false,
  port: 4000,
  origins: ['http://localhost:4000'],
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const credentials = {
  email: 'qa-runtime-owner@example.invalid',
  name: 'Fictional QA Runtime Owner',
  password: 'Fictional QA runtime password 123',
};

describe('independent DATA-01 / VOICE-04 account-runtime adversaries', () => {
  it('rechecks a no-ID Live receipt inserted after deletion preflight before tombstoning', async () => {
    const db = await new Database({ dataDir: 'memory://' }).open();
    const store = new LiveSessionStore(db);
    const service = await createApp({
      db,
      config: fixtureConfig(),
      worker: false,
      openaiLiveDependencies: { store },
    });
    const entered = deferred(),
      resume = deferred();
    try {
      const owner = (
        await service.app.inject({ method: 'POST', url: '/auth/register', payload: credentials })
      ).json();
      const list = service.repo.list.bind(service.repo);
      let held = false;
      vi.spyOn(service.repo, 'list').mockImplementation(
        async (...args: Parameters<typeof service.repo.list>) => {
          if (!held && args[0] === owner.user.id && args[1] === 'mission') {
            held = true;
            entered.resolve();
            await resume.promise;
          }
          return list(...args);
        },
      );
      const deleting = service.app
        .inject({
          method: 'DELETE',
          url: '/account',
          headers: { authorization: `Bearer ${owner.token}` },
        })
        .then((result) => result);
      await entered.promise;
      const requestId = randomUUID();
      const reservation = await store.reserve(owner.user.id, requestId);
      resume.resolve();
      const result = await deleting;
      expect(result.statusCode).toBe(409);
      expect(result.json().error).toBe('voice_termination_pending');
      expect(
        (await db.query('SELECT deleted_at FROM users WHERE id=$1', [owner.user.id]))[0].deleted_at,
      ).toBeNull();
      expect((await store.getByRequest(owner.user.id, requestId))?.id).toBe(reservation.receipt.id);
      expect(
        (
          await service.app.inject({
            url: '/profile',
            headers: { authorization: `Bearer ${owner.token}` },
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      resume.resolve();
      vi.restoreAllMocks();
      await service.app.close();
      await db.close();
    }
  });

  it('recovers the same unknown 5xx start after logout, reauthentication and broker reconstruction without another dispatch', async () => {
    const db = await new Database({ dataDir: 'memory://' }).open();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('fictional-private-provider-body', { status: 503 }));
    const config = { ...fixtureConfig(), openaiKey: 'fictional-test-only-key' };
    let service = await createApp({
      db,
      config,
      worker: false,
      openaiLiveDependencies: { fetch: fetcher },
    });
    const local = { host: 'localhost:4000', origin: 'http://localhost:4000' };
    try {
      const account = (
        await service.app.inject({ method: 'POST', url: '/auth/register', payload: credentials })
      ).json();
      const headers = { ...local, authorization: `Bearer ${account.token}` };
      const requestId = randomUUID(),
        sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
      const first = await service.app.inject({
        method: 'POST',
        url: '/voice/live/session',
        headers,
        payload: { requestId, sdp },
      });
      expect(first.statusCode).toBe(502);
      expect(first.json().error).toBe('openai_creation_unconfirmed');
      expect(first.body).not.toContain('fictional-private-provider-body');
      expect(fetcher).toHaveBeenCalledTimes(1);
      const logout = await service.app.inject({
        method: 'POST',
        url: '/logout',
        headers,
        payload: {},
      });
      expect(logout.json()).toMatchObject({ ok: true, voiceCleanup: { pending: true } });
      await service.app.close();
      service = await createApp({
        db,
        config,
        worker: false,
        openaiLiveDependencies: { fetch: fetcher },
      });
      const login = (
        await service.app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: credentials.email, password: credentials.password },
        })
      ).json();
      const current = { ...local, authorization: `Bearer ${login.token}` };
      expect(
        (await service.app.inject({ url: `/voice/live/requests/${requestId}`, headers }))
          .statusCode,
      ).toBe(401);
      const recovered = await service.app.inject({
        url: `/voice/live/requests/${requestId}`,
        headers: current,
      });
      expect(recovered.statusCode).toBe(200);
      expect(recovered.json()).toMatchObject({ requestId, status: 'unconfirmed' });
      expect(recovered.json()).not.toHaveProperty('sessionId');
      const other = (
        await service.app.inject({
          method: 'POST',
          url: '/auth/register',
          payload: { ...credentials, email: 'qa-runtime-other@example.invalid' },
        })
      ).json();
      expect(
        (
          await service.app.inject({
            url: `/voice/live/requests/${requestId}`,
            headers: { ...local, authorization: `Bearer ${other.token}` },
          })
        ).statusCode,
      ).toBe(404);
      const repeated = await service.app.inject({
        method: 'POST',
        url: '/voice/live/session',
        headers: current,
        payload: { requestId, sdp },
      });
      expect(repeated.statusCode).toBe(409);
      expect(repeated.json().error).toBe('voice_request_exists');
      const replacement = await service.app.inject({
        method: 'POST',
        url: '/voice/live/session',
        headers: current,
        payload: { requestId: randomUUID(), sdp },
      });
      expect(replacement.statusCode).toBe(409);
      expect(replacement.json().error).toBe('voice_session_unresolved');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(recovered.json())).not.toContain('fictional-test-only-key');
    } finally {
      await service.app.close();
      await db.close();
    }
  });
});
