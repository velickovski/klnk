import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ApplicationToolArguments,
  ApplicationToolNameSchema,
  MissionInputSchema,
  MissionSchema,
  ToolTraceSchema,
  selectContext,
  validateCommitment,
  type ApplicationToolName,
  type ApplicationToolStatus,
  type Contact,
  type Memory,
  type Mission,
  type ToolTrace,
} from '../../../../packages/domain/src/index.js';
import { Repository, type SQL } from '../db.js';
import { Engine } from '../engine.js';
import { HttpError } from '../errors.js';
import { LiveSessionStore } from '../live-session-store.js';
import { RecipientSuppression } from './recipient-suppression.js';
import {
  toolRequestId,
  type OwnerToolGateway,
  type ToolActorContext,
  type ToolOutcome,
} from './tool-contract.js';

export const ToolAccessSchema = z
  .object({
    id: z.string(),
    ownerId: z.uuid(),
    version: z.literal(1),
    enabled: z.boolean(),
    tools: z.array(ApplicationToolNameSchema).max(10),
    updatedAt: z.iso.datetime(),
  })
  .strict();
const contextSchema = z
  .object({
    ownerId: z.uuid(),
    liveReceiptId: z.uuid(),
    authSessionHash: z.string().regex(/^[a-f0-9]{64}$/),
    callId: z.string().min(1).max(512),
    authorizedMissionId: z.uuid().optional(),
  })
  .strict();
type Receipt = {
  id: string;
  schemaVersion: 1;
  requestId: string;
  toolName: ApplicationToolName;
  liveReceiptId: string;
  callId: string;
  authorizedMissionId?: string;
  targetMissionId?: string;
  targetActionId?: string;
  argumentDigest?: string;
  argumentExpiresAt: number;
  status: ApplicationToolStatus;
  outcome?: ToolOutcome;
  createdAt: string;
  updatedAt: string;
};
const operations = {
  contacts_lookup: 'lookup',
  memory_lookup: 'lookup',
  request_prepare: 'prepare',
  request_status: 'status',
  request_dispatch: 'dispatch',
  request_cancel: 'cancel',
  calendar_update_existing: 'calendar_update',
  network_connections_lookup: 'lookup',
  network_request_submit: 'prepare',
  network_request_status: 'status',
} as const;
const allowedReasons = new Set([
  'invalid_arguments',
  'tool_access_required',
  'tool_not_allowed',
  'session_expired',
  'owner_deleted',
  'live_session_inactive',
  'controller_lost',
  'review_required',
  'not_found',
  'recipient_opted_out',
  'recipient_changed',
  'external_scope_required',
  'authorization_invalid',
  'invalid_action',
  'queued',
  'cancel_requested',
  'cancelled',
  'draft_prepared',
  'lookup_complete',
  'status_available',
  'already_completed',
  'receipt_conflict',
  'reconciliation_required',
  'operation_failed',
  'calendar_connection_required',
  'request_terminal',
  'action_complete',
]);
const mutations = new Set<ApplicationToolName>([
  'request_dispatch',
  'request_cancel',
  'calendar_update_existing',
]);
const deny = (
  code: string,
  message = 'This tool needs a current owner authorization before it can act.',
) => new HttpError(409, code, message);

/** Application-only tools. Constructed and invoked by the trusted server broker;
 * model arguments never supply identity, grants, URLs, credentials or authority. */
export class ApplicationToolGateway implements OwnerToolGateway {
  private repo: Repository;
  constructor(
    private engine: Engine,
    private live: LiveSessionStore,
    private options: { externalEffectsEnabled?: boolean } = {},
  ) {
    this.repo = engine.repo;
  }
  private async actor(sql: SQL, context: ToolActorContext, tool?: ApplicationToolName) {
    const [user] = await sql.query('SELECT id,deleted_at FROM users WHERE id=$1 FOR UPDATE', [
      context.ownerId,
    ]);
    if (!user || user.deleted_at) throw deny('owner_deleted');
    const session = await sql.query(
      'SELECT token_hash FROM sessions WHERE owner_id=$1 AND token_hash=$2 AND expires_at>clock_timestamp() FOR UPDATE',
      [context.ownerId, context.authSessionHash],
    );
    if (!session.length) throw deny('session_expired');
    const [live] = await sql.query(
      'SELECT *,controller_lease_until>clock_timestamp() AS controller_valid FROM live_sessions WHERE owner_id=$1 AND id=$2 FOR UPDATE',
      [context.ownerId, context.liveReceiptId],
    );
    if (!live || live.status !== 'active') throw deny('live_session_inactive');
    if (live.controller_id !== this.live.controllerId || !live.controller_valid)
      throw deny('controller_lost');
    if (tool) {
      const grant = ToolAccessSchema.safeParse(
        await this.repo
          .in(sql)
          .get(context.ownerId, 'tool_access', `tool-access:${context.ownerId}`),
      );
      if (
        !grant.success ||
        grant.data.id !== `tool-access:${context.ownerId}` ||
        grant.data.ownerId !== context.ownerId ||
        !grant.data.enabled
      )
        throw deny('tool_access_required');
      if (!grant.data.tools.includes(tool)) throw deny('tool_not_allowed');
    }
  }
  private outcome(
    context: ToolActorContext,
    tool: ApplicationToolName,
    status: ApplicationToolStatus,
    reasonCode: string,
    data?: Record<string, unknown>,
  ): ToolOutcome {
    return {
      schemaVersion: 1,
      requestId: toolRequestId(context),
      toolName: tool,
      status,
      reasonCode,
      verification: ['blocked', 'failed'].includes(status)
        ? 'policy_denial'
        : status === 'unknown'
          ? 'unconfirmed'
          : 'local_commit',
      ...(data ? { data } : {}),
    };
  }
  private async trace(
    sql: SQL,
    context: ToolActorContext,
    outcome: ToolOutcome,
    event: ToolTrace['event'],
    started: number,
    resourceCount = 0,
  ) {
    const trace = ToolTraceSchema.parse({
      schemaVersion: 1,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      event,
      traceId: outcome.requestId,
      requestId: outcome.requestId,
      sessionRef: context.liveReceiptId,
      ownerRef: context.ownerId,
      toolName: outcome.toolName,
      toolVersion: 1,
      adapter: 'application',
      status: outcome.status,
      reasonCode: outcome.reasonCode,
      verification: outcome.verification,
      argumentSummary: { operation: operations[outcome.toolName], resourceCount },
      durationMs: Math.max(0, Date.now() - started),
    });
    await this.repo.in(sql).put(context.ownerId, 'tool_trace', { id: trace.eventId, ...trace });
  }
  private metadata(outcome: ToolOutcome): ToolOutcome {
    // Query results are not copied into durable receipts: deleting a source record
    // must not resurrect its private text through a cached tool result.
    if (['contacts_lookup', 'memory_lookup', 'request_status'].includes(outcome.toolName))
      return { ...outcome, data: undefined };
    return outcome;
  }
  private async save(
    sql: SQL,
    context: ToolActorContext,
    receipt: Receipt,
    outcome: ToolOutcome,
    started: number,
  ) {
    await this.repo.in(sql).put(context.ownerId, 'tool_receipt', {
      ...receipt,
      status: outcome.status,
      outcome: this.metadata(outcome),
      updatedAt: new Date().toISOString(),
    });
    const count = Array.isArray(outcome.data?.contacts)
      ? outcome.data.contacts.length
      : Array.isArray(outcome.data?.memories)
        ? outcome.data.memories.length
        : outcome.data?.missionId
          ? 1
          : 0;
    await this.trace(
      sql,
      context,
      outcome,
      outcome.status === 'blocked'
        ? 'tool_blocked'
        : outcome.status === 'unknown'
          ? 'tool_reconciliation_required'
          : outcome.status === 'failed'
            ? 'tool_failed'
            : 'tool_succeeded',
      started,
      count,
    );
  }
  async invoke(
    rawContext: ToolActorContext,
    rawTool: string,
    argumentsJson: string,
  ): Promise<ToolOutcome> {
    if (rawTool.startsWith('network_'))
      throw new HttpError(
        400,
        'unknown_tool',
        'Use the internal network gateway for this operation.',
      );
    const name = ApplicationToolNameSchema.safeParse(rawTool);
    if (!name.success) throw new HttpError(400, 'unknown_tool', 'This tool is unavailable.');
    const parsedContext = contextSchema.safeParse(rawContext);
    if (!parsedContext.success)
      throw new HttpError(400, 'invalid_tool_context', 'Tool control identity is invalid.');
    const context = parsedContext.data,
      tool = name.data,
      started = Date.now();
    let parameters: any;
    try {
      if (typeof argumentsJson !== 'string' || argumentsJson.length > 15000) throw new Error();
      parameters = ApplicationToolArguments[tool].parse(JSON.parse(argumentsJson));
    } catch {
      return this.block(context, tool, 'invalid_arguments', started);
    }
    const argumentDigest = this.engine.db.keyedDigest(
      'tool-arguments',
      JSON.stringify([toolRequestId(context), tool, parameters]),
    );
    let receipt: Receipt | undefined;
    try {
      const reservation = await this.engine.db.transaction(async (sql) => {
        await this.actor(sql, context, tool);
        const repo = this.repo.in(sql),
          id = `tool-receipt:${toolRequestId(context)}`,
          existing = await repo.get<Receipt>(context.ownerId, 'tool_receipt', id);
        if (existing) {
          if (!existing.argumentDigest || existing.argumentExpiresAt <= Date.now())
            throw deny('reconciliation_required');
          if (existing.argumentDigest !== argumentDigest) throw deny('receipt_conflict');
          if (
            existing.toolName !== tool ||
            existing.liveReceiptId !== context.liveReceiptId ||
            existing.callId !== context.callId ||
            existing.authorizedMissionId !== context.authorizedMissionId ||
            existing.targetMissionId !== parameters.missionId ||
            existing.targetActionId !== parameters.actionId
          )
            throw deny('receipt_conflict');
          await this.trace(
            sql,
            context,
            existing.outcome ?? this.outcome(context, tool, 'unknown', 'reconciliation_required'),
            existing.outcome ? 'tool_result_reported' : 'tool_reconciliation_required',
            started,
          );
          return { receipt: existing, created: false };
        }
        const value: Receipt = {
          id,
          schemaVersion: 1,
          requestId: toolRequestId(context),
          toolName: tool,
          liveReceiptId: context.liveReceiptId,
          callId: context.callId,
          authorizedMissionId: context.authorizedMissionId,
          targetMissionId: parameters.missionId,
          targetActionId: parameters.actionId,
          argumentDigest,
          argumentExpiresAt: Date.now() + 86400000,
          status: 'running',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await repo.put(context.ownerId, 'tool_receipt', value);
        await this.trace(
          sql,
          context,
          this.outcome(context, tool, 'running', 'queued'),
          'tool_requested',
          started,
        );
        await this.trace(
          sql,
          context,
          this.outcome(context, tool, 'running', 'queued'),
          'tool_validated',
          started,
        );
        return { receipt: value, created: true };
      });
      receipt = reservation.receipt;
      if (!reservation.created)
        return receipt.outcome ?? this.outcome(context, tool, 'unknown', 'reconciliation_required');
      return await this.engine.db.transaction(async (sql) => {
        await this.actor(sql, context, tool);
        const repo = this.repo.in(sql),
          current = await repo.get<Receipt>(context.ownerId, 'tool_receipt', receipt!.id);
        if (!current || current.status !== 'running') throw deny('receipt_conflict');
        await this.trace(
          sql,
          context,
          this.outcome(context, tool, 'running', 'queued'),
          'tool_started',
          started,
        );
        const outcome = await this.execute(sql, context, tool, parameters);
        if (mutations.has(tool))
          await this.trace(sql, context, outcome, 'authorization_checked', started);
        await this.save(sql, context, current, outcome, started);
        return outcome;
      });
    } catch (error) {
      const reason =
        error instanceof HttpError && allowedReasons.has(error.code)
          ? error.code
          : 'operation_failed';
      const outcome = this.outcome(
        context,
        tool,
        reason === 'operation_failed' ? 'unknown' : 'blocked',
        reason,
      );
      await this.engine.db
        .transaction(async (sql) => {
          await this.actor(sql, context);
          if (receipt) await this.save(sql, context, receipt, outcome, started);
          else await this.trace(sql, context, outcome, 'tool_blocked', started);
        })
        .catch(() => undefined);
      return outcome;
    }
  }
  private async block(
    context: ToolActorContext,
    tool: ApplicationToolName,
    reason: string,
    started: number,
  ) {
    const outcome = this.outcome(context, tool, 'blocked', reason);
    await this.engine.db
      .transaction(async (sql) => {
        await this.actor(sql, context);
        await this.trace(sql, context, outcome, 'tool_blocked', started);
      })
      .catch(() => undefined);
    return outcome;
  }
  private async approved(
    sql: SQL,
    context: ToolActorContext,
    missionId: string,
    mutating = false,
  ): Promise<Mission> {
    if (mutating && context.authorizedMissionId !== missionId) throw deny('review_required');
    const mission = await this.repo.in(sql).get<Mission>(context.ownerId, 'mission', missionId);
    if (!mission) throw deny('not_found');
    if (!mutating) return mission;
    const authorization = mission.authorization;
    if (
      !authorization ||
      authorization.ownerId !== context.ownerId ||
      authorization.recipientId !== mission.contactId
    )
      throw deny('review_required');
    const frozen = MissionSchema.safeParse({
      ...authorization.snapshot,
      authorization,
      status: mission.status,
      updatedAt: mission.updatedAt,
    });
    if (
      !frozen.success ||
      frozen.data.id !== mission.id ||
      frozen.data.ownerId !== context.ownerId ||
      frozen.data.contactId !== mission.contactId
    )
      throw deny('authorization_invalid');
    return frozen.data;
  }
  private async execute(
    sql: SQL,
    context: ToolActorContext,
    tool: ApplicationToolName,
    parameters: any,
  ): Promise<ToolOutcome> {
    const repo = this.repo.in(sql);
    if (tool === 'contacts_lookup') {
      const query = parameters.query.toLocaleLowerCase();
      const contacts = (await repo.list<Contact>(context.ownerId, 'contact'))
        .filter(
          (contact) =>
            contact.ownerId === context.ownerId &&
            `${contact.name} ${contact.relationship}`.toLocaleLowerCase().includes(query),
        )
        .slice(0, parameters.limit);
      return this.outcome(context, tool, 'succeeded', 'lookup_complete', {
        untrusted: true,
        contacts: contacts.map((contact) => ({
          id: contact.id,
          name: contact.name,
          relationship: contact.relationship,
          verified: contact.verified,
          optedOut: contact.optedOut,
        })),
      });
    }
    if (tool === 'memory_lookup') {
      if (
        parameters.contactId &&
        !(await repo.get(context.ownerId, 'contact', parameters.contactId))
      )
        throw deny('not_found');
      const query = parameters.query.toLocaleLowerCase(),
        candidates = (await repo.list<Memory>(context.ownerId, 'memory')).filter((memory) =>
          memory.text.toLocaleLowerCase().includes(query),
        );
      const memories = selectContext(
        context.ownerId,
        parameters.contactId ?? '',
        context.authorizedMissionId ?? '',
        candidates,
        undefined,
        candidates.filter((memory) => memory.scope === 'owner').map((memory) => memory.id),
      ).slice(0, parameters.limit);
      return this.outcome(context, tool, 'succeeded', 'lookup_complete', {
        untrusted: true,
        memories: memories.map((memory) => ({
          id: memory.id,
          text: memory.text,
          source: memory.source,
          confirmation: memory.confirmation,
          scope: memory.scope,
          disclosure: memory.disclosure,
        })),
      });
    }
    if (tool === 'request_prepare') {
      const contact = await repo.get<Contact>(context.ownerId, 'contact', parameters.contactId);
      if (!contact || contact.ownerId !== context.ownerId) throw deny('not_found');
      const profile = await repo.get<any>(context.ownerId, 'profile', context.ownerId);
      const input = MissionInputSchema.parse({
        contactId: contact.id,
        title: parameters.title,
        kind: 'custom',
        goal: parameters.goal,
        requiredTalkingPoints: parameters.statements,
        boundaries: { privateFacts: parameters.privateFacts },
        ownerLanguage: profile?.language ?? 'en',
        recipientLanguage: contact.language,
        schedule: {
          timezone: profile?.timezone ?? 'UTC',
          retryLimit: 0,
          maxDurationSeconds: Math.min(
            180,
            this.engine.config.provider === 'elevenlabs' ? 180 : 600,
          ),
        },
      });
      const id = toolRequestId(context),
        existing = await repo.get<Mission>(context.ownerId, 'mission', id);
      if (existing)
        return this.outcome(context, tool, 'proposed', 'draft_prepared', {
          missionId: existing.id,
          reviewRequired: true,
        });
      const mission = MissionSchema.parse({
        ...input,
        id,
        ownerId: context.ownerId,
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await repo.put(context.ownerId, 'mission', { ...mission, reviewVersion: 1 });
      return this.outcome(context, tool, 'proposed', 'draft_prepared', {
        missionId: id,
        reviewRequired: true,
      });
    }
    const mission = await this.approved(sql, context, parameters.missionId, mutations.has(tool));
    if (tool === 'request_status')
      return this.outcome(context, tool, 'succeeded', 'status_available', {
        untrusted: true,
        missionId: mission.id,
        status: mission.status,
        demo: mission.executionProvider === 'simulator',
        executionProvider: mission.executionProvider ?? 'unavailable',
        actions: (await repo.list<any>(context.ownerId, 'action', mission.id)).map((action) => ({
          id: action.id,
          status: action.status,
          kind: action.kind,
          verification: action.verification ?? 'unconfirmed',
        })),
      });
    if (tool === 'request_cancel') {
      await this.actor(sql, context, tool);
      const cancelled = await this.engine.cancel(context.ownerId, mission.id, sql);
      const pending = (await repo.list<any>(context.ownerId, 'attempt', mission.id)).some(
        (attempt) => attempt.provider === 'elevenlabs' && !attempt.endedAt,
      );
      return this.outcome(
        context,
        tool,
        pending ? 'cancel_requested' : 'cancelled',
        pending ? 'cancel_requested' : 'cancelled',
        {
          missionId: cancelled.id,
          terminationConfirmed: !pending,
          demo: mission.executionProvider === 'simulator',
        },
      );
    }
    if (mission.status === 'cancelled') throw deny('request_terminal');
    if (tool === 'request_dispatch') {
      if (!['authorized', 'queued', 'calling', 'awaiting_owner'].includes(mission.status))
        throw deny('request_terminal');
      const contact = await repo.get<Contact>(context.ownerId, 'contact', mission.contactId);
      if (!contact || !contact.verified || contact.phone !== mission.authorization?.recipientPhone)
        throw deny('recipient_changed');
      if (
        contact.optedOut ||
        (await new RecipientSuppression(this.engine.db).isSuppressed(
          context.ownerId,
          contact.phone,
          sql,
        ))
      )
        throw deny('recipient_opted_out');
      if (mission.executionProvider !== 'simulator' && !this.options.externalEffectsEnabled)
        throw deny('external_scope_required');
      await this.actor(sql, context, tool);
      await repo.enqueue(
        context.ownerId,
        mission.id,
        'start',
        { scenario: 'normal' },
        0,
        `${mission.id}:start:1`,
      );
      return this.outcome(context, tool, 'queued', 'queued', {
        missionId: mission.id,
        demo: mission.executionProvider === 'simulator',
        externalEffectConfirmed: false,
      });
    }
    const action = await repo.get<any>(context.ownerId, 'action', parameters.actionId);
    if (
      !action ||
      action.kind !== 'calendar_update' ||
      !(await repo.list<any>(context.ownerId, 'action', mission.id)).some(
        (value) => value.id === action.id,
      )
    )
      throw deny('invalid_action');
    const declared = mission.followUpActions.find(
      (value) => value.id === action.authorizationActionId,
    );
    if (
      !declared ||
      !declared.authorized ||
      declared.kind !== action.kind ||
      JSON.stringify(declared.payload) !== JSON.stringify(action.payload) ||
      !validateCommitment(mission, { type: 'external_action', actionId: declared.id }).allowed
    )
      throw deny('authorization_invalid');
    if (action.status === 'succeeded')
      return {
        ...this.outcome(context, tool, 'succeeded', 'action_complete', {
          missionId: mission.id,
          actionId: action.id,
          demo: action.demo === true,
          completionRecorded: true,
          providerVerified: action.verification === 'provider_readback',
        }),
        verification: action.demo
          ? 'local_commit'
          : action.verification === 'provider_readback'
            ? 'provider_readback'
            : 'unconfirmed',
      };
    if (!['pending', 'failed'].includes(action.status)) throw deny('invalid_action');
    const attempt = await repo.get<any>(context.ownerId, 'attempt', action.attemptId);
    if (
      !attempt?.outcome ||
      !action.prerequisiteEvidenceIds?.length ||
      !action.prerequisiteEvidenceIds.every((id: string) =>
        attempt.outcome.evidenceIds.includes(id),
      ) ||
      ['uncertain', 'needs_decision', 'unresolved', 'refused'].includes(attempt.outcome.status)
    )
      throw deny('authorization_invalid');
    if (!action.demo && (!this.options.externalEffectsEnabled || !this.engine.googleCalendarAccess))
      throw deny('external_scope_required');
    await this.actor(sql, context, tool);
    await repo.enqueue(
      context.ownerId,
      mission.id,
      'action',
      { actionId: action.id },
      0,
      `${action.id}:execute`,
    );
    await sql.query(
      "UPDATE jobs SET attempts=CASE WHEN status='failed' THEN 0 ELSE attempts END,status='queued',run_at=now(),lease_until=NULL,lease_token=NULL,worker_id=NULL WHERE owner_id=$1 AND id=$2 AND status IN ('failed','queued')",
      [context.ownerId, `${action.id}:execute`],
    );
    return this.outcome(context, tool, 'queued', 'queued', {
      missionId: mission.id,
      actionId: action.id,
      demo: action.demo === true,
      externalEffectConfirmed: false,
    });
  }
  async traces(owner: string, requestId?: string): Promise<ToolTrace[]> {
    const traces = await this.repo.list<any>(owner, 'tool_trace');
    const order: ToolTrace['event'][] = [
      'tool_requested',
      'tool_validated',
      'authorization_checked',
      'tool_started',
      'tool_result_received',
      'tool_blocked',
      'tool_succeeded',
      'tool_failed',
      'tool_reconciliation_required',
      'tool_result_reported',
    ];
    return traces
      .filter((trace) => !requestId || trace.requestId === requestId)
      .map(({ id: _id, ...trace }) => ToolTraceSchema.parse(trace))
      .sort(
        (a, b) =>
          a.occurredAt.localeCompare(b.occurredAt) ||
          order.indexOf(a.event) - order.indexOf(b.event),
      );
  }
  /** Private keyed argument bindings expire after 24h; structural traces after 7d.
   * Non-content receipts remain to prevent a redacted call from executing again. */
  async sweepRetention(now = new Date()): Promise<void> {
    const receipts = await this.engine.db.query(
      "SELECT id,owner_id FROM resources WHERE kind='tool_receipt'",
    );
    for (const row of receipts)
      await this.engine.db.transaction(async (sql) => {
        const [owner] = await sql.query('SELECT id,deleted_at FROM users WHERE id=$1 FOR UPDATE', [
          row.owner_id,
        ]);
        if (!owner || owner.deleted_at) return;
        const repo = this.repo.in(sql),
          receipt = await repo.get<Receipt>(row.owner_id, 'tool_receipt', row.id);
        if (
          !receipt ||
          receipt.argumentExpiresAt > now.getTime() ||
          (!receipt.argumentDigest && !receipt.outcome?.data)
        )
          return;
        await repo.put(row.owner_id, 'tool_receipt', {
          ...receipt,
          argumentDigest: undefined,
          ...(receipt.outcome ? { outcome: { ...receipt.outcome, data: undefined } } : {}),
        });
      });
    await this.engine.db.query("DELETE FROM resources WHERE kind='tool_trace' AND created_at<$1", [
      new Date(now.getTime() - 7 * 86400000).toISOString(),
    ]);
  }
}
