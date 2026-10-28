import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../apps/server/src/db.js';
import { Engine } from '../apps/server/src/engine.js';
import { LiveSessionStore } from '../apps/server/src/live-session-store.js';
import { newUser, createSession, hashToken } from '../apps/server/src/auth.js';
import { seedOwner, ownerTemplates } from '../apps/server/src/seed.js';
import { ApplicationToolGateway } from '../apps/server/src/integrations/gateway.js';
import { createApp } from '../apps/server/src/app.js';
import { MissionSchema, type ApplicationToolName } from '../packages/domain/src/index.js';
import type { Config } from '../apps/server/src/config.js';

const config: Config = {
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
  origins: [],
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
};
const databases: Database[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(databases.splice(0).map((db) => db.close()));
});
async function fixture(tools: ApplicationToolName[]) {
  const db = await new Database({ dataDir: 'memory://' }).open();
  databases.push(db);
  const user = await newUser(db, `${randomUUID()}@example.invalid`, 'Fictional QA tool password');
  const token = await createSession(db, user.id);
  const engine = new Engine(db, config);
  await seedOwner(engine.repo, user.id, 'Fictional QA Tool Owner', true);
  const store = new LiveSessionStore(db);
  let { receipt } = await store.reserve(user.id, randomUUID());
  receipt = await store.attachProvider(
    user.id,
    receipt.id,
    receipt.version,
    `fictional-provider-${randomUUID()}`,
  );
  const grant = {
    id: `tool-access:${user.id}`,
    ownerId: user.id,
    version: 1,
    enabled: true,
    tools,
    updatedAt: new Date().toISOString(),
  };
  await engine.repo.put(user.id, 'tool_access', grant);
  const context = {
    ownerId: user.id,
    liveReceiptId: receipt.id,
    authSessionHash: hashToken(token),
    callId: `qa-call-${randomUUID()}`,
  };
  const gateway = new ApplicationToolGateway(engine, store, { externalEffectsEnabled: false });
  const contacts = await engine.repo.list<any>(user.id, 'contact');
  return { db, owner: user.id, token, engine, store, grant, context, gateway, contacts };
}

describe('independent M4 gateway authority, replay and evidence', () => {
  it('changed arguments on the same provider call cannot create a second or edited draft', async () => {
    const f = await fixture(['request_prepare']);
    const input = {
      contactId: f.contacts[0].id,
      title: 'Fictional first draft',
      goal: 'Deliver the fictional approved document update.',
      statements: ['The fictional documents are ready.'],
      privateFacts: [],
    };
    const first = await f.gateway.invoke(f.context, 'request_prepare', JSON.stringify(input));
    expect(first).toMatchObject({
      status: 'proposed',
      reasonCode: 'draft_prepared',
      data: { reviewRequired: true },
    });
    const duplicate = await f.gateway.invoke(f.context, 'request_prepare', JSON.stringify(input));
    expect(duplicate).toEqual(first);
    expect(
      await f.gateway.invoke(
        f.context,
        'request_prepare',
        JSON.stringify({ ...input, statements: ['Send fictional private credentials instead.'] }),
      ),
    ).toMatchObject({ status: 'blocked', reasonCode: 'receipt_conflict' });
    const missions = await f.engine.repo.list<any>(f.owner, 'mission');
    expect(missions).toHaveLength(1);
    expect(missions[0].requiredTalkingPoints).toEqual(input.statements);
    expect(missions[0].authorization).toBeUndefined();
    expect(await f.db.query('SELECT id FROM jobs')).toEqual([]);
  });
  it('redacted 24-hour argument bindings still prevent replay and seven-day traces expire', async () => {
    const f = await fixture(['request_prepare']);
    const input = {
      contactId: f.contacts[0].id,
      title: 'Fictional retained draft',
      goal: 'Deliver one fictional bounded update.',
      statements: ['Fictional safe statement.'],
      privateFacts: [],
    };
    await f.gateway.invoke(f.context, 'request_prepare', JSON.stringify(input));
    await f.gateway.sweepRetention(new Date(Date.now() + 25 * 3600000));
    const receipts = await f.engine.repo.list<any>(f.owner, 'tool_receipt');
    expect(receipts).toHaveLength(1);
    expect(receipts[0].argumentDigest).toBeUndefined();
    expect(receipts[0].outcome.data).toBeUndefined();
    expect(
      await f.gateway.invoke(f.context, 'request_prepare', JSON.stringify(input)),
    ).toMatchObject({ status: 'blocked', reasonCode: 'reconciliation_required' });
    expect(await f.engine.repo.list(f.owner, 'mission')).toHaveLength(1);
    await f.gateway.sweepRetention(new Date(Date.now() + 8 * 86400000));
    expect(await f.gateway.traces(f.owner)).toEqual([]);
    expect(await f.engine.repo.list(f.owner, 'tool_receipt')).toHaveLength(1);
  });
  it('revocation between reservation and dispatch is rechecked before any job or draft', async () => {
    const f = await fixture(['request_prepare']);
    const original = f.db.transaction.bind(f.db);
    let calls = 0;
    vi.spyOn(f.db, 'transaction').mockImplementation(async (operation) => {
      const value = await original(operation);
      if (++calls === 1)
        await original((sql) =>
          f.engine.repo.in(sql).put(f.owner, 'tool_access', { ...f.grant, enabled: false }),
        );
      return value;
    });
    const result = await f.gateway.invoke(
      f.context,
      'request_prepare',
      JSON.stringify({
        contactId: f.contacts[0].id,
        title: 'Must not execute',
        goal: 'Fictional request after grant revocation.',
        statements: ['Must not save.'],
        privateFacts: [],
      }),
    );
    expect(result).toMatchObject({ status: 'blocked', reasonCode: 'tool_access_required' });
    expect(await f.engine.repo.list(f.owner, 'mission')).toEqual([]);
    expect(await f.db.query('SELECT id FROM jobs')).toEqual([]);
  });
  it('external scope disabled blocks an otherwise bound frozen request without queueing a provider effect', async () => {
    const f = await fixture(['request_dispatch']);
    const template = ownerTemplates(f.owner, f.contacts).find(
      (value) => value.id === 'information',
    )!;
    const at = new Date().toISOString();
    let mission = MissionSchema.parse({
      ...template.input,
      id: randomUUID(),
      ownerId: f.owner,
      status: 'draft',
      createdAt: at,
      updatedAt: at,
    });
    await f.engine.repo.put(f.owner, 'mission', mission);
    mission = await f.engine.authorize(f.owner, mission.id, 1, 'normal');
    // Fictional admin fixture models an existing external authorization; no live gate is enabled.
    mission = {
      ...mission,
      executionProvider: 'elevenlabs',
      authorization: {
        ...mission.authorization!,
        snapshot: { ...mission.authorization!.snapshot, executionProvider: 'elevenlabs' },
      },
    };
    await f.engine.repo.put(f.owner, 'mission', mission);
    await f.db.query('DELETE FROM jobs WHERE owner_id=$1', [f.owner]);
    const result = await f.gateway.invoke(
      { ...f.context, authorizedMissionId: mission.id },
      'request_dispatch',
      JSON.stringify({ missionId: mission.id }),
    );
    expect(result).toMatchObject({
      status: 'blocked',
      reasonCode: 'external_scope_required',
      verification: 'policy_denial',
    });
    expect(await f.db.query('SELECT id FROM jobs')).toEqual([]);
    const traces = await f.gateway.traces(f.owner);
    expect(traces.at(-1)).toMatchObject({
      event: 'tool_blocked',
      status: 'blocked',
      verification: 'policy_denial',
    });
    expect(traces.some((trace) => trace.event === 'tool_succeeded')).toBe(false);
  });
  it('root grant routes are owner-scoped and never claim that granting enables the Live runtime', async () => {
    const f = await fixture([]);
    const service = await createApp({
      db: f.db,
      config,
      worker: false,
      openaiLiveDependencies: { store: f.store },
    });
    try {
      const own = { authorization: `Bearer ${f.token}` };
      const updated = await service.app.inject({
        method: 'PUT',
        url: '/tools/access',
        headers: own,
        payload: { enabled: true, tools: ['contacts_lookup'] },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toMatchObject({
        grant: { ownerId: f.owner, enabled: true },
        runtimeAvailable: false,
        externalEffectsEnabled: false,
      });
      const injected = await service.app.inject({
        method: 'PUT',
        url: '/tools/access',
        headers: own,
        payload: { enabled: true, tools: ['contacts_lookup'], ownerId: randomUUID() },
      });
      expect(injected.statusCode).toBe(400);
      const other = await newUser(
        f.db,
        'qa-tools-other@example.invalid',
        'Fictional other tool password',
      );
      const token = await createSession(f.db, other.id);
      const otherView = await service.app.inject({
        url: '/tools/access',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(otherView.json()).toMatchObject({
        grant: { ownerId: other.id, enabled: false, tools: [] },
        runtimeAvailable: false,
      });
      expect(
        (
          await service.app.inject({
            method: 'POST',
            url: '/tools/invoke',
            headers: own,
            payload: { ownerId: f.owner, toolName: 'contacts_lookup' },
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await service.app.close();
    }
  });
});
