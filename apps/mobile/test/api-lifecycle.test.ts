import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEMO_PROFILE,
  DEMO_CONTACTS,
  DEMO_MEMORIES,
  MISSION_TEMPLATES,
  MissionSchema,
} from '@personal-agent/domain';

const secure = vi.hoisted(() => ({
  values: new Map<string, string>(),
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
  getItemAsync: secure.get,
  setItemAsync: secure.set,
  deleteItemAsync: secure.remove,
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const bootstrap = () => ({
  profile: { ...DEMO_PROFILE },
  contacts: DEMO_CONTACTS,
  memories: DEMO_MEMORIES,
  missions: [],
  templates: MISSION_TEMPLATES,
  capabilities: { liveTranscript: true },
  mode: 'simulator',
  limits: { dailyAttempts: 5, maxDurationSeconds: 600, maxRetries: 2 },
  integrations: [],
});
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://one.example');
  secure.values.clear();
  secure.get.mockReset().mockImplementation(async (key: string) => secure.values.get(key) ?? null);
  secure.set.mockReset().mockImplementation(async (key: string, value: string) => {
    secure.values.set(key, value);
  });
  secure.remove.mockReset().mockImplementation(async (key: string) => {
    secure.values.delete(key);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('AUTH-01 / NET-02 account response lifetime', () => {
  it.each([200, 401])('rejects late owner A %s without changing owner B', async (status) => {
    const service = await import('../src/api');
    await service.setSession('owner-A');
    const request = deferred<Response>();
    const fetcher = vi.fn(() => request.promise);
    vi.stubGlobal('fetch', fetcher);
    const result = service.api('/bootstrap');
    const rejected = expect(result).rejects.toMatchObject({ code: 'session_changed' });
    await service.setSession(null);
    await service.setSession('owner-B');
    expect((fetcher.mock.calls[0] as any)[1].signal.aborted).toBe(true);
    request.resolve(response(status === 200 ? bootstrap() : { error: 'unauthorized' }, status));
    await rejected;
    expect(service.getSessionSnapshot().token).toBe('owner-B');
  });
  it('checks identity again after asynchronous body decoding', async () => {
    const service = await import('../src/api');
    await service.setSession('owner-A');
    const body = deferred<unknown>();
    const started = deferred<void>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: () => {
          started.resolve();
          return body.promise;
        },
      })),
    );
    const pending = service.api('/bootstrap');
    const rejected = expect(pending).rejects.toMatchObject({ code: 'session_changed' });
    await started.promise;
    await service.setSession('owner-B');
    body.resolve(bootstrap());
    await rejected;
    expect(service.getSessionSnapshot().token).toBe('owner-B');
  });
  it('revokes the active credential on its own 401', async () => {
    const service = await import('../src/api');
    await service.setSession('expired-owner');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ error: 'unauthorized', message: 'Sign in again.' }, 401)),
    );
    await expect(service.api('/bootstrap')).rejects.toMatchObject({ status: 401 });
    expect(service.getSessionSnapshot().token).toBeNull();
  });
  it('rejects a sign-in response if another identity was selected while it was pending', async () => {
    const service = await import('../src/api');
    const request = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => request.promise),
    );
    const pending = service.api('/auth/login', 'POST', {});
    const rejected = expect(pending).rejects.toMatchObject({ code: 'session_changed' });
    await service.setSession('owner-B');
    request.resolve(response({ token: 'owner-A', user: { id: 'A', email: 'a@example.invalid' } }));
    await rejected;
  });
});

describe('AUTH-02 / AUTH-03 secure storage', () => {
  it('binds bearer and revocation tombstone writes to unlocked device-only storage', async () => {
    const client = await import('../src/api');
    await client.setSession('private-fixture-token');
    expect(secure.set).toHaveBeenCalledWith(
      'personal-agent-session-v2',
      JSON.stringify({ url: 'https://one.example', token: 'private-fixture-token' }),
      { keychainAccessible: 7 },
    );
    await client.setSession(null);
    expect(secure.set).toHaveBeenCalledWith(
      'personal-agent-session-v2',
      JSON.stringify({ url: 'https://one.example', token: null }),
      { keychainAccessible: 7 },
    );
  });
  it('does not restore a late persisted account over a new sign-in', async () => {
    const service = await import('../src/api');
    const read = deferred<string | null>();
    const started = deferred<void>();
    secure.get.mockImplementationOnce(() => {
      started.resolve();
      return read.promise;
    });
    const restoring = service.restoreSession();
    const rejected = expect(restoring).rejects.toMatchObject({ code: 'session_changed' });
    await started.promise;
    const signing = service.setSession('owner-B');
    read.resolve(null);
    await rejected;
    await signing;
    expect(service.getSessionSnapshot().token).toBe('owner-B');
  });
  it('a failed late restore cannot invalidate a new sign-in', async () => {
    const service = await import('../src/api');
    const read = deferred<string | null>();
    const started = deferred<void>();
    secure.get.mockImplementationOnce(() => {
      started.resolve();
      return read.promise;
    });
    const restoring = service.restoreSession();
    const rejected = expect(restoring).rejects.toMatchObject({ code: 'session_changed' });
    await started.promise;
    const signing = service.setSession('owner-B');
    read.reject(new Error('storage denied'));
    await rejected;
    await signing;
    expect(service.getSessionSnapshot().token).toBe('owner-B');
  });
  it('serializes a delayed save followed by logout so the saved account cannot return', async () => {
    const service = await import('../src/api');
    const write = deferred<void>();
    const started = deferred<void>();
    secure.set.mockImplementationOnce(async (key: string, value: string) => {
      started.resolve();
      await write.promise;
      secure.values.set(key, value);
    });
    const signing = service.setSession('owner-A');
    const rejected = expect(signing).rejects.toMatchObject({ code: 'session_changed' });
    await started.promise;
    const logout = service.setSession(null);
    write.resolve();
    await rejected;
    await logout;
    expect(secure.values.has('personal-agent-session-v2')).toBe(false);
    expect(service.getSessionSnapshot().token).toBeNull();
  });
  it('fails closed when a credential write fails', async () => {
    const service = await import('../src/api');
    secure.set.mockRejectedValueOnce(new Error('sensitive platform error'));
    await expect(service.setSession('owner-A')).rejects.toMatchObject({
      code: 'secure_storage_failed',
    });
    expect(service.getSessionSnapshot().token).toBeNull();
    expect(secure.values.has('personal-agent-session-v2')).toBe(false);
    await expect(service.restoreSession()).rejects.toMatchObject({ code: 'secure_storage_failed' });
  });
  it('persists a logout tombstone even when secure deletion fails', async () => {
    const service = await import('../src/api');
    await service.setSession('owner-A');
    secure.remove.mockRejectedValue(new Error('delete denied'));
    await expect(service.setSession(null)).rejects.toMatchObject({ code: 'secure_storage_failed' });
    expect(JSON.parse(secure.values.get('personal-agent-session-v2')!).token).toBeNull();
    expect(service.getSessionSnapshot().token).toBeNull();
    secure.remove.mockImplementation(async (key: string) => {
      secure.values.delete(key);
    });
    vi.resetModules();
    const restarted = await import('../src/api');
    expect(await restarted.restoreSession()).toBeNull();
  });
  it.each([
    '{',
    JSON.stringify({ url: 'https://one.example', token: 2 }),
    JSON.stringify({ url: 'https://other.example', token: 'owner-A' }),
    JSON.stringify({ url: 'https://one.example', token: '' }),
  ])('rejects malformed or origin-mismatched stored identity %s', async (stored) => {
    secure.values.set('personal-agent-session-v2', stored);
    const service = await import('../src/api');
    await service.restoreSession().catch(() => undefined);
    expect(service.getSessionSnapshot().token).toBeNull();
  });
  it('reports secure read failure without exposing platform error details', async () => {
    const service = await import('../src/api');
    secure.get.mockRejectedValueOnce(new Error('sensitive-platform-detail'));
    await expect(service.restoreSession()).rejects.toThrow('Secure sign-in storage is unavailable');
    expect(service.getSessionSnapshot().token).toBeNull();
  });
});

describe('NET-01 success validation and errors', () => {
  it.each([
    '/auth/login',
    '/bootstrap',
    '/missions/fictional',
    '/voice/turn',
    '/voice/live/session',
    '/health',
  ])('rejects wrong-shaped 200 at %s', async (route) => {
    const service = await import('../src/api');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({})),
    );
    await expect(service.api(route)).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('rejects invalid JSON 200 with a receipt-aware error', async () => {
    const service = await import('../src/api');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>wrong server</html>', { status: 200 })),
    );
    await expect(service.api('/voice/turn', 'POST')).rejects.toMatchObject({
      code: 'invalid_response',
      status: 502,
    });
  });
  it('rejects missing fields that the domain input schema would otherwise default', async () => {
    const service = await import('../src/api');
    const fixture = bootstrap();
    delete (fixture.profile as Partial<typeof fixture.profile>).timezone;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(fixture)),
    );
    await expect(service.api('/bootstrap')).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('accepts actual fixture contracts and preserves extension fields without defaulting them', async () => {
    const service = await import('../src/api');
    const fixture = bootstrap();
    const mission = MissionSchema.parse({
      ...MISSION_TEMPLATES[0].input,
      id: 'm',
      ownerId: 'demo-owner',
      createdAt: '2026-10-27',
      updatedAt: '2026-10-27',
    });
    const fixtures = [
      fixture,
      { ...mission, reviewVersion: 4, attempts: [], actions: [], transcript: [], demo: true },
      { token: 'owner-A', user: { id: 'A', email: 'a@example.invalid' } },
      {
        sessionId: 's',
        turnId: 't',
        text: 'Fictional reply',
        transcript: 'Hello',
        status: 'reply',
        needsReply: false,
        mode: 'simulator',
        voiceMode: 'device',
      },
      {
        session: { id: 's' },
        transport: { type: 'webrtc', sdp: 'fictional-sdp' },
        maxDurationSeconds: 300,
      },
    ];
    const routes = [
      '/bootstrap',
      '/missions/m',
      '/auth/login',
      '/voice/turn',
      '/voice/live/session',
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(fixtures.shift())),
    );
    expect(await service.api(routes[0])).toEqual(fixture);
    expect((await service.api(routes[1])).reviewVersion).toBe(4);
    for (const route of routes.slice(2)) await expect(service.api(route)).resolves.toBeTruthy();
  });
  it.each([403, 404, 429, 500])(
    'preserves HTTP %s without retry or identity loss',
    async (status) => {
      const service = await import('../src/api');
      await service.setSession('owner-A');
      const fetcher = vi.fn(async () =>
        response(
          {
            message: 'Fictional failure',
            fields: [null, { path: 3 }, { path: 'name', message: 'Required' }],
          },
          status,
        ),
      );
      vi.stubGlobal('fetch', fetcher);
      await expect(service.api('/bootstrap')).rejects.toMatchObject({ status });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(service.getSessionSnapshot().token).toBe('owner-A');
    },
  );
  it('reports offline errors without automatically replaying a potentially accepted action', async () => {
    const service = await import('../src/api');
    const fetcher = vi.fn(async () => {
      throw new TypeError('offline');
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(service.api('/voice/turn', 'POST')).rejects.toThrow('Cannot reach your server');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('times out once and forbids credential-bearing redirects', async () => {
    vi.useFakeTimers();
    const service = await import('../src/api');
    await service.setSession('owner-A');
    const fetcher = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init.signal!.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          ),
        ),
    );
    vi.stubGlobal('fetch', fetcher);
    const pending = service.api('/bootstrap');
    const rejected = expect(pending).rejects.toThrow('taking longer than expected');
    await vi.advanceTimersByTimeAsync(20000);
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].redirect).toBe('error');
    expect(service.getSessionSnapshot().token).toBe('owner-A');
  });
});
