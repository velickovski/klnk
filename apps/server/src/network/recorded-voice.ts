import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  NetworkVoiceTurnInputSchema,
  NetworkVoiceTurnResultSchema,
  ProfileSchema,
  type NetworkVoiceTurnInput,
  type NetworkVoiceTurnResult,
} from '@personal-agent/domain';
import { Database, type SQL } from '../db.js';
import { HttpError } from '../errors.js';
import { OwnerIntentService, type OwnerIntentResult } from './owner-intent.js';
import { lockNetworkOwners, NetworkStore } from './store.js';

export const RECORDED_VOICE_LIMITS = Object.freeze({
  maxAudioBytes: 2 * 1024 * 1024,
  maxCaptureSeconds: 30,
  maxTurnsPerDay: 60,
  receiptHours: 24,
});
const TRANSCRIBE_MODEL = 'gpt-transcribe';
const receiptId = (owner: string, turn: string) => {
  const hex = createHash('sha256')
    .update(`network-recorded-turn-v1:${owner}:${turn}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
type Receipt = {
  kind: 'network_recorded_turn_v1';
  ownerId: string;
  turnId: string;
  digest: string;
  state: NetworkVoiceTurnResult['status'];
  createdAt: string;
  updatedAt: string;
  intentCommandId?: string;
  reviewHash?: string;
  cancelledReview?: boolean;
  reason?: string;
};
type Options = { apiKey?: string; fetch?: typeof fetch };
const safeFailure = (code: string, message: string) => new HttpError(409, code, message);

/** Actual bounded transcription followed by owner intent, never a telephone adapter.
 * Audio and transcripts are not cached in these receipts. The existing owner
 * command stores submitted instruction text under its documented lifecycle. */
export class RecordedNetworkVoice {
  private store: NetworkStore;
  constructor(
    private db: Database,
    private intents: OwnerIntentService,
    private options: Options = {},
  ) {
    this.store = new NetworkStore(db);
  }
  status() {
    return {
      available: !!this.options.apiKey?.trim(),
      recordedTurns: true as const,
      speechSource: 'device' as const,
      nativeLiveAvailable: false as const,
      maxCaptureSeconds: RECORDED_VOICE_LIMITS.maxCaptureSeconds,
      maxAudioBytes: RECORDED_VOICE_LIMITS.maxAudioBytes,
      maxTurnsPerDay: RECORDED_VOICE_LIMITS.maxTurnsPerDay,
    };
  }
  private async saved(sql: SQL, owner: string, turnId: string) {
    const record = await this.store.in(sql).get<Receipt>('receipt', receiptId(owner, turnId));
    return record?.ownerA === owner &&
      !record.ownerB &&
      record.value.kind === 'network_recorded_turn_v1'
      ? record.value
      : undefined;
  }
  private save(sql: SQL, receipt: Receipt) {
    receipt.updatedAt = new Date().toISOString();
    return this.store.in(sql).put({
      id: receiptId(receipt.ownerId, receipt.turnId),
      kind: 'receipt',
      ownerA: receipt.ownerId,
      status: `voice_${receipt.state}`,
      version: 1,
      value: receipt,
    });
  }
  private async update(owner: string, turnId: string, change: (receipt: Receipt) => void) {
    return this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [owner]);
      const receipt = await this.saved(sql, owner, turnId);
      if (!receipt)
        throw new HttpError(404, 'not_found', 'This voice instruction was not recorded.');
      change(receipt);
      await this.save(sql, receipt);
      return receipt;
    });
  }
  private base(
    receipt: Receipt,
    replyText: string,
    extra: Record<string, unknown> = {},
  ): NetworkVoiceTurnResult {
    return NetworkVoiceTurnResultSchema.parse({
      schemaVersion: 1,
      turnId: receipt.turnId,
      status: receipt.state,
      replyText,
      ...(receipt.reason ? { reason: receipt.reason } : {}),
      speechSource: 'device',
      audioStored: false,
      ...extra,
    });
  }
  private async view(
    owner: string,
    receipt: Receipt,
    transcript?: string,
  ): Promise<NetworkVoiceTurnResult> {
    if (Date.parse(receipt.createdAt) + RECORDED_VOICE_LIMITS.receiptHours * 3600000 <= Date.now())
      return this.base(
        { ...receipt, state: 'failed', reason: 'voice_receipt_expired' },
        'This voice receipt expired. Check your Inbox before giving a new instruction.',
      );
    if (receipt.state === 'processing')
      return this.base(
        receipt,
        'That voice instruction is still processing. Check this same instruction before trying again.',
      );
    if (receipt.state === 'uncertain')
      return this.base(
        receipt,
        'The transcription result is unconfirmed. No automatic paid retry was made. Check your Inbox before giving a new instruction.',
      );
    if (receipt.state === 'failed')
      return this.base(
        receipt,
        'This voice instruction could not be completed. No successful result is assumed.',
      );
    if (!receipt.intentCommandId)
      return this.base(
        { ...receipt, state: 'failed', reason: 'voice_result_missing' },
        'There is no confirmed result for that voice instruction.',
      );
    let intent: OwnerIntentResult;
    try {
      intent = await this.intents.read(owner, receipt.intentCommandId);
    } catch (error) {
      if (error instanceof HttpError && [404, 410].includes(error.statusCode))
        return this.base(
          { ...receipt, state: 'failed', reason: 'voice_result_removed' },
          'The request result is no longer available. An old voice identifier cannot recreate it.',
        );
      throw error;
    }
    let replyText: string;
    let review: NetworkVoiceTurnResult['review'];
    if (receipt.cancelledReview)
      replyText =
        'I have not sent the prepared request. You can give a new complete instruction, or review the saved draft in your workspace.';
    else if (intent.status === 'draft' && intent.plan && intent.planHash) {
      const plan = intent.plan;
      const recipient = await this.intents.recipient(owner, plan.connectionId);
      const displayName = ProfileSchema.shape.name.safeParse(recipient.name);
      const recipientName = displayName.success ? displayName.data : `member ${recipient.id}`;
      const format = (instant: string, zone: string) =>
        new Intl.DateTimeFormat('en', {
          timeZone: zone,
          dateStyle: 'full',
          timeStyle: 'long',
        }).format(new Date(instant));
      const intervals = plan.candidateSlots
        .map(
          (slot, index) =>
            `Option ${index + 1}: ${format(slot.startAt, slot.timezone)} through ${format(slot.endAt, slot.timezone)}, in ${slot.timezone}.`,
        )
        .join(' ');
      const terms = [
        `${plan.kind === 'meeting' ? 'A meeting' : plan.kind === 'ask' ? 'A question' : 'A message'}.`,
        `Purpose: ${plan.purpose}. Topic: ${plan.topic}.`,
        ...(plan.message ? [`Exact message: ${plan.message}`] : []),
        ...(intervals ? [intervals] : []),
        `Location: ${plan.location || 'not specified'}.`,
        `Request expires ${format(plan.expiresAt, 'UTC')}.`,
      ].join(' ');
      // Immutable member identity stays visible in the UI; the server-resolved
      // connection cannot be changed by the readback or a model confirmation.
      replyText = `I prepared this exact request for ${recipientName}. ${terms} Nothing has been sent. Say "Send this exact request" to confirm, or "Cancel this request".`;
      review = { commandId: intent.commandId, planHash: intent.planHash };
    } else if (intent.status === 'submitted' && intent.conversation) {
      replyText = `${intent.conversation.summary} ${intent.conversation.nextAction || ''}`.trim();
    } else if (intent.status === 'clarification')
      replyText = `${intent.clarification || 'Please clarify your instruction.'} Say the complete updated instruction when you are ready.`;
    else if (intent.status === 'processing')
      replyText =
        'Your request is still processing. Check this same instruction before starting another.';
    else if (intent.status === 'uncertain')
      replyText =
        'The planning result is unconfirmed. No automatic paid retry was made. Check this instruction in your Inbox.';
    else
      replyText =
        'I could not prepare that request under the current permissions. Review your connections and settings before trying a new instruction.';
    return this.base(receipt, replyText, {
      intent,
      ...(transcript ? { transcript } : {}),
      ...(review ? { review } : {}),
    });
  }
  async read(owner: string, turnId: string) {
    z.uuid().parse(turnId);
    let receipt = await this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [owner]);
      return this.saved(sql, owner, turnId);
    });
    if (!receipt) throw new HttpError(404, 'not_found', 'This voice instruction was not recorded.');
    if (receipt.state === 'processing' && Date.parse(receipt.updatedAt) + 90000 < Date.now())
      receipt = await this.update(owner, turnId, (value) => {
        if (value.state === 'processing') {
          value.state = 'uncertain';
          value.reason = 'voice_processing_unconfirmed';
        }
      });
    if (
      receipt.intentCommandId &&
      ['voice_request_unconfirmed', 'voice_processing_unconfirmed'].includes(receipt.reason ?? '')
    ) {
      try {
        const known = await this.intents.read(owner, receipt.intentCommandId);
        if (known.status !== 'processing' && known.status !== 'uncertain')
          receipt = await this.update(owner, turnId, (value) => {
            value.state = 'completed';
            delete value.reason;
          });
      } catch (error) {
        if (!(error instanceof HttpError) || ![404, 410].includes(error.statusCode)) throw error;
      }
    }
    return this.view(owner, receipt);
  }
  async sweepRetention() {
    // No audio, transcript, reply or shared terms are stored in these receipts.
    // Retain only the content-free idempotency binding after its readback TTL.
    const rows = await this.db.query(
      "SELECT id,owner_a FROM network_records WHERE kind='receipt' AND owner_b IS NULL AND status LIKE 'voice_%' AND status<>'voice_failed' AND created_at<clock_timestamp()-interval '24 hours'",
    );
    for (const row of rows)
      await this.db.transaction(async (sql) => {
        await lockNetworkOwners(sql, [row.owner_a]);
        const record = await this.store.in(sql).get<Receipt>('receipt', row.id);
        if (!record || record.value.kind !== 'network_recorded_turn_v1') return;
        const { intentCommandId, reviewHash, ...metadata } = record.value;
        await this.save(sql, { ...metadata, state: 'failed', reason: 'voice_receipt_expired' });
      });
  }
  async execute(owner: string, raw: unknown): Promise<NetworkVoiceTurnResult> {
    const input = NetworkVoiceTurnInputSchema.parse(raw);
    if (!this.options.apiKey?.trim())
      throw new HttpError(
        503,
        'openai_not_configured',
        'Voice transcription is not configured on the server. Your recording was not submitted to OpenAI.',
      );
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.audioBase64))
      throw new HttpError(400, 'invalid_audio', 'The recording encoding is invalid.');
    const bytes = Buffer.from(input.audioBase64, 'base64');
    if (!bytes.length || bytes.length > RECORDED_VOICE_LIMITS.maxAudioBytes)
      throw new HttpError(
        413,
        'voice_audio_limit',
        'This recording exceeds the bounded voice upload limit.',
      );
    const digest = this.db.keyedDigest('tool-arguments', JSON.stringify(input));
    const reservation = await this.db.transaction(async (sql) => {
      await lockNetworkOwners(sql, [owner]);
      const old = await this.saved(sql, owner, input.turnId);
      if (old) {
        if (old.digest !== digest)
          throw safeFailure(
            'voice_turn_conflict',
            'That voice instruction identifier already refers to a different recording.',
          );
        return { receipt: old, created: false };
      }
      if (
        (
          await sql.query(
            "SELECT id FROM live_sessions WHERE owner_id=$1 AND status IN ('creating','active','closing','unconfirmed')",
            [owner],
          )
        ).length
      )
        throw safeFailure(
          'voice_session_unresolved',
          'An earlier live conversation still needs confirmed closure. End that conversation before starting recorded voice.',
        );
      const [counts] = await sql.query<{ daily: number; active: number }>(
        `SELECT count(*) FILTER(WHERE created_at>clock_timestamp()-interval '1 day')::int AS daily,count(*) FILTER(WHERE status='voice_processing' AND updated_at>clock_timestamp()-interval '90 seconds')::int AS active FROM network_records WHERE kind='receipt' AND owner_a=$1 AND owner_b IS NULL AND status LIKE 'voice_%'`,
        [owner],
      );
      if (counts.daily >= RECORDED_VOICE_LIMITS.maxTurnsPerDay)
        throw new HttpError(
          429,
          'voice_daily_limit',
          'The daily recorded voice limit has been reached. No transcription was started.',
        );
      if (counts.active)
        throw safeFailure(
          'voice_turn_processing',
          'An earlier recorded voice instruction is still processing. Check that instruction first.',
        );
      const at = new Date().toISOString();
      const receipt: Receipt = {
        kind: 'network_recorded_turn_v1',
        ownerId: owner,
        turnId: input.turnId,
        digest,
        state: 'processing',
        createdAt: at,
        updatedAt: at,
      };
      await this.save(sql, receipt);
      return { receipt, created: true };
    });
    if (!reservation.created) return this.read(owner, input.turnId);
    let transcript: string;
    try {
      transcript = await this.transcribe(bytes, input);
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 401) throw error;
      const reliable = error instanceof HttpError && error.code !== 'transcription_unconfirmed';
      const receipt = await this.update(owner, input.turnId, (value) => {
        value.state = reliable ? 'failed' : 'uncertain';
        value.reason = error instanceof HttpError ? error.code : 'transcription_unconfirmed';
      });
      return this.view(owner, receipt);
    }
    try {
      const reference = input.review?.commandId ?? input.turnId;
      await this.update(owner, input.turnId, (value) => {
        if (value.state !== 'processing')
          throw safeFailure(
            'voice_turn_fenced',
            'This voice instruction was already fenced. No late action is allowed.',
          );
        value.intentCommandId = reference;
        value.reviewHash = input.review?.planHash;
      });
      if (input.review) {
        const phrase = transcript
          .trim()
          .toLocaleLowerCase()
          .replace(/[.!?]+$/, '')
          .trim();
        if (/^(?:send|confirm) this exact request$/.test(phrase))
          await this.intents.confirm(owner, reference, input.review.planHash);
        else {
          const current = await this.intents.read(owner, reference);
          if (!current.planHash || current.planHash !== input.review.planHash)
            throw safeFailure(
              'voice_review_changed',
              'The prepared request changed. Read its current terms before confirming.',
            );
          if (
            /^(?:cancel this request|do not send(?: this request)?|don't send(?: this request)?|no)$/.test(
              phrase,
            )
          )
            await this.update(owner, input.turnId, (value) => {
              value.cancelledReview = true;
            });
        }
      } else
        await this.intents.execute(
          owner,
          { commandId: input.turnId, text: transcript },
          { requireInformationReview: true },
        );
      const receipt = await this.update(owner, input.turnId, (value) => {
        if (value.state === 'processing') value.state = 'completed';
      });
      return this.view(owner, receipt, transcript);
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 401) throw error;
      // A late return or lost local result can follow a committed request. Read
      // canonical owner-intent state; never retranscribe or replay a new ID.
      const receipt = await this.update(owner, input.turnId, (value) => {
        value.state = error instanceof HttpError ? 'failed' : 'uncertain';
        value.reason = error instanceof HttpError ? error.code : 'voice_request_unconfirmed';
      });
      return this.view(owner, receipt);
    }
  }
  private async transcribe(bytes: Buffer, input: NetworkVoiceTurnInput) {
    const form = new FormData();
    const extension =
      input.mimeType === 'audio/mp4' ? 'm4a' : input.mimeType === 'audio/wav' ? 'wav' : 'webm';
    form.append(
      'file',
      new Blob([new Uint8Array(bytes)], { type: input.mimeType }),
      `recording.${extension}`,
    );
    form.append('model', TRANSCRIBE_MODEL);
    const response = await (this.options.fetch ?? fetch)(
      'https://api.openai.com/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${this.options.apiKey}` },
        body: form,
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok)
      throw new HttpError(
        503,
        response.status >= 500 ? 'transcription_unconfirmed' : 'transcription_rejected',
        'The transcription service did not return a confirmed recording transcript.',
      );
    const text = await response.text();
    if (text.length > 32000)
      throw new HttpError(
        502,
        'transcription_invalid',
        'The transcription response exceeded its supported size.',
      );
    const parsed = z
      .object({ text: z.string().trim().min(1).max(1500) })
      .safeParse(JSON.parse(text));
    if (!parsed.success)
      throw new HttpError(502, 'transcription_invalid', 'No supported transcript was returned.');
    return parsed.data.text;
  }
}
