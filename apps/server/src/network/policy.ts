import { createHash } from 'node:crypto';
import type {
  NetworkConnection,
  NetworkConversation,
  NetworkPolicy,
  NetworkTerms,
} from '../../../../packages/domain/src/network.js';
import { HttpError } from '../errors.js';

/** Explicit field order makes material terms stable across object construction order. */
export function canonicalProposalHash(terms: NetworkTerms): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: terms.version,
        participants: [...terms.participants].sort(),
        purpose: terms.purpose,
        topic: terms.topic,
        slot: {
          startAt: new Date(terms.slot.startAt).toISOString(),
          endAt: new Date(terms.slot.endAt).toISOString(),
          timezone: terms.slot.timezone,
        },
        location: terms.location,
        obligations: terms.obligations,
      }),
    )
    .digest('hex');
}
export function networkReceiptId(
  conversationId: string,
  ownerId: string,
  proposalHash: string,
): string {
  const hex = createHash('sha256')
    .update(`network-approval-v1:${conversationId}:${ownerId}:${proposalHash}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function defaultNetworkPolicy(ownerId: string): NetworkPolicy {
  const now = new Date().toISOString();
  return {
    ownerId,
    version: 1,
    updatedAt: now,
    enabled: false,
    trustedMemberIds: [],
    topics: [],
    allowMessages: true,
    allowQuestions: false,
    allowMeetings: false,
    autoAcceptMeetings: false,
    timezone: 'UTC',
    weekdays: [1, 2, 3, 4, 5],
    workStartMinute: 540,
    workEndMinute: 1020,
    maxDurationMinutes: 60,
    minNoticeMinutes: 60,
    schedulingWindowDays: 30,
    expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    sharedMemoryIds: [],
    reminderMinutes: [15],
  };
}
export function assertNetworkAuthority(
  conversation: NetworkConversation,
  policies: NetworkPolicy[],
  connection: NetworkConnection,
  now = Date.now(),
): void {
  const deny = (code: string, message: string): never => {
    throw new HttpError(409, code, message);
  };
  if (Date.parse(conversation.request.expiresAt) <= now)
    deny('network_expired', 'This request has expired.');
  if (
    connection.id !== conversation.connectionId ||
    connection.status !== 'accepted' ||
    connection.version !== conversation.connectionVersion ||
    !(
      [connection.fromId, connection.toId].includes(conversation.initiatorId) &&
      [connection.fromId, connection.toId].includes(conversation.recipientId)
    ) ||
    !connection.inbound[conversation.recipientId] ||
    connection.mutedBy.includes(conversation.recipientId)
  )
    deny('network_connection_changed', 'The connection no longer permits this request.');
  if (
    conversation.request.kind !== 'inform' &&
    (!connection.inbound[conversation.initiatorId] ||
      connection.mutedBy.includes(conversation.initiatorId))
  )
    deny('network_connection_changed', 'This connection does not permit a reply or negotiation.');
  for (const ownerId of [conversation.initiatorId, conversation.recipientId]) {
    const policy = policies.find((p) => p.ownerId === ownerId),
      peerId =
        ownerId === conversation.initiatorId ? conversation.recipientId : conversation.initiatorId;
    if (
      !policy ||
      !policy.enabled ||
      policy.version !== conversation.policyVersions[ownerId] ||
      Date.parse(policy.expiresAt) <= now
    )
      deny(
        'network_policy_changed',
        'Current authorization is unavailable. Submit a new request after reviewing authority.',
      );
    if (
      !policy!.trustedMemberIds.includes(peerId) ||
      !policy!.topics.includes(conversation.request.topic)
    )
      deny('network_scope_denied', 'This request is outside granted scope.');
    const allowed =
      conversation.request.kind === 'inform'
        ? policy!.allowMessages
        : conversation.request.kind === 'ask'
          ? policy!.allowQuestions
          : policy!.allowMeetings;
    if (!allowed) deny('network_scope_denied', 'This operation has not been authorized.');
  }
}
/** Check every minute of the bounded interval, rather than only its start. */
export function meetingRuleAllows(
  policy: NetworkPolicy,
  peerId: string,
  topic: string,
  slot: NetworkTerms['slot'],
  now = Date.now(),
): boolean {
  const start = Date.parse(slot.startAt),
    end = Date.parse(slot.endAt);
  if (
    !policy.enabled ||
    !policy.allowMeetings ||
    !policy.autoAcceptMeetings ||
    Date.parse(policy.expiresAt) <= now ||
    !policy.trustedMemberIds.includes(peerId) ||
    !policy.topics.includes(topic) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > policy.maxDurationMinutes * 60000 ||
    start < now + policy.minNoticeMinutes * 60000 ||
    end > now + policy.schedulingWindowDays * 86400000
  )
    return false;
  try {
    const format = new Intl.DateTimeFormat('en-US', {
      timeZone: policy.timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const points: number[] = [];
    for (let at = start; at < end; at += 60000) points.push(at);
    points.push(end - 1);
    for (const at of points) {
      const parts = format.formatToParts(at),
        value = (type: string) => parts.find((p) => p.type === type)!.value;
      const minute = Number(value('hour')) * 60 + Number(value('minute'));
      if (
        !policy.weekdays.includes(days.indexOf(value('weekday'))) ||
        minute < policy.workStartMinute ||
        minute >= policy.workEndMinute
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
