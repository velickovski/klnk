import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import { Database } from '../apps/server/src/db.js';
import { getConfig } from '../apps/server/src/config.js';
const services: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  for (const s of services.splice(0)) {
    await s.app.close();
    await s.db.close();
  }
});
async function fixture(prepare?: (app: Awaited<ReturnType<typeof createApp>>['app']) => void) {
  const db = await new Database({ dataDir: 'memory://' }).open();
  const s = await createApp({
    db,
    worker: false,
    config: {
      ...getConfig(),
      demoEnabled: true,
      production: false,
      provider: 'simulator',
      liveEnabled: false,
      openaiKey: 'fictional-configured-key',
      googleClientId: undefined,
      googleClientSecret: undefined,
      googleRedirectUri: undefined,
    },
  });
  services.push(s);
  prepare?.(s.app);
  const a = (await s.app.inject({ method: 'POST', url: '/auth/demo' })).json();
  return { ...s, a, headers: { authorization: `Bearer ${a.token}` } };
}
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
describe('explicit account permission for application voice tools', () => {
  it('a configured provider key leaves owner grants off, and the model cannot supply tenant or unknown permissions', async () => {
    const f = await fixture();
    const state = (await f.app.inject({ url: '/tools/access', headers: f.headers })).json();
    expect(state.grant).toMatchObject({ ownerId: f.a.user.id, enabled: false, tools: [] });
    expect(state.externalEffectsEnabled).toBe(false);
    for (const payload of [
      { enabled: true, tools: ['arbitrary_http'] },
      { enabled: true, tools: ['contacts_lookup'], ownerId: 'someone-else' },
      { enabled: true, tools: ['contacts_lookup', 'contacts_lookup'] },
    ])
      expect(
        (await f.app.inject({ method: 'PUT', url: '/tools/access', headers: f.headers, payload }))
          .statusCode,
      ).toBe(400);
    expect(
      (
        await f.app.inject({
          method: 'PUT',
          url: '/tools/access',
          payload: { enabled: true, tools: ['contacts_lookup'] },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await f.app.inject({ url: '/tools/access', headers: f.headers })).json().grant.enabled,
    ).toBe(false);
  });
  it('enabling and revoking a grant is owner-scoped and persisted, without performing any tool operation', async () => {
    const f = await fixture(),
      b = (await f.app.inject({ method: 'POST', url: '/auth/demo' })).json();
    const enabled = await f.app.inject({
      method: 'PUT',
      url: '/tools/access',
      headers: f.headers,
      payload: { enabled: true, tools: ['contacts_lookup', 'request_prepare'] },
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().grant.tools).toEqual(['contacts_lookup', 'request_prepare']);
    expect(
      (
        await f.app.inject({
          url: '/tools/access',
          headers: { authorization: `Bearer ${b.token}` },
        })
      ).json().grant.enabled,
    ).toBe(false);
    expect(
      (await f.app.inject({ url: '/tools/traces', headers: f.headers })).json().events,
    ).toEqual([]);
    expect(await f.repo.list(f.a.user.id, 'mission')).toHaveLength(0);
    expect(
      (
        await f.app.inject({
          method: 'PUT',
          url: '/tools/access',
          headers: f.headers,
          payload: { enabled: false, tools: ['contacts_lookup'] },
        })
      ).json().grant.enabled,
    ).toBe(false);
  });
  it('a permission request already past authentication cannot commit after logout revokes that session', async () => {
    const entered = deferred(),
      resume = deferred();
    const f = await fixture((app) =>
      app.addHook('preHandler', async (request) => {
        if (request.method === 'PUT' && request.url === '/tools/access') {
          entered.resolve();
          await resume.promise;
        }
      }),
    );
    const pending = f.app.inject({
      method: 'PUT',
      url: '/tools/access',
      headers: f.headers,
      payload: { enabled: true, tools: ['contacts_lookup'] },
    });
    await entered.promise;
    expect(
      (await f.app.inject({ method: 'POST', url: '/logout', headers: f.headers, payload: {} }))
        .statusCode,
    ).toBe(200);
    resume.resolve();
    expect((await pending).statusCode).toBe(401);
    expect(await f.repo.list(f.a.user.id, 'tool_access')).toEqual([]);
  });
});
