import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ElevenLabsAdapter, ElevenOwnerPlanner } from '../../../packages/providers/src/index.js';
import {
  MissionInputSchema,
  type Contact,
  type Mission,
} from '../../../packages/domain/src/index.js';
import { Engine } from './engine.js';
import { HttpError, requireValue } from './errors.js';
import { RecipientSuppression } from './integrations/recipient-suppression.js';

export const VoiceTurnSchema = z
  .object({
    sessionId: z.string().optional(),
    requestId: z.uuid(),
    text: z.string().trim().min(1).max(5000).optional(),
    audioBase64: z.string().max(14_000_000).optional(),
    mimeType: z.string().max(80).optional(),
    language: z.string().max(12).optional(),
  })
  .refine((x) => !!x.text !== !!x.audioBase64, {
    message: 'Send either a transcript or one audio recording.',
  });
const PlanSchema = z.object({
  intent: z.enum(['message', 'information', 'chat', 'status', 'cancel']),
  recipientName: z.string().max(100).optional(),
  message: z.string().max(3000).optional(),
  reply: z.string().max(1000).optional(),
});
type Plan = z.infer<typeof PlanSchema>;
type Pending = {
  plan: Plan;
  utterance: string;
  utteranceAt?: string;
  confirmPlan?: boolean;
  phone?: string;
  confirmPhone?: boolean;
  contactId?: string;
  previousPhone?: string;
};
type Session = {
  id: string;
  ownerId: string;
  history: { role: string; text: string; at: string }[];
  pending?: Pending;
  lastMissionId?: string;
  createdAt: string;
  updatedAt: string;
  privacyVersion?: number;
  status?: string;
  clearedAt?: string;
};
export type VoiceReply = {
  sessionId: string;
  turnId: string;
  text: string;
  transcript: string;
  audioBase64?: string;
  audioMimeType?: string;
  missionId?: string;
  status: 'reply' | 'needs_reply' | 'queued' | 'calling_disabled' | 'completed' | 'cancelled';
  needsReply: boolean;
  mode: 'simulator' | 'elevenlabs';
  voiceMode: 'provider' | 'device' | 'unavailable';
};
const normalize = (x: string) =>
  x
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\p{M}]/gu, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const privateClause =
  /\b(private|confidential|secret|password|credit card|social security|bank account|don['’]t share|do not share|don['’]t tell|do not tell)\b/i;
const consequential = /\b(book|buy|purchase|pay|sign|accept|agree|charge|transfer money)\b/i;
const yes = (text: string) =>
  /^(yes|yeah|yep|correct|that's right|that is right|go ahead|please do|confirm|do it)[.! ]*$/i.test(
    text.trim(),
  );
const clearChat =
  /^(?:please\s+)?(?:forget|clear|erase|delete)\s+(?:this|the|our)\s+(?:conversation|chat)(?:\s+history)?[.! ]*$/i;
const stopRequest = /^(?:please )?(?:stop|cancel)(?: the (?:call|mission|request))?[.! ]*$/i;
const erased = (value: any) => value && ['expired', 'deleted'].includes(value.status);
const expired = () =>
  new HttpError(
    409,
    'voice_request_expired',
    'This conversation content was cleared or expired. I will not repeat its request or place another call. Start a new request.',
  );
/** Exact-message fast path, with no generated authority or contact ID. */
export function parseDirectVoiceCommand(text: string): Plan | undefined {
  const clean = text
    .trim()
    .replace(
      /^(?:hey\s+(?:agent|assistant)[, ]+)?(?:please\s+|can you\s+|could you\s+|i want you to\s+)?/i,
      '',
    );
  const match =
    /^call\s+(.{1,100}?)\s+and\s+(tell|ask)\s+(?:him|her|them|the person|that person)?\s*(?:that\s+)?([\s\S]{2,3000})$/i.exec(
      clean,
    );
  if (!match || privateClause.test(match[3])) return undefined;
  return {
    intent: match[2].toLowerCase() === 'ask' ? 'information' : 'message',
    recipientName: match[1].trim(),
    message: match[3].trim(),
  };
}
export function resolveVoiceRecipient(name: string, contacts: Contact[]) {
  const n = normalize(name),
    exact = contacts.filter((c) => normalize(c.name) === n);
  if (exact.length) return exact;
  return contacts.filter((c) => normalize(c.name).split(' ').includes(n));
}
function spokenPhone(text: string): string | undefined {
  const words: Record<string, string> = {
    zero: '0',
    oh: '0',
    one: '1',
    two: '2',
    three: '3',
    four: '4',
    five: '5',
    six: '6',
    seven: '7',
    eight: '8',
    nine: '9',
    plus: '+',
  };
  const converted = text
    .toLowerCase()
    .replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine|plus)\b/g, (x) => words[x]);
  const digits = converted.replace(/[^\d+]/g, '');
  const p = digits.length === 10 ? '+1' + digits : digits.startsWith('+') ? digits : '+' + digits;
  return /^\+1\d{10}$/.test(p) ? p : undefined;
}
/** Anchor a simple relative message to receipt time, including the owner's explicit timezone. */
export function anchorVoiceTiming(
  message: string,
  utteranceAt: string,
  timezone: string,
): { message: string; deadlineAt?: string; needsClarification?: boolean } {
  const mentions = [...message.matchAll(/\bin\s+([a-z\d -]{1,30})\s+minutes?\b/gi)];
  if (!mentions.length)
    return /\bin\s+[a-z\d -]{1,30}\s+(?:mins?|hours?|hrs?|days?)\b/i.test(message)
      ? { message, needsClarification: true }
      : { message };
  const values: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    fifteen: 15,
    twenty: 20,
    thirty: 30,
    'forty five': 45,
    'forty-five': 45,
    sixty: 60,
  };
  if (mentions.length !== 1) return { message, needsClarification: true };
  const count = mentions[0][1].trim().toLowerCase(),
    minutes = /^\d{1,4}$/.test(count) ? Number(count) : values[count];
  if (!minutes || minutes > 1440 || !Number.isFinite(Date.parse(utteranceAt)))
    return { message, needsClarification: true };
  const deadlineAt = new Date(Date.parse(utteranceAt) + minutes * 60000).toISOString();
  const explicit = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(deadlineAt));
  return { message: message.replace(mentions[0][0], `at ${explicit} (${timezone})`), deadlineAt };
}
export class VoiceService {
  async readTurn(owner: string, requestId: string) {
    z.uuid().parse(requestId);
    const id = createHash('sha256').update(`${owner}:${requestId}`).digest('hex');
    const receipt = requireValue(await this.engine.repo.get<any>(owner, 'voice_turn', id));
    return {
      status: receipt.status,
      missionId: receipt.missionId ?? receipt.response?.missionId,
      response: receipt.response,
    };
  }
  private pendingRequests = new Map<string, Promise<VoiceReply>>();
  private sessionRequests = new Map<string, Promise<VoiceReply>>();
  speech?: ElevenLabsAdapter;
  planner?: Pick<ElevenOwnerPlanner, 'plan'>;
  constructor(public engine: Engine) {
    const c = engine.config;
    if (c.elevenKey)
      this.speech = new ElevenLabsAdapter({
        apiKey: c.elevenKey,
        agentId: c.ownerAgentId ?? c.agentId ?? 'not-configured',
        phoneNumberId: c.phoneId ?? 'not-configured',
      });
    if (c.elevenKey && c.ownerAgentId)
      this.planner = new ElevenOwnerPlanner({ apiKey: c.elevenKey, agentId: c.ownerAgentId });
  }
  private providersAllowed(owner: string) {
    return this.engine.config.liveOwnerId === owner;
  }
  private async claimTurn(
    owner: string,
    id: string,
    value: Record<string, unknown>,
    providerUsage: boolean,
  ) {
    return this.engine.db.transaction(async (sql) => {
      const [user] = await sql.query('SELECT id,deleted_at FROM users WHERE id=$1 FOR UPDATE', [
        owner,
      ]);
      if (!user || user.deleted_at) throw expired();
      if (providerUsage) {
        const [usage] = await sql.query(
          "SELECT count(*)::int AS total FROM resources WHERE owner_id=$1 AND kind='voice_turn' AND created_at>now()-interval '1 day'",
          [owner],
        );
        if (usage.total >= 100)
          throw new HttpError(
            429,
            'voice_usage_limit',
            'The private pilot allows up to 100 voice turns and reports per 24 hours. No provider request was sent.',
          );
      }
      return sql.query(
        'INSERT INTO resources(id,owner_id,kind,payload) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id',
        [id, owner, 'voice_turn', this.engine.db.encrypt(value)],
      );
    });
  }
  async turn(owner: string, raw: unknown): Promise<VoiceReply> {
    const body = VoiceTurnSchema.parse(raw),
      id = createHash('sha256').update(`${owner}:${body.requestId}`).digest('hex');
    const running = this.pendingRequests.get(id);
    if (running) return running;
    const sessionKey = body.sessionId ? `${owner}:${body.sessionId}` : undefined;
    const previous = sessionKey ? this.sessionRequests.get(sessionKey) : undefined;
    const task = (
      previous
        ? previous.catch(() => undefined).then(() => this.run(owner, id, body))
        : this.run(owner, id, body)
    ).finally(() => {
      this.pendingRequests.delete(id);
      if (sessionKey && this.sessionRequests.get(sessionKey) === task)
        this.sessionRequests.delete(sessionKey);
    });
    this.pendingRequests.set(id, task);
    if (sessionKey) this.sessionRequests.set(sessionKey, task);
    return task;
  }
  private async run(
    owner: string,
    turnId: string,
    b: z.infer<typeof VoiceTurnSchema>,
  ): Promise<VoiceReply> {
    const repo = this.engine.repo,
      now = new Date().toISOString();
    const prior = await repo.get<any>(owner, 'voice_turn', turnId);
    if (erased(prior)) throw expired();
    if (prior?.response) return prior.response;
    if (prior)
      throw new HttpError(
        409,
        'voice_turn_in_progress',
        'This voice request is already processing or needs reconciliation. I will not repeat a call.',
      );
    const session = b.sessionId
      ? requireValue(await repo.get<Session>(owner, 'voice_session', b.sessionId))
      : ({
          id: randomUUID(),
          ownerId: owner,
          history: [],
          createdAt: now,
          updatedAt: now,
        } as Session);
    if (erased(session)) throw expired();
    // A unique receipt covers lost first-turn responses even before the client knows a session ID.
    const localControl =
      !!b.text && (clearChat.test(b.text.trim()) || stopRequest.test(b.text.trim()));
    const usesProvider =
      !localControl &&
      this.providersAllowed(owner) &&
      !!(this.planner || (this.speech && (b.audioBase64 || this.engine.config.standardVoice)));
    const claimed = await this.claimTurn(
      owner,
      turnId,
      { id: turnId, status: 'processing', sessionId: session.id },
      usesProvider,
    );
    if (!claimed.length)
      throw new HttpError(
        409,
        'voice_turn_in_progress',
        'This voice request is already processing.',
      );
    let transcript = b.text ?? '';
    try {
      if (b.audioBase64) {
        if (!this.providersAllowed(owner))
          throw new HttpError(
            403,
            'provider_owner_required',
            'Shared speech services are restricted to the configured private-pilot owner. Text and device speech remain available without a provider request.',
          );
        if (!this.speech)
          throw new HttpError(
            503,
            'speech_not_configured',
            'Voice recognition on iPhone needs the ElevenLabs speech key. Browser device speech can be used for the local demo.',
          );
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b.audioBase64) || !b.mimeType)
          throw new HttpError(400, 'invalid_audio', 'Provide a supported audio recording.');
        const stt = await this.speech.transcribeAudio({
          bytes: Buffer.from(b.audioBase64, 'base64'),
          mimeType: b.mimeType,
          languageCode: b.language,
        });
        transcript = stt.text.trim();
        if (!transcript)
          throw new HttpError(
            400,
            'speech_empty',
            'I did not catch that. Please try speaking again.',
          );
      }
      const reply = await this.handle(owner, session, transcript, turnId, now);
      session.history.push(
        { role: 'owner', text: transcript, at: now },
        { role: 'agent', text: reply.text, at: new Date().toISOString() },
      );
      session.history = session.history.slice(-20);
      session.updatedAt = new Date().toISOString();
      await this.engine.db.transaction(async (sql) => {
        await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [owner]);
        await sql.query('SELECT id FROM resources WHERE owner_id=$1 AND id=$2 FOR UPDATE', [
          owner,
          session.id,
        ]);
        const r = repo.in(sql),
          current = await r.get<Session>(owner, 'voice_session', session.id),
          receipt = await r.get<any>(owner, 'voice_turn', turnId);
        const [user] = await sql.query('SELECT deleted_at FROM users WHERE id=$1', [owner]);
        if (!user || user.deleted_at) throw expired();
        if (
          erased(current) ||
          erased(receipt) ||
          (current?.privacyVersion ?? 0) !== (session.privacyVersion ?? 0)
        )
          throw expired();
        await r.put(owner, 'voice_session', session);
      });
      const response: VoiceReply = {
        ...reply,
        sessionId: session.id,
        turnId,
        transcript,
        mode: this.engine.config.provider,
        voiceMode: 'device',
      };
      if (
        !localControl &&
        this.providersAllowed(owner) &&
        this.speech &&
        this.engine.config.standardVoice
      ) {
        try {
          const audio = await this.speech.synthesizeReply(
            this.engine.config.standardVoice,
            response.text,
          );
          response.audioBase64 = Buffer.from(audio.audio).toString('base64');
          response.audioMimeType = audio.contentType;
          response.voiceMode = 'provider';
        } catch {
          response.voiceMode = 'unavailable';
        }
      }
      await this.engine.db.transaction(async (sql) => {
        await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [owner]);
        await sql.query('SELECT id FROM resources WHERE owner_id=$1 AND id=$2 FOR UPDATE', [
          owner,
          session.id,
        ]);
        const r = repo.in(sql),
          current = await r.get<Session>(owner, 'voice_session', session.id),
          receipt = await r.get<any>(owner, 'voice_turn', turnId);
        const [user] = await sql.query('SELECT deleted_at FROM users WHERE id=$1', [owner]);
        if (!user || user.deleted_at) throw expired();
        if (
          erased(current) ||
          erased(receipt) ||
          (current?.privacyVersion ?? 0) !== (session.privacyVersion ?? 0)
        )
          throw expired();
        await r.put(owner, 'voice_turn', {
          id: turnId,
          sessionId: session.id,
          missionId: response.missionId,
          status: 'done',
          response,
        });
      });
      return response;
    } catch (error) {
      await this.failReceipt(owner, turnId, {
        sessionId: session.id,
        error: error instanceof HttpError ? error.code : 'voice_processing_failed',
      });
      throw error;
    }
  }
  private async failReceipt(owner: string, id: string, fields: Record<string, unknown>) {
    await this.engine.db.transaction(async (sql) => {
      await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [owner]);
      await sql.query('SELECT id FROM resources WHERE owner_id=$1 AND id=$2 FOR UPDATE', [
        owner,
        id,
      ]);
      const r = this.engine.repo.in(sql),
        prior = await r.get<any>(owner, 'voice_turn', id);
      const [user] = await sql.query('SELECT deleted_at FROM users WHERE id=$1', [owner]);
      if (!user || user.deleted_at) return;
      if (erased(prior)) return;
      await r.put(owner, 'voice_turn', {
        id,
        sessionId: prior?.sessionId,
        missionId: prior?.missionId,
        ...fields,
        status: 'failed',
      });
    });
  }
  /** Erase chat content while retaining effect receipts so an old request can never redial. */
  async clearSession(owner: string, id: string, keepTurnId?: string) {
    return this.engine.db.transaction(async (sql) => {
      await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [owner]);
      await sql.query('SELECT id FROM resources WHERE owner_id=$1 AND id=$2 FOR UPDATE', [
        owner,
        id,
      ]);
      const r = this.engine.repo.in(sql),
        s = requireValue(await r.get<Session>(owner, 'voice_session', id)),
        at = new Date().toISOString();
      const turns = await r.list<any>(owner, 'voice_turn'),
        associated = turns.filter((t) => t.sessionId === id || t.response?.sessionId === id);
      const missionIds = new Set<string>(
        associated.map((t) => t.missionId ?? t.response?.missionId).filter(Boolean),
      );
      if (s.lastMissionId) missionIds.add(s.lastMissionId);
      for (const t of turns) {
        if (t.id === keepTurnId) continue;
        const missionId = t.missionId ?? t.response?.missionId;
        if (
          t.sessionId !== id &&
          t.response?.sessionId !== id &&
          (!missionId || !missionIds.has(missionId))
        )
          continue;
        await r.put(owner, 'voice_turn', {
          id: t.id,
          sessionId: t.sessionId ?? t.response?.sessionId ?? id,
          missionId,
          status: 'deleted',
          clearedAt: at,
        });
      }
      const privacyVersion = (s.privacyVersion ?? 0) + 1;
      await r.put(owner, 'voice_session', {
        id: s.id,
        ownerId: owner,
        createdAt: s.createdAt,
        updatedAt: at,
        history: [],
        privacyVersion,
        clearedAt: at,
      });
      await r.audit(owner, id, 'voice_session_cleared');
      return { cleared: true, sessionId: id, privacyVersion };
    });
  }
  private response(text: string, status: VoiceReply['status'] = 'reply', missionId?: string) {
    return { text, status, needsReply: status === 'needs_reply', missionId };
  }
  private async handle(
    owner: string,
    s: Session,
    text: string,
    turnId: string,
    receivedAt: string,
  ): Promise<ReturnType<VoiceService['response']>> {
    const repo = this.engine.repo,
      profile = requireValue(await repo.get<any>(owner, 'profile', owner)),
      contacts = await repo.list<Contact>(owner, 'contact');
    if (clearChat.test(text.trim())) {
      const exists = await repo.get<Session>(owner, 'voice_session', s.id);
      const result = exists
        ? await this.clearSession(owner, s.id, turnId)
        : { privacyVersion: s.privacyVersion ?? 0 };
      s.history = [];
      s.pending = undefined;
      s.lastMissionId = undefined;
      s.privacyVersion = result.privacyVersion;
      s.clearedAt = new Date().toISOString();
      return this.response(
        'I cleared this chat and its cached voice replies. Separate call records and saved memories remain, and any authorized call is not cancelled.',
      );
    }
    if (stopRequest.test(text.trim())) {
      s.pending = undefined;
      if (s.lastMissionId) {
        await this.engine.cancel(owner, s.lastMissionId);
        return this.response(
          'I have stopped the queued work and requested the end of any supported active call.',
          'cancelled',
          s.lastMissionId,
        );
      }
      return this.response('Okay, I have stopped this request.', 'cancelled');
    }
    if (
      /^(?:please\s+)?(?:end|close)\s+(?:this|the|our)\s+(?:voice\s+)?(?:conversation|session)[.! ]*$/i.test(
        text.trim(),
      )
    ) {
      s.pending = undefined;
      return this.response(
        'To end live voice, choose End call. In this recorded-turn view, leaving stops capture and playback. This has not cancelled any separately authorized request.',
      );
    }
    if (
      /^(?:wait[, ]+)?(?:please\s+)?(?:stop speaking|pause (?:the )?(?:audio|playback|speaking))(?:\s+for a moment)?[.! ]*$/i.test(
        text.trim(),
      )
    )
      return this.response(
        'Use Stop playback to silence the spoken reply. This recorded-turn command cannot stop playback by itself, and it has not cancelled a separate request.',
      );
    if (/\b(what happened|how did (?:it|the call) go|call status|any update)\b/i.test(text))
      return this.reportText(owner, s.lastMissionId);
    const name = /^my name is\s+(.{1,70})[.!]?$/i.exec(text.trim());
    if (name) {
      profile.name = name[1].replace(/[.!]$/, '');
      profile.onboardingComplete = true;
      await repo.put(owner, 'profile', profile);
      return this.response(
        `Nice to meet you, ${profile.name}. Tell me what you would like me to handle.`,
      );
    }
    let plan: Plan | undefined,
      utterance = text,
      utteranceAt = receivedAt;
    if (s.pending) {
      const pending = s.pending;
      if (pending.confirmPhone) {
        if (!yes(text)) {
          const phone = spokenPhone(text);
          if (phone) {
            pending.phone = phone;
            return this.response(
              `I heard ${phone.split('').join(' ')} for ${pending.plan.recipientName}. Is that the right person and number?`,
              'needs_reply',
            );
          }
          s.pending = undefined;
          return this.response(
            'Okay. I have not added the number or placed a call. Tell me the correct request.',
            'needs_reply',
          );
        }
        const existing = pending.contactId
          ? contacts.find((c) => c.id === pending.contactId)
          : undefined;
        if (
          pending.contactId &&
          (!existing || existing.optedOut || existing.phone !== pending.previousPhone)
        ) {
          s.pending = undefined;
          return this.response(
            'The saved contact changed or cannot be called. Tell me the intended person again; I have not placed a call.',
            'needs_reply',
          );
        }
        const c: Contact = existing
          ? { ...existing, phone: pending.phone!, verified: true }
          : {
              id: randomUUID(),
              ownerId: owner,
              name: pending.plan.recipientName!,
              phone: pending.phone!,
              relationship: 'Contact',
              language: profile.language,
              verified: true,
              context: 'Number supplied and read back through owner voice conversation.',
              optedOut: false,
            };
        await this.engine.db.transaction(async (sql) => {
          const [account] = await sql.query(
            'SELECT id,deleted_at FROM users WHERE id=$1 FOR UPDATE',
            [owner],
          );
          if (!account || account.deleted_at) throw expired();
          const r = repo.in(sql),
            current = existing ? await r.get<Contact>(owner, 'contact', existing.id) : undefined;
          if (existing && (!current || current.optedOut || current.phone !== pending.previousPhone))
            throw new HttpError(
              409,
              'recipient_changed',
              'The contact changed during number readback. Review the intended person again; no call was placed.',
            );
          c.optedOut = await new RecipientSuppression(this.engine.db).contactChanged(
            owner,
            current,
            c,
            sql,
          );
          await r.put(owner, 'contact', c);
          for (const draft of await r.list<any>(owner, 'mission'))
            if (draft.status === 'draft' && draft.contactId === c.id)
              await r.put(owner, 'mission', {
                ...draft,
                reviewVersion: (draft.reviewVersion ?? 1) + 1,
                updatedAt: new Date().toISOString(),
              });
        });
        if (existing) contacts[contacts.findIndex((x) => x.id === existing.id)] = c;
        else contacts.push(c);
        pending.contactId = c.id;
      } else if (pending.confirmPlan) {
        if (!yes(text)) {
          s.pending = undefined;
          return this.response(
            'Okay, I will not use that brief. Tell me exactly what you want me to say.',
            'needs_reply',
          );
        }
      } else {
        const matches = resolveVoiceRecipient(text, contacts);
        if (matches.length === 1) pending.contactId = matches[0].id;
        else if (!resolveVoiceRecipient(pending.plan.recipientName ?? '', contacts).length) {
          const phone = spokenPhone(text);
          if (!phone)
            return this.response(
              `What is ${pending.plan.recipientName}'s US phone number? You can say the digits.`,
              'needs_reply',
            );
          pending.phone = phone;
          pending.confirmPhone = true;
          return this.response(
            `I heard ${phone.split('').join(' ')} for ${pending.plan.recipientName}. Is that the right person and number?`,
            'needs_reply',
          );
        } else return this.response('Please say the intended person’s full name.', 'needs_reply');
      }
      plan = pending.plan;
      utterance = pending.utterance;
      utteranceAt = pending.utteranceAt ?? receivedAt;
      s.pending = undefined;
      if (pending.contactId)
        plan = { ...plan, recipientName: contacts.find((c) => c.id === pending.contactId)!.name };
    } else {
      if (privateClause.test(text))
        return this.response(
          'Please say only the exact message or questions you want shared. I will keep private background out of the call.',
          'needs_reply',
        );
      plan = parseDirectVoiceCommand(text);
      if (!plan && !/\bcall\b/i.test(text)) {
        if (/\bcalendar\b/i.test(text))
          return this.response(
            'Calendar changes are unavailable in this recorded-turn conversation. Review your Calendar connection and any authorized existing-event action in the workspace. I have not changed an event.',
          );
        if (/\b(?:sms|text message|email|send\s+.+\s+(?:text|message))\b/i.test(text))
          return this.response(
            'Outbound SMS, email and messaging are unavailable. I can help prepare wording, but I have not sent a message.',
          );
      }
      if (!plan && this.planner && this.providersAllowed(owner)) {
        const mentioned = ` ${normalize(text)} `;
        const candidates = /\bcall\b/i.test(text)
          ? contacts
              .filter((c) =>
                normalize(c.name)
                  .split(' ')
                  .some((word) => word.length > 1 && mentioned.includes(` ${word} `)),
              )
              .slice(0, 100)
          : [];
        let candidate: unknown;
        try {
          candidate = await this.planner.plan({
            text,
            contacts: candidates.map((c) => ({ id: c.id, name: c.name })),
            language: profile.language,
            timezone: profile.timezone,
            history: s.history.slice(-6),
            now: new Date().toISOString(),
          });
        } catch {
          return this.response(
            'I could not reach the conversation interpreter. Please say the full name and the exact message, such as “call Jordan Lee and tell him the documents are ready.” No call has been placed.',
            'needs_reply',
          );
        }
        const parsed = PlanSchema.safeParse(candidate);
        if (!parsed.success)
          return this.response(
            'I could not safely interpret that. Please say who I should call and the exact message.',
            'needs_reply',
          );
        plan = parsed.data;
        if (
          ['message', 'information'].includes(plan.intent) &&
          plan.message &&
          plan.recipientName
        ) {
          if (!/\bcall\b/i.test(text) || /\b(?:don['’]?t|do not|never|not to)\s+call\b/i.test(text))
            return this.response(
              'I can prepare that, but I have not been asked to place a call. Say “call” with the intended person and message.',
              'needs_reply',
            );
          s.pending = { plan, utterance: text, utteranceAt, confirmPlan: true };
          return this.response(
            `I understood: tell ${plan.recipientName}, “${plan.message}”. Should I go ahead with that brief?`,
            'needs_reply',
          );
        }
      }
    }
    if (!plan)
      return this.response(
        'I am here. Say something like: call Jordan Lee and tell him I am meeting him near the fountain in ten minutes. You can also ask for a call update, or say stop.',
        'needs_reply',
      );
    if (plan.intent === 'status') return this.reportText(owner, s.lastMissionId);
    if (plan.intent === 'cancel')
      return this.response(
        'To stop the current request, say “stop”. I have not changed any call yet.',
        'needs_reply',
      );
    if (plan.intent === 'chat')
      return this.response(
        plan.reply && !/\b(?:called|booked|paid|sent|confirmed|authorized)\b/i.test(plan.reply)
          ? plan.reply
          : 'Tell me what you would like me to handle.',
        'needs_reply',
      );
    if (!plan.recipientName || !plan.message)
      return this.response('Who should I call, and what should I say?', 'needs_reply');
    if (privateClause.test(plan.message) || consequential.test(plan.message))
      return this.response(
        'That could disclose sensitive information or create a commitment. I can relay a simple message or collect options in this pilot. What exact message should I use?',
        'needs_reply',
      );
    const matches = resolveVoiceRecipient(plan.recipientName, contacts);
    if (matches.length !== 1) {
      s.pending = { plan, utterance, utteranceAt };
      return this.response(
        matches.length
          ? `I found ${matches.map((c) => c.name).join(' and ')}. Which person do you mean?`
          : `I do not have a number for ${plan.recipientName}. What is their US phone number?`,
        'needs_reply',
      );
    }
    const c = matches[0];
    if (c.optedOut)
      return this.response(`${c.name} asked not to receive more calls. I will not call them.`);
    if (!c.verified) {
      s.pending = {
        plan,
        utterance,
        utteranceAt,
        confirmPhone: true,
        contactId: c.id,
        phone: c.phone,
        previousPhone: c.phone,
      };
      return this.response(
        `Before I use the saved number for ${c.name}, please check it: ${c.phone.split('').join(' ')}. Is that the right person and number?`,
        'needs_reply',
      );
    }
    const timing = anchorVoiceTiming(plan.message, utteranceAt, profile.timezone);
    if (timing.needsClarification)
      return this.response(
        'Please give an exact date and clock time for that message. I do not want a delay to change what the recipient hears.',
        'needs_reply',
      );
    if (timing.deadlineAt && Date.parse(timing.deadlineAt) <= Date.now())
      return this.response(
        'The arrival time in that earlier request has passed. What updated message or exact time should I use? I have not placed a call.',
        'needs_reply',
      );
    const attributed =
      plan.intent === 'message'
        ? `${profile.name} asked me to pass on this message: “${timing.message}”`
        : `${profile.name} asked me to ask you: “${timing.message}”`;
    const now = new Date().toISOString(),
      input = MissionInputSchema.parse({
        contactId: c.id,
        title: `Message for ${c.name}`,
        kind: plan.intent === 'message' ? 'message' : 'information',
        goal: `Relay the owner's request to ${c.name}: ${timing.message}`,
        requiredTalkingPoints: [attributed],
        ownerLanguage: profile.language,
        recipientLanguage: c.language,
        tone: profile.tone,
        pronunciation: profile.pronunciation,
        schedule: {
          timezone: profile.timezone,
          retryLimit: 0,
          maxDurationSeconds: 180,
          ...(timing.deadlineAt ? { callingWindowEnd: timing.deadlineAt } : {}),
        },
        boundaries: {
          nonNegotiable: [
            'Do not make a booking, payment, purchase or new commitment.',
            'Do not disclose unrelated or private information.',
          ],
          maxAmount: 0,
        },
      });
    const mission: Mission = {
      ...input,
      id: randomUUID(),
      ownerId: owner,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    // Save intent and its receipt together before authorization; a lost response can never redial it.
    await this.engine.db.transaction(async (sql) => {
      const [user] = await sql.query('SELECT deleted_at FROM users WHERE id=$1 FOR UPDATE', [
        owner,
      ]);
      if (!user || user.deleted_at) throw expired();
      const r = repo.in(sql);
      await r.put(owner, 'mission', {
        ...mission,
        reviewVersion: 1,
        voiceAuthorization: {
          sessionId: s.id,
          turnId,
          utterance,
          utteranceAt,
          originalMessage: plan.message,
        },
      });
      await r.put(owner, 'voice_turn', {
        id: turnId,
        status: 'prepared',
        sessionId: s.id,
        missionId: mission.id,
      });
    });
    s.lastMissionId = mission.id;
    if (this.engine.config.provider === 'elevenlabs' && !this.engine.config.liveEnabled)
      return this.response(
        `I have prepared your message for ${c.name}. Real calling is still disabled, so I have not called anyone.`,
        'calling_disabled',
        mission.id,
      );
    try {
      await this.engine.authorize(owner, mission.id, 1, 'normal');
    } catch (error) {
      if (error instanceof HttpError || (error instanceof Error && error.name === 'PolicyError'))
        return this.response(
          `I have prepared the message for ${c.name}, but calling is blocked by setup or recipient checks. No call has been placed.`,
          'calling_disabled',
          mission.id,
        );
      throw error;
    }
    return this.response(
      this.engine.config.provider === 'simulator'
        ? `I will rehearse that call to ${c.name} now. This is a simulation; nobody will be contacted.`
        : `I will call ${c.name} and relay your message. I will report back when the call is over.`,
      'queued',
      mission.id,
    );
  }
  private async reportText(owner: string, missionId?: string) {
    if (!missionId)
      return this.response(
        'There is no conversation to report yet. Who would you like me to call?',
        'needs_reply',
      );
    const d = await this.engine.detail(owner, missionId);
    if (['calling', 'queued', 'authorized', 'awaiting_owner'].includes(d.status))
      return this.response(
        d.status === 'awaiting_owner'
          ? 'The conversation needs a decision. No new commitment has been accepted.'
          : 'The conversation is still in progress. I will report the actual outcome when it finishes.',
        'reply',
        missionId,
      );
    const prefix = d.demo ? 'In the simulated call, ' : '';
    return this.response(
      prefix +
        (d.outcome?.overview ??
          (d as any).executionNotice ??
          'No confirmed outcome is available.') +
        (d.outcome?.unresolved.length
          ? ' Still unresolved: ' + d.outcome.unresolved.join(' ')
          : ''),
      'completed',
      missionId,
    );
  }
  async report(owner: string, body: unknown): Promise<VoiceReply> {
    const b = z.object({ missionId: z.string(), requestId: z.uuid() }).parse(body),
      id = createHash('sha256').update(`${owner}:report:${b.requestId}`).digest('hex');
    const running = this.pendingRequests.get(id);
    if (running)
      return running.then((r) => {
        if (r.missionId !== b.missionId)
          throw new HttpError(
            409,
            'voice_request_reused',
            'Use a new request identifier for a different report.',
          );
        return r;
      });
    const task = this.runReport(owner, id, b).finally(() => this.pendingRequests.delete(id));
    this.pendingRequests.set(id, task);
    return task;
  }
  private async runReport(
    owner: string,
    id: string,
    b: { missionId: string; requestId: string },
  ): Promise<VoiceReply> {
    await this.engine.mission(owner, b.missionId);
    const repo = this.engine.repo,
      prior = await repo.get<any>(owner, 'voice_turn', id);
    if (erased(prior)) throw expired();
    if (prior?.missionId && prior.missionId !== b.missionId)
      throw new HttpError(
        409,
        'voice_request_reused',
        'Use a new request identifier for a different report.',
      );
    if (prior?.response) return prior.response;
    if (prior)
      throw new HttpError(
        409,
        'voice_report_in_progress',
        'This report is processing or needs reconciliation. It will not be synthesized twice.',
      );
    const claimed = await this.claimTurn(
      owner,
      id,
      { id, missionId: b.missionId, status: 'processing' },
      this.providersAllowed(owner) && !!(this.speech && this.engine.config.standardVoice),
    );
    if (!claimed.length)
      throw new HttpError(409, 'voice_report_in_progress', 'This report is already processing.');
    try {
      const reply = await this.reportText(owner, b.missionId);
      const response: VoiceReply = {
        ...reply,
        sessionId: '',
        turnId: b.requestId,
        transcript: '',
        mode: this.engine.config.provider,
        voiceMode: 'device',
      };
      if (this.providersAllowed(owner) && this.speech && this.engine.config.standardVoice) {
        try {
          const audio = await this.speech.synthesizeReply(
            this.engine.config.standardVoice,
            response.text,
          );
          response.audioBase64 = Buffer.from(audio.audio).toString('base64');
          response.audioMimeType = audio.contentType;
          response.voiceMode = 'provider';
        } catch {
          response.voiceMode = 'unavailable';
        }
      }
      await this.engine.db.transaction(async (sql) => {
        await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [owner]);
        await sql.query('SELECT id FROM resources WHERE owner_id=$1 AND id=$2 FOR UPDATE', [
          owner,
          id,
        ]);
        const r = repo.in(sql),
          current = await r.get<any>(owner, 'voice_turn', id);
        if (erased(current)) throw expired();
        const [user] = await sql.query('SELECT deleted_at FROM users WHERE id=$1', [owner]);
        if (!user || user.deleted_at) throw expired();
        await r.put(owner, 'voice_turn', { id, missionId: b.missionId, status: 'done', response });
      });
      return response;
    } catch (error) {
      await this.failReceipt(owner, id, { missionId: b.missionId });
      throw error;
    }
  }
}
