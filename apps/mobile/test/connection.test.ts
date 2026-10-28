import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeApiUrl } from '../src/connection';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => storage.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { storage.set(key, value); },
  deleteItemAsync: async (key: string) => { storage.delete(key); },
}));

beforeEach(() => { vi.resetModules(); storage.clear(); vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://one.example'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('iPhone backend connection safety', () => {
  it('requires explicit private-LAN HTTP and rejects credentials, public HTTP and physical-device loopback', () => {
    expect(normalizeApiUrl(' https://agent.example.com/ ')).toBe('https://agent.example.com');
    expect(normalizeApiUrl('http://192.168.1.20:4000', { allowLocalHttp: true, physicalDevice: true })).toBe('http://192.168.1.20:4000');
    for (const value of ['http://agent.example.com', 'https://password@example.com', 'https://agent.example.com?token=secret', 'https://agent.example.com/api', 'http://localhost:4000']) {
      expect(() => normalizeApiUrl(value, { allowLocalHttp: true, physicalDevice: true }), value).toThrow();
    }
    expect(() => normalizeApiUrl('http://192.168.1.20:4000')).toThrow();
  });

  it('clears the old-server session before any request to a newly selected origin', async () => {
    const service = await import('../src/api');
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })); vi.stubGlobal('fetch', fetcher);
    await service.setSession('old-server-token');
    await service.changeApiUrl('https://two.example', false);
    await service.api('/logout', 'POST');
    expect((fetcher.mock.calls[0] as any)[0]).toBe('https://two.example/logout');
    expect((fetcher.mock.calls[0] as any)[1].headers).not.toHaveProperty('Authorization');
    expect(storage.has('personal-agent-session-v2')).toBe(false);
    expect(JSON.parse(storage.get('personal-agent-connection')!).url).toBe('https://two.example');
  });

  it('does not restore a token bound to a different origin and never authenticates health probes', async () => {
    storage.set('personal-agent-session-v2', JSON.stringify({ url: 'https://other.example', token: 'wrong-origin-token' }));
    storage.set('personal-agent-session', 'legacy-unbound-token');
    const service = await import('../src/api');
    expect(await service.restoreSession()).toBeNull();
    expect(storage.has('personal-agent-session')).toBe(false);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: 'ok', mode: 'simulator' }), { status: 200 })); vi.stubGlobal('fetch', fetcher);
    await service.setSession('current-token'); await service.checkConnection();
    expect((fetcher.mock.calls[0] as any)[1].headers).toEqual({ Accept: 'application/json' });
  });

  it('discards an in-flight response from the previous server after a connection change', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const service = await import('../src/api'); await service.setSession('old-server-token');
    const pending = service.api('/bootstrap');
    await service.changeApiUrl('https://two.example', false);
    finish(new Response(JSON.stringify({ private: 'old account data' }), { status: 200 }));
    await expect(pending).rejects.toThrow('server connection changed');
  });
});
