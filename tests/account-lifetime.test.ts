import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import { Database } from '../apps/server/src/db.js';
import type { Config } from '../apps/server/src/config.js';
import { newUser } from '../apps/server/src/auth.js';

const config: Config = { production: false, port: 4000, host: '127.0.0.1', databaseUrl: undefined, dataDir: 'memory://', key: undefined, demoEnabled: true, openaiKey: undefined, provider: 'simulator', liveEnabled: false, liveOwnerId: undefined, publicBaseUrl: undefined, recipients: [], origins: [], embeddedWorker: false, elevenKey: undefined, agentId: undefined, phoneId: undefined, webhookSecret: undefined, twilioSid: undefined, twilioToken: undefined, standardVoice: undefined, retentionVerified: false, llmProvider: undefined, retentionDisclosure: undefined, ownerAgentId: undefined, googleClientId: undefined, googleClientSecret: undefined, googleRedirectUri: undefined };
const services: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => { for (const service of services.splice(0)) { await service.app.close(); await service.db.close(); } });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

describe('DATA-01 delayed authenticated writers cannot resurrect deleted accounts', () => {
  it.each(['profile', 'contact'] as const)('rejects a delayed %s save after account deletion', async kind => {
    const db = await new Database({ dataDir: 'memory://' }).open(); const service = await createApp({ db, config, worker: false }); services.push(service);
    const entered = deferred(), resume = deferred();
    service.app.addHook('preHandler', async request => { if (request.url === (kind === 'profile' ? '/profile' : '/contacts') && request.method === (kind === 'profile' ? 'PUT' : 'POST')) { entered.resolve(); await resume.promise; } });
    const auth = (await service.app.inject({ method: 'POST', url: '/auth/register', payload: { email: `${kind}-lifetime@example.invalid`, name: 'Fictional Lifetime Owner', password: 'A fictional lifetime test password' } })).json();
    const headers = { authorization: `Bearer ${auth.token}` };
    const pending = service.app.inject({ method: kind === 'profile' ? 'PUT' : 'POST', url: kind === 'profile' ? '/profile' : '/contacts', headers, payload: kind === 'profile' ? { name: 'Fictional late profile', language: 'en', timezone: 'UTC', tone: 'Clear', pronunciation: '', onboardingComplete: true } : { name: 'Fictional late contact', phone: '+12025550999', relationship: 'Fixture', language: 'en', verified: true, context: '', optedOut: false } });
    await entered.promise;
    const deleted = await service.app.inject({ method: 'DELETE', url: '/account', headers }); expect(deleted.statusCode).toBe(200); resume.resolve();
    const result = await pending; expect(result.statusCode).toBe(401); expect((await db.query('SELECT count(*)::int AS total FROM resources WHERE owner_id=$1', [auth.user.id]))[0].total).toBe(0);
    expect((await db.query('SELECT deleted_at FROM users WHERE id=$1', [auth.user.id]))[0].deleted_at).toBeTruthy();
  });
  it('Repository.put rejects tombstoned owners both standalone and inside an existing transaction', async () => {
    const db = await new Database({ dataDir: 'memory://' }).open(); const service = await createApp({ db, config, worker: false }); services.push(service); const user = await newUser(db, 'repository-lifetime@example.invalid', 'A fictional repository password');
    await db.query('UPDATE users SET deleted_at=now() WHERE id=$1', [user.id]);
    await expect(service.repo.put(user.id, 'memory', { id: 'late-memory', text: 'Must not return' })).rejects.toMatchObject({ code: 'owner_deleted' });
    await expect(db.transaction(sql => service.repo.in(sql).put(user.id, 'profile', { id: user.id, name: 'Late' }))).rejects.toMatchObject({ code: 'owner_deleted' });
    expect((await db.query('SELECT count(*)::int AS total FROM resources WHERE owner_id=$1', [user.id]))[0].total).toBe(0);
  });
});
