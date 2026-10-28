import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import { Database } from '../apps/server/src/db.js';
import { getConfig } from '../apps/server/src/config.js';

const services: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) {
    await service.app.close();
    await service.db.close();
  }
});
async function fixture() {
  const db = await new Database({ dataDir: 'memory://' }).open();
  const s = await createApp({
    db,
    config: {
      ...getConfig(),
      provider: 'simulator',
      liveEnabled: false,
      openaiKey: undefined,
      googleClientId: undefined,
      googleClientSecret: undefined,
      googleRedirectUri: undefined,
      demoEnabled: true,
    },
    worker: false,
  });
  services.push(s);
  const auth = (await s.app.inject({ method: 'POST', url: '/auth/demo' })).json(),
    headers = { authorization: `Bearer ${auth.token}` };
  const created = await s.app.inject({
    method: 'POST',
    url: '/missions',
    headers,
    payload: { templateId: 'information' },
  });
  expect(created.statusCode).toBe(201);
  return { ...s, auth, headers, mission: created.json() };
}
describe('review binds mutable recipient and context inputs', () => {
  it('changing and verifying a recipient number invalidates the old review before authorization', async () => {
    const f = await fixture();
    const changed = await f.app.inject({
      method: 'PATCH',
      url: `/contacts/${f.mission.contactId}`,
      headers: f.headers,
      payload: { phone: '+12025550998', verified: true },
    });
    expect(changed.statusCode).toBe(200);
    const stale = await f.app.inject({
      method: 'POST',
      url: `/missions/${f.mission.id}/authorize`,
      headers: f.headers,
      payload: { version: 1 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('stale_authorization');
    const reviewed = (
      await f.app.inject({ url: `/missions/${f.mission.id}`, headers: f.headers })
    ).json();
    expect(reviewed.reviewVersion).toBe(2);
    const accepted = await f.app.inject({
      method: 'POST',
      url: `/missions/${f.mission.id}/authorize`,
      headers: f.headers,
      payload: { version: 2 },
    });
    expect(accepted.statusCode).toBe(200);
    expect(JSON.stringify(accepted.json().authorization)).toContain('+12025550998');
  });
  it('new relationship context invalidates a review even when it was not listed in needed memory IDs', async () => {
    const f = await fixture();
    const created = await f.app.inject({
      method: 'POST',
      url: '/memories',
      headers: f.headers,
      payload: {
        kind: 'fact',
        text: 'Fictional newly allowed relationship context',
        scope: 'relationship',
        contactId: f.mission.contactId,
        confirmation: 'confirmed',
        disclosure: 'allowed',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: `/missions/${f.mission.id}/authorize`,
          headers: f.headers,
          payload: { version: 1 },
        })
      ).statusCode,
    ).toBe(409);
    const review = (
      await f.app.inject({ url: `/missions/${f.mission.id}`, headers: f.headers })
    ).json();
    expect(review.reviewVersion).toBe(2);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: `/missions/${f.mission.id}/authorize`,
          headers: f.headers,
          payload: { version: 2 },
        })
      ).statusCode,
    ).toBe(200);
  });
  it('private-to-allowed changes and removal invalidate drafts, while an approved snapshot stays frozen', async () => {
    const f = await fixture();
    const memory = (
      await f.app.inject({
        method: 'POST',
        url: '/memories',
        headers: f.headers,
        payload: {
          kind: 'fact',
          text: 'Fictional original memory',
          scope: 'relationship',
          contactId: f.mission.contactId,
          confirmation: 'confirmed',
          disclosure: 'private',
        },
      })
    ).json();
    await f.app.inject({
      method: 'PATCH',
      url: `/memories/${memory.id}`,
      headers: f.headers,
      payload: { disclosure: 'allowed' },
    });
    let review = (
      await f.app.inject({ url: `/missions/${f.mission.id}`, headers: f.headers })
    ).json();
    expect(review.reviewVersion).toBe(3);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: `/missions/${f.mission.id}/authorize`,
          headers: f.headers,
          payload: { version: 2 },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: `/missions/${f.mission.id}/authorize`,
          headers: f.headers,
          payload: { version: 3 },
        })
      ).statusCode,
    ).toBe(200);
    const before = (
      await f.app.inject({ url: `/missions/${f.mission.id}`, headers: f.headers })
    ).json();
    await f.app.inject({ method: 'DELETE', url: `/memories/${memory.id}`, headers: f.headers });
    review = (await f.app.inject({ url: `/missions/${f.mission.id}`, headers: f.headers })).json();
    expect(review.authorization).toEqual(before.authorization);
    expect(review.context).toEqual(before.context);
  });
  it('contact deletion and recreation preserve owner-scoped opt-out without exporting the telephone number in suppression', async () => {
    const f = await fixture();
    const contact = (
      await f.app.inject({
        method: 'PATCH',
        url: `/contacts/${f.mission.contactId}`,
        headers: f.headers,
        payload: { optedOut: true },
      })
    ).json();
    expect(
      (await f.app.inject({ method: 'DELETE', url: `/contacts/${contact.id}`, headers: f.headers }))
        .statusCode,
    ).toBe(200);
    const restored = (
      await f.app.inject({
        method: 'POST',
        url: '/contacts',
        headers: f.headers,
        payload: { ...contact, id: undefined, optedOut: false },
      })
    ).json();
    expect(restored.optedOut).toBe(true);
    const exported = (await f.app.inject({ url: '/export', headers: f.headers })).json();
    expect(exported.recipientSuppression).toHaveLength(1);
    expect(JSON.stringify(exported.recipientSuppression)).not.toContain(contact.phone);
    expect(exported.recipientSuppression[0].retention).toBe('account_lifetime');
  });
});
