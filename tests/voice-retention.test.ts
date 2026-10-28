import { openTestDatabase } from './support/test-database.js';
import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import { Database } from '../apps/server/src/db.js';
import { getConfig } from '../apps/server/src/config.js';

test('voice expiry removes content but an old first-turn retry cannot create a second mission', async () => {
  const network = vi.fn(async () => {
    throw new Error('No external network is permitted');
  });
  vi.stubGlobal('fetch', network);
  const db = await openTestDatabase({ dataDir: 'memory://' });
  const service = await createApp({
    db,
    worker: false,
    config: {
      ...getConfig(),
      provider: 'simulator',
      elevenKey: undefined,
      ownerAgentId: undefined,
      demoEnabled: true,
    },
  });
  try {
    const login = (
      await service.app.inject({ method: 'POST', url: '/auth/demo', payload: {} })
    ).json();
    const request = {
      requestId: randomUUID(),
      text: 'Call Jordan Lee and tell him I am near the fountain.',
    };
    const response = await service.voice.turn(login.user.id, request);
    expect(response.status).toBe('queued');
    await service.engine.sweepRetention(new Date(Date.now() + 2 * 86400000));
    expect(
      await service.repo.get(login.user.id, 'voice_session', response.sessionId),
    ).toBeUndefined();
    const receipts = await service.repo.list<any>(login.user.id, 'voice_turn');
    expect(receipts).toHaveLength(1);
    expect(receipts[0].status).toBe('expired');
    expect(receipts[0].response).toBeUndefined();
    expect(receipts[0].missionId).toBe(response.missionId);
    await expect(service.voice.turn(login.user.id, request)).rejects.toMatchObject({
      code: 'voice_request_expired',
    });
    expect(await service.repo.list(login.user.id, 'mission')).toHaveLength(1);
    expect(network).not.toHaveBeenCalled();
  } finally {
    await service.app.close();
    await db.close();
    vi.unstubAllGlobals();
  }
});
