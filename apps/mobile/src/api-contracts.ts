import { z } from 'zod';
import {NetworkIdentitySchema,NetworkConnectionSchema,NetworkPolicySchema,NetworkMemorySchema,NetworkInboxSchema,NetworkConversationSchema,NetworkCalendarSchema,NetworkEventSchema,NetworkReminderSchema,NetworkPreferencesSchema,OwnerIntentResultSchema} from '@personal-agent/domain';
import { ProfileSchema, ContactSchema, MemorySchema, MissionSchema, MissionInputSchema, AttemptSchema, FollowUpActionSchema, OutcomeSchema, TranscriptEntrySchema, ApplicationToolNameSchema, ToolTraceSchema } from '@personal-agent/domain';

const text = z.string().min(1);
const object = z.record(z.string(), z.unknown());
export const ReadinessSchema = z.object({ ready: z.boolean(), callGate: text, checks: z.array(z.object({ id: text, label: text, status: z.enum(['ready', 'missing', 'blocked']), detail: z.string() })) });
export const HealthSchema = z.object({ status: z.literal('ok'), mode: z.enum(['simulator', 'elevenlabs']), storage: z.string().optional(), liveCallsEnabled: z.boolean().optional(), liveReadiness: ReadinessSchema.optional() });
const profile = ProfileSchema.required();
const contact = ContactSchema.required();
const memory = MemorySchema;
const mission = MissionSchema.extend({ status: MissionSchema.shape.status.removeDefault(), schedule: MissionSchema.shape.schedule.removeDefault(), boundaries: MissionSchema.shape.boundaries.removeDefault(), retention: MissionSchema.shape.retention.removeDefault(), followUpActions: z.array(FollowUpActionSchema) });
const detail = mission.extend({ attempts: z.array(AttemptSchema), actions: z.array(FollowUpActionSchema), transcript: z.array(TranscriptEntrySchema), outcome: OutcomeSchema.optional(), context: z.array(memory).optional() });
const capabilities = z.record(z.string(), z.union([z.boolean(), z.string(), object]));
// An unused template has no recipient until the owner adds their first contact.
const templateInput = MissionInputSchema.extend({ contactId: z.string() });
const bootstrap = z.object({ profile, contacts: z.array(contact), memories: z.array(memory), missions: z.array(mission), templates: z.array(z.object({ id: text, title: text, description: z.string(), icon: text, input: templateInput })), capabilities, mode: z.enum(['simulator', 'elevenlabs']), liveCallsEnabled: z.boolean().optional(), liveReadiness: ReadinessSchema.optional(), limits: z.object({ dailyAttempts: z.number().int().nonnegative(), maxDurationSeconds: z.number().int().positive(), maxRetries: z.number().int().nonnegative() }), integrations: z.array(z.object({ id: text, name: text, status: text, detail: z.string() })) });
const voiceReply = z.object({ sessionId: text, turnId: text, text: z.string(), transcript: z.string(), audioBase64: z.string().optional(), audioMimeType: z.string().optional(), missionId: text.optional(), status: z.enum(['reply', 'needs_reply', 'queued', 'calling_disabled', 'completed', 'cancelled']), needsReply: z.boolean(), mode: z.enum(['simulator', 'elevenlabs']), voiceMode: z.enum(['provider', 'device', 'unavailable']) });
const voiceReport = voiceReply.extend({ sessionId: z.string() });
const voice = z.object({ id: text, name: text, kind: text, enabled: z.boolean().optional() });
const ok = z.object({ ok: z.literal(true) });
const googleConnection=z.object({id:text,kind:z.literal('google_calendar'),name:z.literal('Google Calendar'),status:z.enum(['unavailable','disconnected','connecting','connected','expired','insufficient_scope','revoked','revoke_pending','error']),available:z.boolean(),reasonCode:text,detail:z.string(),capabilities:z.object({readExisting:z.boolean(),updateExisting:z.boolean()}),tokenExpiresAt:z.iso.datetime().optional(),verifiedAt:z.iso.datetime().optional()});

function containsDecodedFields(decoded: unknown, input: unknown): boolean {
  if (Array.isArray(decoded)) return Array.isArray(input) && decoded.every((value, index) => containsDecodedFields(value, input[index]));
  if (decoded && typeof decoded === 'object') {
    if (!input || typeof input !== 'object') return false;
    const source = input as Record<string, unknown>;
    return Object.entries(decoded).every(([key, value]) => value === undefined || Object.hasOwn(source, key) && containsDecodedFields(value, source[key]));
  }
  return true;
}

/** Validate without applying schema defaults or stripping evidence/extension fields. */
export function validateApiPayload(path: string, method: string, payload: unknown) {
  const route = path.split('?')[0];
  let schema: z.ZodType = object;
  if (route === '/health') schema = HealthSchema;
  else if(route==='/network/identity')schema=NetworkIdentitySchema;
  else if(route==='/network/owner-intents'||route.startsWith('/network/owner-intents/'))schema=OwnerIntentResultSchema;
  else if(route==='/network/preferences')schema=NetworkPreferencesSchema;
  else if(route==='/network/notifications')schema=z.object({items:z.array(z.object({id:z.uuid(),conversationId:z.uuid(),kind:text,at:z.iso.datetime()})).max(20),delivery:z.literal('in_app')}).strict();
  else if(/^\/network\/notifications\/[^/]+\/read$/.test(route))schema=ok;
  else if(route==='/network/connections')schema=method==='GET'?z.object({connections:z.array(NetworkConnectionSchema)}).strict():NetworkConnectionSchema;
  else if(/^\/network\/connections\/[^/]+$/.test(route))schema=NetworkConnectionSchema;
  else if(route==='/network/policy')schema=NetworkPolicySchema;
  else if(route==='/network/memories')schema=method==='GET'?z.object({memories:z.array(NetworkMemorySchema)}).strict():NetworkMemorySchema;
  else if(/^\/network\/memories\/[^/]+$/.test(route))schema=method==='DELETE'?ok:NetworkMemorySchema;
  else if(route==='/network/conversations')schema=method==='GET'?NetworkInboxSchema:NetworkConversationSchema;
  else if(route.startsWith('/network/conversations/'))schema=NetworkConversationSchema;
  else if(route==='/network/calendar')schema=NetworkCalendarSchema;
  else if(/^\/network\/calendar\/[^/]+\/cancel$/.test(route))schema=NetworkEventSchema;
  else if(/^\/network\/reminders\/[^/]+\/dismiss$/.test(route))schema=NetworkReminderSchema;
  else if (route === '/demo/status') schema = z.object({ configured: z.boolean(), model: text, voice: text, startupUnconfirmed: z.boolean().optional() });
  else if (route.startsWith('/auth/')) schema = z.object({ token: text.max(4096).regex(/^\S+$/), user: z.object({ id: text, email: z.email() }) });
  else if (route === '/bootstrap') schema = bootstrap;
  else if (route === '/tools/access') schema=z.object({grant:z.object({id:text,ownerId:z.uuid(),version:z.literal(1),enabled:z.boolean(),tools:z.array(ApplicationToolNameSchema),updatedAt:z.iso.datetime()}),runtimeAvailable:z.boolean(),externalEffectsEnabled:z.literal(false)});
  else if (route === '/tools/traces') schema=z.object({events:z.array(ToolTraceSchema)});
  else if (route === '/profile') schema = profile;
  else if (route === '/voice/turn') schema = voiceReply;
  else if (route === '/voice/report') schema = voiceReport;
  else if (/^\/voice\/turns\/[^/]+$/.test(route)) schema = z.object({ status: z.enum(['processing', 'prepared', 'done', 'failed', 'expired', 'deleted']), missionId: text.optional(), response: voiceReply.optional() });
  else if (route === '/voice/live/session') schema = z.object({ session: z.object({ id: text }), transport: z.object({ type: z.literal('webrtc'), sdp: text }), maxDurationSeconds: z.number().int().positive() });
  else if (/^\/voice\/live\/requests\/[^/]+$/.test(route)) schema = z.object({requestId:z.uuid(),receiptId:text,status:z.enum(['creating','active','closing','closed','unconfirmed','rejected']),sessionId:text.optional(),expiresAt:z.number().finite()});
  else if (route==='/voice/live/recovery') schema=z.object({requests:z.array(z.object({requestId:z.uuid(),receiptId:text,status:z.enum(['creating','active','closing','closed','unconfirmed','rejected']),sessionId:text.optional(),expiresAt:z.number().finite()})).max(4)});
  else if (/^\/voice\/live\/session\/[^/]+\/close$/.test(route)) schema = z.object({ status: z.enum(['closing', 'closed', 'unconfirmed']) });
  else if (/^\/voice\/live\/session\/[^/]+$/.test(route)) schema = z.object({ sessionId: text, status: z.enum(['active', 'closing', 'closed', 'unconfirmed']), expiresAt: z.number().finite() });
  else if (route === '/integrations/google-calendar/connect') schema=method==='POST'?z.object({authorizationUrl:z.url().refine(value=>{try{const url=new URL(value);return url.origin==='https://accounts.google.com'&&url.pathname==='/o/oauth2/v2/auth';}catch{return false;}}),expiresAt:z.number().finite().positive()}):ok.extend({connection:googleConnection});
  else if (route === '/integrations/google-calendar') schema=method==='DELETE'?ok.extend({connection:googleConnection}):googleConnection;
  else if (route.startsWith('/integrations/') && method==='DELETE') schema=ok.extend({connection:googleConnection});
  else if (method === 'DELETE' || route === '/logout') schema = ok;
  else if (route === '/contacts' || route.startsWith('/contacts/')) schema = route === '/contacts' && method === 'GET' ? z.array(contact) : contact;
  else if (route === '/memories' || route.startsWith('/memories/')) schema = route === '/memories' && method === 'GET' ? z.array(memory) : memory;
  else if (route === '/missions') schema = method === 'GET' ? z.array(mission) : mission;
  else if (/^\/missions\/requests\/[^/]+$/.test(route)) schema=mission;
  else if (/^\/missions\/[^/]+$/.test(route)) schema = method === 'GET' ? detail : mission;
  else if (/^\/missions\/[^/]+\/(authorize|cancel)$/.test(route)) schema = mission;
  else if (route.endsWith('/actions/retry')) schema = z.object({ queued: z.number().int().nonnegative() });
  else if (route.endsWith('/intervene')) schema = z.union([mission, z.object({ accepted: z.literal(true), applied: z.boolean(), mode: text, message: z.string() })]);
  else if (route === '/settings/voice') schema = method === 'GET' ? z.object({ voices: z.array(voice), cloneEnrollment: z.object({ available: z.boolean(), reason: z.string() }), previewAvailable: z.boolean() }) : voice;
  else if (route === '/integrations') schema = z.array(googleConnection);
  else if (route === '/calendar') schema = z.array(z.object({ id: text, startAt: text, durationMinutes: z.number(), timezone: text }));
  else if (route === '/setup/readiness') schema = ReadinessSchema.extend({ ownerId: text });
  else if (route === '/export') schema = z.object({ exportedAt: text, profile: z.array(profile), contact: z.array(contact), memory: z.array(memory), mission: z.array(mission), attempt: z.array(AttemptSchema), action: z.array(FollowUpActionSchema), voice: z.array(voice), calendar: z.array(object), voice_session: z.array(object), voice_turn: z.array(object) });
  const parsed = schema.safeParse(payload);
  // Domain schemas default missing input fields. A wire response must actually
  // contain those fields; accepting defaults would hide an incomplete success.
  return parsed.success && containsDecodedFields(parsed.data, payload);
}
