import { randomUUID } from 'node:crypto';
import { afterEach, test, expect } from 'vitest';
import { MissionSchema, type Mission, type Attempt } from '../packages/domain/src/index.js';
import { Database } from '../apps/server/src/db.js';
import { Engine } from '../apps/server/src/engine.js';
import { getConfig } from '../apps/server/src/config.js';
import { ownerTemplates, seedOwner } from '../apps/server/src/seed.js';

const databases: Database[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});
async function fixture(kind = 'appointment', scenario = 'normal', patch: Record<string, any> = {}) {
  const db = await new Database({ dataDir: 'memory://' }).open();
  databases.push(db);
  const engine = new Engine(db, { ...getConfig(), provider: 'simulator', embeddedWorker: false });
  const owner = randomUUID();
  await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
    owner,
    `${owner}@example.test`,
    'unused-test-hash',
  ]);
  await seedOwner(engine.repo, owner, 'Test owner', true);
  const contacts = await engine.repo.list(owner, 'contact'),
    input = ownerTemplates(owner, contacts).find((t) => t.id === kind)!.input;
  const target = new Date(Date.now() + 86_400_000).toISOString();
  if (kind === 'appointment') {
    input.schedule = { ...input.schedule, explicitTargetAt: target };
    input.followUpActions = input.followUpActions.map((a) => ({
      ...a,
      payload: { ...a.payload, startAt: target },
    }));
  }
  const m = MissionSchema.parse({
    ...input,
    ...patch,
    id: randomUUID(),
    ownerId: owner,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await engine.repo.put(owner, 'mission', m);
  await engine.authorize(owner, m.id, 1, scenario);
  return { db, engine, owner, m: await engine.mission(owner, m.id) };
}
async function drain(engine: Engine, limit = 80) {
  for (let i = 0; i < limit; i++) {
    await engine.tick(true);
    const pending = await engine.db.query(
      "SELECT id FROM jobs WHERE status IN ('queued','running')",
    );
    if (!pending.length) return;
  }
  throw new Error(`Worker did not converge after ${limit} bounded ticks`);
}

test('confirmed replacement updates exactly the existing calendar event; stage and action replays are harmless', async () => {
  const { engine, owner, m } = await fixture();
  await drain(engine);
  const detail = await engine.detail(owner, m.id);
  expect(detail.status).toBe('completed');
  expect(detail.attempts).toHaveLength(1);
  expect(detail.actions).toHaveLength(1);
  expect(detail.actions[0].status).toBe('succeeded');
  const before = await engine.repo.list<any>(owner, 'calendar');
  expect(before).toHaveLength(1);
  expect(before[0].revision).toBe(2);
  expect(before[0].startAt).toBe(m.schedule.explicitTargetAt);
  const attempt = detail.attempts[0];
  await engine.repo.enqueue(owner, m.id, 'sim_connected', {
    attemptId: attempt.id,
    scenario: 'normal',
  });
  await engine.repo.enqueue(owner, m.id, 'sim_finish', {
    attemptId: attempt.id,
    scenario: 'normal',
  });
  await engine.repo.enqueue(owner, m.id, 'action', { actionId: detail.actions[0].id });
  await engine.repo.enqueue(owner, m.id, 'start', { scenario: 'normal' });
  await drain(engine);
  const after = await engine.detail(owner, m.id);
  expect(after.attempts).toHaveLength(1);
  expect(after.transcript).toEqual(detail.transcript);
  expect((await engine.repo.list<any>(owner, 'calendar'))[0].revision).toBe(2);
});

test('calendar failure preserves confirmed agreement and retries only its action after worker restart', async () => {
  const { db, engine, owner, m } = await fixture('appointment', 'calendar_failure');
  await engine.tick(true);
  await engine.tick(true);
  await engine.tick(true);
  await engine.tick(true);
  const pending = await engine.detail(owner, m.id);
  expect(pending.status).toBe('completed');
  expect(pending.actions[0].status).toBe('pending');
  expect(pending.actions[0].error).toContain('calendar update pending');
  expect(pending.attempts).toHaveLength(1);
  expect((await engine.repo.list<any>(owner, 'calendar'))[0].revision).toBe(1);
  const restarted = new Engine(db, {
    ...getConfig(),
    provider: 'simulator',
    embeddedWorker: false,
  });
  await drain(restarted);
  const done = await restarted.detail(owner, m.id);
  expect(done.actions[0].status).toBe('succeeded');
  expect(done.attempts).toHaveLength(1);
  expect((await restarted.repo.list<any>(owner, 'calendar'))[0].revision).toBe(2);
});

test('no-answer retries are bounded and a dropped tentative agreement is never redialled', async () => {
  const f = await fixture('information', 'no_answer', {
    schedule: { timezone: 'America/New_York', retryLimit: 2, maxDurationSeconds: 180 },
  });
  await drain(f.engine);
  const d = await f.engine.detail(f.owner, f.m.id);
  expect(d.status).toBe('unresolved');
  expect(d.attempts).toHaveLength(3);
  expect(d.attempts.every((a) => a.status === 'no_answer')).toBe(true);
  expect(d.actions).toHaveLength(0);
  const dropped = await fixture('appointment', 'dropped_uncertain', {
    schedule: {
      timezone: 'America/New_York',
      explicitTargetAt: new Date(Date.now() + 86_400_000).toISOString(),
      retryLimit: 2,
      maxDurationSeconds: 180,
    },
  });
  await drain(dropped.engine);
  const uncertain = await dropped.engine.detail(dropped.owner, dropped.m.id);
  expect(uncertain.attempts).toHaveLength(1);
  expect(uncertain.outcome?.status).toBe('uncertain');
  expect(uncertain.actions).toHaveLength(0);
});

test('cancel before dispatch or after connection cannot be resurrected by stale jobs or worker restart', async () => {
  for (const connected of [false, true]) {
    const { db, engine, owner, m } = await fixture();
    if (connected) {
      await engine.tick(true);
      await engine.tick(true);
    }
    await engine.cancel(owner, m.id);
    await engine.markUncertain(owner, m.id, 'stale failure');
    await engine.repo.enqueue(owner, m.id, 'start', { scenario: 'normal' });
    const restarted = new Engine(db, {
      ...getConfig(),
      provider: 'simulator',
      embeddedWorker: false,
    });
    await drain(restarted);
    const d = await restarted.detail(owner, m.id);
    expect(d.status).toBe('cancelled');
    expect(d.actions).toHaveLength(0);
    expect(d.attempts.every((a) => a.status === 'cancelled')).toBe(true);
    expect((await restarted.repo.list<any>(owner, 'calendar'))[0].revision).toBe(1);
  }
});

test('expired running start lease resumes the same attempt without a duplicate commitment', async () => {
  const { engine, owner, m } = await fixture();
  await engine.tick(true);
  await engine.db.query(
    "UPDATE jobs SET status='running',lease_until=now()-interval '1 second' WHERE mission_id=$1 AND kind='start'",
    [m.id],
  );
  const restarted = new Engine(engine.db, {
    ...getConfig(),
    provider: 'simulator',
    embeddedWorker: false,
  });
  await drain(restarted);
  const d = await restarted.detail(owner, m.id);
  expect(d.attempts).toHaveLength(1);
  expect(d.actions).toHaveLength(1);
  expect(d.actions[0].status).toBe('succeeded');
  expect((await engine.repo.list<any>(owner, 'calendar'))[0].revision).toBe(2);
});

test('actions use the frozen declaration; altered action payload cannot update a calendar', async () => {
  const { engine, owner, m } = await fixture();
  await engine.tick(true);
  await engine.tick(true);
  await engine.tick(true);
  const [action] = await engine.repo.list<any>(owner, 'action', m.id);
  await engine.repo.put(
    owner,
    'action',
    { ...action, payload: { ...action.payload, startAt: '2035-01-01T00:00:00Z' } },
    m.id,
  );
  await drain(engine);
  expect((await engine.repo.list<any>(owner, 'action', m.id))[0].status).toBe('blocked');
  expect((await engine.repo.list<any>(owner, 'calendar'))[0].revision).toBe(1);
});

test('cancel after confirmed agreement preserves already completed work and cancels pending actions', async () => {
  const completed = await fixture();
  await drain(completed.engine);
  await completed.engine.cancel(completed.owner, completed.m.id);
  expect((await completed.engine.detail(completed.owner, completed.m.id)).actions[0].status).toBe(
    'succeeded',
  );
  expect((await completed.engine.repo.list<any>(completed.owner, 'calendar'))[0].revision).toBe(2);
  const pending = await fixture();
  await pending.engine.tick(true);
  await pending.engine.tick(true);
  await pending.engine.tick(true);
  await pending.engine.cancel(pending.owner, pending.m.id);
  await drain(pending.engine);
  expect((await pending.engine.detail(pending.owner, pending.m.id)).actions[0].status).toBe(
    'cancelled',
  );
  expect((await pending.engine.repo.list<any>(pending.owner, 'calendar'))[0].revision).toBe(1);
});

test('silent boundary tightening survives finish and prevents a scripted agreement and follow-ups', async () => {
  const { engine, owner, m } = await fixture();
  await engine.tick(true);
  await engine.tick(true);
  const [attempt] = await engine.repo.list<any>(owner, 'attempt', m.id);
  await engine.repo.put(
    owner,
    'attempt',
    {
      ...attempt,
      ownerGuidance: [{ kind: 'tighten_boundary', text: 'Do not make any commitment.' }],
      transcript: [
        ...attempt.transcript,
        {
          id: 'owner-note',
          speaker: 'owner',
          text: 'Do not make any commitment.',
          language: 'en',
          at: new Date().toISOString(),
        },
      ],
    },
    m.id,
  );
  await engine.repo.put(owner, 'mission', {
    ...(await engine.mission(owner, m.id)),
    activeBoundaryNotes: ['Do not make any commitment.'],
  });
  await drain(engine);
  const d = await engine.detail(owner, m.id);
  expect(d.status).toBe('unresolved');
  expect(d.outcome?.agentCommitments).toHaveLength(0);
  expect(d.actions).toHaveLength(0);
  expect(d.transcript.some((t) => t.id === 'owner-note')).toBe(true);
});

test('recipient opt-out in a final live transcript blocks future calls and ignores delayed status events', async () => {
  const { engine, owner, m } = await fixture('information');
  await engine.db.query("UPDATE jobs SET status='cancelled' WHERE mission_id=$1", [m.id]);
  const a: Attempt = {
    id: randomUUID(),
    ownerId: owner,
    missionId: m.id,
    status: 'connected',
    provider: 'elevenlabs',
    providerConversationId: 'conversation-one',
    startedAt: new Date().toISOString(),
    transcript: [],
  };
  await engine.repo.put(owner, 'attempt', a, m.id);
  const c = {
    agent_id: engine.config.agentId ?? 'configured-agent',
    conversation_id: 'conversation-one',
    status: 'done' as const,
    transcript: [{ role: 'user' as const, message: 'Do not call me again.', time_in_call_secs: 4 }],
  };
  await engine.applyProviderConversation(m, a, c);
  expect((await engine.detail(owner, m.id)).outcome?.status).toBe('refused');
  expect((await engine.repo.get<any>(owner, 'contact', m.contactId)).optedOut).toBe(true);
  await engine.applyProviderConversation(m, a, { ...c, status: 'in-progress' });
  expect((await engine.detail(owner, m.id)).attempts[0].status).toBe('refused');
  await expect(
    engine.applyProviderConversation(m, a, { ...c, conversation_id: 'other-user-conversation' }),
  ).rejects.toMatchObject({ code: 'provider_identity_mismatch' });
});

test('retention sweeper strips expired transcript and guidance once, retaining the outcome and deduplicating provider deletion', async () => {
  const { engine, owner, m } = await fixture('information');
  await drain(engine);
  const [a] = await engine.repo.list<any>(owner, 'attempt', m.id);
  await engine.repo.put(
    owner,
    'attempt',
    {
      ...a,
      provider: 'elevenlabs',
      providerConversationId: 'retention-conversation',
      endedAt: '2000-01-01T00:00:00Z',
      ownerGuidance: [{ text: 'old guidance' }],
    },
    m.id,
  );
  await engine.sweepRetention();
  await engine.sweepRetention();
  const expired = await engine.repo.get<any>(owner, 'attempt', a.id);
  expect(expired.transcript).toHaveLength(0);
  expect(expired.ownerGuidance).toHaveLength(0);
  expect(expired.transcriptExpired).toBe(true);
  expect(expired.outcome.overview).toBe(a.outcome.overview);
  expect(
    await engine.db.query("SELECT id FROM jobs WHERE kind='provider_delete' AND mission_id=$1", [
      m.id,
    ]),
  ).toHaveLength(1);
});

test('review version and hostile relationship context are enforced independently of UI', async () => {
  const { engine, owner, m } = await fixture('information');
  const contact = await engine.repo.get<any>(owner, 'contact', m.contactId);
  const unrelated = (await engine.repo.list<any>(owner, 'memory')).find(
    (x) => x.disclosure === 'private',
  );
  const draft = {
    ...m,
    id: randomUUID(),
    status: 'draft' as const,
    authorization: undefined,
    reviewVersion: 2,
    neededMemoryIds: [unrelated.id],
  };
  await engine.repo.put(owner, 'mission', draft);
  await expect(engine.authorize(owner, draft.id, 1, 'normal')).rejects.toMatchObject({
    code: 'stale_authorization',
  });
  await engine.authorize(owner, draft.id, 2, 'normal');
  const d = await engine.detail(owner, draft.id);
  expect(d.context.some((x) => x.id === unrelated.id)).toBe(false);
  expect(d.authorization?.version).toBe(2);
  expect(contact.verified).toBe(true);
});

test('a wrong-person response invalidates recipient verification and requires a fresh number check', async () => {
  const { engine, owner, m } = await fixture('information', 'wrong_person');
  await drain(engine);
  expect((await engine.repo.get<any>(owner, 'contact', m.contactId)).verified).toBe(false);
  const revised = { ...m, id: randomUUID(), status: 'draft' as const, authorization: undefined };
  await engine.repo.put(owner, 'mission', revised);
  await expect(engine.authorize(owner, revised.id, 1, 'normal')).rejects.toMatchObject({
    code: 'recipient_unverified',
  });
});

test('queued live missions cannot bypass the owner dispatch budget, and changed configuration prevents dispatch', async () => {
  const { engine, owner, m } = await fixture('information');
  const contact = await engine.repo.get<any>(owner, 'contact', m.contactId);
  engine.config = {
    ...engine.config,
    provider: 'elevenlabs',
    liveEnabled: true,
    liveOwnerId: owner,
    publicBaseUrl: 'https://pilot.example.test',
    webhookSecret: 'test-secret',
    retentionVerified: true,
    llmProvider: 'Test LLM',
    retentionDisclosure: 'Transcript retained for the configured pilot period.',
    standardVoice: 'test-standard',
    recipients: [contact.phone],
  };
  engine.verifyLiveSetup = async () => {}; // Read-only inspection is covered by provider transport tests.
  let dispatched = 0;
  const introductions: string[] = [];
  engine.eleven = {
    startCall: async (input: any) => {
      introductions.push(input.firstMessage);
      return {
        success: true,
        conversation_id: `fake-${++dispatched}`,
        callSid: `fake-call-${dispatched}`,
      };
    },
  } as any;
  engine.twilio = { endCall: async () => {} } as any;
  await engine.cancel(owner, m.id);
  const missions: Mission[] = [];
  for (let i = 0; i < 6; i++) {
    const draft = { ...m, id: randomUUID(), status: 'draft' as const, authorization: undefined };
    await engine.repo.put(owner, 'mission', draft);
    missions.push(await engine.authorize(owner, draft.id, 1, 'normal'));
  }
  for (let i = 0; i < 6; i++) await engine.tick(true);
  expect(dispatched).toBe(5);
  expect(await engine.repo.list(owner, 'attempt')).toHaveLength(5);
  expect(
    introductions.every(
      (text) =>
        !text.includes(m.title) &&
        text.includes('AI assistant') &&
        text.includes('approved message or questions'),
    ),
  ).toBe(true);
  expect((await engine.mission(owner, missions[5].id)).status).toBe('unresolved');
  // A previously approved mission must pass the current worker configuration too.
  const disabled = await fixture('information');
  disabled.engine.config = {
    ...engine.config,
    liveEnabled: false,
    recipients: [
      (await disabled.engine.repo.get<any>(disabled.owner, 'contact', disabled.m.contactId)).phone,
    ],
  };
  disabled.engine.eleven = engine.eleven;
  disabled.engine.twilio = engine.twilio;
  await disabled.engine.tick(true);
  expect(await disabled.engine.repo.list(disabled.owner, 'attempt')).toHaveLength(0);
  expect((await disabled.engine.mission(disabled.owner, disabled.m.id)).status).toBe('unresolved');
  expect(dispatched).toBe(5);
});

test('a simulator authorization cannot become a live call when provider configuration changes', async () => {
  const { engine, owner, m } = await fixture('information');
  const contact = await engine.repo.get<any>(owner, 'contact', m.contactId);
  engine.config = {
    ...engine.config,
    provider: 'elevenlabs',
    liveEnabled: true,
    retentionVerified: true,
    llmProvider: 'Test LLM',
    retentionDisclosure: 'No recording; configured transcript retention.',
    standardVoice: 'test-standard',
    recipients: [contact.phone],
  };
  let dispatched = 0;
  engine.eleven = {
    startCall: async () => {
      dispatched++;
      throw new Error('A simulated authorization must never dispatch a live call.');
    },
  } as any;
  engine.twilio = { endCall: async () => {} } as any;
  // Even changing the mutable mission cannot change the provider in its frozen snapshot.
  await engine.repo.put(owner, 'mission', { ...m, executionProvider: 'elevenlabs' });
  await engine.tick(true);
  const current = await engine.mission(owner, m.id);
  expect(m.authorization?.snapshot.executionProvider).toBe('simulator');
  expect(dispatched).toBe(0);
  expect(await engine.repo.list(owner, 'attempt')).toHaveLength(0);
  expect(current.status).toBe('unresolved');
  expect((current as any).executionNotice).toContain('provider changed after authorization');
  expect((await engine.detail(owner, m.id)).demo).toBe(true);
});

test('concurrent cancellation and stage completion never restore active work or pending actions', async () => {
  const { engine, owner, m } = await fixture();
  await engine.tick(true);
  await engine.tick(true);
  const otherWorker = new Engine(engine.db, engine.config);
  await Promise.all([otherWorker.tick(true), engine.cancel(owner, m.id)]);
  await drain(engine);
  const d = await engine.detail(owner, m.id);
  expect(d.status).toBe('cancelled');
  expect(d.actions.every((a) => ['cancelled', 'succeeded'].includes(a.status))).toBe(true);
  expect(
    await engine.db.query(
      "SELECT id FROM jobs WHERE mission_id=$1 AND status IN ('queued','running')",
      [m.id],
    ),
  ).toHaveLength(0);
});
