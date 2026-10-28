import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Database } from '../apps/server/src/db.js';
import { newUser } from '../apps/server/src/auth.js';
import { NetworkCoordinator } from '../apps/server/src/network/coordination.js';
import { InternalCalendar } from '../apps/server/src/network/calendar.js';
import { OwnerIntentService } from '../apps/server/src/network/owner-intent.js';

// Deliberate opt-in only. Never imported by a default test and never uses production records.
if (!process.argv.includes('--run-openai')) {
  process.stdout.write(
    'Not run. Add --run-openai to authorize at most two fictional owner-context Responses requests.\n',
  );
  process.exit(0);
}
if (!process.env.OPENAI_API_KEY) {
  process.stderr.write('Missing server OPENAI_API_KEY. No request was made.\n');
  process.exit(1);
}
const db = await new Database({ dataDir: 'memory://' }).open(),
  calendar = new InternalCalendar(db),
  coordinator = new NetworkCoordinator(db, calendar);
let calls = 0;
const contexts: Array<{ trusted: string[]; peers: string[] }> = [];
const privateMarkers = ['fictional_private_policy_A', 'fictional_private_policy_B'];
const contextChecks: boolean[] = [],
  httpStatuses: number[] = [];
let endpointsAllowed = true;
const transport: typeof fetch = async (url, options) => {
  if (
    String(url) !== 'https://api.openai.com/v1/responses' ||
    options?.method !== 'POST' ||
    options.redirect !== 'error' ||
    ++calls > 2
  ) {
    endpointsAllowed = false;
    throw new Error('Smoke request budget or egress scope exceeded.');
  }
  const body = JSON.parse(String(options.body));
  if (
    body.model !== 'gpt-6.1-sol' ||
    body.store !== false ||
    body.max_output_tokens > 2000 ||
    body.tools?.length ||
    body.previous_response_id ||
    body.conversation
  )
    throw new Error('Smoke request exceeded its model/context scope.');
  const context = JSON.parse(
    body.input.find((item: { role: string }) => item.role === 'user').content,
  );
  contexts.push({
    trusted: context.ownerPolicy.trustedMemberIds,
    peers: context.acceptedConnections.map((item: { peerId: string }) => item.peerId),
  });
  const contextText = String(options.body);
  contextChecks.push(
    contextText.includes(privateMarkers[calls - 1]) &&
      !contextText.includes(privateMarkers[2 - calls]),
  );
  const response = await fetch(url, { ...options, redirect: 'error' });
  httpStatuses.push(response.status);
  return response;
};
const report: {
  kind: string;
  at: string;
  model: string;
  providerCalls: number;
  httpStatuses: number[];
  reason?: string;
  legacyJobs?: number;
  legacyProviderEvents?: number;
  internalEvents?: number;
  results: Array<{
    ownerContext: string;
    status: string;
    reason?: string;
    operation?: string;
    actualState?: string;
    slotCount: number;
    expectedConnection: boolean;
  }>;
  checks: { scope: boolean; separateOwnerContexts: boolean; noExternalEffects: boolean };
  passed: boolean;
} = {
  kind: 'klnk_internal_owner_intent_smoke_v1',
  at: new Date().toISOString(),
  model: 'gpt-6.1-sol',
  providerCalls: 0,
  httpStatuses,
  results: [],
  checks: { scope: false, separateOwnerContexts: false, noExternalEffects: false },
  passed: false,
};
try {
  const a = (
      await newUser(
        db,
        `fixture-${randomUUID()}@example.invalid`,
        'Fictional isolated owner password',
      )
    ).id,
    b = (
      await newUser(
        db,
        `fixture-${randomUUID()}@example.invalid`,
        'Fictional isolated peer password',
      )
    ).id;
  for (const [owner, name] of [
    [a, 'Fictional Alex'],
    [b, 'Fictional Jordan'],
  ])
    await db.query("INSERT INTO resources(id,owner_id,kind,payload) VALUES($1,$1,'profile',$2)", [
      owner,
      db.encrypt({ id: owner, name }),
    ]);
  const peer = await coordinator.identity(b),
    connection = await coordinator.invite(a, peer.member.memberCode);
  await coordinator.updateConnection(b, connection.id, {
    action: 'accept',
    version: connection.version,
  });
  for (const [index, owner, other] of [
    [0, a, b],
    [1, b, a],
  ] as const) {
    const old = await coordinator.policy(owner),
      { ownerId, version, updatedAt, ...input } = old;
    await coordinator.savePolicy(
      owner,
      {
        ...input,
        enabled: true,
        trustedMemberIds: [other],
        topics: ['routine', privateMarkers[index]],
        allowMeetings: true,
        allowQuestions: true,
        autoAcceptMeetings: true,
        timezone: 'UTC',
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        workStartMinute: 0,
        workEndMinute: 1440,
        minNoticeMinutes: 0,
      },
      version,
    );
  }
  const service = new OwnerIntentService(db, coordinator, {
    apiKey: process.env.OPENAI_API_KEY,
    fetch: transport,
  });
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  for (const [index, owner, name, question] of [
    [0, a, 'Fictional Jordan', false],
    [1, b, 'Fictional Alex', true],
  ] as const) {
    const commandId = randomUUID(),
      text = question
        ? `Ask ${name} what the routine blue-gate meeting instructions are. Keep this a question; make no commitment.`
        : `Schedule a routine 30 minute meeting with ${name} on ${tomorrow} at 10:00 UTC at the fictional blue gate.`;
    const result = await service.execute(owner, { commandId, text });
    await coordinator.tick();
    const read = await service.read(owner, commandId),
      plan = result.plan ?? read.conversation?.request;
    report.results.push({
      ownerContext: index === 0 ? 'A' : 'B',
      status: read.status,
      reason: read.reason,
      operation: plan?.kind,
      actualState: read.conversation?.state,
      slotCount: plan?.candidateSlots.length ?? 0,
      expectedConnection: !plan || plan.connectionId === connection.id,
    });
  }
  report.providerCalls = calls;
  report.checks.separateOwnerContexts =
    contexts.length === 2 &&
    contextChecks.length === 2 &&
    contextChecks.every(Boolean) &&
    contexts[0].trusted.join() === b &&
    contexts[0].peers.join() === b &&
    contexts[1].trusted.join() === a &&
    contexts[1].peers.join() === a;
  const persisted = (await coordinator.inbox(a)).conversations,
    events = (await calendar.list(a)).events;
  report.internalEvents = events.length;
  report.legacyJobs = Number((await db.query('SELECT count(*) AS total FROM jobs'))[0].total);
  report.legacyProviderEvents = Number(
    (await db.query('SELECT count(*) AS total FROM provider_events'))[0].total,
  );
  report.checks.scope =
    report.results.length === 2 &&
    report.results[0].operation === 'meeting' &&
    report.results[1].operation !== 'meeting' &&
    persisted.length === 1 &&
    events.length === 1 &&
    events[0].status === 'confirmed' &&
    events[0].conversationId === persisted[0].id &&
    events[0].proposalHash === persisted[0].proposal?.hash &&
    events[0].terms.participants.includes(a) &&
    events[0].terms.participants.includes(b) &&
    events[0].terms.obligations.length === 0;
  report.checks.noExternalEffects =
    endpointsAllowed && calls <= 2 && report.legacyJobs === 0 && report.legacyProviderEvents === 0;
  report.passed =
    calls === 2 &&
    report.results.length === 2 &&
    report.results[0].status === 'submitted' &&
    report.results[0].actualState === 'agreed' &&
    ['draft', 'clarification'].includes(report.results[1].status) &&
    report.results.every((r) => r.expectedConnection && r.slotCount <= 3) &&
    Object.values(report.checks).every(Boolean);
  if (!report.passed) report.reason = 'smoke_acceptance_failed';
} catch {
  // Provider text, credentials, prompts and error bodies are deliberately excluded from evidence.
  report.providerCalls = calls;
  report.passed = false;
  report.reason = 'smoke_execution_failed';
} finally {
  await coordinator.stop();
  await db.close();
  const directory = resolve('.data');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'network-model-smoke.json'), JSON.stringify(report, null, 2));
}
process.stdout.write(
  JSON.stringify({
    passed: report.passed,
    providerCalls: report.providerCalls,
    resultStatuses: report.results.map((r) => r.status),
    evidence: '.data/network-model-smoke.json',
  }) + '\n',
);
if (!report.passed) process.exitCode = 1;
