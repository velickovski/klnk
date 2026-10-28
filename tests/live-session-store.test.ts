import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../apps/server/src/db.js';
import { newUser } from '../apps/server/src/auth.js';
import { LiveSessionStore } from '../apps/server/src/live-session-store.js';

describe('durable owner-bound Live reservation metadata', () => {
  let db: Database;
  beforeAll(async () => {
    db = await new Database({ dataDir: 'memory://' }).open();
  });
  afterAll(async () => {
    await db.close();
  });
  async function fixture(
    limits = { maxConcurrent: 100, maxPerOwnerDay: 20, maxDurationSeconds: 300 },
  ) {
    const owner = await newUser(
      db,
      `${randomUUID()}@example.invalid`,
      'A fictional platform test password',
    );
    return { owner: owner.id, store: new LiveSessionStore(db, limits) };
  }
  it('reserves once for concurrent duplicates and reconstructs the same receipt in a new store', async () => {
    const { owner, store } = await fixture();
    const requestId = randomUUID();
    const results = await Promise.all([
      store.reserve(owner, requestId),
      store.reserve(owner, requestId),
    ]);
    expect(results.filter((value) => value.created)).toHaveLength(1);
    expect(results[0].receipt.id).toBe(results[1].receipt.id);
    expect(await new LiveSessionStore(db).getByRequest(owner, requestId)).toEqual(
      results[0].receipt,
    );
    await expect(store.reserve(owner, randomUUID())).rejects.toMatchObject({
      code: 'voice_session_unresolved',
    });
  });
  it('enforces a global unresolved cap across owners', async () => {
    const a = await fixture(),
      b = await fixture();
    const [count] = await db.query(
      "SELECT count(*)::int AS total FROM live_sessions WHERE status IN ('creating','active','closing','unconfirmed')",
    );
    const limits = { maxConcurrent: count.total + 1, maxPerOwnerDay: 20, maxDurationSeconds: 300 };
    const results = await Promise.allSettled([
      new LiveSessionStore(db, limits).reserve(a.owner, randomUUID()),
      new LiveSessionStore(db, limits).reserve(b.owner, randomUUID()),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      (results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.code,
    ).toBe('voice_concurrency_limit');
  });
  it('enforces daily creation limits after completed sessions', async () => {
    const { owner, store } = await fixture({
      maxConcurrent: 100,
      maxPerOwnerDay: 1,
      maxDurationSeconds: 300,
    });
    let { receipt } = await store.reserve(owner, randomUUID());
    receipt = await store.attachProvider(
      owner,
      receipt.id,
      receipt.version,
      `provider-${randomUUID()}`,
    );
    receipt = await store.transition(owner, receipt.id, receipt.version, 'closed', {
      source: 'provider_event',
      event: 'session.closed',
      usage: { totalTokens: 12 },
    });
    await expect(store.reserve(owner, randomUUID())).rejects.toMatchObject({
      code: 'voice_daily_limit',
    });
    const [row] = await db.query('SELECT terminal_evidence FROM live_sessions WHERE id=$1', [
      receipt.id,
    ]);
    expect(row.terminal_evidence).not.toContain('session.closed');
  });
  it('owner-bound reads and CAS cannot attach or close another account session', async () => {
    const a = await fixture(),
      b = await fixture();
    const requestId = randomUUID();
    let { receipt } = await a.store.reserve(a.owner, requestId);
    expect(await a.store.get(b.owner, receipt.id)).toBeUndefined();
    expect(await a.store.getByRequest(b.owner, requestId)).toBeUndefined();
    await expect(
      a.store.attachProvider(b.owner, receipt.id, receipt.version, 'provider-foreign'),
    ).rejects.toMatchObject({ statusCode: 404 });
    receipt = await a.store.attachProvider(
      a.owner,
      receipt.id,
      receipt.version,
      `provider-${randomUUID()}`,
    );
    expect(await a.store.findByProviderId(b.owner, receipt.providerSessionId!)).toBeUndefined();
    await expect(
      a.store.transition(a.owner, receipt.id, receipt.version - 1, 'closing'),
    ).rejects.toMatchObject({ code: 'voice_receipt_conflict' });
    const transitions = await Promise.allSettled([
      a.store.transition(a.owner, receipt.id, receipt.version, 'closing'),
      a.store.transition(a.owner, receipt.id, receipt.version, 'unconfirmed'),
    ]);
    expect(transitions.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
  });
  it('unknown creation remains blocked after expiry and store reconstruction', async () => {
    const { owner, store } = await fixture();
    let { receipt } = await store.reserve(owner, randomUUID());
    await db.query("UPDATE live_sessions SET expires_at=now()-interval '1 hour' WHERE id=$1", [
      receipt.id,
    ]);
    receipt = await store.transition(
      owner,
      receipt.id,
      receipt.version,
      'unconfirmed',
      undefined,
      'creation_uncertain',
    );
    const restarted = new LiveSessionStore(db);
    expect((await restarted.listUnresolved(owner))[0].status).toBe('unconfirmed');
    await expect(restarted.reserve(owner, randomUUID())).rejects.toMatchObject({
      code: 'voice_session_unresolved',
    });
    await store.releaseControllerLeases();
    receipt = (await restarted.claimUnresolved()).find((value) => value.id === receipt.id)!;
    await expect(
      restarted.transition(owner, receipt.id, receipt.version, 'closed'),
    ).rejects.toMatchObject({ code: 'voice_terminal_evidence_required' });
    await expect(
      restarted.transition(owner, receipt.id, receipt.version, 'closed', {
        source: 'provider_event',
        event: 'session.closed',
      }),
    ).rejects.toMatchObject({ code: 'voice_terminal_identity_required' });
  });
  it('requires provider terminal evidence and prevents closed-session resurrection', async () => {
    const { owner, store } = await fixture();
    let { receipt } = await store.reserve(owner, randomUUID());
    receipt = await store.attachProvider(
      owner,
      receipt.id,
      receipt.version,
      `provider-${randomUUID()}`,
    );
    await expect(
      store.transition(owner, receipt.id, receipt.version, 'closed'),
    ).rejects.toMatchObject({ code: 'voice_terminal_evidence_required' });
    receipt = await store.transition(owner, receipt.id, receipt.version, 'closing');
    receipt = await store.transition(owner, receipt.id, receipt.version, 'closed', {
      source: 'provider_readback',
      event: 'session.closed',
      reasonCode: 'completed',
    });
    await expect(
      store.transition(owner, receipt.id, receipt.version, 'unconfirmed'),
    ).rejects.toMatchObject({ code: 'voice_receipt_conflict' });
    expect((await store.reserve(owner, randomUUID())).created).toBe(true);
  });
  it('does not reserve for deleted owners or accept arbitrary evidence content', async () => {
    const { owner, store } = await fixture();
    await db.query('UPDATE users SET deleted_at=now() WHERE id=$1', [owner]);
    await expect(store.reserve(owner, randomUUID())).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      store.transition(owner, 'missing', 1, 'closed', {
        source: 'provider_event',
        event: 'session.closed',
        transcript: 'must not persist',
      } as any),
    ).rejects.toThrow();
  });
  it('does not claim a healthy peer controller and fences stale transitions after failover', async () => {
    const { owner, store } = await fixture();
    let { receipt } = await store.reserve(owner, randomUUID());
    receipt = await store.attachProvider(
      owner,
      receipt.id,
      receipt.version,
      `provider-${randomUUID()}`,
    );
    const replacement = new LiveSessionStore(db);
    expect((await replacement.claimUnresolved()).some((row) => row.id === receipt.id)).toBe(false);
    expect((await store.renewControllerLeases()).some((row) => row.id === receipt.id)).toBe(true);
    await db.query(
      "UPDATE live_sessions SET controller_lease_until=now()-interval '1 second' WHERE id=$1",
      [receipt.id],
    );
    const claimed = (await replacement.claimUnresolved()).find((row) => row.id === receipt.id)!;
    expect(replacement.ownsController(claimed)).toBe(true);
    expect((await store.renewControllerLeases()).some((row) => row.id === receipt.id)).toBe(false);
    await expect(
      store.transition(owner, claimed.id, claimed.version, 'closing'),
    ).rejects.toMatchObject({ code: 'voice_controller_lost' });
    const closing = await replacement.transition(owner, claimed.id, claimed.version, 'closing');
    expect(closing.status).toBe('closing');
  });
  it('records a late accepted provider identity after fencing without reclaiming control', async () => {
    const { owner, store } = await fixture();
    const { receipt } = await store.reserve(owner, randomUUID());
    await store.releaseControllerLeases();
    const replacement = new LiveSessionStore(db);
    const claimed = (await replacement.claimUnresolved()).find((row) => row.id === receipt.id)!;
    await expect(
      store.attachProvider(owner, receipt.id, receipt.version, 'fictional-late-provider'),
    ).rejects.toMatchObject({ code: 'voice_controller_lost' });
    const observed = await store.recordProviderObservation(
      owner,
      receipt.id,
      'fictional-late-provider',
    );
    expect(observed).toMatchObject({
      status: 'unconfirmed',
      providerSessionId: 'fictional-late-provider',
      controllerId: replacement.controllerId,
    });
    expect(store.ownsController(observed)).toBe(false);
    expect(replacement.ownsController(observed)).toBe(true);
    expect(observed.version).toBeGreaterThan(claimed.version);
    await expect(
      store.recordProviderObservation(owner, receipt.id, 'different-provider'),
    ).rejects.toMatchObject({ code: 'voice_receipt_conflict' });
  });
});
