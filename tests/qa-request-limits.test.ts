import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import { createSession, newUser } from '../apps/server/src/auth.js';
import { getConfig } from '../apps/server/src/config.js';
import { openTestDatabase } from './support/test-database.js';

const services: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) {
    await service.app.close();
    await service.db.close();
  }
});
async function fixture(trustProxy = 'false') {
  const db = await openTestDatabase();
  const service = await createApp({
    db,
    worker: false,
    config: getConfig({ NODE_ENV: 'test', TRUST_PROXY: trustProxy, LEGACY_ENABLED: 'true' }),
  });
  services.push(service);
  service.app.get('/qa/request-ip', async (request) => ({ ip: request.ip }));
  return service;
}

describe('independent HTTP request-limit boundaries', () => {
  it('bounds rejected unauthenticated requests before their account lookup', async () => {
    const f = await fixture();
    const responses = [];
    for (let index = 0; index < 101; index++) {
      responses.push(
        (await f.app.inject({ url: '/network/identity', remoteAddress: '192.0.2.75' })).statusCode,
      );
    }
    expect(responses.slice(0, 100)).toEqual(Array(100).fill(401));
    expect(responses[100]).toBe(429);
  });

  it('uses forwarded IPs only from an explicitly trusted proxy', async () => {
    const f = await fixture('127.0.0.1');
    const account = await newUser(
      f.db,
      `${randomUUID()}@example.invalid`,
      'Independent proxy QA password',
    );
    const headers = {
      authorization: `Bearer ${await createSession(f.db, account.id)}`,
      'x-forwarded-for': '203.0.113.45',
    };
    const trusted = await f.app.inject({
      url: '/qa/request-ip',
      remoteAddress: '127.0.0.1',
      headers,
    });
    const untrusted = await f.app.inject({
      url: '/qa/request-ip',
      remoteAddress: '192.0.2.90',
      headers,
    });
    expect(trusted.json()).toEqual({ ip: '203.0.113.45' });
    expect(untrusted.json()).toEqual({ ip: '192.0.2.90' });
  });

  it('shares an email lockout across distinct client IPs and keeps the address out of persisted counters', async () => {
    const f = await fixture();
    const email = 'independent-login@example.invalid';
    for (let index = 0; index < 10; index++) {
      const denied = await f.app.inject({
        method: 'POST',
        url: '/auth/login',
        remoteAddress: `192.0.2.${index + 1}`,
        payload: {
          email: index % 2 ? email.toUpperCase() : email,
          password: 'Fictional wrong password',
        },
      });
      expect(denied.statusCode).toBe(401);
    }
    const blocked = await f.app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress: '192.0.2.55',
      payload: { email, password: 'Fictional wrong password' },
    });
    expect(blocked.statusCode).toBe(429);
    const rows = await f.db.query('SELECT * FROM request_limits');
    expect(JSON.stringify(rows)).not.toContain(email);
    expect(rows.every((row) => /^[a-f0-9]{64}$/.test(row.key_hash))).toBe(true);
  });
});
