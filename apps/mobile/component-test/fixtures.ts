import {
  NetworkConnectionSchema,
  NetworkConversationSchema,
  NetworkEventSchema,
  NetworkMemorySchema,
  NetworkPolicySchema,
  NETWORK_VOICE_TOOLS,
} from '@personal-agent/domain';

export const ownerId = '00000000-0000-4000-8000-000000000001';
export const peerId = '00000000-0000-4000-8000-000000000002';
const connectionId = '00000000-0000-4000-8000-000000000003';
export const conversationId = '00000000-0000-4000-8000-000000000004';
const eventId = '00000000-0000-4000-8000-000000000005';
const now = new Date().toISOString(),
  future = new Date(Date.now() + 7 * 86400000).toISOString();
export const connection = NetworkConnectionSchema.parse({
  id: connectionId,
  fromId: ownerId,
  toId: peerId,
  status: 'accepted',
  version: 2,
  inbound: { [ownerId]: true, [peerId]: true },
  mutedBy: [],
  createdAt: now,
  updatedAt: now,
  peer: { id: peerId, name: 'Fictional Jordan', memberCode: 'klnk_fictionalJordanCode' },
});
export const policy = NetworkPolicySchema.parse({
  ownerId,
  version: 1,
  updatedAt: now,
  enabled: false,
  trustedMemberIds: [],
  topics: [],
  allowMessages: false,
  allowQuestions: false,
  allowMeetings: false,
  autoAcceptMeetings: false,
  timezone: 'UTC',
  weekdays: [1, 2, 3, 4, 5],
  workStartMinute: 540,
  workEndMinute: 1020,
  maxDurationMinutes: 30,
  minNoticeMinutes: 60,
  schedulingWindowDays: 14,
  expiresAt: future,
  sharedMemoryIds: [],
  reminderMinutes: [15],
});
export const enabledPolicy = {
  ...policy,
  enabled: true,
  trustedMemberIds: [peerId],
  topics: ['launch'],
  allowMessages: true,
  allowQuestions: true,
  allowMeetings: true,
};
export const conversation = NetworkConversationSchema.parse({
  id: conversationId,
  protocolVersion: 1,
  initiatorId: ownerId,
  recipientId: peerId,
  connectionId,
  request: {
    requestId: conversationId,
    connectionId,
    kind: 'inform',
    purpose: 'Fictional launch update',
    topic: 'launch',
    message: 'Fictional exact message',
    candidateSlots: [],
    location: '',
    expiresAt: future,
  },
  state: 'delivered',
  version: 2,
  connectionVersion: 2,
  policyVersions: { [ownerId]: 1, [peerId]: 1 },
  messages: [],
  acceptances: [],
  decisionOwnerIds: [],
  summary: 'The fictional update is in the shared conversation.',
  nextAction: 'No decision is needed.',
  turns: 1,
  createdAt: now,
  updatedAt: now,
  readBy: [],
});
export const event = NetworkEventSchema.parse({
  id: eventId,
  conversationId,
  proposalHash: 'af'.repeat(32),
  proposalVersion: 1,
  terms: {
    version: 1,
    participants: [ownerId, peerId],
    purpose: 'Fictional launch meeting',
    topic: 'launch',
    slot: {
      startAt: new Date(Date.now() + 86400000).toISOString(),
      endAt: new Date(Date.now() + 88200000).toISOString(),
      timezone: 'UTC',
    },
    location: 'Fictional fountain',
    obligations: [],
  },
  acceptances: [ownerId, peerId].map((id) => ({
    ownerId: id,
    proposalHash: 'af'.repeat(32),
    proposalVersion: 1,
    source: 'owner_approval',
    policyVersion: 1,
    at: now,
  })),
  status: 'confirmed',
  revision: 1,
  createdAt: now,
});
export const memory = NetworkMemorySchema.parse({
  id: eventId,
  ownerId,
  version: 1,
  text: 'Fictional private context',
  topic: 'launch',
  sharing: 'private',
  memberIds: [],
  expiresAt: future,
  confirmed: true,
  source: 'owner',
  createdAt: now,
  updatedAt: now,
});
export function responses(): Record<string, unknown> {
  return {
    '/network/identity': {
      member: { id: ownerId, name: 'Fictional Owner', memberCode: 'klnk_fictionalComponentCode' },
      delivery: 'internal',
      externalEffectsEnabled: false,
      cloudProcessor: 'OpenAI owner conversation; optional reasoning',
    },
    '/network/connections': { connections: [] },
    '/network/conversations': { conversations: [], unread: 0 },
    '/network/calendar': {
      events: [],
      reminders: [],
      scope: 'klnk_only',
      busyBlocks: [],
      availability: null,
    },
    '/network/memories': { memories: [] },
    '/network/policy': policy,
    '/network/notifications': { items: [], delivery: 'in_app' },
    '/network/preferences': {
      ownerId,
      version: 1,
      updatedAt: now,
      retentionDays: 30,
      notificationMode: 'decisions_results',
    },
    '/tools/access': {
      grant: { id: `tool-access:${ownerId}`, ownerId, enabled: false, tools: [], updatedAt: now },
      runtimeAvailable: false,
      externalEffectsEnabled: false,
    },
  };
}
export function populatedVoice() {
  const baseline = responses()['/tools/access'] as {
    grant: { id: string; ownerId: string; updatedAt: string };
  };
  return {
    ...baseline,
    grant: { ...baseline.grant, enabled: true, tools: [...NETWORK_VOICE_TOOLS] },
    runtimeAvailable: true,
    externalEffectsEnabled: false,
  };
}
