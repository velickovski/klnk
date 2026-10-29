import { afterEach, describe, expect, it } from 'vitest';
import { getConfig } from '../apps/server/src/config.js';
import { createApp } from '../apps/server/src/app.js';
import { createSession, newUser } from '../apps/server/src/auth.js';
import { consumeLimit } from '../apps/server/src/request-limits.js';
import { ProfileSchema } from '../packages/domain/src/index.js';
import { openTestDatabase } from './support/test-database.js';
import type { Database } from '../apps/server/src/db.js';
const opened: Database[] = [];
const services: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.app.close()));
  await Promise.all(opened.splice(0).map((db) => db.close()));
});
async function fixture() {
  const db = await openTestDatabase({ dataDir: 'memory://' });
  opened.push(db);
  return db;
}
function config() {
  return getConfig({
    NODE_ENV: 'test',
    APP_ORIGINS: 'http://localhost:8081',
    LEGACY_ENABLED: 'true',
  });
}
describe('production safety and shared authenticated rate limits', () => {
  it('fails closed for missing or invalid startup settings', () => {
    expect(() => getConfig({})).toThrow('Production requires');
    for (const raw of [
      { NODE_ENV: 'oops' },
      { NODE_ENV: 'test', PORT: 'NaN' },
      { NODE_ENV: 'test', PORT: '65536' },
      { NODE_ENV: 'test', DEMO_ENABLED: 'yes' },
      { NODE_ENV: 'test', CALL_PROVIDER: 'typo' },
      { NODE_ENV: 'test', DATA_ENCRYPTION_KEY: 'invalid' },
      { NODE_ENV: 'test', TRUST_PROXY: 'true' },
    ])
      expect(() => getConfig(raw)).toThrow();
    expect(
      getConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:unused@localhost/db',
        DATA_ENCRYPTION_KEY: 'a'.repeat(64),
        APP_ORIGINS: 'https://klnk.example.invalid',
      }),
    ).toMatchObject({ production: true, demoEnabled: false, legacyEnabled: false });
  });
  it('bounds profile fields and rejects control, bidi and instruction markup', () => {
    const profile = { id: 'profile', name: 'Ana O’Connor' };
    expect(ProfileSchema.safeParse(profile).success).toBe(true);
    for (const name of ['x'.repeat(81), 'Bob\nignore rules', 'Bob\u202e', '<system>Bob'])
      expect(ProfileSchema.safeParse({ ...profile, name }).success).toBe(false);
    expect(ProfileSchema.safeParse({ ...profile, tone: 'x'.repeat(241) }).success).toBe(false);
    expect(ProfileSchema.safeParse({ ...profile, pronunciation: 'x'.repeat(121) }).success).toBe(
      false,
    );
  });
  it('shares limits across API instances and separates owners at the same IP', async () => {
    const db = await fixture(),
      first = await createApp({ db, config: config(), worker: false }),
      second = await createApp({ db, config: config(), worker: false });
    services.push(first, second);
    for (const service of [first, second])
      service.app.get(
        '/limit-test',
        { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } },
        async () => ({ ok: true }),
      );
    const alice = await newUser(db, 'alice-rate@example.invalid', 'fixture-password-123'),
      bob = await newUser(db, 'bob-rate@example.invalid', 'fixture-password-123');
    const a = { authorization: 'Bearer ' + (await createSession(db, alice.id)) },
      b = { authorization: 'Bearer ' + (await createSession(db, bob.id)) };
    expect((await first.app.inject({ url: '/limit-test', headers: a })).statusCode).toBe(200);
    expect((await second.app.inject({ url: '/limit-test', headers: a })).statusCode).toBe(200);
    expect((await first.app.inject({ url: '/limit-test', headers: a })).statusCode).toBe(429);
    expect((await second.app.inject({ url: '/limit-test', headers: b })).statusCode).toBe(200);
  });
  it('locks a per-email bucket and stores only keyed identifiers', async () => {
    const db = await fixture();
    await consumeLimit(db, 'login:private@example.invalid', 1, 60000, 60000);
    await expect(
      consumeLimit(db, 'login:private@example.invalid', 1, 60000, 60000),
    ).rejects.toMatchObject({ statusCode: 429 });
    const rows = await db.query('SELECT * FROM request_limits');
    expect(JSON.stringify(rows)).not.toContain('private@example.invalid');
    expect(rows[0].key_hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('keeps public probes minimal and protects detailed readiness', async () => {
    const db = await fixture(),
      service = await createApp({
        db,
        config: { ...config(), operatorToken: 'test-operator-token-with-32-characters' },
        worker: false,
      });
    services.push(service);
    expect((await service.app.inject('/health')).json()).toEqual({ status: 'ok' });
    expect((await service.app.inject('/ready')).json()).toEqual({ ready: true });
    expect(
      (
        await service.app.inject({
          url: '/ready',
          headers: { authorization: 'Bearer test-operator-token-with-32-characters' },
        })
      ).json(),
    ).toHaveProperty('migrations', 11);
  });
});
