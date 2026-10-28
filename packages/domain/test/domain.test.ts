import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MissionSchema, DEMO_CONTACTS, DEMO_MEMORIES, MISSION_TEMPLATES, authorizeMission, selectContext, simulate, validateCommitment, validateGuidance, type Mission } from '../src/index.js';

function mission(kind = 'appointment'): Mission {
  const input = MISSION_TEMPLATES.find(t => t.id === kind)!.input;
  const m = MissionSchema.parse({ ...input, id: `test-${kind}`, ownerId: 'demo-owner', createdAt: '2026-10-26T12:00:00Z', updatedAt: '2026-10-26T12:00:00Z' });
  m.authorization = authorizeMission(m, DEMO_CONTACTS.find(c => c.id === m.contactId)!, '2026-10-26T12:00:00Z'); m.status = 'authorized';
  return m;
}
test('context retrieval excludes another relationship, private facts, claims, and other owners', () => {
  const extra = { ...DEMO_MEMORIES[0], id: 'other', ownerId: 'other-owner' };
  const context = selectContext('demo-owner', 'contact-shop', 'm', [...DEMO_MEMORIES, extra]);
  assert.deepEqual(context.map(m => m.id), []);
  assert(!JSON.stringify(context).includes('family matter'));
  assert.deepEqual(selectContext('demo-owner', 'contact-shop', 'm', DEMO_MEMORIES, '2026-10-26T12:00:00Z', ['memory-tone']).map(m => m.id), ['memory-tone']);
});
test('verified recipient, opt-out, and explicit appointment date are checked before authorization', () => {
  const m = mission(); const c = DEMO_CONTACTS[0];
  assert.throws(() => authorizeMission(m, { ...c, verified: false }), /Confirm/);
  assert.throws(() => authorizeMission(m, { ...c, optedOut: true }), /no further/);
  assert.throws(() => authorizeMission(m, { ...c, ownerId: 'other' }), /belong/);
  m.schedule.explicitTargetAt = undefined; assert.throws(() => authorizeMission(m, c), /explicit/);
});
test('authorization freezes authority and a preference cannot raise the spending ceiling', () => {
  const m = mission('refund'); m.boundaries.maxAmount = 500;
  assert.equal(validateCommitment(m, { type: 'amount', amount: 75 }).allowed, false);
  assert.equal(validateCommitment(m, { type: 'amount', amount: 0 }).allowed, true);
  assert.equal(validateCommitment(m, { type: 'alternative', value: 'store credit' }).allowed, false);
});
test('confirmed replacement carries evidence and updates only authorized existing event', () => {
  const r = simulate(mission());
  assert.equal(r.status, 'completed'); assert.equal(r.outcome.recipientAgreements.length, 1);
  assert.equal(r.outcome.actions[0].kind, 'calendar_update');
  assert.equal(r.outcome.actions[0].payload.eventId, 'demo-event-sink');
  assert(r.outcome.actions[0].prerequisiteEvidenceIds.every(id => r.transcript.some(t => t.id === id)));
});
test('different missions share the generic simulator and preserve outcome distinctions', () => {
  assert.equal(simulate(mission('late')).outcome.status, 'achieved');
  const info = simulate(mission('information')); assert.equal(info.outcome.actions.length, 0); assert.equal(info.outcome.recipientAgreements.length, 0); assert.equal(info.outcome.alternatives.length, 2);
  const refund = simulate(mission('refund')); assert.equal(refund.outcome.status, 'partial'); assert(refund.outcome.unresolved.includes('Refund not approved or paid.'));
  const custom = simulate(mission('custom')); assert.equal(custom.outcome.status, 'partial'); assert.equal(custom.outcome.recipientAgreements.length, 0);
});
test('cross-language evidence keeps original and translation distinguishable', () => {
  const r = simulate(mission('cross_language')); const translated = r.transcript.find(t => t.translation);
  assert(translated); assert.equal(translated.language, 'es'); assert.equal(translated.translatedLanguage, 'en'); assert.notEqual(translated.text, translated.translation);
  assert(r.transcript.every(t=>t.speaker==='system' || (t.language==='es' && !!t.translation)));
});
test('private requests and instruction overrides do not leak memory or create commitments', () => {
  const r = simulate(mission('personal'), 'injection');
  assert(!JSON.stringify(r).includes('family matter')); assert.equal(r.outcome.agentCommitments.length, 0); assert.equal(r.outcome.actions.length, 0);
});
test('counteroffer follows delegated fallback or awaits assisted decision without accepting', () => {
  const m = mission('refund'); const delegated = simulate(m, 'counteroffer'); assert.equal(delegated.status, 'unresolved');
  m.mode = 'assisted'; const assisted = simulate(m, 'counteroffer'); assert.equal(assisted.status, 'awaiting_owner'); assert.equal(assisted.outcome.agentCommitments.length, 0);
});
test('no answer, voicemail, wrong person, AI refusal, and dropped tentative agreement never become success', () => {
  for (const scenario of ['no_answer', 'busy', 'voicemail', 'wrong_person', 'refusal', 'dropped_uncertain'] as const) {
    const r = simulate(mission(), scenario); assert.notEqual(r.status, 'completed'); assert.equal(r.outcome.actions.length, 0); assert.equal(r.outcome.recipientAgreements.length, 0);
    if (scenario === 'wrong_person') assert(!r.transcript.some(t => t.text.includes('sink')));
  }
});
test('unsupported intervention is rejected and plain text cannot authorize new commitments', () => {
  const m = mission(); m.status = 'calling';
  assert.throws(() => validateGuidance(m, { kind: 'clarify', text: 'Please ask again' }, { typedIntervention: false }), /does not support/);
  assert.throws(() => validateGuidance(m, { kind: 'approve_alternative', text: 'Accept $75' }, { typedIntervention: true }), /authorization revision/);
  validateGuidance(m, { kind: 'tighten_boundary', text: 'Do not discuss fees' }, { typedIntervention: true });
});
test('conflicting disclosures and invalid calling windows are rejected before authorization', () => {
  const m = mission('personal'); const c = DEMO_CONTACTS.find(c => c.id === m.contactId)!;
  m.requiredTalkingPoints.push(m.boundaries.privateFacts[0]);
  assert.throws(() => authorizeMission(m, c, '2026-10-26T12:00:00Z'), /marked private/);
  m.requiredTalkingPoints.pop(); m.schedule.callingWindowStart = '2026-10-26T15:00:00Z'; m.schedule.callingWindowEnd = '2026-10-26T14:00:00Z';
  assert.throws(() => authorizeMission(m, c, '2026-10-26T12:00:00Z'), /end after/);
});
test('unconfirmed inferences and standing permissions are never promoted or retrieved as facts', () => {
  const claim = { ...DEMO_MEMORIES[0], id: 'inference', kind: 'inference' as const, confirmation: 'proposed' as const };
  const permission = { ...DEMO_MEMORIES[0], id: 'permission', kind: 'permission' as const };
  assert.deepEqual(selectContext('demo-owner', 'contact-shop', 'm', [claim, permission], '2026-10-26T12:00:00Z', ['inference', 'permission']), []);
  const r = simulate(mission('custom'));
  assert.equal(r.proposedMemories.length, 0); assert.equal(r.fixture.synthetic, true);
});
