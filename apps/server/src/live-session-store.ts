import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Database, type Row } from './db.js';
import { HttpError } from './errors.js';

const statusSchema = z.enum(['creating', 'active', 'closing', 'closed', 'unconfirmed', 'rejected']);
export type LiveReceiptStatus = z.infer<typeof statusSchema>;
const reasonSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional();
const evidenceSchema = z
  .object({
    source: z.enum(['provider_event', 'provider_readback']),
    event: z.literal('session.closed'),
    reasonCode: reasonSchema.optional(),
    usage: z
      .object({ inputTokens: counter, outputTokens: counter, totalTokens: counter })
      .strict()
      .optional(),
  })
  .strict();
export type LiveTerminalEvidence = z.infer<typeof evidenceSchema>;
export type LiveReceipt = {
  id: string;
  ownerId: string;
  requestId: string;
  status: LiveReceiptStatus;
  providerSessionId?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: number;
  reasonCode?: string;
  terminalEvidence?: LiveTerminalEvidence;
  controllerId?: string;
  controllerLeaseUntil?: number;
};
export type LiveSessionLimits = {
  maxConcurrent: number;
  maxPerOwnerDay: number;
  maxDurationSeconds: number;
};
const transitions: Record<LiveReceiptStatus, LiveReceiptStatus[]> = {
  creating: ['unconfirmed', 'rejected', 'closing', 'closed'],
  active: ['closing', 'unconfirmed', 'closed'],
  closing: ['unconfirmed', 'closed'],
  unconfirmed: ['closing', 'closed'],
  closed: [],
  rejected: [],
};

/** Durable metadata only: no SDP, credentials, audio, transcripts or tool content. */
export class LiveSessionStore {
  readonly limits: Readonly<LiveSessionLimits>;
  readonly controllerId: string;
  readonly controllerLeaseMs: number;
  constructor(
    private db: Database,
    limits: LiveSessionLimits = { maxConcurrent: 4, maxPerOwnerDay: 20, maxDurationSeconds: 300 },
    controller: { id?: string; leaseMs?: number } = {},
  ) {
    this.limits = Object.freeze(
      z
        .object({
          maxConcurrent: z.number().int().min(1).max(100),
          maxPerOwnerDay: z.number().int().min(1).max(1000),
          maxDurationSeconds: z.number().int().min(1).max(3600),
        })
        .parse(limits),
    );
    this.controllerId = z
      .string()
      .min(1)
      .max(128)
      .parse(controller.id ?? randomUUID());
    this.controllerLeaseMs = z
      .number()
      .int()
      .min(100)
      .max(600000)
      .parse(controller.leaseMs ?? 30000);
  }
  private decode(row: Row): LiveReceipt {
    return {
      id: row.id,
      ownerId: row.owner_id,
      requestId: row.request_id,
      status: row.status,
      ...(row.provider_session_id ? { providerSessionId: row.provider_session_id } : {}),
      version: row.version,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      expiresAt: new Date(row.expires_at).getTime(),
      ...(row.reason_code ? { reasonCode: row.reason_code } : {}),
      ...(row.terminal_evidence
        ? { terminalEvidence: evidenceSchema.parse(this.db.decrypt(row.terminal_evidence)) }
        : {}),
      ...(row.controller_id ? { controllerId: row.controller_id } : {}),
      ...(row.controller_lease_until
        ? { controllerLeaseUntil: new Date(row.controller_lease_until).getTime() }
        : {}),
    };
  }
  async get(ownerId: string, id: string): Promise<LiveReceipt | undefined> {
    const [row] = await this.db.query('SELECT * FROM live_sessions WHERE owner_id=$1 AND id=$2', [
      ownerId,
      id,
    ]);
    return row ? this.decode(row) : undefined;
  }
  async getByRequest(ownerId: string, requestId: string): Promise<LiveReceipt | undefined> {
    const [row] = await this.db.query(
      'SELECT * FROM live_sessions WHERE owner_id=$1 AND request_id=$2',
      [ownerId, requestId],
    );
    return row ? this.decode(row) : undefined;
  }
  async findByProviderId(ownerId: string, providerId: string): Promise<LiveReceipt | undefined> {
    const [row] = await this.db.query(
      'SELECT * FROM live_sessions WHERE owner_id=$1 AND provider_session_id=$2',
      [ownerId, providerId],
    );
    return row ? this.decode(row) : undefined;
  }
  async listUnresolved(ownerId?: string): Promise<LiveReceipt[]> {
    const rows = await this.db.query(
      "SELECT * FROM live_sessions WHERE status IN ('creating','active','closing','unconfirmed')" +
        (ownerId ? ' AND owner_id=$1' : '') +
        ' ORDER BY created_at,id',
      ownerId ? [ownerId] : [],
    );
    return rows.map((row) => this.decode(row));
  }
  ownsController(receipt: LiveReceipt): boolean {
    return (
      receipt.controllerId === this.controllerId && (receipt.controllerLeaseUntil ?? 0) > Date.now()
    );
  }
  async renewControllerLeases(): Promise<LiveReceipt[]> {
    const rows = await this.db.query(
      "UPDATE live_sessions SET controller_lease_until=clock_timestamp()+$2::int*interval '1 millisecond' WHERE controller_id=$1 AND controller_lease_until>clock_timestamp() AND status IN ('creating','active','closing','unconfirmed') RETURNING *",
      [this.controllerId, this.controllerLeaseMs],
    );
    return rows.map((row) => this.decode(row));
  }
  async claimUnresolved(): Promise<LiveReceipt[]> {
    return this.db.transaction(async (sql) => {
      const rows = await sql.query(
        "SELECT * FROM live_sessions WHERE status IN ('creating','active','closing','unconfirmed') AND (controller_lease_until IS NULL OR controller_lease_until<=clock_timestamp()) ORDER BY created_at,id FOR UPDATE SKIP LOCKED",
      );
      const claimed: LiveReceipt[] = [];
      for (const row of rows) {
        const [updated] = await sql.query(
          "UPDATE live_sessions SET controller_id=$2,controller_lease_until=clock_timestamp()+$3::int*interval '1 millisecond',version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [row.id, this.controllerId, this.controllerLeaseMs],
        );
        claimed.push(this.decode(updated));
      }
      return claimed;
    });
  }
  async releaseControllerLeases(): Promise<void> {
    await this.db.query(
      "UPDATE live_sessions SET controller_id=NULL,controller_lease_until=NULL,version=version+1,updated_at=now() WHERE controller_id=$1 AND status IN ('creating','active','closing','unconfirmed')",
      [this.controllerId],
    );
  }
  async reserve(
    ownerId: string,
    requestId: string,
  ): Promise<{ receipt: LiveReceipt; created: boolean }> {
    z.uuid().parse(requestId);
    return this.db.transaction(async (sql) => {
      await sql.query("SELECT name FROM runtime_locks WHERE name='live_reservations' FOR UPDATE");
      const [owner] = await sql.query('SELECT id,deleted_at FROM users WHERE id=$1 FOR UPDATE', [
        ownerId,
      ]);
      if (!owner || owner.deleted_at)
        throw new HttpError(401, 'unauthorized', 'Sign in to continue.');
      const [existing] = await sql.query(
        'SELECT * FROM live_sessions WHERE owner_id=$1 AND request_id=$2',
        [ownerId, requestId],
      );
      if (existing) return { receipt: this.decode(existing), created: false };
      const [active] = await sql.query(
        "SELECT count(*)::int AS total FROM live_sessions WHERE owner_id=$1 AND status IN ('creating','active','closing','unconfirmed')",
        [ownerId],
      );
      if (active.total)
        throw new HttpError(
          409,
          'voice_session_unresolved',
          'An earlier conversation needs closure or reconciliation before another can start.',
        );
      const [global] = await sql.query(
        "SELECT count(*)::int AS total FROM live_sessions WHERE status IN ('creating','active','closing','unconfirmed')",
      );
      if (global.total >= this.limits.maxConcurrent)
        throw new HttpError(
          429,
          'voice_concurrency_limit',
          'The voice service is at its session limit. No provider request was sent.',
        );
      const [daily] = await sql.query(
        "SELECT count(*)::int AS total FROM live_sessions WHERE owner_id=$1 AND created_at>now()-interval '1 day'",
        [ownerId],
      );
      if (daily.total >= this.limits.maxPerOwnerDay)
        throw new HttpError(
          429,
          'voice_daily_limit',
          'The daily voice session limit was reached. No provider request was sent.',
        );
      const [row] = await sql.query(
        "INSERT INTO live_sessions(id,owner_id,request_id,status,expires_at,controller_id,controller_lease_until) VALUES($1,$2,$3,'creating',$4,$5,clock_timestamp()+$6::int*interval '1 millisecond') RETURNING *",
        [
          randomUUID(),
          ownerId,
          requestId,
          new Date(Date.now() + this.limits.maxDurationSeconds * 1000).toISOString(),
          this.controllerId,
          this.controllerLeaseMs,
        ],
      );
      return { receipt: this.decode(row), created: true };
    });
  }
  async attachProvider(
    ownerId: string,
    id: string,
    expectedVersion: number,
    providerId: string,
  ): Promise<LiveReceipt> {
    z.string().min(1).max(512).parse(providerId);
    return this.db.transaction(async (sql) => {
      const [current] = await sql.query(
        'SELECT *,controller_lease_until>clock_timestamp() AS controller_valid FROM live_sessions WHERE owner_id=$1 AND id=$2 FOR UPDATE',
        [ownerId, id],
      );
      if (!current) throw new HttpError(404, 'not_found', 'Voice receipt not found.');
      if (current.controller_id !== this.controllerId || !current.controller_valid)
        throw new HttpError(
          409,
          'voice_controller_lost',
          'Another server owns voice recovery. Read the existing receipt before continuing.',
        );
      if (
        current.version !== expectedVersion ||
        !['creating', 'unconfirmed'].includes(current.status) ||
        (current.provider_session_id && current.provider_session_id !== providerId)
      )
        throw new HttpError(
          409,
          'voice_receipt_conflict',
          'The voice receipt changed. Read its current state before continuing.',
        );
      const [row] = await sql.query(
        "UPDATE live_sessions SET provider_session_id=$3,status='active',version=version+1,updated_at=now() WHERE owner_id=$1 AND id=$2 RETURNING *",
        [ownerId, id, providerId],
      );
      return this.decode(row);
    });
  }
  /** Preserve an observed paid-session identity even after this controller was fenced.
   * This grants no ownership or permission to send provider commands. */
  async recordProviderObservation(
    ownerId: string,
    id: string,
    providerId: string,
  ): Promise<LiveReceipt> {
    z.string().min(1).max(512).parse(providerId);
    return this.db.transaction(async (sql) => {
      const [current] = await sql.query(
        'SELECT *,controller_lease_until>clock_timestamp() AS controller_valid FROM live_sessions WHERE owner_id=$1 AND id=$2 FOR UPDATE',
        [ownerId, id],
      );
      if (!current) throw new HttpError(404, 'not_found', 'Voice receipt not found.');
      if (
        (current.provider_session_id && current.provider_session_id !== providerId) ||
        (['closed', 'rejected'].includes(current.status) && !current.provider_session_id)
      )
        throw new HttpError(
          409,
          'voice_receipt_conflict',
          'Provider identity does not match this receipt.',
        );
      if (current.provider_session_id) return this.decode(current);
      const [updated] = await sql.query(
        "UPDATE live_sessions SET provider_session_id=$3,status='unconfirmed',reason_code='late_provider_identity',version=version+1,updated_at=now() WHERE owner_id=$1 AND id=$2 RETURNING *",
        [ownerId, id, providerId],
      );
      return this.decode(updated);
    });
  }
  async transition(
    ownerId: string,
    id: string,
    expectedVersion: number,
    status: LiveReceiptStatus,
    evidence?: LiveTerminalEvidence,
    reasonCode?: string,
  ): Promise<LiveReceipt> {
    statusSchema.parse(status);
    if (reasonCode !== undefined) reasonSchema.parse(reasonCode);
    const terminal = evidence === undefined ? undefined : evidenceSchema.parse(evidence);
    if (status === 'closed' && !terminal)
      throw new HttpError(
        409,
        'voice_terminal_evidence_required',
        'Provider terminal evidence is required before reporting closure.',
      );
    if (terminal && status !== 'closed')
      throw new HttpError(
        409,
        'voice_invalid_transition',
        'Terminal evidence applies only to a closed session.',
      );
    return this.db.transaction(async (sql) => {
      const [current] = await sql.query(
        'SELECT *,controller_lease_until>clock_timestamp() AS controller_valid FROM live_sessions WHERE owner_id=$1 AND id=$2 FOR UPDATE',
        [ownerId, id],
      );
      if (!current) throw new HttpError(404, 'not_found', 'Voice receipt not found.');
      if (current.controller_id !== this.controllerId || !current.controller_valid)
        throw new HttpError(
          409,
          'voice_controller_lost',
          'Another server owns voice recovery. Read the existing receipt before continuing.',
        );
      if (
        current.version !== expectedVersion ||
        !transitions[current.status as LiveReceiptStatus].includes(status)
      )
        throw new HttpError(
          409,
          'voice_receipt_conflict',
          'The voice receipt changed. Read its current state before continuing.',
        );
      if (status === 'closed' && !current.provider_session_id)
        throw new HttpError(
          409,
          'voice_terminal_identity_required',
          'A provider session identity is required before reporting closure.',
        );
      const [row] = await sql.query(
        'UPDATE live_sessions SET status=$3,version=version+1,updated_at=now(),reason_code=$4,terminal_evidence=$5 WHERE owner_id=$1 AND id=$2 RETURNING *',
        [ownerId, id, status, reasonCode ?? null, terminal ? this.db.encrypt(terminal) : null],
      );
      return this.decode(row);
    });
  }
}
