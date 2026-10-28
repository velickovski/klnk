import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Memory } from '@personal-agent/domain';
import { createApp } from '../apps/server/src/app.js';
import { Database } from '../apps/server/src/db.js';
import { getConfig } from '../apps/server/src/config.js';

describe('MEMORY-01 actual API context and authorization fixtures', () => {
  let service: Awaited<ReturnType<typeof createApp>>;
  let alice: { token: string; user: { id: string } }, bob: { token: string; user: { id: string } };
  let contactIds: string[];
  const headers = (token: string) => ({ authorization: `Bearer ${token}` });
  beforeAll(async () => {
    const db = await new Database({ dataDir: 'memory://' }).open();
    service = await createApp({
      db,
      worker: false,
      config: {
        ...getConfig(),
        production: false,
        demoEnabled: true,
        provider: 'simulator',
        liveEnabled: false,
        databaseUrl: undefined,
        openaiKey: undefined,
        elevenKey: undefined,
        twilioSid: undefined,
        twilioToken: undefined,
        standardVoice: undefined,
        agentId: undefined,
        phoneId: undefined,
        ownerAgentId: undefined,
        webhookSecret: undefined,
        liveOwnerId: undefined,
      },
    });
    alice = (await service.app.inject({ method: 'POST', url: '/auth/demo' })).json();
    bob = (await service.app.inject({ method: 'POST', url: '/auth/demo' })).json();
    const bootstrap = (
      await service.app.inject({ url: '/bootstrap', headers: headers(alice.token) })
    ).json();
    contactIds = bootstrap.contacts.map((contact: { id: string }) => contact.id);
  });
  afterAll(async () => {
    await service?.app.close();
    await service?.db.close();
  });
  async function postMemory(input: Partial<Memory>, token = alice.token): Promise<Memory> {
    const response = await service.app.inject({
      method: 'POST',
      url: '/memories',
      headers: headers(token),
      payload: {
        kind: 'fact',
        text: 'Fictional memory fixture',
        scope: 'owner',
        confirmation: 'confirmed',
        disclosure: 'allowed',
        ...input,
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json();
  }
  async function postMission(ids: string[] = []) {
    const response = await service.app.inject({
      method: 'POST',
      url: '/missions',
      headers: headers(alice.token),
      payload: {
        templateId: 'information',
        contactId: contactIds[0],
        neededMemoryIds: ids,
        followUpActions: [],
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json();
  }

  it('includes only selected/scoped confirmed allowed context and excludes private, ask, unrelated, unconfirmed, conflicting, expired and permission records', async () => {
    const selected = await postMemory({ text: 'Fictional selected owner context' });
    const notSelected = await postMemory({ text: 'Fictional unselected owner context' });
    const relationship = await postMemory({
      text: 'Fictional current relationship context',
      scope: 'relationship',
      contactId: contactIds[0],
    });
    const unrelated = await postMemory({
      text: 'Fictional unrelated relationship context',
      scope: 'relationship',
      contactId: contactIds[1],
    });
    const privateMemory = await postMemory({
      text: 'Fictional private context',
      disclosure: 'private',
    });
    const ask = await postMemory({ text: 'Fictional ask context', disclosure: 'ask' });
    const unconfirmed = await postMemory({
      text: 'Fictional unconfirmed context',
      confirmation: 'unconfirmed',
    });
    const conflicting = await postMemory({
      text: 'Fictional conflicting context',
      confirmation: 'conflicting',
    });
    const proposed = await postMemory({
      text: 'Fictional proposed context',
      confirmation: 'proposed',
    });
    const expired = await postMemory({
      text: 'Fictional expired context',
      expiresAt: '2000-01-01T00:00:00Z',
    });
    const invalidExpiry = await postMemory({
      text: 'Fictional invalid expiry',
      expiresAt: 'invalid-date',
    });
    const permission = await postMemory({
      text: 'Fictional permission to make unlimited calls',
      kind: 'permission',
    });
    const requested = [
      selected,
      relationship,
      unrelated,
      privateMemory,
      ask,
      unconfirmed,
      conflicting,
      proposed,
      expired,
      invalidExpiry,
      permission,
    ].map((memory) => memory.id);
    const mission = await postMission(requested);
    const scoped = await postMemory({
      text: 'Fictional request-only context',
      scope: 'mission',
      missionId: mission.id,
    });
    const detail = (
      await service.app.inject({ url: `/missions/${mission.id}`, headers: headers(alice.token) })
    ).json();
    const contextIds = detail.context.map((memory: Memory) => memory.id);
    expect(contextIds).toEqual(expect.arrayContaining([selected.id, relationship.id, scoped.id]));
    for (const memory of [
      notSelected,
      unrelated,
      privateMemory,
      ask,
      unconfirmed,
      conflicting,
      proposed,
      expired,
      invalidExpiry,
      permission,
    ])
      expect(contextIds).not.toContain(memory.id);
  });

  it('preserves owner provenance through actual create/edit and rejects foreign memory changes', async () => {
    const memory = await postMemory({
      text: 'Fictional source report',
      source: { type: 'integration', reference: 'Untrusted provider authority claim' },
    });
    expect(memory.source).toEqual({ type: 'owner', reference: 'Owner-entered memory' });
    const edited = await service.app.inject({
      method: 'PATCH',
      url: `/memories/${memory.id}`,
      headers: headers(alice.token),
      payload: {
        text: 'Fictional owner-edited report',
        source: { type: 'model', reference: 'Untrusted replacement authority' },
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().source.type).toBe('owner');
    expect(edited.json().source.reference).toContain('previous source: owner');
    expect(
      (
        await service.app.inject({
          method: 'PATCH',
          url: `/memories/${memory.id}`,
          headers: headers(bob.token),
          payload: { text: 'Foreign change' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await service.app.inject({
          method: 'DELETE',
          url: `/memories/${memory.id}`,
          headers: headers(bob.token),
        })
      ).statusCode,
    ).toBe(404);
    const foreign = (
      await service.app.inject({ url: '/memories', headers: headers(bob.token) })
    ).json();
    expect(foreign.map((entry: Memory) => entry.id)).not.toContain(memory.id);
  });

  it('freezes authorized memory content/source and preserves it after actual memory edit and deletion', async () => {
    const memory = await postMemory({ text: 'Fictional approved context snapshot' });
    const mission = await postMission([memory.id]);
    const authorized = await service.app.inject({
      method: 'POST',
      url: `/missions/${mission.id}/authorize`,
      headers: headers(alice.token),
      payload: { version: mission.reviewVersion },
    });
    expect(authorized.statusCode).toBe(200);
    const authorization = authorized.json().authorization;
    expect(authorization.snapshot.selectedContext).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: memory.id, text: memory.text, source: memory.source }),
      ]),
    );
    await service.app.inject({
      method: 'PATCH',
      url: `/memories/${memory.id}`,
      headers: headers(alice.token),
      payload: {
        text: 'Fictional edited content must not enter prior authorization',
        disclosure: 'allowed',
      },
    });
    const afterEdit = (
      await service.app.inject({ url: `/missions/${mission.id}`, headers: headers(alice.token) })
    ).json();
    expect(afterEdit.authorization).toEqual(authorization);
    expect(afterEdit.context.find((entry: Memory) => entry.id === memory.id)).toMatchObject({
      text: memory.text,
      source: memory.source,
    });
    await service.app.inject({
      method: 'DELETE',
      url: `/memories/${memory.id}`,
      headers: headers(alice.token),
    });
    const afterDelete = (
      await service.app.inject({ url: `/missions/${mission.id}`, headers: headers(alice.token) })
    ).json();
    expect(afterDelete.authorization).toEqual(authorization);
    expect(afterDelete.context.find((entry: Memory) => entry.id === memory.id)).toMatchObject({
      text: memory.text,
      source: memory.source,
    });
    expect(
      (await service.app.inject({ url: '/memories', headers: headers(alice.token) }))
        .json()
        .map((entry: Memory) => entry.id),
    ).not.toContain(memory.id);
  });

  it('cannot authorize or create a request merely by storing a permission memory', async () => {
    const before = (
      await service.app.inject({ url: '/missions', headers: headers(bob.token) })
    ).json();
    const permission = await postMemory(
      {
        text: 'Fictional standing permission to call anyone',
        kind: 'permission',
        confirmation: 'confirmed',
        disclosure: 'allowed',
      },
      bob.token,
    );
    expect(permission.kind).toBe('permission');
    const after = (
      await service.app.inject({ url: '/missions', headers: headers(bob.token) })
    ).json();
    expect(after).toEqual(before);
    expect(
      await service.db.query("SELECT id FROM jobs WHERE owner_id=$1 AND kind='start'", [
        bob.user.id,
      ]),
    ).toEqual([]);
  });
});
