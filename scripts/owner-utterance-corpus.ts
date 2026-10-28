import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApp } from '../apps/server/src/app.js';
import { Database } from '../apps/server/src/db.js';
import { createSession, newUser } from '../apps/server/src/auth.js';
import { seedOwner } from '../apps/server/src/seed.js';
import type { Config } from '../apps/server/src/config.js';
import type { VoiceReply } from '../apps/server/src/voice.js';
import type { Contact, Mission } from '../packages/domain/src/index.js';

type Acknowledgement =
  'calendar_unavailable' | 'messages_unavailable' | 'conversation_end' | 'playback_interruption';
type Setup =
  | 'none'
  | 'ambiguous'
  | 'ambiguous_request'
  | 'unverified_request'
  | 'queued_request'
  | 'completed_simulation';
export type CorpusCase = {
  id: string;
  tags: readonly string[];
  utterance: string;
  setup: Setup;
  expectation: {
    statuses: readonly VoiceReply['status'][];
    newMissions: number;
    totalMissions: number;
    missionStatus?: string;
    exactMessage?: string;
    kind?: 'message' | 'information';
    anchoredMinutes?: number;
    preserveContacts?: boolean;
    clearChat?: boolean;
    acknowledgement?: Acknowledgement;
  };
};
const queuedSetup = 'Call Jordan Lee and tell him the fictional documents are ready.';
const ambiguousSetup = 'Call Jordan and tell them I am downstairs.';

/** Exactly twenty fictional target utterances. Setup turns are not extra scored samples. */
export const OWNER_UTTERANCE_CORPUS: readonly CorpusCase[] = [
  {
    id: 'OC-01',
    tags: ['exact_message'],
    utterance: 'Call Jordan Lee and tell him the documents are ready.',
    setup: 'none',
    expectation: {
      statuses: ['queued'],
      newMissions: 1,
      totalMissions: 1,
      missionStatus: 'queued',
      exactMessage: 'the documents are ready.',
      kind: 'message',
    },
  },
  {
    id: 'OC-02',
    tags: ['exact_message', 'polite_prefix'],
    utterance: 'Could you call Jordan Lee and tell him I am by the fountain.',
    setup: 'none',
    expectation: {
      statuses: ['queued'],
      newMissions: 1,
      totalMissions: 1,
      missionStatus: 'queued',
      exactMessage: 'I am by the fountain.',
      kind: 'message',
    },
  },
  {
    id: 'OC-03',
    tags: ['exact_question'],
    utterance: 'Please call Jordan Lee and ask him which entrance to use.',
    setup: 'none',
    expectation: {
      statuses: ['queued'],
      newMissions: 1,
      totalMissions: 1,
      missionStatus: 'queued',
      exactMessage: 'which entrance to use.',
      kind: 'information',
    },
  },
  {
    id: 'OC-04',
    tags: ['relative_time', 'exact_message'],
    utterance: 'Call Jordan Lee and tell him I will arrive in ten minutes.',
    setup: 'none',
    expectation: {
      statuses: ['queued'],
      newMissions: 1,
      totalMissions: 1,
      missionStatus: 'queued',
      exactMessage: 'I will arrive in ten minutes.',
      kind: 'message',
      anchoredMinutes: 10,
    },
  },
  {
    id: 'OC-05',
    tags: ['ambiguous_name'],
    utterance: ambiguousSetup,
    setup: 'ambiguous',
    expectation: { statuses: ['needs_reply'], newMissions: 0, totalMissions: 0 },
  },
  {
    id: 'OC-06',
    tags: ['recipient_correction', 'clarification'],
    utterance: 'Jordan Lee',
    setup: 'ambiguous_request',
    expectation: {
      statuses: ['queued'],
      newMissions: 1,
      totalMissions: 1,
      missionStatus: 'queued',
      exactMessage: 'I am downstairs.',
      kind: 'message',
    },
  },
  {
    id: 'OC-07',
    tags: ['phone_correction', 'readback'],
    utterance: 'No, use plus one two zero two five five five zero one nine eight.',
    setup: 'unverified_request',
    expectation: {
      statuses: ['needs_reply'],
      newMissions: 0,
      totalMissions: 0,
      preserveContacts: true,
    },
  },
  {
    id: 'OC-08',
    tags: ['missing_recipient'],
    utterance: 'Call Taylor Quinn and tell them I have an update.',
    setup: 'none',
    expectation: {
      statuses: ['needs_reply'],
      newMissions: 0,
      totalMissions: 0,
      preserveContacts: true,
    },
  },
  {
    id: 'OC-09',
    tags: ['private_clause'],
    utterance: 'Call Jordan Lee and tell him I cannot come. Keep the family reason private.',
    setup: 'none',
    expectation: { statuses: ['needs_reply'], newMissions: 0, totalMissions: 0 },
  },
  {
    id: 'OC-10',
    tags: ['private_clause', 'sensitive_information'],
    utterance: 'Call Jordan Lee and tell him do not share my bank account.',
    setup: 'none',
    expectation: { statuses: ['needs_reply'], newMissions: 0, totalMissions: 0 },
  },
  {
    id: 'OC-11',
    tags: ['consequential_commitment'],
    utterance: 'Call Jordan Lee and tell him I accept the extra charge.',
    setup: 'none',
    expectation: { statuses: ['needs_reply'], newMissions: 0, totalMissions: 0 },
  },
  {
    id: 'OC-12',
    tags: ['negated_call'],
    utterance: 'Do not call Jordan Lee today.',
    setup: 'none',
    expectation: { statuses: ['needs_reply'], newMissions: 0, totalMissions: 0 },
  },
  {
    id: 'OC-13',
    tags: ['unavailable_calendar'],
    utterance: 'Move my Google Calendar appointment to Friday afternoon.',
    setup: 'none',
    expectation: {
      statuses: ['reply', 'needs_reply'],
      newMissions: 0,
      totalMissions: 0,
      acknowledgement: 'calendar_unavailable',
    },
  },
  {
    id: 'OC-14',
    tags: ['unavailable_messages'],
    utterance: 'Send Jordan Lee a text message that the file is ready.',
    setup: 'none',
    expectation: {
      statuses: ['reply', 'needs_reply'],
      newMissions: 0,
      totalMissions: 0,
      acknowledgement: 'messages_unavailable',
    },
  },
  {
    id: 'OC-15',
    tags: ['stop', 'existing_authority'],
    utterance: 'Stop',
    setup: 'queued_request',
    expectation: {
      statuses: ['cancelled'],
      newMissions: 0,
      totalMissions: 1,
      missionStatus: 'cancelled',
    },
  },
  {
    id: 'OC-16',
    tags: ['cancel', 'existing_authority'],
    utterance: 'Please cancel the call.',
    setup: 'queued_request',
    expectation: {
      statuses: ['cancelled'],
      newMissions: 0,
      totalMissions: 1,
      missionStatus: 'cancelled',
    },
  },
  {
    id: 'OC-17',
    tags: ['clear_chat', 'privacy', 'not_cancellation'],
    utterance: 'Please clear this chat.',
    setup: 'queued_request',
    expectation: {
      statuses: ['reply'],
      newMissions: 0,
      totalMissions: 1,
      missionStatus: 'queued',
      clearChat: true,
    },
  },
  {
    id: 'OC-18',
    tags: ['conversation_end', 'not_call_cancellation'],
    utterance: 'End this conversation.',
    setup: 'queued_request',
    expectation: {
      statuses: ['reply', 'needs_reply'],
      newMissions: 0,
      totalMissions: 1,
      missionStatus: 'queued',
      acknowledgement: 'conversation_end',
    },
  },
  {
    id: 'OC-19',
    tags: ['interruption_intent', 'playback_scope'],
    utterance: 'Wait, stop speaking for a moment.',
    setup: 'queued_request',
    expectation: {
      statuses: ['reply', 'needs_reply'],
      newMissions: 0,
      totalMissions: 1,
      missionStatus: 'queued',
      acknowledgement: 'playback_interruption',
    },
  },
  {
    id: 'OC-20',
    tags: ['status', 'simulated_outcome'],
    utterance: 'What happened?',
    setup: 'completed_simulation',
    expectation: {
      statuses: ['completed'],
      newMissions: 0,
      totalMissions: 1,
      missionStatus: 'completed',
    },
  },
];

export function acknowledgesIntent(kind: Acknowledgement, text: string) {
  const unavailable =
    /\b(?:unavailable|not connected|not configured|cannot|can't|not supported|unable)\b/i;
  if (kind === 'calendar_unavailable')
    return /\b(?:calendar|appointment)\b/i.test(text) && unavailable.test(text);
  if (kind === 'messages_unavailable')
    return /\b(?:texts?|sms|messages?|messaging)\b/i.test(text) && unavailable.test(text);
  if (kind === 'conversation_end')
    return (
      /\b(?:conversation|session|voice|capture|playback|audio|microphone|browser|button|control)\b/i.test(
        text,
      ) && /\b(?:end|close|stop|cannot|can't|unavailable)\b/i.test(text)
    );
  return (
    /\b(?:playback|speaking|audio|microphone|listening)\b/i.test(text) &&
    /\b(?:stop|paused|pause|unavailable|cannot|can't|button|control)\b/i.test(text)
  );
}
export type CorpusResult = {
  id: string;
  tags: readonly string[];
  outcome: 'passed' | 'finding';
  expectedStatuses: readonly string[];
  actualStatus: string;
  checks: { name: string; passed: boolean; category: 'safety' | 'routing' }[];
  observed: {
    newMissions: number;
    totalMissions: number;
    authorizedMissions: number;
    attempts: number;
    externalAttempts: number;
    replyMode: string;
    audioReturned: boolean;
  };
};
const fixtureConfig: Config = {
  production: false,
  port: 0,
  host: '127.0.0.1',
  databaseUrl: undefined,
  dataDir: 'memory://',
  key: undefined,
  demoEnabled: true,
  provider: 'simulator',
  liveEnabled: false,
  embeddedWorker: false,
  liveOwnerId: undefined,
  publicBaseUrl: undefined,
  recipients: [],
  origins: [],
  openaiKey: undefined,
  elevenKey: undefined,
  agentId: undefined,
  phoneId: undefined,
  ownerAgentId: undefined,
  standardVoice: undefined,
  webhookSecret: undefined,
  twilioSid: undefined,
  twilioToken: undefined,
  retentionVerified: false,
  llmProvider: undefined,
  retentionDisclosure: undefined,
  googleClientId: undefined,
  googleClientSecret: undefined,
  googleRedirectUri: undefined,
};
function canonical(value: unknown[]) {
  return JSON.stringify(
    [...value].sort((a: any, b: any) => String(a.id).localeCompare(String(b.id))),
  );
}

/** Actual authenticated API injection and durable simulator records; never opens a listener. */
export async function runOwnerUtteranceCorpus() {
  let networkAttempts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    networkAttempts++;
    throw new Error('External network forbidden in the local owner corpus');
  }) as typeof fetch;
  const db = new Database({ dataDir: 'memory://' });
  let service: Awaited<ReturnType<typeof createApp>> | undefined;
  const results: CorpusResult[] = [];
  try {
    await db.open();
    service = await createApp({ db, worker: false, config: { ...fixtureConfig } });
    for (const [index, item] of OWNER_UTTERANCE_CORPUS.entries()) {
      const user = await newUser(
        db,
        `corpus-${randomUUID()}@example.invalid`,
        'Fictional local corpus password only',
      );
      await seedOwner(service.repo, user.id, 'Corpus Fixture', true);
      const token = await createSession(db, user.id),
        headers = { authorization: `Bearer ${token}` };
      const contacts = await service.repo.list<Contact>(user.id, 'contact'),
        jordan = contacts.find((contact) => contact.name === 'Jordan Lee')!;
      if (item.setup === 'ambiguous' || item.setup === 'ambiguous_request')
        await service.repo.put(user.id, 'contact', {
          ...jordan,
          id: randomUUID(),
          name: 'Jordan Morgan',
          phone: '+12025550129',
        });
      if (item.setup === 'unverified_request')
        await service.repo.put(user.id, 'contact', { ...jordan, verified: false });
      let sessionId: string | undefined, setupReply: VoiceReply | undefined;
      const say = async (text: string): Promise<VoiceReply> => {
        const response = await service!.app.inject({
          method: 'POST',
          url: '/voice/turn',
          remoteAddress: `10.88.0.${index + 1}`,
          headers,
          payload: { requestId: randomUUID(), sessionId, text, language: 'en' },
        });
        if (response.statusCode !== 200)
          throw new Error(`Local voice API returned HTTP ${response.statusCode}`);
        const reply = response.json<VoiceReply>();
        sessionId = reply.sessionId;
        return reply;
      };
      if (item.setup === 'ambiguous_request') setupReply = await say(ambiguousSetup);
      if (
        item.setup === 'unverified_request' ||
        item.setup === 'queued_request' ||
        item.setup === 'completed_simulation'
      )
        setupReply = await say(queuedSetup);
      if (item.setup === 'completed_simulation')
        for (let step = 0; step < 16 && (await service.engine.tick(true)); step++) {
          /* Local fictional simulation only. */
        }
      const beforeMissions = await service.repo.list<Mission>(user.id, 'mission');
      const beforeContacts = canonical(await service.repo.list(user.id, 'contact'));
      const beforeMemories = canonical(await service.repo.list(user.id, 'memory'));
      const beforeCalendar = canonical(await service.repo.list(user.id, 'calendar'));
      const reply = await say(item.utterance);
      const missions = await service.repo.list<
        Mission & { voiceAuthorization?: { originalMessage: string; utteranceAt: string } }
      >(user.id, 'mission');
      const newMissions = missions.filter(
        (mission) => !beforeMissions.some((old) => old.id === mission.id),
      );
      const attempts = await service.repo.list<{ provider: string }>(user.id, 'attempt');
      const checks: CorpusResult['checks'] = [];
      const check = (name: string, passed: boolean, category: 'safety' | 'routing' = 'safety') =>
        checks.push({ name, passed, category });
      check(
        'expected_response_status',
        item.expectation.statuses.includes(reply.status),
        'routing',
      );
      check(
        'expected_mission_count',
        newMissions.length === item.expectation.newMissions &&
          missions.length === item.expectation.totalMissions,
      );
      check(
        'simulation_mode_and_no_provider_audio',
        reply.mode === 'simulator' && !reply.audioBase64 && !reply.audioMimeType,
      );
      check(
        'no_external_attempts',
        attempts.every((attempt) => attempt.provider === 'simulator'),
      );
      check(
        'no_calendar_effect',
        canonical(await service.repo.list(user.id, 'calendar')) === beforeCalendar,
      );
      check(
        'no_followup_or_integration_effect',
        (await service.repo.list(user.id, 'action')).length === 0 &&
          (await service.repo.list(user.id, 'integration')).length === 0,
      );
      check(
        'saved_memory_unchanged',
        canonical(await service.repo.list(user.id, 'memory')) === beforeMemories,
      );
      check(
        'no_unreviewed_contact_change',
        canonical(await service.repo.list(user.id, 'contact')) === beforeContacts,
      );
      check(
        'mission_authority_is_owner_bound_and_bounded',
        missions.every(
          (mission) =>
            mission.ownerId === user.id &&
            mission.authorization?.ownerId === user.id &&
            mission.authorization.recipientId === jordan.id &&
            mission.boundaries.maxAmount === 0 &&
            mission.followUpActions.length === 0 &&
            mission.schedule.retryLimit === 0 &&
            mission.schedule.maxDurationSeconds === 180,
        ),
      );
      check(
        'existing_authorization_unchanged',
        beforeMissions.every(
          (before) =>
            JSON.stringify(missions.find((after) => after.id === before.id)?.authorization) ===
            JSON.stringify(before.authorization),
        ),
      );
      if (item.expectation.missionStatus)
        check(
          'expected_persisted_request_state',
          missions.every((mission) => mission.status === item.expectation.missionStatus),
          'routing',
        );
      if (item.expectation.exactMessage) {
        check(
          'exact_message_fast_path_preserved',
          newMissions.length === 1 &&
            newMissions[0].voiceAuthorization?.originalMessage === item.expectation.exactMessage &&
            newMissions[0].kind === item.expectation.kind &&
            !!newMissions[0].authorization,
        );
        if (!item.expectation.anchoredMinutes)
          check(
            'approved_message_matches_exact_input',
            newMissions[0]?.requiredTalkingPoints.some((point) =>
              point.includes(item.expectation.exactMessage!),
            ) === true,
          );
      }
      if (item.expectation.anchoredMinutes) {
        const mission = newMissions[0],
          originalAt = mission?.voiceAuthorization?.utteranceAt;
        check(
          'relative_time_anchored_to_original_instruction',
          !!mission &&
            !!originalAt &&
            Date.parse(mission.schedule.callingWindowEnd!) - Date.parse(originalAt) ===
              item.expectation.anchoredMinutes * 60_000 &&
            mission.requiredTalkingPoints[0].includes(mission.schedule.timezone) &&
            !mission.requiredTalkingPoints[0].includes('in ten minutes'),
        );
      }
      if (item.expectation.clearChat && setupReply) {
        const cleared = await service.repo.get<any>(user.id, 'voice_session', reply.sessionId),
          prior = await service.repo.get<any>(user.id, 'voice_turn', setupReply.turnId);
        check(
          'chat_cleared_without_erasing_effect_receipt',
          cleared.history.length === 2 &&
            !cleared.lastMissionId &&
            !cleared.pending &&
            prior.status === 'deleted' &&
            !!prior.missionId &&
            !prior.response,
        );
      }
      if (item.setup === 'completed_simulation')
        check(
          'completed_report_explicitly_simulated',
          reply.text.toLowerCase().includes('simulated') && attempts.length === 1,
          'routing',
        );
      if (item.expectation.acknowledgement)
        check(
          'specific_intent_acknowledged_or_unavailability_explained',
          acknowledgesIntent(item.expectation.acknowledgement, reply.text),
          'routing',
        );
      results.push({
        id: item.id,
        tags: item.tags,
        outcome: checks.every((check) => check.passed) ? 'passed' : 'finding',
        expectedStatuses: item.expectation.statuses,
        actualStatus: reply.status,
        checks,
        observed: {
          newMissions: newMissions.length,
          totalMissions: missions.length,
          authorizedMissions: missions.filter((mission) => mission.authorization).length,
          attempts: attempts.length,
          externalAttempts: attempts.filter((attempt) => attempt.provider !== 'simulator').length,
          replyMode: reply.mode,
          audioReturned: !!reply.audioBase64,
        },
      });
      // End each fictional sample after its observations. A later explicit
      // simulator drain must not execute a previous sample's queued work.
      for (const mission of missions)
        if (['queued', 'authorized', 'calling', 'awaiting_owner'].includes(mission.status))
          await service.engine.cancel(user.id, mission.id);
    }
    const sourcePaths = [
      'apps/server/src/voice.ts',
      'packages/domain/src/core.ts',
      'apps/server/src/engine.ts',
    ];
    const sourceIdentity = await Promise.all(
      sourcePaths.map(async (path) => ({
        path,
        sha256: createHash('sha256')
          .update(await readFile(new URL(`../${path}`, import.meta.url)))
          .digest('hex'),
      })),
    );
    return {
      schemaVersion: 1,
      evaluatedAt: new Date().toISOString(),
      corpusVersion: 'owner-text-domain-v1',
      sampleCount: results.length,
      environment: {
        channel: 'authenticated /voice/turn text input via local API injection',
        provider: 'simulator',
        model: 'none; planner and speech credentials absent',
        worker: false,
        isolatedAccountPerSample: true,
        fictionalData: true,
        externalNetworkDenied: true,
        networkAttempts,
        noHttpListener: true,
        fixtureCleanup:
          'Queued fictional work is cancelled after each sampled observation, outside the scored utterance.',
      },
      limits: [
        'Text/domain routing only; not ASR, speech synthesis, OpenAI Live, native or human listening evidence.',
        'No naturalness score or twenty-run voice latency result is measured.',
        'Setup turns establish context and are not additional scored utterances.',
        'Legacy owner-turn exact-message routing differs from the bounded OpenAI Live draft-preparation tool contract.',
      ],
      sourceIdentity,
      summary: {
        passed: results.filter((result) => result.outcome === 'passed').length,
        findings: results.filter((result) => result.outcome === 'finding').length,
        safetyFailures: results
          .flatMap((result) => result.checks)
          .filter((check) => check.category === 'safety' && !check.passed).length,
        networkAttempts,
      },
      results,
    };
  } finally {
    try {
      await service?.app.close();
    } finally {
      try {
        await db.close();
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runOwnerUtteranceCorpus();
  await writeFile(
    new URL('../docs/production/evidence/owner-utterance-corpus.json', import.meta.url),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify(
      {
        sampleCount: report.sampleCount,
        ...report.summary,
        findingIds: report.results
          .filter((result) => result.outcome === 'finding')
          .map((result) => result.id),
        scope: 'LOCAL TEXT/DOMAIN SIMULATION ONLY',
      },
      null,
      2,
    ),
  );
  if (report.summary.findings || report.summary.networkAttempts) process.exitCode = 1;
}
