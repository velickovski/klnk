import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { MissionSchema, type Mission, type Memory } from '../packages/domain/src/index.js';
import { Database } from '../apps/server/src/db.js';
import { Engine } from '../apps/server/src/engine.js';
import type { Config } from '../apps/server/src/config.js';
import { RecipientSuppression } from '../apps/server/src/integrations/recipient-suppression.js';
import { newUser } from '../apps/server/src/auth.js';
import { ownerTemplates, seedOwner } from '../apps/server/src/seed.js';

const base: Config = {
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
  googleClientId: undefined,
  googleClientSecret: undefined,
  googleRedirectUri: undefined,
};
const databases: Database[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});
async function fixture(live = false) {
  const db = await new Database({ dataDir: 'memory://' }).open();
  databases.push(db);
  const user = await newUser(
    db,
    `${randomUUID()}@example.invalid`,
    'A fictional authorization password',
  );
  const config = {
    ...base,
    ...(live
      ? {
          provider: 'elevenlabs' as const,
          liveEnabled: true,
          liveOwnerId: user.id,
          publicBaseUrl: 'https://klnk.example',
          recipients: [
            '+12025550101',
            '+12025550102',
            '+12025550103',
            '+12025550104',
            '+12025550105',
          ],
          elevenKey: 'fictional-key',
          agentId: 'fictional-agent',
          phoneId: 'fictional-phone',
          webhookSecret: 'fictional-webhook',
          twilioSid: 'fictional-sid',
          twilioToken: 'fictional-token',
          standardVoice: 'fictional-voice',
          retentionVerified: true,
          llmProvider: 'fictional-model',
          retentionDisclosure: 'Fictional test retention.',
        }
      : {}),
  };
  const engine = new Engine(db, config);
  engine.verifyLiveSetup = async () => undefined;
  await seedOwner(engine.repo, user.id, 'Fictional Owner', true);
  const contacts = await engine.repo.list<any>(user.id, 'contact'),
    template = ownerTemplates(user.id, contacts).find((value) => value.id === 'information')!;
  const mission = (patch: Record<string, unknown> = {}) =>
    MissionSchema.parse({
      ...template.input,
      id: randomUUID(),
      ownerId: user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...patch,
    });
  return {
    db,
    engine,
    owner: user.id,
    contact: contacts.find((value) => value.id === template.input.contactId),
    mission,
    suppression: new RecipientSuppression(db),
  };
}

describe('recipient suppression survives editable contact records', () => {
  it('delete and recreate cannot remove keyed owner-scoped suppression or expose the telephone number', async () => {
    const f = await fixture();
    await f.suppression.contactChanged(f.owner, undefined, { ...f.contact, optedOut: true });
    await f.engine.repo.remove(f.owner, 'contact', f.contact.id);
    const recreated = { ...f.contact, id: randomUUID(), optedOut: false };
    expect(await f.suppression.contactChanged(f.owner, undefined, recreated)).toBe(true);
    await f.engine.repo.put(f.owner, 'contact', recreated);
    const mission = f.mission({ contactId: recreated.id });
    await f.engine.repo.put(f.owner, 'mission', mission);
    await expect(f.engine.authorize(f.owner, mission.id, 1, 'normal')).rejects.toMatchObject({
      code: 'recipient_opted_out',
    });
    const rows = await f.suppression.list(f.owner);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(f.contact.phone);
    expect(rows[0].id).not.toContain(f.contact.phone);
    const other = await newUser(
      f.db,
      'suppression-other@example.invalid',
      'Another fictional account password',
    );
    expect(await f.suppression.isSuppressed(other.id, f.contact.phone)).toBe(false);
  });
  it('rechecks suppression immediately before queued dispatch', async () => {
    const f = await fixture();
    const mission = f.mission();
    await f.engine.repo.put(f.owner, 'mission', mission);
    await f.engine.authorize(f.owner, mission.id, 1, 'normal');
    await f.suppression.suppress(f.owner, f.contact.phone, 'recipient_opt_out');
    await f.engine.tick(true);
    const detail = await f.engine.detail(f.owner, mission.id);
    expect(detail.status).toBe('unresolved');
    expect(detail.attempts).toHaveLength(0);
  });
  it('refusal suppresses the immutable dialed number even if contact number changed during the call', async () => {
    const f = await fixture();
    const mission = f.mission();
    await f.engine.repo.put(f.owner, 'mission', mission);
    await f.engine.authorize(f.owner, mission.id, 1, 'refusal');
    await f.engine.tick(true);
    await f.engine.tick(true);
    const changedPhone = '+12025550999';
    await f.engine.repo.put(f.owner, 'contact', {
      ...f.contact,
      phone: changedPhone,
      optedOut: false,
    });
    await f.engine.tick(true);
    expect(await f.suppression.isSuppressed(f.owner, f.contact.phone)).toBe(true);
    expect(await f.suppression.isSuppressed(f.owner, changedPhone)).toBe(false);
    expect((await f.engine.repo.get<any>(f.owner, 'contact', f.contact.id)).optedOut).toBe(false);
  });
  it('migrates legacy opt-out records into minimal keyed suppression', async () => {
    const f = await fixture();
    await f.engine.repo.put(f.owner, 'optout', {
      id: 'legacy-opt-out',
      phone: f.contact.phone,
      createdAt: new Date().toISOString(),
    });
    expect(await f.suppression.isSuppressed(f.owner, f.contact.phone)).toBe(true);
    const records = await f.engine.repo.list(f.owner, 'optout');
    expect(records).toHaveLength(1);
    expect(records[0].purpose).toBe('recipient_contact_suppression');
    expect(JSON.stringify(records)).not.toContain(f.contact.phone);
  });
});

describe('authorization freezes disclosed memory content and provenance', () => {
  async function memoryFixture(live = false) {
    const f = await fixture(live),
      id = randomUUID(),
      at = new Date().toISOString();
    const memory: Memory = {
      id,
      ownerId: f.owner,
      kind: 'fact',
      text: 'Fictional approved detail',
      source: { type: 'owner', reference: 'Fictional approved source' },
      createdAt: at,
      updatedAt: at,
      scope: 'owner',
      confirmation: 'confirmed',
      disclosure: 'allowed',
    };
    await f.engine.repo.put(f.owner, 'memory', memory);
    const mission = f.mission({ neededMemoryIds: [id] });
    await f.engine.repo.put(f.owner, 'mission', mission);
    await f.engine.authorize(f.owner, mission.id, 1, 'normal');
    return { ...f, memory, mission };
  }
  it('edits, deletion and disclosure/source changes cannot replace approved facts in detail', async () => {
    const f = await memoryFixture();
    const before = await f.engine.mission(f.owner, f.mission.id);
    await f.engine.repo.put(f.owner, 'memory', {
      ...f.memory,
      text: 'Fictional changed private fact',
      source: { type: 'model', reference: 'Untrusted new source' },
      disclosure: 'private',
      confirmation: 'unconfirmed',
    });
    let detail = await f.engine.detail(f.owner, f.mission.id);
    expect(detail.context).toEqual([f.memory]);
    expect(detail.authorization?.snapshot).toEqual(before.authorization?.snapshot);
    await f.engine.repo.remove(f.owner, 'memory', f.memory.id);
    detail = await f.engine.detail(f.owner, f.mission.id);
    expect(detail.context).toEqual([f.memory]);
    const legacy = {
      ...detail,
      authorization: { ...detail.authorization!, snapshot: { ...detail.authorization!.snapshot } },
    };
    delete legacy.authorization.snapshot.selectedContext;
    await f.engine.repo.put(f.owner, 'mission', legacy);
    expect((await f.engine.detail(f.owner, f.mission.id)).context).toEqual([]);
  });
  it('passes only frozen text to the fake telephone provider and never current edited memory', async () => {
    const f = await memoryFixture(true);
    let prompt = '';
    f.engine.eleven = {
      startCall: async (input: any) => {
        prompt = input.prompt;
        return { conversation_id: 'fictional-conversation', callSid: 'fictional-call' };
      },
    } as any;
    await f.engine.repo.put(f.owner, 'memory', {
      ...f.memory,
      text: 'Fictional newly injected disclosure',
      source: { type: 'integration', reference: 'Untrusted new source' },
    });
    await f.engine.tick(true);
    expect(JSON.parse(prompt).context).toEqual([{ text: f.memory.text, source: f.memory.source }]);
    expect(prompt).not.toContain('newly injected');
  });
  it('freezes only owner-scoped confirmed allowed unexpired selection', async () => {
    const f = await fixture();
    const at = new Date().toISOString();
    const common = {
      kind: 'fact',
      text: 'Fictional candidate context',
      source: { type: 'owner', reference: 'Fixture' },
      createdAt: at,
      updatedAt: at,
      scope: 'owner',
      confirmation: 'confirmed',
      disclosure: 'allowed',
    };
    const ids: string[] = [];
    for (const patch of [
      {},
      { ownerId: randomUUID() },
      { disclosure: 'private' },
      { confirmation: 'unconfirmed' },
      { expiresAt: '2000-01-01T00:00:00Z' },
    ]) {
      const id = randomUUID();
      ids.push(id);
      await f.engine.repo.put(f.owner, 'memory', { ...common, ownerId: f.owner, ...patch, id });
    }
    const mission: Mission = f.mission({ neededMemoryIds: ids });
    await f.engine.repo.put(f.owner, 'mission', mission);
    await f.engine.authorize(f.owner, mission.id, 1, 'normal');
    const detail = await f.engine.detail(f.owner, mission.id);
    expect(detail.context.map((value: Memory) => value.id)).toEqual([ids[0]]);
  });
});
