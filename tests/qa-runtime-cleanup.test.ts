import { openTestDatabase } from './support/test-database.js';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { Database } from '../apps/server/src/db.js';
import { Engine } from '../apps/server/src/engine.js';
import { getConfig } from '../apps/server/src/config.js';
import { runtimeReadiness } from '../apps/server/src/readiness.js';

it('DATA-01 readiness counts pending and failed OAuth revocation as remote cleanup', async () => {
  const db = await openTestDatabase({ dataDir: 'memory://' });
  const owner = randomUUID();
  try {
    await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
      owner,
      'qa-cleanup@example.invalid',
      'fictional-unused-hash',
    ]);
    const engine = new Engine(db, {
      ...getConfig(),
      production: false,
      provider: 'simulator',
      liveEnabled: false,
      elevenKey: undefined,
      agentId: undefined,
      phoneId: undefined,
      twilioSid: undefined,
      twilioToken: undefined,
    });
    await engine.repo.enqueue(owner, null, 'google_revoke', {
      token: 'fictional-revocation-token-never-disclose',
    });
    const pending = await runtimeReadiness(db);
    expect(pending.cleanup).toMatchObject({ status: 'pending', pending: 1, failed: 0 });
    engine.googleRevoke = async () => {
      throw new Error('fictional-provider-private-body');
    };
    for (let attempt = 0; attempt < 5; attempt++) await engine.tick(true);
    const failed = await runtimeReadiness(db);
    expect(failed.cleanup).toMatchObject({ status: 'attention', pending: 0, failed: 1 });
    expect(failed.status).toBe('degraded');
    expect(JSON.stringify({ pending, failed })).not.toMatch(
      /fictional-revocation-token|fictional-provider-private-body/,
    );
  } finally {
    await db.close();
  }
});
