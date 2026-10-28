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
async function fixture(configured = false) {
  const db = await new Database({ dataDir: 'memory://' }).open();
  let requests = 0;
  const s = await createApp({
    db,
    worker: false,
    config: {
      ...getConfig(),
      provider: 'simulator',
      liveEnabled: false,
      openaiKey: undefined,
      demoEnabled: true,
      googleClientId: configured ? 'fictional-client' : undefined,
      googleClientSecret: configured ? 'fictional-secret' : undefined,
      googleRedirectUri: configured
        ? 'http://localhost:4000/integrations/google-calendar/callback'
        : undefined,
    },
    googleDependencies: {
      fetch: async () => {
        requests++;
        throw new Error('Unexpected network');
      },
    },
  });
  services.push(s);
  const auth = (await s.app.inject({ method: 'POST', url: '/auth/demo' })).json();
  return {
    ...s,
    auth,
    headers: { authorization: `Bearer ${auth.token}` },
    requests: () => requests,
  };
}
describe('sanitized authenticated Google routes', () => {
  it('a key or an adapter does not establish a service connection', async () => {
    const f = await fixture();
    expect((await f.app.inject({ url: '/integrations' })).statusCode).toBe(401);
    const status = (await f.app.inject({ url: '/integrations', headers: f.headers })).json();
    expect(status).toHaveLength(1);
    expect(status[0]).toMatchObject({
      status: 'unavailable',
      available: false,
      capabilities: { readExisting: false, updateExisting: false },
    });
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/integrations/google-calendar/connect',
          headers: f.headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(503);
    expect(f.requests()).toBe(0);
  });
  it('keeps PKCE, nonce, account subject and session/token state out of lists and exports', async () => {
    const f = await fixture(true);
    const started = await f.app.inject({
      method: 'POST',
      url: '/integrations/google-calendar/connect',
      headers: f.headers,
      payload: {},
    });
    expect(started.statusCode).toBe(200);
    const location = new URL(started.json().authorizationUrl);
    expect(location.origin).toBe('https://accounts.google.com');
    const state = location.searchParams.get('state')!;
    for (const url of ['/integrations', '/export']) {
      const response = await f.app.inject({ url, headers: f.headers });
      expect(response.headers['cache-control'] ?? 'no-store').toBe('no-store');
      expect(response.body).not.toContain(state);
      for (const secret of [
        'verifier',
        'sessionHash',
        'googleSubject',
        'accessToken',
        'refreshToken',
        'nonce',
      ])
        expect(response.body).not.toContain(secret);
    }
    expect(
      (
        await f.app.inject({
          url: '/integrations/google-calendar/callback?state=invalid&code=fictional',
        })
      ).statusCode,
    ).toBe(400);
    const declined = await f.app.inject({
      url: `/integrations/google-calendar/callback?state=${state}&error=access_denied`,
    });
    expect(declined.statusCode).toBe(200);
    expect(declined.json().reasonCode).toBe('oauth_denied');
    expect(declined.headers['referrer-policy']).toBe('no-referrer');
    expect(
      (
        await f.app.inject({
          url: `/integrations/google-calendar/callback?state=${state}&error=access_denied`,
        })
      ).statusCode,
    ).toBe(400);
    expect(f.requests()).toBe(0);
  });
  it('logout invalidates an initiating OAuth session and the callback does not authenticate arbitrary API paths', async () => {
    const f = await fixture(true);
    const begin = (
      await f.app.inject({
        method: 'POST',
        url: '/integrations/google-calendar/connect',
        headers: f.headers,
        payload: {},
      })
    ).json();
    const state = new URL(begin.authorizationUrl).searchParams.get('state')!;
    await f.app.inject({ method: 'POST', url: '/logout', headers: f.headers, payload: {} });
    const callback = await f.app.inject({
      url: `/integrations/google-calendar/callback?state=${state}&error=access_denied`,
    });
    expect(callback.statusCode).toBe(401);
    expect(callback.json().error).toBe('oauth_session_expired');
    expect(
      (await f.app.inject({ url: '/integrations/google-calendar/callback/anything' })).statusCode,
    ).toBe(401);
    expect(f.requests()).toBe(0);
  });
});
