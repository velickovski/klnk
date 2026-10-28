import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ApplicationToolNameSchema,
  ApplicationToolStatusSchema,
  type ApplicationToolName,
} from '../../../packages/domain/src/index.js';
import {
  toolRequestId,
  type OwnerToolGateway,
  type ToolActorContext,
} from './integrations/tool-contract.js';

// https://developers.openai.com/api/docs/guides/live-delegation
// Only finished function items in response.event require an application result.
const identifier = z.string().min(1).max(512);
const outcomeSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: z.uuid(),
    toolName: ApplicationToolNameSchema,
    status: ApplicationToolStatusSchema,
    reasonCode: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    verification: z.enum([
      'local_commit',
      'provider_readback',
      'provider_terminal_event',
      'unconfirmed',
      'policy_denial',
    ]),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const object = (value: unknown): Record<string, any> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : undefined;
type Call = {
  id: string;
  name: string;
  arguments: string;
  fingerprint: string;
  invalid?: boolean;
  sent: boolean;
};
type ResponseWork = {
  id: string;
  delegationId: string;
  calls: Call[];
  phase: 'collecting' | 'ready' | 'cancelled' | 'continued' | 'done';
};
/** Includes internal network names only when the server resolver grants them.
 * Network request authority is rechecked by its own gateway; this optional
 * legacy mission binding never authorizes an internal request. */
export type LiveToolAccess = {
  authSessionHash: string;
  tools: ApplicationToolName[];
  authorizedMissionId?: string;
};
export type ResolveLiveToolAccess = (
  ownerId: string,
  authorization?: string,
  authorizedMissionId?: string,
) => Promise<LiveToolAccess | undefined>;
export type ToolDelegationOptions = {
  context: Omit<ToolActorContext, 'callId'>;
  tools: readonly ApplicationToolName[];
  gateway: OwnerToolGateway;
  isCurrent: () => boolean;
  accessCurrent: (tool: ApplicationToolName) => Promise<boolean>;
  send: (event: Record<string, unknown>) => void;
  onProtocolFailure: (
    reason:
      | 'invalid_correlation'
      | 'malformed_function_call'
      | 'duplicate_call_conflict'
      | 'tool_budget_exceeded'
      | 'tool_transport_failed'
      | 'tool_access_revoked',
  ) => void;
};

/** Ephemeral correlation only. Persisted effects and authority belong to the gateway.
 * A finished backend response is never treated as spoken delivery. */
export class OpenAIToolDelegation {
  private stopped = false;
  private responses = new Map<string, ResponseWork>();
  private active = new Map<string, string>();
  private callIds = new Map<string, { responseId: string; fingerprint: string }>();
  private expectedResponses = new Map<string, string>();
  private draining: Promise<void> | undefined;
  private continuations = 0;
  private invocations: number[] = [];
  private sentEventIds = new Set<string>();
  constructor(private options: ToolDelegationOptions) {}
  private current() {
    return !this.stopped && this.options.isCurrent();
  }
  private fail(reason: Parameters<ToolDelegationOptions['onProtocolFailure']>[0]) {
    if (this.stopped) return;
    this.stopped = true;
    this.redact();
    this.options.onProtocolFailure(reason);
  }
  private redact() {
    for (const response of this.responses.values())
      for (const call of response.calls) call.arguments = '';
  }
  stop() {
    this.stopped = true;
    this.redact();
    return this.draining ?? Promise.resolve();
  }
  async idle() {
    await this.draining;
  }
  receive(raw: unknown) {
    if (!this.current()) return;
    const envelope = object(raw);
    if (!envelope) return;
    if (envelope.type === 'session.closed') {
      void this.stop();
      return;
    }
    if (envelope.type === 'error') {
      const error = object(envelope.error),
        eventId = error?.client_event_id ?? envelope.client_event_id;
      if (
        error?.code === 'responses_validation_failed' ||
        (typeof eventId === 'string' && this.sentEventIds.has(eventId))
      )
        this.fail('tool_transport_failed');
      return;
    }
    if (envelope.type === 'session.delegation.created') {
      const delegation = object(envelope.delegation);
      if (delegation?.target !== 'responses') return;
      if (!identifier.safeParse(delegation.id).success) return this.fail('invalid_correlation');
      const responseId = delegation.response_id ?? envelope.response_id;
      if (!identifier.safeParse(responseId).success) return this.fail('invalid_correlation');
      {
        const existing = this.responses.get(responseId);
        if (existing) {
          if (existing.delegationId !== delegation.id) this.fail('invalid_correlation');
          return;
        }
        const announced = this.expectedResponses.get(delegation.id);
        if (announced) {
          if (announced !== responseId) this.fail('invalid_correlation');
          return;
        }
        if ([...this.expectedResponses.values()].includes(responseId))
          return this.fail('invalid_correlation');
        if (this.expectedResponses.size >= 16) return this.fail('tool_budget_exceeded');
        this.expectedResponses.set(delegation.id, responseId);
      }
      return;
    }
    if (envelope.type !== 'response.event') return;
    const nested = object(envelope.event),
      delegationId = envelope.delegation_id;
    if (!nested) return;
    if (!identifier.safeParse(delegationId).success) return this.fail('invalid_correlation');
    if (nested.type === 'response.created') {
      const id = object(nested.response)?.id;
      if (!identifier.safeParse(id).success) return this.fail('invalid_correlation');
      const expected = this.expectedResponses.get(delegationId);
      if (expected && expected !== id) return this.fail('invalid_correlation');
      this.expectedResponses.delete(delegationId);
      const existing = this.responses.get(id);
      if (existing) {
        if (existing.delegationId !== delegationId) this.fail('invalid_correlation');
        return;
      }
      const previous = this.responses.get(this.active.get(delegationId) ?? '');
      if (previous && ['collecting', 'ready'].includes(previous.phase))
        return this.fail('invalid_correlation');
      if (this.responses.size >= 24 || this.active.size >= 16)
        return this.fail('tool_budget_exceeded');
      this.responses.set(id, { id, delegationId, calls: [], phase: 'collecting' });
      this.active.set(delegationId, id);
      return;
    }
    if (
      ![
        'response.output_item.done',
        'response.completed',
        'response.failed',
        'response.incomplete',
      ].includes(nested.type)
    )
      return;
    const response = this.responses.get(this.active.get(delegationId) ?? '');
    if (!response) return this.fail('invalid_correlation');
    const responseId = nested.response_id ?? object(nested.response)?.id;
    if (responseId !== undefined && responseId !== response.id)
      return this.fail('invalid_correlation');
    if (
      nested.type === 'response.failed' ||
      nested.type === 'response.incomplete' ||
      ['cancelled', 'failed', 'incomplete'].includes(object(nested.response)?.status)
    ) {
      response.phase = 'cancelled';
      for (const call of response.calls) call.arguments = '';
      this.scheduleDrain();
      return;
    }
    if (nested.type === 'response.completed') {
      if (response.phase !== 'collecting') return;
      response.phase = response.calls.length ? 'ready' : 'done';
      this.scheduleDrain();
      return;
    }
    const item = object(nested.item);
    if (item?.type !== 'function_call') {
      if (
        typeof item?.type === 'string' &&
        (item.type.endsWith('_call') || item.type === 'mcp_approval_request')
      )
        this.fail('malformed_function_call');
      return;
    }
    if (response.phase !== 'collecting') {
      const prior = this.callIds.get(item.call_id);
      if (
        prior &&
        prior.responseId === response.id &&
        prior.fingerprint === this.fingerprint(item.name, item.arguments)
      )
        return;
      return this.fail('invalid_correlation');
    }
    if (!identifier.safeParse(item.call_id).success) return this.fail('malformed_function_call');
    const fingerprint = this.fingerprint(item.name, item.arguments),
      prior = this.callIds.get(item.call_id);
    if (prior) {
      if (prior.responseId !== response.id || prior.fingerprint !== fingerprint)
        this.fail('duplicate_call_conflict');
      return;
    }
    if (response.calls.length >= 4 || this.callIds.size >= 16 || this.continuations >= 8)
      return this.fail('tool_budget_exceeded');
    const validName = ApplicationToolNameSchema.safeParse(item.name);
    const invalid =
      !validName.success ||
      !this.options.tools.includes(validName.data) ||
      typeof item.arguments !== 'string' ||
      item.arguments.length > 15000;
    this.callIds.set(item.call_id, { responseId: response.id, fingerprint });
    response.calls.push({
      id: item.call_id,
      name: validName.success ? validName.data : 'unavailable',
      arguments:
        typeof item.arguments === 'string' && item.arguments.length <= 15000 ? item.arguments : '',
      fingerprint,
      invalid,
      sent: false,
    });
  }
  private fingerprint(name: unknown, args: unknown) {
    return createHash('sha256')
      .update(JSON.stringify([name, args]))
      .digest('hex');
  }
  private scheduleDrain() {
    if (this.draining || !this.current()) return;
    this.draining = Promise.resolve()
      .then(() => this.drain())
      .catch(() => this.fail('tool_transport_failed'))
      .finally(() => {
        this.draining = undefined;
        if (
          this.current() &&
          [...this.responses.values()].some(
            (value) => value.phase === 'ready' && value.calls.some((call) => !call.sent),
          )
        )
          this.scheduleDrain();
      });
  }
  private blocked(reasonCode: string, status = 'blocked') {
    return {
      schemaVersion: 1,
      status,
      reasonCode,
      verification: status === 'unknown' ? 'unconfirmed' : 'policy_denial',
      instruction:
        'This is a structured application result. Do not infer execution or spoken delivery.',
    };
  }
  private async drain() {
    let resultsSent = false;
    for (const response of this.responses.values()) {
      if (response.phase !== 'ready') continue;
      for (const call of response.calls) {
        if (call.sent) continue;
        if (!this.current() || response.phase !== 'ready') return;
        const context = { ...this.options.context, callId: call.id };
        let output: unknown = this.blocked('tool_not_allowed');
        const accessTool = (
          call.invalid ? this.options.tools[0] : call.name
        ) as ApplicationToolName;
        if (!accessTool || !(await this.options.accessCurrent(accessTool)))
          return this.fail('tool_access_revoked');
        if (!this.current() || response.phase !== 'ready') return;
        if (!call.invalid) {
          const name = call.name as ApplicationToolName;
          this.invocations = this.invocations.filter((at) => at > Date.now() - 60_000);
          if (this.invocations.length >= 8) return this.fail('tool_budget_exceeded');
          this.invocations.push(Date.now());
          try {
            const result = outcomeSchema.safeParse(
              await this.options.gateway.invoke(context, name, call.arguments),
            );
            output =
              result.success &&
              result.data.requestId === toolRequestId(context) &&
              result.data.toolName === name
                ? { ...result.data, untrusted: true, spokenDeliveryConfirmed: false }
                : this.blocked('invalid_tool_result', 'unknown');
          } catch {
            output = this.blocked('operation_failed', 'unknown');
          }
          call.arguments = '';
          if (!this.current() || response.phase !== 'ready') return;
        }
        if (!(await this.options.accessCurrent(accessTool)))
          return this.fail('tool_access_revoked');
        if (!this.current() || response.phase !== 'ready') return;
        let serialized = JSON.stringify(output);
        if (
          serialized.length > 64 * 1024 ||
          serialized.includes(this.options.context.authSessionHash)
        )
          serialized = JSON.stringify(this.blocked('tool_result_unavailable', 'unknown'));
        if (!this.current() || response.phase !== 'ready') return;
        const eventId = `tool_${randomUUID()}`;
        this.sentEventIds.add(eventId);
        this.options.send({
          type: 'response.item.create',
          event_id: eventId,
          item: { type: 'function_call_output', call_id: call.id, output: serialized },
        });
        call.sent = true;
        resultsSent = true;
      }
    }
    if (!this.current()) return;
    const pending = [...this.responses.values()].filter(
      (response) => response.phase === 'collecting' || response.phase === 'ready',
    );
    if (
      !pending.some((response) => response.calls.some((call) => call.sent)) ||
      pending.some(
        (response) => response.phase === 'collecting' || response.calls.some((call) => !call.sent),
      )
    )
      return;
    if (!resultsSent && !pending.some((response) => response.phase === 'ready')) return;
    if (this.continuations++ >= 8) return this.fail('tool_budget_exceeded');
    const eventId = `continue_${randomUUID()}`;
    this.sentEventIds.add(eventId);
    this.options.send({ type: 'response.create', event_id: eventId });
    for (const response of pending) response.phase = 'continued';
  }
}
