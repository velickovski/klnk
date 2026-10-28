import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import { createSession } from '../apps/server/src/auth.js';
import { createRuntime } from '../apps/server/src/composition-root.js';
import { getConfig } from '../apps/server/src/config.js';
import { Database } from '../apps/server/src/db.js';
import { logger } from '../apps/server/src/logging.js';
import { consumeLimit } from '../apps/server/src/request-limits.js';
import { openTestDatabase } from './support/test-database.js';

const databases: Database[] = [];
const apps: Awaited<ReturnType<typeof createApp>>['app'][] = [];
const originalLogLevel = logger.level;

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  await Promise.all(databases.splice(0).map((db) => db.close()));
  logger.level = originalLogLevel;
  vi.restoreAllMocks();
});

const development = (overrides: Partial<ReturnType<typeof getConfig>> = {}) => ({
  ...getConfig({ NODE_ENV: 'test' }),
  demoEnabled: false,
  embeddedWorker: false,
  legacyEnabled: false,
  ...overrides,
});

async function fixture(overrides: Partial<ReturnType<typeof getConfig>> = {}) {
  const db = await openTestDatabase({ dataDir: 'memory://' });
  databases.push(db);
  const config = development(overrides);
  async function instance() {
    const built = await createApp({ db, config, worker: false });
    apps.push(built.app);
    return built.app;
  }
  async function member() {
    const owner = randomUUID();
    await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
      owner,
      `${owner}@example.invalid`,
      'fictional-unusable-password-hash',
    ]);
    return { owner, token: await createSession(db, owner) };
  }
  return { db, config, instance, member };
}

describe('independent M0/M1 production safety', () => {
  it('missing environment cannot silently enable demo, a generated key or embedded storage', () => {
    expect(() => getConfig({})).toThrow('Production requires');
    const production = getConfig({
      DATABASE_URL: 'postgresql://fixture:fictional@127.0.0.1/klnk_qa',
      DATA_ENCRYPTION_KEY: 'a'.repeat(64),
      APP_ORIGINS: 'https://app.example.invalid',
    });
    expect(production).toMatchObject({
      production: true,
      demoEnabled: false,
      legacyEnabled: false,
    });
    for (const raw of [
      { NODE_ENV: 'staging' },
      { NODE_ENV: 'test', PORT: 'NaN' },
      { NODE_ENV: 'test', CALL_PROVIDER: 'typo' },
      { NODE_ENV: 'test', LIVE_CALLS_ENABLED: 'yes' },
    ])
      expect(() => getConfig(raw)).toThrow('Invalid configuration fields');
  });

  it.each(['999.999.999.999/999', '127.0.0.1/33', '::1/129', 'f', 'true'])(
    'rejects invalid trusted proxy range %s before listening',
    (trust) => expect(() => getConfig({ NODE_ENV: 'test', TRUST_PROXY: trust })).toThrow(),
  );

  it('two API instances consume one durable owner budget while another owner sharing the IP remains usable', async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([f.instance(), f.instance()]);
    for (const app of [a, b]) app.get('/qa-owner-budget', async (req) => ({ owner: req.ownerId }));
    const first = await f.member(),
      second = await f.member();
    const replies = await Promise.all(
      Array.from({ length: 101 }, (_, index) =>
        (index % 2 ? a : b).inject({
          method: 'GET',
          url: '/qa-owner-budget',
          headers: { authorization: `Bearer ${first.token}` },
          remoteAddress: '203.0.113.10',
        }),
      ),
    );
    expect(replies.filter((reply) => reply.statusCode === 200)).toHaveLength(100);
    expect(replies.filter((reply) => reply.statusCode === 429)).toHaveLength(1);
    const unaffected = await b.inject({
      method: 'GET',
      url: '/qa-owner-budget',
      headers: { authorization: `Bearer ${second.token}` },
      remoteAddress: '203.0.113.10',
    });
    expect(unaffected.statusCode).toBe(200);
    expect(unaffected.json()).toEqual({ owner: second.owner });
    const persisted = await f.db.query('SELECT * FROM request_limits');
    expect(persisted).toHaveLength(3);
    const text = JSON.stringify(persisted);
    for (const value of [first.owner, first.token, second.owner, '203.0.113.10'])
      expect(text).not.toContain(value);
  });

  it('shared per-email lockout resists rotating IPs and email case across API instances', async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([f.instance(), f.instance()]);
    const send = (index: number, email: string) =>
      (index % 2 ? a : b).inject({
        method: 'POST',
        url: '/auth/login',
        remoteAddress: `203.0.113.${index + 1}`,
        payload: { email, password: 'Fictional incorrect password' },
      });
    for (let index = 0; index < 10; index++)
      expect((await send(index, 'target@example.invalid')).statusCode).toBe(401);
    const locked = await send(10, 'TARGET@example.invalid');
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toBe('rate_limited');
    expect((await send(11, 'other@example.invalid')).statusCode).toBe(401);
    expect(JSON.stringify(await f.db.query('SELECT * FROM request_limits'))).not.toContain(
      'target@example.invalid',
    );
  });

  it.each([false, true])(
    'fences repeated unauthenticated traffic (bearer present: %s) without exhausting a valid owner budget',
    async (bearer) => {
      const f = await fixture();
      const a = await f.instance(),
        b = await f.instance();
      for (const app of [a, b]) app.get('/qa-auth-fence', async () => ({ ok: true }));
      const valid = await f.member();
      const replies = [];
      for (let index = 0; index < 105; index++)
        replies.push(
          await (index % 2 ? a : b).inject({
            method: 'GET',
            url: '/qa-auth-fence',
            remoteAddress: '203.0.113.88',
            headers: bearer ? { authorization: 'Bearer fictional-invalid-session' } : {},
          }),
        );
      expect(replies.slice(0, 100).every((reply) => reply.statusCode === 401)).toBe(true);
      expect(replies.slice(100).every((reply) => reply.statusCode === 429)).toBe(true);
      expect(
        (
          await b.inject({
            method: 'GET',
            url: '/qa-auth-fence',
            remoteAddress: '203.0.113.88',
            headers: { authorization: `Bearer ${valid.token}` },
          })
        ).statusCode,
      ).toBe(200);
    },
  );

  it('disables legacy requests without disabling the shared core OpenAI owner-voice transport', async () => {
    const f = await fixture({ demoEnabled: true, legacyEnabled: false });
    const app = await f.instance();
    const member = await f.member();
    const headers = { authorization: `Bearer ${member.token}`, host: 'localhost:4000' };
    expect((await app.inject({ method: 'GET', url: '/missions', headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/demo', headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/demo/status', headers })).statusCode).toBe(
      200,
    );
    expect(
      (await app.inject({ method: 'GET', url: '/voice/live/recovery', headers })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/voice/turn', headers, payload: {} })).statusCode,
    ).toBe(404);
  });

  it('trusts forwarded IPs only when the immediate proxy is explicitly allowed', async () => {
    const f = await fixture({ trustProxy: ['127.0.0.1/32'] });
    const app = await f.instance();
    app.get(
      '/auth/qa-proxy',
      { config: { rateLimit: { max: 1, timeWindow: '1 minute' } } },
      async (req) => ({ ip: req.ip }),
    );
    const send = (remoteAddress: string, forwarded: string) =>
      app.inject({
        method: 'GET',
        url: '/auth/qa-proxy',
        remoteAddress,
        headers: { 'x-forwarded-for': forwarded },
      });
    expect((await send('127.0.0.1', '203.0.113.10')).json()).toEqual({ ip: '203.0.113.10' });
    expect((await send('127.0.0.1', '203.0.113.11')).statusCode).toBe(200);
    expect((await send('198.51.100.9', '203.0.113.12')).json()).toEqual({ ip: '198.51.100.9' });
    expect((await send('198.51.100.9', '203.0.113.13')).statusCode).toBe(429);
  });

  it('expiry of one rate-limit window resets its counter without erasing another key', async () => {
    const f = await fixture();
    await consumeLimit(f.db, 'fixture-one', 1, 60000);
    await expect(consumeLimit(f.db, 'fixture-one', 1, 60000)).rejects.toMatchObject({
      statusCode: 429,
    });
    await consumeLimit(f.db, 'fixture-two', 1, 60000);
    await f.db.query(
      "UPDATE request_limits SET reset_at=clock_timestamp()-interval '1 second' WHERE key_hash=$1",
      [f.db.keyedDigest('rate-limit', 'fixture-one')],
    );
    await expect(consumeLimit(f.db, 'fixture-one', 1, 60000)).resolves.toBeUndefined();
    await expect(consumeLimit(f.db, 'fixture-two', 1, 60000)).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  it('keeps public health/readiness content-free and restricts detailed queue diagnostics to the operator token', async () => {
    const operatorToken = 'fictional-operator-token-for-independent-QA';
    const f = await fixture({ operatorToken });
    const app = await f.instance();
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'ok' });
    for (const authorization of [undefined, 'Bearer wrong-operator-token']) {
      const reply = await app.inject({
        method: 'GET',
        url: '/ready',
        headers: authorization ? { authorization } : {},
      });
      expect(reply.statusCode).toBe(200);
      expect(reply.json()).toEqual({ ready: true });
    }
    const detailed = await app.inject({
      method: 'GET',
      url: '/ready',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(detailed.json()).toMatchObject({
      ready: true,
      database: 'ready',
      jobs: { queued: 0, running: 0 },
      agentNetwork: { delivery: 'internal', externalEffectsEnabled: false },
    });
    expect(detailed.body).not.toContain(operatorToken);
    expect(detailed.headers['cache-control']).toBe('no-store');
  });

  it('worker maintenance prunes expired rate-limit metadata without undoing active windows or lockouts', async () => {
    const f = await fixture();
    const runtime = createRuntime(f.db, f.config);
    const expired = f.db.keyedDigest('rate-limit', 'old-expired');
    const locked = f.db.keyedDigest('rate-limit', 'old-locked');
    const active = f.db.keyedDigest('rate-limit', 'new-active');
    await f.db.query(
      "INSERT INTO request_limits(key_hash,hits,reset_at) VALUES($1,1,clock_timestamp()-interval '2 days')",
      [expired],
    );
    await f.db.query(
      "INSERT INTO request_limits(key_hash,hits,reset_at,blocked_until) VALUES($1,20,clock_timestamp()-interval '2 days',clock_timestamp()+interval '1 hour')",
      [locked],
    );
    await consumeLimit(f.db, 'new-active', 5, 60000);
    await runtime.engine.toolMaintenance!(new Date());
    expect(
      (await f.db.query('SELECT key_hash FROM request_limits ORDER BY key_hash')).map(
        (row) => row.key_hash,
      ),
    ).toEqual([locked, active].sort());
  });

  it('logs a 500 as operational metadata without request secrets, concrete URLs, transcripts or provider errors', async () => {
    const captured: string[] = [];
    const destination = (logger as unknown as Record<symbol, { write(chunk: string): void }>)[
      pino.symbols.streamSym
    ];
    vi.spyOn(destination, 'write').mockImplementation((chunk) => {
      captured.push(String(chunk));
    });
    logger.level = 'info';
    const f = await fixture();
    const app = await f.instance();
    app.post('/auth/qa-failure/:private', async () => {
      throw new Error('PRIVATE_PROVIDER_ERROR_qa');
    });
    const reply = await app.inject({
      method: 'POST',
      url: '/auth/qa-failure/PRIVATE_PATH_qa?secret=PRIVATE_QUERY_qa',
      headers: { authorization: 'Bearer PRIVATE_BEARER_qa', cookie: 'secret=PRIVATE_COOKIE_qa' },
      payload: {
        email: 'PRIVATE_EMAIL_qa@example.invalid',
        password: 'PRIVATE_PASSWORD_qa',
        transcript: 'PRIVATE_TRANSCRIPT_qa',
      },
    });
    expect(reply.statusCode).toBe(500);
    expect(reply.body).not.toContain('PRIVATE_');
    const serialized = captured.join('');
    expect(serialized).toContain('request_failed');
    expect(serialized).toContain('request_complete');
    expect(serialized).toContain('requestId');
    expect(serialized).not.toContain('PRIVATE_');
    expect(serialized).toContain('/auth/qa-failure/:private');
  });
});
