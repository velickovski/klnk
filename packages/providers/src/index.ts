import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type Fetch = typeof globalThis.fetch;

/** Does not include provider response text: that can contain PII or secrets. */
export class ProviderError extends Error {
  constructor(
    public provider: string,
    public status: number,
    public operation: string,
  ) {
    super(`${provider} ${operation} failed (${status})`);
  }
}

async function checked(response: Response, provider: string, operation: string): Promise<Response> {
  if (!response.ok) throw new ProviderError(provider, response.status, operation);
  return response;
}

const escaped = (value: string) => encodeURIComponent(value);
const object = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const callStatuses = new Set([
  'queued',
  'initiated',
  'ringing',
  'in-progress',
  'completed',
  'busy',
  'failed',
  'no-answer',
  'canceled',
]);
const terminalCallStatuses = new Set(['completed', 'busy', 'failed', 'no-answer', 'canceled']);
function invalid(provider: string, operation: string): never {
  throw new ProviderError(provider, 502, `invalid ${operation} response`);
}

export interface ElevenLabsConfig {
  apiKey: string;
  agentId: string;
  phoneNumberId: string;
  fetch?: Fetch;
}

export interface CallStartInput {
  toNumber: string;
  prompt: string;
  firstMessage: string;
  voiceId?: string;
  language: string;
  maxDurationSeconds: number;
  recordingEnabled?: false;
  dynamicVariables?: Record<string, string | number | boolean>;
}

export interface CallStartResult {
  success: boolean;
  message?: string;
  conversation_id: string | null;
  callSid: string | null;
}

export interface ProviderTranscriptTurn {
  role: 'agent' | 'user';
  message: string | null;
  time_in_call_secs: number;
  original_message?: string | null;
}

export interface ProviderConversation {
  agent_id: string;
  conversation_id: string;
  status: 'initiated' | 'in-progress' | 'processing' | 'done' | 'failed';
  transcript: ProviderTranscriptTurn[];
  metadata?: Record<string, unknown>;
  analysis?: {
    transcript_summary?: string;
    call_successful?: string;
    [key: string]: unknown;
  } | null;
  has_audio?: boolean;
}

export interface ProviderVoice {
  voice_id: string;
  name: string;
  category?: string;
  preview_url?: string | null;
  is_owner?: boolean;
  voice_verification?: Record<string, unknown>;
}

export interface ProviderAgent {
  agent_id: string;
  name?: string;
  conversation_config: Record<string, any>;
  platform_settings?: Record<string, any>;
  workflow?: { nodes?: Record<string, unknown>; edges?: Record<string, unknown> } | null;
  procedures?: Record<string, unknown> | null;
}
export interface ProviderPhoneNumber {
  provider: string;
  phone_number_id: string;
  phone_number: string;
  label?: string;
  supports_inbound?: boolean;
  supports_outbound?: boolean;
  assigned_agent?: { agent_id: string; agent_name?: string } | null;
}

/** Low-level provider transport. Ownership, allowlists, authorization and accounting belong in the server. */
export class ElevenLabsAdapter {
  private fetcher: Fetch;
  private base = 'https://api.elevenlabs.io';
  constructor(private config: ElevenLabsConfig) {
    this.fetcher = config.fetch ?? globalThis.fetch;
  }

  private async request(path: string, method = 'GET', body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { 'xi-api-key': this.config.apiKey };
    const form = body instanceof FormData;
    if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
    // No automatic retry for a create: a timed-out call start may already have dialled.
    return checked(
      await this.fetcher(this.base + path, {
        method,
        headers,
        body: body === undefined ? undefined : form ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      }),
      'elevenlabs',
      `${method} ${path.split('/').slice(0, 4).join('/')}`,
    );
  }

  async startCall(input: CallStartInput): Promise<CallStartResult> {
    if (!/^\+[1-9]\d{7,14}$/.test(input.toNumber))
      throw new Error('A confirmed E.164 recipient is required');
    if (!input.firstMessage.trim() || !input.prompt.trim())
      throw new Error('Disclosure and approved mission prompt are required');
    if (
      !Number.isInteger(input.maxDurationSeconds) ||
      input.maxDurationSeconds < 30 ||
      input.maxDurationSeconds > 600
    )
      throw new Error('Call duration outside pilot limits');
    const response = await this.request('/v1/convai/twilio/outbound-call', 'POST', {
      agent_id: this.config.agentId,
      agent_phone_number_id: this.config.phoneNumberId,
      to_number: input.toNumber,
      call_recording_enabled: false,
      telephony_call_config: { ringing_timeout_secs: 30, twilio_call_recording_enabled: false },
      conversation_initiation_client_data: {
        dynamic_variables: input.dynamicVariables ?? {},
        conversation_config_override: {
          agent: {
            first_message: input.firstMessage,
            language: input.language,
            prompt: {
              prompt: input.prompt,
              tool_ids: [],
              tool_ids_strict: true,
              native_mcp_server_ids: [],
              knowledge_base: [],
            },
          },
          conversation: { max_duration_seconds: input.maxDurationSeconds },
          ...(input.voiceId ? { tts: { voice_id: input.voiceId } } : {}),
        },
      },
    });
    const result = (await response.json()) as CallStartResult;
    // A malformed/partial accepted response is uncertain. Never retry the creation automatically.
    if (
      !object(result) ||
      result.success !== true ||
      typeof result.conversation_id !== 'string' ||
      !result.conversation_id.trim() ||
      typeof result.callSid !== 'string' ||
      !/^CA[0-9a-fA-F]{32}$/.test(result.callSid)
    )
      invalid('elevenlabs', 'outbound call');
    return result;
  }

  async getConversation(id: string): Promise<ProviderConversation> {
    const value: unknown = await (
      await this.request(`/v1/convai/conversations/${escaped(id)}`)
    ).json();
    if (
      !object(value) ||
      value.conversation_id !== id ||
      typeof value.agent_id !== 'string' ||
      !value.agent_id ||
      !['initiated', 'in-progress', 'processing', 'done', 'failed'].includes(value.status) ||
      !Array.isArray(value.transcript)
    )
      invalid('elevenlabs', 'conversation');
    if (
      value.transcript.some(
        (t: unknown) =>
          !object(t) ||
          !['agent', 'user'].includes(t.role) ||
          !(t.message === null || typeof t.message === 'string') ||
          typeof t.time_in_call_secs !== 'number' ||
          !Number.isFinite(t.time_in_call_secs) ||
          t.time_in_call_secs < 0,
      )
    )
      invalid('elevenlabs', 'conversation transcript');
    if (
      value.analysis !== undefined &&
      value.analysis !== null &&
      (!object(value.analysis) ||
        (value.analysis.transcript_summary !== undefined &&
          typeof value.analysis.transcript_summary !== 'string'))
    )
      invalid('elevenlabs', 'conversation analysis');
    return value as unknown as ProviderConversation;
  }

  /** Read-only metadata. Do not log the full response: prompts/config can contain private content. */
  async getAgent(id = this.config.agentId): Promise<ProviderAgent> {
    const value: unknown = await (await this.request(`/v1/convai/agents/${escaped(id)}`)).json();
    if (!object(value) || value.agent_id !== id || !object(value.conversation_config))
      invalid('elevenlabs', 'agent');
    return value as ProviderAgent;
  }

  /** Read-only: this does not import, purchase, assign or call a number. */
  async getPhoneNumber(id = this.config.phoneNumberId): Promise<ProviderPhoneNumber> {
    const value: unknown = await (
      await this.request(`/v1/convai/phone-numbers/${escaped(id)}`)
    ).json();
    if (
      !object(value) ||
      value.phone_number_id !== id ||
      typeof value.provider !== 'string' ||
      typeof value.phone_number !== 'string' ||
      !/^\+[1-9]\d{7,14}$/.test(value.phone_number)
    )
      invalid('elevenlabs', 'phone number');
    return value as ProviderPhoneNumber;
  }

  async deleteConversation(id: string): Promise<void> {
    await this.request(`/v1/convai/conversations/${escaped(id)}`, 'DELETE');
  }

  async listVoices(
    nextPageToken?: string,
  ): Promise<{ voices: ProviderVoice[]; next_page_token?: string; has_more?: boolean }> {
    const query = new URLSearchParams({ page_size: '100' });
    if (nextPageToken) query.set('next_page_token', nextPageToken);
    return (await this.request(`/v2/voices?${query}`)).json();
  }

  async getVoice(id: string): Promise<ProviderVoice> {
    const value: unknown = await (await this.request(`/v1/voices/${escaped(id)}`)).json();
    if (
      !object(value) ||
      value.voice_id !== id ||
      typeof value.name !== 'string' ||
      !value.name.trim()
    )
      invalid('elevenlabs', 'voice');
    return value as ProviderVoice;
  }

  /** Owner-initiated short voice turn. No URL ingestion, edit surcharge, diarization or webhook fan-out. */
  async transcribeAudio(input: {
    bytes: Uint8Array;
    mimeType: string;
    languageCode?: string;
  }): Promise<{ text: string; languageCode: string; languageProbability?: number }> {
    const extensions: Record<string, string> = {
      'audio/mp4': 'm4a',
      'audio/m4a': 'm4a',
      'audio/x-m4a': 'm4a',
      'audio/aac': 'aac',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/webm': 'webm',
      'audio/ogg': 'ogg',
    };
    const mime = input.mimeType.split(';')[0]!.trim().toLowerCase(),
      extension = extensions[mime];
    if (!extension || input.bytes.length < 1 || input.bytes.length > 10 * 1024 * 1024)
      throw new Error('Provide a supported owner audio turn of at most 10 MiB');
    if (input.languageCode && !/^[a-z]{2,3}$/i.test(input.languageCode))
      throw new Error('Use an ISO-639-1 or ISO-639-3 language code');
    const body = new FormData();
    body.set('model_id', 'scribe_v2');
    body.set(
      'file',
      new Blob([new Uint8Array(input.bytes)], { type: mime }),
      `owner-turn.${extension}`,
    );
    body.set('diarize', 'false');
    body.set('tag_audio_events', 'false');
    body.set('timestamps_granularity', 'none');
    body.set('webhook', 'false');
    if (input.languageCode) body.set('language_code', input.languageCode.toLowerCase());
    // Provider default logging applies. Do not request enterprise-only zero retention or claim it implicitly.
    const value: unknown = await (await this.request('/v1/speech-to-text', 'POST', body)).json();
    if (
      !object(value) ||
      typeof value.text !== 'string' ||
      value.text.length > 20000 ||
      typeof value.language_code !== 'string' ||
      !/^[a-z]{2,3}$/i.test(value.language_code) ||
      (value.language_probability !== undefined &&
        (typeof value.language_probability !== 'number' ||
          !Number.isFinite(value.language_probability) ||
          value.language_probability < 0 ||
          value.language_probability > 1))
    )
      invalid('elevenlabs', 'speech transcription');
    return {
      text: value.text,
      languageCode: value.language_code,
      languageProbability: value.language_probability,
    };
  }

  /** Server-authorized owner reply/summary. Caller must enforce per-owner voice ownership and usage limits. */
  async synthesizeReply(
    id: string,
    text: string,
    options: { modelId?: string; languageCode?: string } = {},
  ): Promise<{ contentType: string; audio: Uint8Array }> {
    if (!text.trim() || text.length > 2000)
      throw new Error('A spoken reply must contain 1–2000 characters');
    if (options.languageCode && !/^[a-z]{2}$/i.test(options.languageCode))
      throw new Error('Use an ISO-639-1 TTS language code');
    const response = await this.request(
      `/v1/text-to-speech/${escaped(id)}?output_format=mp3_44100_128`,
      'POST',
      {
        text,
        model_id: options.modelId ?? 'eleven_multilingual_v2',
        ...(options.languageCode ? { language_code: options.languageCode.toLowerCase() } : {}),
      },
    );
    const contentType = response.headers.get('content-type') ?? 'audio/mpeg';
    if (!/^audio\//i.test(contentType) && !/^application\/octet-stream/i.test(contentType))
      invalid('elevenlabs', 'speech audio');
    if (Number(response.headers.get('content-length')) > 5 * 1024 * 1024)
      invalid('elevenlabs', 'speech audio');
    const audio = new Uint8Array(await response.arrayBuffer());
    if (!audio.length || audio.length > 5 * 1024 * 1024) invalid('elevenlabs', 'speech audio');
    return { contentType, audio };
  }

  /** Server must allow only its configured standard voice or a verified voice owned by this user. */
  async previewVoice(
    id: string,
    text = 'Hello. I am your AI assistant. I will speak within your instructions.',
  ): Promise<{ contentType: string; audio: Uint8Array }> {
    if (text.length > 500) throw new Error('Voice preview is limited to 500 characters');
    return this.synthesizeReply(id, text);
  }

  /** Transport only. Not exposed by default: account arrangement and provider verification must be resolved first. */
  async createInstantClone(input: {
    name: string;
    files: File[];
    consent: { ownsVoice: true; permitsSynthesis: true; acceptedAt: string };
    providerAccountApproved: boolean;
  }): Promise<{ voice_id: string; requires_verification: boolean }> {
    if (
      input.providerAccountApproved !== true ||
      input.consent?.ownsVoice !== true ||
      input.consent?.permitsSynthesis !== true ||
      !Number.isFinite(Date.parse(input.consent.acceptedAt))
    )
      throw new Error('Owner consent and approved provider onboarding are required');
    if (
      !input.files.length ||
      input.files.length > 5 ||
      input.files.some((f) => f.size > 10 * 1024 * 1024 || !/^audio\//.test(f.type))
    )
      throw new Error('Provide one to five audio files, each at most 10 MiB');
    const body = new FormData();
    body.set('name', input.name.slice(0, 80));
    for (const file of input.files) body.append('files', file);
    return (await this.request('/v1/voices/add', 'POST', body)).json();
  }

  async deleteVoice(id: string): Promise<void> {
    await this.request(`/v1/voices/${escaped(id)}`, 'DELETE');
  }
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  apiKeySid?: string;
  apiKeySecret?: string;
  fetch?: Fetch;
}
export interface TwilioCall {
  sid: string;
  status: string;
  duration?: string;
  to?: string;
  from?: string;
}
export interface TwilioAccount {
  sid: string;
  status: 'active' | 'suspended' | 'closed';
  type: 'Trial' | 'Full';
}
export interface TwilioPhoneNumber {
  sid: string;
  phone_number: string;
  capabilities?: { voice?: boolean };
  status?: string;
}
export interface TwilioCallerId {
  sid: string;
  phone_number: string;
}

export class TwilioAdapter {
  private fetcher: Fetch;
  constructor(private config: TwilioConfig) {
    this.fetcher = config.fetch ?? globalThis.fetch;
  }
  private credential() {
    return this.config.apiKeySid && this.config.apiKeySecret
      ? `${this.config.apiKeySid}:${this.config.apiKeySecret}`
      : `${this.config.accountSid}:${this.config.authToken}`;
  }
  private async read(path: string): Promise<Record<string, any>> {
    const response = await checked(
      await this.fetcher(
        `https://api.twilio.com/2010-04-01/Accounts/${escaped(this.config.accountSid)}${path}`,
        {
          method: 'GET',
          headers: { Authorization: `Basic ${Buffer.from(this.credential()).toString('base64')}` },
          signal: AbortSignal.timeout(15_000),
        },
      ),
      'twilio',
      'GET readiness metadata',
    );
    const value: unknown = await response.json();
    if (!object(value)) invalid('twilio', 'readiness metadata');
    return value;
  }
  /** The raw account endpoint contains auth_token. Deliberately return only these non-secret fields. */
  async getAccount(): Promise<TwilioAccount> {
    const value = await this.read('.json');
    if (
      value.sid !== this.config.accountSid ||
      !['active', 'suspended', 'closed'].includes(value.status) ||
      !['Trial', 'Full'].includes(value.type)
    )
      invalid('twilio', 'account');
    return { sid: value.sid, status: value.status, type: value.type };
  }
  async listIncomingPhoneNumbers(phoneNumber: string): Promise<TwilioPhoneNumber[]> {
    if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) throw new Error('E.164 number required');
    const value = await this.read(
      `/IncomingPhoneNumbers.json?${new URLSearchParams({ PhoneNumber: phoneNumber, PageSize: '1000' })}`,
    );
    if (!Array.isArray(value.incoming_phone_numbers)) invalid('twilio', 'incoming phone numbers');
    return value.incoming_phone_numbers
      .filter((n: unknown) => object(n) && n.phone_number === phoneNumber)
      .map((n: Record<string, any>) => ({
        sid: n.sid,
        phone_number: n.phone_number,
        capabilities: object(n.capabilities) ? { voice: n.capabilities.voice } : undefined,
        status: n.status,
      }));
  }
  async listVerifiedCallerIds(phoneNumber: string): Promise<TwilioCallerId[]> {
    if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) throw new Error('E.164 number required');
    const value = await this.read(
      `/OutgoingCallerIds.json?${new URLSearchParams({ PhoneNumber: phoneNumber, PageSize: '1000' })}`,
    );
    if (!Array.isArray(value.outgoing_caller_ids)) invalid('twilio', 'verified caller IDs');
    return value.outgoing_caller_ids
      .filter((n: unknown) => object(n) && n.phone_number === phoneNumber)
      .map((n: Record<string, any>) => ({ sid: n.sid, phone_number: n.phone_number }));
  }
  private async request(
    id: string,
    method: 'GET' | 'POST',
    data?: URLSearchParams,
  ): Promise<TwilioCall> {
    if (!/^CA[a-zA-Z0-9]{20,40}$/.test(id)) throw new Error('Invalid Twilio call SID');
    const response = await checked(
      await this.fetcher(
        `https://api.twilio.com/2010-04-01/Accounts/${escaped(this.config.accountSid)}/Calls/${escaped(id)}.json`,
        {
          method,
          headers: {
            Authorization: `Basic ${Buffer.from(this.credential()).toString('base64')}`,
            ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          },
          body: data?.toString(),
          signal: AbortSignal.timeout(15_000),
        },
      ),
      'twilio',
      `${method} call`,
    );
    const value: unknown = await response.json();
    if (!object(value) || value.sid !== id || !callStatuses.has(value.status))
      invalid('twilio', 'call');
    return value as unknown as TwilioCall;
  }
  async getCall(id: string): Promise<TwilioCall> {
    return this.request(id, 'GET');
  }
  async endCall(id: string): Promise<TwilioCall> {
    const call = await this.getCall(id);
    if (terminalCallStatuses.has(call.status)) return call;
    const status = ['queued', 'initiated', 'ringing'].includes(call.status)
      ? 'canceled'
      : 'completed';
    const updated = await this.request(id, 'POST', new URLSearchParams({ Status: status }));
    if (!terminalCallStatuses.has(updated.status))
      throw new ProviderError('twilio', 502, 'termination not yet confirmed');
    return updated;
  }
}

export interface ElevenLabsWebhook {
  type: string;
  event_timestamp?: number;
  data: {
    conversation_id?: string;
    agent_id?: string;
    status?: string;
    transcript?: ProviderTranscriptTurn[];
    analysis?: ProviderConversation['analysis'];
    failure_reason?: string;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

/** Authenticates raw bytes before parsing. Persist the returned deduplication key transactionally before effects. */
export function verifyElevenLabsWebhook(
  raw: string | Uint8Array,
  signature: string | undefined,
  secret: string,
  nowMs = Date.now(),
): ElevenLabsWebhook {
  if (!signature || !secret) throw new Error('Webhook authentication required');
  const parts = signature.split(',').map((v) => v.trim().split('='));
  const timestamps = parts.filter(([k]) => k === 't').map(([, v]) => v);
  const signatures = parts.filter(([k]) => k === 'v0').map(([, v]) => v);
  if (timestamps.length !== 1 || signatures.length !== 1 || !/^\d+$/.test(timestamps[0] ?? ''))
    throw new Error('Invalid signature header');
  const timestamp = Number(timestamps[0]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowMs / 1000 - timestamp) > 1800)
    throw new Error('Stale webhook');
  const bytes = typeof raw === 'string' ? Buffer.from(raw) : Buffer.from(raw);
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(bytes).digest();
  const claimed = signatures[0] ?? '';
  if (!/^[a-fA-F0-9]{64}$/.test(claimed) || !timingSafeEqual(expected, Buffer.from(claimed, 'hex')))
    throw new Error('Invalid webhook signature');
  const event = JSON.parse(bytes.toString('utf8')) as ElevenLabsWebhook;
  if (!event || typeof event.type !== 'string' || !event.data || typeof event.data !== 'object')
    throw new Error('Invalid webhook envelope');
  return event;
}

export function webhookDeduplicationKey(event: ElevenLabsWebhook): string {
  // Same logical event signed again later still deduplicates. Different final transcript versions are distinct.
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return value;
  };
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonical({
          type: event.type,
          conversation: event.data.conversation_id,
          timestamp: event.event_timestamp,
          data: event.data,
        }),
      ),
    )
    .digest('hex');
}

/** Standard Twilio form webhook validation; URL must be the exact configured PUBLIC URL, never derived from Host. */
export function verifyTwilioWebhook(
  publicUrl: string,
  params: Record<string, string>,
  signature: string | undefined,
  authToken: string,
): boolean {
  if (!signature || !authToken || !publicUrl.startsWith('https://')) return false;
  const text =
    publicUrl +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join('');
  const expected = createHmac('sha1', authToken).update(text).digest();
  const received = Buffer.from(signature, 'base64');
  return received.length === expected.length && timingSafeEqual(expected, received);
}

export interface GoogleCalendarConfig {
  accessToken: string;
  fetch?: Fetch;
}
export interface CalendarEvent {
  id: string;
  etag?: string;
  status?: string;
  transparency?: string;
  recurrence?: string[];
  recurringEventId?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
}
export interface CalendarUpdateInput {
  calendarId: string;
  eventId: string;
  startAt: string;
  endAt: string;
  timezone: string;
  idempotencyKey: string;
  expectedStartAt?: string;
}

export class GoogleCalendarAdapter {
  private fetcher: Fetch;
  constructor(private config: GoogleCalendarConfig) {
    this.fetcher = config.fetch ?? globalThis.fetch;
  }
  private async request(
    path: string,
    method = 'GET',
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<Response> {
    return checked(
      await this.fetcher(`https://www.googleapis.com/calendar/v3${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...extraHeaders,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      }),
      'google-calendar',
      `${method} calendar`,
    );
  }
  async getEvent(calendarId: string, eventId: string): Promise<CalendarEvent> {
    return (
      await this.request(`/calendars/${escaped(calendarId)}/events/${escaped(eventId)}`)
    ).json();
  }
  async updateExistingEvent(
    input: CalendarUpdateInput,
  ): Promise<{ externalId: string; etag?: string; alreadyApplied: boolean }> {
    if (!input.eventId || !input.calendarId || !input.idempotencyKey)
      throw new Error('Existing event, calendar and idempotency key required');
    if (
      !/(?:[zZ]|[+-]\d{2}:\d{2})$/.test(input.startAt) ||
      !/(?:[zZ]|[+-]\d{2}:\d{2})$/.test(input.endAt)
    )
      throw new Error('Explicit dates with offsets required');
    const start = Date.parse(input.startAt),
      end = Date.parse(input.endAt);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      end - start > 86_400_000
    )
      throw new Error('Invalid calendar duration');
    try {
      new Intl.DateTimeFormat('en', { timeZone: input.timezone });
    } catch {
      throw new Error('Valid timezone required');
    }
    const existing = await this.getEvent(input.calendarId, input.eventId);
    if (existing?.id !== input.eventId)
      throw new Error('Calendar event identity does not match the authorized event');
    if (existing.recurrence?.length)
      throw new Error(
        'Select a single event occurrence; changing a recurring series is not authorized',
      );
    const marker = createHash('sha256').update(input.idempotencyKey).digest('hex');
    if (existing.extendedProperties?.private?.personalAgentAction === marker) {
      if (
        Date.parse(existing.start?.dateTime ?? '') !== start ||
        Date.parse(existing.end?.dateTime ?? '') !== end
      )
        throw new Error('Calendar changed after this action; owner review required');
      return { externalId: existing.id, etag: existing.etag, alreadyApplied: true };
    }
    if (
      existing.status === 'cancelled' ||
      !existing.etag ||
      !existing.start?.dateTime ||
      !existing.end?.dateTime
    )
      throw new Error('Existing timed event unavailable');
    if (
      input.expectedStartAt &&
      Date.parse(existing.start.dateTime) !== Date.parse(input.expectedStartAt)
    )
      throw new Error('Original event moved; owner review required');
    // Listing current event instances permits exclusion of the event being moved. freeBusy cannot do that.
    let pageToken: string | undefined;
    const seenPages = new Set<string>();
    do {
      const query = new URLSearchParams({
        timeMin: input.startAt,
        timeMax: input.endAt,
        singleEvents: 'true',
        showDeleted: 'false',
        maxResults: '2500',
      });
      if (pageToken) query.set('pageToken', pageToken);
      const page = (await (
        await this.request(`/calendars/${escaped(input.calendarId)}/events?${query}`)
      ).json()) as { items?: CalendarEvent[]; nextPageToken?: string };
      if (!Array.isArray(page.items)) throw new Error('Availability response incomplete');
      for (const event of page.items) {
        if (
          event.id === input.eventId ||
          event.status === 'cancelled' ||
          event.transparency === 'transparent'
        )
          continue;
        // Calendar list API time bounds already select overlapping instances, including all-day events.
        throw new Error('Calendar slot is no longer available');
      }
      pageToken = page.nextPageToken;
      if (pageToken && (seenPages.has(pageToken) || seenPages.size >= 20))
        throw new Error('Availability pagination could not be verified within the request bound');
      if (pageToken) seenPages.add(pageToken);
    } while (pageToken);
    const updated = (await (
      await this.request(
        `/calendars/${escaped(input.calendarId)}/events/${escaped(input.eventId)}?sendUpdates=none`,
        'PATCH',
        {
          start: { dateTime: input.startAt, timeZone: input.timezone },
          end: { dateTime: input.endAt, timeZone: input.timezone },
          extendedProperties: {
            private: { ...existing.extendedProperties?.private, personalAgentAction: marker },
          },
        },
        { 'If-Match': existing.etag },
      )
    ).json()) as CalendarEvent;
    if (updated?.id !== input.eventId)
      throw new Error('Calendar update response did not identify the authorized event');
    const verified = await this.getEvent(input.calendarId, input.eventId);
    if (
      verified?.id !== input.eventId ||
      verified.status === 'cancelled' ||
      verified.extendedProperties?.private?.personalAgentAction !== marker ||
      Date.parse(verified.start?.dateTime ?? '') !== start ||
      Date.parse(verified.end?.dateTime ?? '') !== end
    )
      throw new Error(
        'Calendar update needs reconciliation; readback did not confirm the authorized change',
      );
    return { externalId: verified.id, etag: verified.etag, alreadyApplied: false };
  }
}

export const LIVE_CAPABILITIES = {
  liveTranscript: false,
  translatedLiveTranscript: false,
  typedIntervention: false,
  instructionUpdates: false,
  pause: false,
  takeover: false,
  transfer: false,
  terminate: true,
  postCallTranscript: true,
  callbacks: false,
  retention:
    'Provider agent/workspace settings; deletion API is available, zero retention is not assumed.',
  limitation:
    'The native ElevenLabs–Twilio adapter does not implement a second live control channel. Owner guidance is available only in simulation; end requests use the Twilio call SID.',
} as const;

export {
  inspectAgentForPilot,
  inspectOwnerAgent,
  type PilotAgentInspection,
  type PilotCheck,
} from './readiness.js';
export {
  ElevenOwnerPlanner,
  type ElevenOwnerPlannerConfig,
  type OwnerPlanInput,
  type OwnerSocket,
} from './owner-planner.js';
