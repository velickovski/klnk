import { requestId } from './request-id';
export { requestId } from './request-id';
import {
  NetworkMemoryInputSchema,
  NetworkPolicyInputSchema,
  NetworkRequestInputSchema,
  type NetworkConnection,
  type NetworkConversation,
  type NetworkMemory,
  type NetworkPolicyInput,
  type NetworkRequestInput,
} from '@personal-agent/domain';

export type MemoryInput = Pick<
  NetworkMemory,
  'text' | 'topic' | 'sharing' | 'memberIds' | 'expiresAt' | 'confirmed'
>;
export type RequestDraft = Omit<NetworkRequestInput, 'requestId' | 'candidateSlots'> & {
  candidateSlots: { startAt: string; endAt: string; timezone: string }[];
};
export const futureInstant = (days = 7, now = Date.now()) =>
  new Date(now + days * 86400000).toISOString();
export function requestDraft(now = Date.now()): RequestDraft {
  return {
    connectionId: '',
    kind: 'inform',
    purpose: '',
    topic: '',
    message: '',
    candidateSlots: [],
    location: '',
    expiresAt: futureInstant(7, now),
  };
}
export function memoryDraft(now = Date.now()): MemoryInput {
  return {
    text: '',
    topic: '',
    sharing: 'private',
    memberIds: [],
    expiresAt: futureInstant(30, now),
    confirmed: false,
  };
}

function validFuture(value: string, now: number, label: string) {
  if (!Number.isFinite(Date.parse(value)) || Date.parse(value) <= now)
    throw new Error(
      `${label} must be a future ISO date and time with Z or an explicit UTC offset.`,
    );
}
function checked<T>(
  result:
    | { success: true; data: T }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } },
): T {
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  throw new Error(`${issue.path.join('.') || 'Details'}: ${issue.message}`);
}
export function buildRequest(
  draft: RequestDraft,
  connections: NetworkConnection[],
  nonce: string,
  now = Date.now(),
): NetworkRequestInput {
  if (
    !connections.some(
      (connection) => connection.id === draft.connectionId && connection.status === 'accepted',
    )
  )
    throw new Error('Choose an accepted connection in People before sending.');
  const value = checked(NetworkRequestInputSchema.safeParse({ ...draft, requestId: nonce }));
  validFuture(value.expiresAt, now, 'Request expiry');
  if (Date.parse(value.expiresAt) > now + 30 * 86400000)
    throw new Error('Request expiry must be within thirty days.');
  if (value.kind !== 'meeting' && !value.message)
    throw new Error('Include the exact information or question to deliver.');
  for (const slot of value.candidateSlots) {
    validFuture(slot.startAt, now, 'Candidate start');
    if (Date.parse(slot.endAt) > Date.parse(value.expiresAt))
      throw new Error('Each candidate must end before the request expires.');
  }
  return value;
}
export function buildMemory(
  draft: MemoryInput,
  acceptedMemberIds: string[],
  now = Date.now(),
): MemoryInput {
  const value = checked(NetworkMemoryInputSchema.safeParse(draft));
  validFuture(value.expiresAt, now, 'Memory expiry');
  if (value.sharing === 'private' && value.memberIds.length)
    throw new Error('Private memory cannot include sharing recipients.');
  if (
    value.sharing === 'connections' &&
    (!value.memberIds.length || value.memberIds.some((id) => !acceptedMemberIds.includes(id)))
  )
    throw new Error('Choose at least one current accepted member for this memory.');
  return value;
}
export function buildPolicy(
  draft: NetworkPolicyInput,
  acceptedMemberIds: string[],
  now = Date.now(),
): NetworkPolicyInput {
  const value = checked(NetworkPolicyInputSchema.safeParse(draft));
  if (value.enabled) {
    validFuture(value.expiresAt, now, 'Delegation expiry');
    if (
      !value.trustedMemberIds.length ||
      value.trustedMemberIds.some((id) => !acceptedMemberIds.includes(id))
    )
      throw new Error('Select current accepted members before enabling delegation.');
    if (!value.topics.length)
      throw new Error('Add at least one permitted topic before enabling delegation.');
    if (!value.allowMessages && !value.allowQuestions && !value.allowMeetings)
      throw new Error('Select at least one capability before enabling delegation.');
    if (value.autoAcceptMeetings && !value.allowMeetings)
      throw new Error('Meeting acceptance requires meeting coordination permission.');
  }
  return value;
}
export const peerId = (connection: NetworkConnection, ownerId: string) =>
  connection.fromId === ownerId ? connection.toId : connection.fromId;
export const peerName = (connection: NetworkConnection) => connection.peer?.name || 'Member';
export const acceptedConnections = (connections: NetworkConnection[]) =>
  connections.filter((connection) => connection.status === 'accepted');
export const isTerminal = (state: NetworkConversation['state']) =>
  ['agreed', 'delivered', 'answered', 'declined', 'unresolved', 'expired', 'cancelled'].includes(
    state,
  );
export function inboxLabel(conversation: NetworkConversation, ownerId: string) {
  if (conversation.state === 'awaiting_approval')
    return conversation.decisionOwnerIds.includes(ownerId)
      ? 'Your decision needed'
      : 'Waiting for the other owner';
  return (
    (
      {
        queued: 'Queued',
        processing: 'Agents coordinating',
        agreed: 'Meeting confirmed',
        delivered: 'Information delivered',
        answered: 'Question answered',
        declined: 'Declined',
        unresolved: 'Unresolved',
        expired: 'Expired',
        cancelled: 'Cancelled',
        paused: 'Paused',
      } as Record<string, string>
    )[conversation.state] ?? 'Status unavailable'
  );
}
export function canDecide(conversation: NetworkConversation, ownerId: string, now = Date.now()) {
  return (
    conversation.state === 'awaiting_approval' &&
    conversation.decisionOwnerIds.includes(ownerId) &&
    !!conversation.proposal &&
    Date.parse(conversation.proposal.expiresAt) > now
  );
}
export function errorText(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'The service could not confirm this action. Your draft is retained. Retry after reconnecting.';
}

/** One immutable nonce and payload survive ambiguous saves; read back before retrying. */
export class RequestSubmission {
  pending: NetworkRequestInput | null = null;
  stage(payload: NetworkRequestInput) {
    if (!this.pending) this.pending = JSON.parse(JSON.stringify(payload)) as NetworkRequestInput;
    return this.pending;
  }
  async send(
    send: (payload: NetworkRequestInput) => Promise<NetworkConversation>,
    read: () => Promise<NetworkConversation[]>,
  ): Promise<NetworkConversation> {
    const payload = this.pending;
    if (!payload) throw new Error('Prepare a request first.');
    const existing = (await read()).find((item) => item.request.requestId === payload.requestId);
    if (existing) {
      this.pending = null;
      return existing;
    }
    try {
      const result = await send(payload);
      this.pending = null;
      return result;
    } catch (error) {
      try {
        const recovered = (await read()).find(
          (item) => item.request.requestId === payload.requestId,
        );
        if (recovered) {
          this.pending = null;
          return recovered;
        }
      } catch {
        /* Keep the same nonce when readback also fails. */
      }
      // A known validation/authorization rejection permits correction; timeouts remain uncertain.
      const status = (error as { status?: number })?.status;
      const code = (error as { code?: string })?.code;
      if (
        (status && status >= 400 && status < 500 && ![408, 409, 429].includes(status)) ||
        (status === 409 &&
          [
            'network_policy_changed',
            'network_scope_denied',
            'network_connection_changed',
            'network_expired',
          ].includes(code ?? ''))
      )
        this.pending = null;
      throw error;
    }
  }
}

/** Discard late effects from an unmounted owner subtree and older reads. */
export class ResponseFence {
  private generation = 0;
  private active = true;
  begin() {
    return ++this.generation;
  }
  current(ticket: number) {
    return this.active && ticket === this.generation;
  }
  dispose() {
    this.active = false;
    this.generation++;
  }
}
