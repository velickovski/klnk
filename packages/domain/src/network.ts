import { z } from 'zod';

/** Internal collaboration v1. Legacy telephone missions are deliberately separate. */
const id = z.uuid(),
  instant = z.iso.datetime({ offset: true });
export const NetworkTimezoneSchema = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Use an IANA timezone.');
export const NetworkSlotSchema = z
  .object({ startAt: instant, endAt: instant, timezone: NetworkTimezoneSchema })
  .strict()
  .refine(
    (s) =>
      Date.parse(s.endAt) > Date.parse(s.startAt) &&
      Date.parse(s.endAt) - Date.parse(s.startAt) <= 4 * 3600000,
    'Choose an interval of at most four hours.',
  );
export const NetworkPolicyInputSchema = z
  .object({
    enabled: z.boolean(),
    trustedMemberIds: z.array(id).max(100),
    topics: z.array(z.string().trim().min(1).max(80)).max(20),
    allowMessages: z.boolean(),
    allowQuestions: z.boolean(),
    allowMeetings: z.boolean(),
    autoAcceptMeetings: z.boolean(),
    timezone: NetworkTimezoneSchema,
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    workStartMinute: z.number().int().min(0).max(1439),
    workEndMinute: z.number().int().min(1).max(1440),
    maxDurationMinutes: z.number().int().min(5).max(240),
    minNoticeMinutes: z.number().int().min(0).max(43200),
    schedulingWindowDays: z.number().int().min(1).max(90),
    expiresAt: instant,
    sharedMemoryIds: z.array(id).max(50),
    reminderMinutes: z.array(z.number().int().min(0).max(10080)).max(4),
  })
  .strict()
  .refine((p) => p.workEndMinute > p.workStartMinute, 'Working hours must end after they begin.');
export type NetworkPolicyInput = z.infer<typeof NetworkPolicyInputSchema>;
export type NetworkPolicy = NetworkPolicyInput & {
  ownerId: string;
  version: number;
  updatedAt: string;
};
export const NetworkPolicySchema = NetworkPolicyInputSchema.safeExtend({
  ownerId: id,
  version: z.number().int().positive(),
  updatedAt: instant,
});
export const NetworkMemberSchema = z
  .object({ id, name: z.string(), memberCode: z.string() })
  .strict();
export type NetworkMember = z.infer<typeof NetworkMemberSchema>;
export const NetworkConnectionSchema = z
  .object({
    id,
    fromId: id,
    toId: id,
    status: z.enum(['pending', 'accepted', 'declined', 'blocked']),
    version: z.number().int().positive(),
    inbound: z.record(z.string(), z.boolean()),
    mutedBy: z.array(id),
    createdAt: instant,
    updatedAt: instant,
    peer: NetworkMemberSchema.optional(),
  })
  .strict();
export type NetworkConnection = z.infer<typeof NetworkConnectionSchema>;
export const NetworkMemoryInputSchema = z
  .object({
    text: z.string().trim().min(1).max(1000),
    topic: z.string().trim().min(1).max(80),
    sharing: z.enum(['private', 'connections']),
    memberIds: z.array(id).max(100),
    expiresAt: instant,
    confirmed: z.boolean(),
  })
  .strict();
export const NetworkMemorySchema = NetworkMemoryInputSchema.extend({
  id,
  ownerId: id,
  version: z.number().int().positive(),
  source: z.literal('owner'),
  createdAt: instant,
  updatedAt: instant,
});
export type NetworkMemory = z.infer<typeof NetworkMemorySchema>;
export const NetworkRequestInputSchema = z
  .object({
    requestId: id,
    connectionId: id,
    kind: z.enum(['inform', 'ask', 'meeting']),
    purpose: z.string().trim().min(1).max(500),
    topic: z.string().trim().min(1).max(80),
    message: z.string().trim().max(1500),
    candidateSlots: z.array(NetworkSlotSchema).max(3),
    location: z.string().trim().max(200),
    expiresAt: instant,
  })
  .strict()
  .refine(
    (r) => (r.kind === 'meeting' ? r.candidateSlots.length > 0 : r.candidateSlots.length === 0),
    'Meetings need one to three explicit slots; messages cannot carry meeting authority.',
  );
export type NetworkRequestInput = z.infer<typeof NetworkRequestInputSchema>;
export const NetworkTermsSchema = z
  .object({
    version: z.literal(1),
    participants: z.array(id).length(2),
    purpose: z.string().min(1).max(500),
    topic: z.string().min(1).max(80),
    slot: NetworkSlotSchema,
    location: z.string().max(200),
    obligations: z
      .array(
        z
          .object({
            assigneeId: id,
            text: z.string().max(500),
            dueAt: instant,
            timezone: NetworkTimezoneSchema,
          })
          .strict(),
      )
      .max(0),
  })
  .strict();
export type NetworkTerms = z.infer<typeof NetworkTermsSchema>;
export const NetworkProposalSchema = z
  .object({
    id,
    version: z.number().int().positive(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    terms: NetworkTermsSchema,
    expiresAt: instant,
  })
  .strict();
export type NetworkProposal = z.infer<typeof NetworkProposalSchema>;
export const NetworkAcceptanceSchema = z
  .object({
    ownerId: id,
    proposalHash: z.string(),
    proposalVersion: z.number().int().positive(),
    source: z.enum(['owner_request', 'owner_approval', 'delegation_rule']),
    policyVersion: z.number().int().positive(),
    at: instant,
  })
  .strict();
export type NetworkAcceptance = z.infer<typeof NetworkAcceptanceSchema>;
export const NetworkMessageSchema = z
  .object({
    id,
    sequence: z.number().int().positive(),
    actorId: id,
    role: z.enum(['owner', 'agent', 'server']),
    kind: z.enum([
      'inform',
      'ask',
      'propose',
      'counterpropose',
      'accept',
      'decline',
      'needs_owner',
      'close',
    ]),
    text: z.string().max(2000),
    at: instant,
    proposalHash: z.string().optional(),
  })
  .strict();
export type NetworkMessage = z.infer<typeof NetworkMessageSchema>;
export const NetworkConversationSchema = z
  .object({
    id,
    protocolVersion: z.literal(1),
    initiatorId: id,
    recipientId: id,
    connectionId: id,
    request: NetworkRequestInputSchema,
    state: z.enum([
      'queued',
      'processing',
      'awaiting_approval',
      'agreed',
      'delivered',
      'answered',
      'declined',
      'unresolved',
      'expired',
      'cancelled',
      'paused',
    ]),
    version: z.number().int().positive(),
    connectionVersion: z.number().int().positive(),
    policyVersions: z.record(z.string(), z.number().int().positive()),
    messages: z.array(NetworkMessageSchema).max(30),
    proposal: NetworkProposalSchema.optional(),
    acceptances: z.array(NetworkAcceptanceSchema).max(2),
    decisionOwnerIds: z.array(id).max(2),
    eventId: id.optional(),
    summary: z.string().max(4000),
    nextAction: z.string().max(1000),
    turns: z.number().int().nonnegative(),
    createdAt: instant,
    updatedAt: instant,
    processedAt: instant.optional(),
    readBy: z.array(id),
  })
  .strict();
export type NetworkConversation = z.infer<typeof NetworkConversationSchema>;
export const NetworkEventSchema = z
  .object({
    id,
    conversationId: id,
    proposalHash: z.string(),
    proposalVersion: z.number().int().positive(),
    terms: NetworkTermsSchema,
    acceptances: z.array(NetworkAcceptanceSchema).length(2),
    status: z.enum(['confirmed', 'cancelled']),
    revision: z.number().int().positive(),
    createdAt: instant,
    cancelledAt: instant.optional(),
    cancelledBy: id.optional(),
  })
  .strict();
export type NetworkEvent = z.infer<typeof NetworkEventSchema>;
export const NetworkReminderSchema = z
  .object({
    id,
    ownerId: id,
    eventId: id,
    text: z.string(),
    dueAt: instant,
    timezone: NetworkTimezoneSchema,
    status: z.enum(['scheduled', 'due', 'dismissed', 'cancelled']),
    createdAt: instant,
  })
  .strict();
export type NetworkReminder = z.infer<typeof NetworkReminderSchema>;
export const NetworkInboxSchema = z
  .object({
    conversations: z.array(NetworkConversationSchema),
    unread: z.number().int().nonnegative(),
  })
  .strict();
export const NetworkCalendarSchema = z
  .object({
    events: z.array(NetworkEventSchema),
    reminders: z.array(NetworkReminderSchema),
    scope: z.literal('klnk_only'),
  })
  .strict();
export const NetworkIdentitySchema = z
  .object({
    member: NetworkMemberSchema,
    delivery: z.literal('internal'),
    externalEffectsEnabled: z.literal(false),
    cloudProcessor: z.literal('OpenAI owner conversation; optional reasoning'),
  })
  .strict();
export const NetworkDecisionSchema = z
  .object({
    proposalHash: z.string().regex(/^[a-f0-9]{64}$/),
    proposalVersion: z.number().int().positive(),
    decision: z.enum(['approve', 'decline']),
  })
  .strict();
export const NetworkPreferencesInputSchema = z
  .object({
    retentionDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
    notificationMode: z.enum(['decisions_results', 'decisions_only', 'quiet']),
  })
  .strict();
export const NetworkPreferencesSchema = NetworkPreferencesInputSchema.extend({
  ownerId: id,
  version: z.number().int().positive(),
  updatedAt: instant,
}).strict();
export type NetworkPreferences = z.infer<typeof NetworkPreferencesSchema>;
const intentBase = {
  commandId: id,
  reason: z.string().max(100).optional(),
  clarification: z.string().max(500).optional(),
  plan: NetworkRequestInputSchema.optional(),
  planHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  conversation: NetworkConversationSchema.optional(),
};
export const OwnerIntentResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      ...intentBase,
      status: z.literal('clarification'),
      clarification: z.string().min(1).max(500),
    })
    .strict(),
  z
    .object({
      ...intentBase,
      status: z.literal('draft'),
      plan: NetworkRequestInputSchema,
      planHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      ...intentBase,
      status: z.literal('submitted'),
      conversation: NetworkConversationSchema,
    })
    .strict(),
  z.object({ ...intentBase, status: z.literal('processing') }).strict(),
  z.object({ ...intentBase, status: z.literal('uncertain') }).strict(),
  z.object({ ...intentBase, status: z.literal('failed') }).strict(),
]);
export type OwnerIntentResult = z.infer<typeof OwnerIntentResultSchema>;
