import {
  ElevenLabsAdapter,
  TwilioAdapter,
  inspectAgentForPilot,
  inspectOwnerAgent,
} from '../../../packages/providers/src/index.js';
import type { Config } from './config.js';
import type { Database } from './db.js';
export type ReadyCheck = {
  id: string;
  label: string;
  status: 'ready' | 'missing' | 'blocked';
  detail: string;
};
export function isPublicHttps(value?: string) {
  try {
    const u = new URL(value!);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname === '/' &&
      !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[|.*\.local$)/i.test(u.hostname) &&
      !/^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)
    );
  } catch {
    return false;
  }
}
/** Configuration only: never contacts any provider, synthesizes audio or initiates calls. */
export function localReadiness(c: Config, ownerId?: string) {
  const checks: ReadyCheck[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string) =>
    checks.push({
      id,
      label,
      status: ok ? 'ready' : 'missing',
      detail: ok ? 'Configured.' : detail,
    });
  add(
    'elevenlabs',
    'ElevenLabs calling credentials',
    !!(c.elevenKey && c.agentId && c.phoneId && c.standardVoice),
    'Add the API key, telephone agent ID, imported phone number ID and standard voice ID on the backend.',
  );
  add(
    'twilio',
    'Twilio call control',
    !!(c.twilioSid && c.twilioToken),
    'Add the Twilio Account SID and Auth Token on the backend.',
  );
  add(
    'webhook',
    'Signed callback endpoint',
    !!c.webhookSecret && isPublicHttps(c.publicBaseUrl),
    'Configure PUBLIC_API_URL as a public HTTPS origin and the ElevenLabs webhook signing secret.',
  );
  add(
    'owner',
    'Private pilot owner',
    !!c.liveOwnerId && (!ownerId || c.liveOwnerId === ownerId),
    'Bind LIVE_OWNER_ID to your own signed-in account before calling.',
  );
  add(
    'recipients',
    'Approved US test recipients',
    c.recipients.length > 0 && c.recipients.every((x) => /^\+1\d{10}$/.test(x)),
    'Add only consented US E.164 test numbers. A +1 country code alone does not establish the country.',
  );
  add(
    'disclosure',
    'Processing and retention disclosure',
    !!(c.retentionVerified && c.llmProvider && c.retentionDisclosure),
    'Verify audio recording is off and set the exact model provider and transcript-retention disclosure.',
  );
  const configured = checks.every((x) => x.status === 'ready');
  checks.push({
    id: 'dialing',
    label: 'Real calling switch',
    status: c.liveEnabled ? 'ready' : 'blocked',
    detail: c.liveEnabled
      ? 'Enabled; mission authorization and provider preflight are still required.'
      : 'Disabled. No real calls will be placed, even after credentials are added.',
  });
  return {
    ready: configured && c.liveEnabled && c.provider === 'elevenlabs',
    configured,
    callGate: c.liveEnabled ? 'requires_mission_authorization' : 'disabled',
    checks,
    ownerVoice: {
      speechToText: !!c.elevenKey,
      textToSpeech: !!(c.elevenKey && c.standardVoice),
      conversationPlanner: !!(c.elevenKey && c.ownerAgentId),
    },
    disclosure: {
      llmProvider: c.llmProvider ?? null,
      retention: c.retentionDisclosure ?? null,
      audioRecording: false,
    },
  };
}

/** Database-backed, content-free runtime diagnostics; never probes a paid provider. */
export async function runtimeReadiness(db: Database) {
  try {
    await db.query('SELECT 1 AS ready');
    const [jobs] = await db.query(`SELECT
      count(*) FILTER (WHERE status='queued')::int AS queued,
      count(*) FILTER (WHERE status='running')::int AS running,
      count(*) FILTER (WHERE status='failed')::int AS failed,
      count(*) FILTER (WHERE status='running' AND lease_until<now())::int AS expired_leases,
      count(*) FILTER (WHERE kind IN ('provider_delete','google_revoke') AND status IN ('queued','running'))::int AS cleanup_pending,
      count(*) FILTER (WHERE kind IN ('provider_delete','google_revoke') AND status='failed')::int AS cleanup_failed FROM jobs`);
    const [live] = await db.query(
      "SELECT count(*) FILTER (WHERE status IN ('creating','active','closing','unconfirmed'))::int AS unresolved,count(*) FILTER (WHERE status='unconfirmed')::int AS unconfirmed FROM live_sessions",
    );
    const migrations = await db.query('SELECT name FROM schema_migrations ORDER BY name');
    const [network] = await db.query(
      "SELECT count(*) FILTER(WHERE status='queued')::int AS queued,count(*) FILTER(WHERE status='running')::int AS running,count(*) FILTER(WHERE status='paused')::int AS paused,count(*) FILTER(WHERE status='waiting')::int AS waiting FROM network_records WHERE kind='task'",
    );
    const degraded = jobs.failed > 0 || jobs.expired_leases > 0 || live.unconfirmed > 0;
    return {
      ready: true,
      status: degraded ? ('degraded' as const) : ('ready' as const),
      database: 'ready' as const,
      migrations: migrations.length,
      jobs: {
        queued: jobs.queued,
        running: jobs.running,
        failed: jobs.failed,
        expiredLeases: jobs.expired_leases,
      },
      cleanup: {
        status: jobs.cleanup_failed
          ? ('attention' as const)
          : jobs.cleanup_pending
            ? ('pending' as const)
            : ('current' as const),
        pending: jobs.cleanup_pending,
        failed: jobs.cleanup_failed,
      },
      live: { unresolved: live.unresolved, unconfirmed: live.unconfirmed },
      agentNetwork: {
        delivery: 'internal' as const,
        queued: network.queued,
        running: network.running,
        paused: network.paused,
        waitingForOwner: network.waiting,
        externalEffectsEnabled: false as const,
      },
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return {
      ready: false,
      status: 'not_ready' as const,
      database: 'unavailable' as const,
      checkedAt: new Date().toISOString(),
    };
  }
}

/** Strict GET-only account inspection. No call, preview, transcription, upload or resource creation. */
export async function inspectProviders(
  c: Config,
  eleven?: ElevenLabsAdapter,
  twilio?: TwilioAdapter,
) {
  if (
    !c.elevenKey ||
    !c.agentId ||
    !c.phoneId ||
    !c.standardVoice ||
    !c.twilioSid ||
    !c.twilioToken
  )
    return {
      ready: false,
      checks: [
        { id: 'credentials', status: 'unknown', message: 'Complete backend credentials first.' },
      ],
    };
  eleven ??= new ElevenLabsAdapter({
    apiKey: c.elevenKey,
    agentId: c.agentId,
    phoneNumberId: c.phoneId,
  });
  twilio ??= new TwilioAdapter({ accountSid: c.twilioSid, authToken: c.twilioToken });
  const [agent, phone, voice, account] = await Promise.all([
    eleven.getAgent(),
    eleven.getPhoneNumber(),
    eleven.getVoice(c.standardVoice),
    twilio.getAccount(),
  ]);
  const inspection = inspectAgentForPilot(agent, {
    expectedVoiceId: c.standardVoice,
    maxDurationSeconds: 180,
    maxRetentionDays: 30,
  });
  const checks = [...inspection.checks];
  const check = (id: string, ok: boolean, message: string) =>
    checks.push({ id, status: ok ? 'pass' : 'fail', message });
  check(
    'account.active',
    account.status === 'active',
    'Twilio account must be active. Trial restrictions and verified destinations still apply.',
  );
  check(
    'voice.accessible',
    voice.voice_id === c.standardVoice,
    'Standard voice must be accessible to this ElevenLabs key.',
  );
  const p = phone as any;
  check(
    'phone.identity',
    p.phone_number_id === c.phoneId,
    'Imported phone-number identity must match configuration.',
  );
  check('phone.provider', p.provider === 'twilio', 'This adapter requires a native Twilio number.');
  check(
    'phone.outbound',
    p.supports_outbound === true,
    'Imported number must explicitly support outbound calls.',
  );
  // assigned_agent controls inbound routing; outbound names its agent explicitly.
  // Requiring an inbound assignment here would incorrectly block outbound-only numbers.
  if (typeof p.phone_number === 'string') {
    const [owned, verified] = await Promise.all([
      twilio.listIncomingPhoneNumbers(p.phone_number),
      twilio.listVerifiedCallerIds(p.phone_number),
    ]);
    check(
      'phone.twilio_account',
      owned.some((x: any) => x.phone_number === p.phone_number && x.capabilities?.voice === true) ||
        verified.some((x: any) => x.phone_number === p.phone_number),
      'Number must be voice-capable in this Twilio account or a verified outgoing caller ID.',
    );
  } else check('phone.twilio_account', false, 'Imported number metadata is incomplete.');
  if (c.ownerAgentId) {
    const ownerAgent = await eleven.getAgent(c.ownerAgentId);
    const ownerInspection = inspectOwnerAgent(ownerAgent);
    checks.push(...ownerInspection.checks.map((x) => ({ ...x, id: `owner.${x.id}` })));
    check(
      'owner.separate',
      c.ownerAgentId !== c.agentId,
      'Owner conversation and recipient calling must use separate agents.',
    );
  } else
    checks.push({
      id: 'owner.agent',
      status: 'unknown',
      message:
        'Set ELEVENLABS_OWNER_AGENT_ID for general owner conversation beyond exact-message commands.',
    });
  return {
    ready: checks.every((x) => x.status === 'pass'),
    checks,
    llmModel: inspection.llmModel,
    retentionDays: inspection.retentionDays,
  };
}
