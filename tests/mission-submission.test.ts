import { randomUUID } from 'node:crypto';
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
async function fixture() {
  const db = await new Database({ dataDir: 'memory://' }).open();
  const s = await createApp({
    db,
    worker: false,
    config: {
      ...getConfig(),
      demoEnabled: true,
      provider: 'simulator',
      liveEnabled: false,
      openaiKey: undefined,
    },
  });
  services.push(s);
  const a = (await s.app.inject({ method: 'POST', url: '/auth/demo' })).json();
  return { ...s, a, headers: { authorization: `Bearer ${a.token}` } };
}
describe('durable draft creation receipts', () => {
  it('two concurrent submissions and a lost-response replay resolve one draft, then no replay recreates a deleted draft', async () => {
    const f = await fixture(),
      requestId = randomUUID(),
      payload = { requestId, templateId: 'information' };
    const replies = await Promise.all(
      [1, 2].map(() =>
        f.app.inject({ method: 'POST', url: '/missions', headers: f.headers, payload }),
      ),
    );
    expect(replies.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    expect(replies[0].json().id).toBe(replies[1].json().id);
    const saved = (
      await f.app.inject({ url: `/missions/requests/${requestId}`, headers: f.headers })
    ).json();
    expect(saved.id).toBe(replies[0].json().id);
    expect(await f.repo.list(f.a.user.id, 'mission')).toHaveLength(1);
    await f.app.inject({ method: 'DELETE', url: `/missions/${saved.id}`, headers: f.headers });
    expect(
      (await f.app.inject({ method: 'POST', url: '/missions', headers: f.headers, payload }))
        .statusCode,
    ).toBe(410);
    expect(await f.repo.list(f.a.user.id, 'mission')).toHaveLength(0);
  });
  it('changed inputs under an uncertain submission cannot create a second draft or overwrite the first', async () => {
    const f = await fixture(),
      requestId = randomUUID();
    const saved = (
      await f.app.inject({
        method: 'POST',
        url: '/missions',
        headers: f.headers,
        payload: { requestId, templateId: 'information' },
      })
    ).json();
    const changed = await f.app.inject({
      method: 'POST',
      url: '/missions',
      headers: f.headers,
      payload: { requestId, templateId: 'information', title: 'A materially different request' },
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error).toBe('submission_changed');
    expect((await f.repo.get(f.a.user.id, 'mission', saved.id)).title).toBe(saved.title);
    expect(await f.repo.list(f.a.user.id, 'mission')).toHaveLength(1);
  });
  it('another owner cannot read a creation receipt even with the exact request UUID', async () => {
    const f = await fixture(),
      requestId = randomUUID();
    await f.app.inject({
      method: 'POST',
      url: '/missions',
      headers: f.headers,
      payload: { requestId, templateId: 'information' },
    });
    const b = (await f.app.inject({ method: 'POST', url: '/auth/demo' })).json();
    expect(
      (
        await f.app.inject({
          url: `/missions/requests/${requestId}`,
          headers: { authorization: `Bearer ${b.token}` },
        })
      ).statusCode,
    ).toBe(404);
    const receipts = await f.repo.list<any>(f.a.user.id, 'mission_submission');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).not.toHaveProperty('arguments');
    expect(JSON.stringify(receipts)).not.toContain('Can you');
  });
});
