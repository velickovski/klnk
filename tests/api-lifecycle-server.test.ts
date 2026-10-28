import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import { Database } from '../apps/server/src/db.js';
import { validateApiPayload } from '../apps/mobile/src/api-contracts.js';

describe('NET-01 actual local server response contracts', () => {
  let service: Awaited<ReturnType<typeof createApp>>;
  beforeAll(async () => {
    const db = await new Database({ dataDir: 'memory://' }).open();
    service = await createApp({
      db,
      worker: false,
      config: {
        production: false,
        port: 4000,
        host: '127.0.0.1',
        databaseUrl: undefined,
        dataDir: 'memory://',
        key: undefined,
        demoEnabled: true,
        openaiKey: undefined,
        provider: 'simulator',
        liveEnabled: false,
        liveOwnerId: undefined,
        publicBaseUrl: undefined,
        recipients: [],
        origins: ['http://localhost:8081'],
        embeddedWorker: false,
        elevenKey: undefined,
        agentId: undefined,
        phoneId: undefined,
        webhookSecret: undefined,
        twilioSid: undefined,
        twilioToken: undefined,
        standardVoice: undefined,
        retentionVerified: false,
        llmProvider: undefined,
        retentionDisclosure: undefined,
        ownerAgentId: undefined,
        googleClientId: undefined,
        googleClientSecret: undefined,
        googleRedirectUri: undefined,
      },
    });
  });
  afterAll(async () => {
    await service?.app.close();
    await service?.db.close();
  });
  async function checked(
    path: string,
    method: 'GET' | 'POST' = 'GET',
    token?: string,
    payload?: unknown,
  ) {
    const result = await service.app.inject({
      url: path,
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    expect(result.statusCode, `${method} ${path}`).toBeLessThan(300);
    const body = result.json();
    expect(validateApiPayload(path, method, body), `${method} ${path}`).toBe(true);
    return body;
  }
  it('accepts fresh-account bootstrap templates before any contact exists', async () => {
    const auth = await checked('/auth/register', 'POST', undefined, {
      name: 'Fictional Owner',
      email: 'platform-wire@example.invalid',
      password: 'A fictional test password only',
    });
    const data = await checked('/bootstrap', 'GET', auth.token);
    expect(data.contacts).toEqual([]);
    expect(data.templates[0].input.contactId).toBe('');
    await checked('/settings/voice', 'GET', auth.token);
    await checked('/integrations', 'GET', auth.token);
    await checked('/export', 'GET', auth.token);
    await checked('/health');
  });
  it('accepts simulated request creation/detail, exact-message reply and receipt contracts', async () => {
    const auth = await checked('/auth/demo', 'POST');
    const data = await checked('/bootstrap', 'GET', auth.token);
    const mission = await checked('/missions', 'POST', auth.token, { templateId: 'information' });
    await checked(`/missions/${mission.id}`, 'GET', auth.token);
    await checked(`/missions/${mission.id}/authorize`, 'POST', auth.token, {
      version: mission.reviewVersion,
      scenario: 'normal',
    });
    for (let step = 0; step < 12 && (await service.engine.tick(true)); step++) {
      /* Deterministic local simulation only. */
    }
    const report = await checked('/voice/report', 'POST', auth.token, {
      missionId: mission.id,
      requestId: 'f1ab70d4-e68f-44e5-9f81-3c90781a517b',
    });
    expect(report.sessionId).toBe('');
    const requestId = '43a218e9-6e81-41de-86b7-1d3389e79570';
    const turn = await checked('/voice/turn', 'POST', auth.token, {
      requestId,
      text: 'Hello',
      language: 'en',
    });
    expect(turn.mode).toBe('simulator');
    await checked(`/voice/turns/${requestId}`, 'GET', auth.token);
    expect(data.contacts.length).toBeGreaterThan(0);
  });
});
