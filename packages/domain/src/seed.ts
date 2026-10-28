import { MissionInputSchema, type Profile, type Contact, type Memory, type MissionInput } from './core.js';

const at = '2026-10-26T12:00:00.000Z';
export const DEMO_PROFILE: Profile = { id: 'demo-owner', name: 'Alex Morgan', language: 'en', timezone: 'America/New_York', tone: 'Warm, clear, and concise', pronunciation: '', onboardingComplete: false };
export const DEMO_CONTACTS: Contact[] = [
  { id: 'contact-plumber', ownerId: 'demo-owner', name: 'Sam Rivera', phone: '+12025550101', relationship: 'Plumber', language: 'en', verified: true, context: 'Sink repair booked; keep original until replacement is confirmed.', optedOut: false },
  { id: 'contact-friend', ownerId: 'demo-owner', name: 'Jordan Lee', phone: '+12025550102', relationship: 'Friend', language: 'en', verified: true, context: 'Coffee plans and invitations.', optedOut: false },
  { id: 'contact-shop', ownerId: 'demo-owner', name: 'Cedar Repair', phone: '+12025550103', relationship: 'Repair shop', language: 'en', verified: true, context: 'Ask for inspection options; do not authorize repairs.', optedOut: false },
  { id: 'contact-order', ownerId: 'demo-owner', name: 'Northline Orders', phone: '+12025550104', relationship: 'Retailer', language: 'en', verified: true, context: 'Order DEMO-104 arrived damaged.', optedOut: false },
  { id: 'contact-supplier', ownerId: 'demo-owner', name: 'Luz Supplies', phone: '+12025550105', relationship: 'Supplier', language: 'es', verified: true, context: 'Promised a status update.', optedOut: false },
];
export const DEMO_MEMORIES: Memory[] = [
  { id: 'memory-tone', ownerId: 'demo-owner', kind: 'preference', text: 'Keep apologies brief and be clear about the request.', source: { type: 'owner', reference: 'Text onboarding' }, createdAt: at, updatedAt: at, scope: 'owner', confirmation: 'confirmed', disclosure: 'allowed' },
  { id: 'memory-plumber', ownerId: 'demo-owner', kind: 'appointment', text: 'Sink repair booked with Sam; retain the original booking until a replacement is confirmed.', source: { type: 'owner', reference: 'Owner-entered booking detail' }, createdAt: at, updatedAt: at, scope: 'relationship', contactId: 'contact-plumber', confirmation: 'confirmed', disclosure: 'allowed' },
  { id: 'memory-private', ownerId: 'demo-owner', kind: 'fact', text: 'The private reason for declining is a family matter.', source: { type: 'owner', reference: 'Private relationship note' }, createdAt: at, updatedAt: at, scope: 'relationship', contactId: 'contact-friend', confirmation: 'confirmed', disclosure: 'private' },
  { id: 'memory-claim', ownerId: 'demo-owner', kind: 'claim', text: 'Supplier expects inspection to finish Friday; not confirmed.', source: { type: 'recipient', reference: 'Previous demo conversation' }, createdAt: at, updatedAt: at, scope: 'relationship', contactId: 'contact-supplier', confirmation: 'unconfirmed', disclosure: 'ask' },
];

export type MissionTemplate = { id: string; title: string; description: string; icon: string; input: MissionInput };
const template = (id: string, title: string, description: string, icon: string, input: unknown): MissionTemplate => ({ id, title, description, icon, input: MissionInputSchema.parse(input) });
export const MISSION_TEMPLATES: MissionTemplate[] = [
  template('appointment', 'Move an appointment', 'Confirm a replacement before releasing the original.', 'calendar', {
    kind: 'appointment', title: 'Move the sink repair', contactId: 'contact-plumber', goal: 'Move our sink-repair appointment to October 27, 2026 at 13:00 America/New_York. Keep the original booking unless the replacement is confirmed. Ask about any extra fee.',
    successCriteria: ['Explicit replacement confirmation', 'No extra fee accepted'], requiredTalkingPoints: ['Could we move the sink repair to October 27 at 1 PM Eastern? Please keep the original unless you confirm the replacement. Is there an additional fee?'],
    boundaries: { nonNegotiable: ['Keep original booking until replacement confirmed', 'Ask owner about any additional fee'], maxAmount: 0 }, schedule: { timezone: 'America/New_York', explicitTargetAt: '2026-10-27T13:00:00-04:00' },
    followUpActions: [{ id: 'calendar-demo-repair', kind: 'calendar_update', description: 'Update the existing sink-repair calendar event after confirmation.', authorized: true, payload: { eventId: 'demo-event-sink', startAt: '2026-10-27T13:00:00-04:00', durationMinutes: 60, timezone: 'America/New_York' } }],
  }),
  template('late', 'Let someone know', 'Deliver a message and bring back their response.', 'message', {
    kind: 'late', title: 'Running fifteen minutes late', contactId: 'contact-friend', goal: 'Tell Jordan I will be fifteen minutes late, apologize briefly, and ask whether they can still meet.',
    requiredTalkingPoints: ['Alex is running about fifteen minutes late and is sorry for the delay. Can you still meet?'], successCriteria: ['Message delivered', 'Recipient response collected'],
  }),
  template('information', 'Gather information', 'Ask questions without booking or spending.', 'search', {
    kind: 'information', title: 'Ask about the repair', contactId: 'contact-shop', goal: 'Ask Cedar Repair about inspection availability and price for a sink that drains slowly. Collect options without booking or authorizing work.',
    requiredTalkingPoints: ['The sink drains slowly. What inspection slots are available, and what is the inspection price? I am collecting options only.'], boundaries: { nonNegotiable: ['Do not book', 'Do not authorize work'], maxAmount: 0 },
  }),
  template('refund', 'Request a refund', 'Negotiate within clear boundaries.', 'return', {
    kind: 'refund', title: 'Request an order refund', contactId: 'contact-order', goal: 'Explain that order DEMO-104 arrived damaged and ask for a refund. Do not accept store credit or a new charge.',
    requiredTalkingPoints: ['Order DEMO-104 arrived damaged. What remedy can you offer? Alex requests a refund.'], boundaries: { nonNegotiable: ['No store credit', 'No new charge'], maxAmount: 0 },
  }),
  template('personal', 'A personal message', 'Say what matters while keeping private facts private.', 'heart', {
    kind: 'personal', title: 'Politely decline an invitation', contactId: 'contact-friend', goal: 'Politely decline Jordan’s invitation and tell me their response. Keep the private reason confidential.',
    requiredTalkingPoints: ['Thank you for inviting Alex. Alex cannot make it this time and hopes you have a lovely evening.'], boundaries: { privateFacts: ['The private reason for declining is a family matter.'], nonNegotiable: ['Do not disclose the private reason'] },
  }),
  template('follow_up', 'Follow up on a promise', 'Get a concrete status and expected update.', 'clock', {
    kind: 'follow_up', title: 'Check the supplier update', contactId: 'contact-supplier', goal: 'Ask for the promised supplier update, get a concrete status and expected date, and create a reminder if unresolved.', recipientLanguage: 'en',
    requiredTalkingPoints: ['Could you share the concrete status of the item and the expected date of the next update?'],
    followUpActions: [{ id: 'reminder-supplier', kind: 'reminder', description: 'Follow up if the supplier update has not arrived.', authorized: true, payload: { dueAt: '2026-10-30T17:00:00-04:00' } }],
  }),
  template('cross_language', 'Across languages', 'Brief in English; converse in Spanish.', 'language', {
    kind: 'cross_language', title: 'Ask in Spanish', contactId: 'contact-supplier', goal: 'Ask in Spanish about inspection availability and price, then return the original response with an English translation. Do not book.',
    ownerLanguage: 'en', recipientLanguage: 'es', requiredTalkingPoints: ['¿Cuándo pueden revisar el problema y cuánto cuesta la inspección? Solo estoy recopilando información.'], boundaries: { nonNegotiable: ['Do not book'], maxAmount: 0 },
  }),
  template('custom', 'Your own conversation', 'A goal, your context, and your boundaries.', 'spark', {
    kind: 'custom', title: 'A custom conversation', contactId: 'contact-friend', goal: 'Present my request and bring back the recipient’s response without making any additional commitment.',
    requiredTalkingPoints: ['Alex would like to discuss a request. Could you review it and respond?'], boundaries: { nonNegotiable: ['Do not make a new commitment'] },
  }),
];
export const DEMO_MISSIONS: MissionInput[] = MISSION_TEMPLATES.map(t => t.input);
