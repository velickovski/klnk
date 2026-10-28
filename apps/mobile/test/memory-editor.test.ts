import { describe, expect, it, vi } from 'vitest';
import type { Contact, Memory } from '@personal-agent/domain';
import { createMemoryDraft, expiryState, memoryEligibility, MemoryEditorModel, memoryErrors, memoryPage, memoryScope } from '../src/features/memory/model';

const now = Date.parse('2026-10-27T12:00:00Z');
const contact: Contact = { id: 'fictional-person', ownerId: 'fictional-owner', name: 'Fictional Person', phone: '+12025550101', relationship: 'Fictional colleague', language: 'en', context: '', verified: true, optedOut: false };
const memory: Memory = { id: 'fictional-memory', ownerId: contact.ownerId, kind: 'fact', text: 'Fictional café preference', source: { type: 'recipient', reference: 'Fictional recipient report' }, createdAt: '2026-10-26T12:00:00Z', updatedAt: '2026-10-27T10:00:00Z', scope: 'owner', disclosure: 'private', confirmation: 'unconfirmed', expiresAt: '2026-10-28T12:00:00Z' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(complete => { resolve = complete; }); return { promise, resolve }; }

describe('MEMORY-01 source, scope, disclosure and expiry presentation', () => {
  it('keeps source, confirmation and private state distinct instead of declaring a fact', () => {
    expect(createMemoryDraft(memory)).toMatchObject({ kind: 'fact', confirmation: 'unconfirmed', disclosure: 'private' });
    expect(memoryEligibility(memory, [], now)).toContain('Needs review');
    expect(memoryScope(memory, [])).toBe('Owner context · selected requests only');
  });
  it.each(['proposed', 'unconfirmed', 'conflicting'] as const)('shows %s content as excluded from new call context', confirmation => {
    expect(memoryEligibility({ ...memory, confirmation, disclosure: 'allowed' }, [], now)).toContain('Needs review');
  });
  it('describes private, ask-first, selected-owner and scoped relationship states separately', () => {
    const confirmed = { ...memory, confirmation: 'confirmed' as const };
    expect(memoryEligibility(confirmed, [], now)).toContain('Private');
    expect(memoryEligibility({ ...confirmed, disclosure: 'ask' }, [], now)).toContain('Ask first');
    expect(memoryEligibility({ ...confirmed, disclosure: 'allowed' }, [], now)).toBe('Eligible only when selected for a request.');
    expect(memoryEligibility({ ...confirmed, disclosure: 'allowed', scope: 'relationship', contactId: contact.id }, [contact], now)).toBe('Eligible only for this relationship.');
  });
  it('distinguishes absent, valid, expired, exact-boundary and invalid expiry', () => {
    expect(expiryState({})).toBe('none'); expect(expiryState(memory, now)).toBe('active');
    expect(expiryState({ expiresAt: '2026-10-26T12:00:00Z' }, now)).toBe('expired');
    expect(expiryState({ expiresAt: new Date(now).toISOString() }, now)).toBe('expired');
    expect(expiryState({ expiresAt: 'invalid-date' }, now)).toBe('invalid');
    expect(memoryEligibility({ ...memory, expiresAt: 'invalid-date' }, [], now)).toContain('Expiry is invalid');
  });
  it('never presents a permission memory as execution authority even when confirmed and allowed', () => {
    expect(memoryEligibility({ ...memory, kind: 'permission', confirmation: 'confirmed', disclosure: 'allowed' }, [], now)).toContain('does not authorize');
  });
  it('makes removed relationship references visible and requires a current selection', () => {
    const removed = { ...memory, scope: 'relationship' as const, contactId: 'removed', confirmation: 'confirmed' as const, disclosure: 'allowed' as const };
    expect(memoryScope(removed, [contact])).toBe('Removed relationship');
    expect(memoryEligibility(removed, [contact], now)).toContain('Relationship removed');
    expect(memoryErrors(createMemoryDraft(removed), [contact], []).contactId).toBeTruthy();
  });
});

describe('MEMORY-02 draft lifecycle and validated save', () => {
  it('starts new owner-entered memory as private without auto-selecting a relationship', async () => {
    const model = new MemoryEditorModel(), submit = vi.fn(async (_value: Partial<Memory>) => true);
    expect(model.getSnapshot().draft).toMatchObject({ disclosure: 'private', contactId: '' });
    model.update('text', '  Fictional owner note  '); expect(await model.save(submit, [contact], [])).toBe(true);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ text: 'Fictional owner note', source: { type: 'owner', reference: 'Owner-entered memory' }, disclosure: 'private' }));
    expect(submit.mock.calls[0]?.[0]).not.toHaveProperty('ownerId');
  });
  it('does not submit blank text or unavailable scope references', async () => {
    const model = new MemoryEditorModel(), submit = vi.fn();
    model.update('scope', 'relationship'); expect(await model.save(submit, [contact], [])).toBe(false);
    expect(model.getSnapshot().errors).toMatchObject({ text: expect.any(String), contactId: expect.any(String) }); expect(submit).not.toHaveBeenCalled();
    model.update('text', 'Explicit note'); model.update('contactId', contact.id);
    expect(model.getSnapshot().errors.text).toBeUndefined();
    expect(await model.save(submit.mockResolvedValue(true), [contact], [])).toBe(true);
  });
  it('rejects a missing or removed linked request rather than silently broadening scope', () => {
    const linked = { ...memory, scope: 'mission' as const, missionId: 'removed-mission' };
    expect(memoryErrors(createMemoryDraft(linked), [], [], linked).scope).toBeTruthy();
    expect(memoryErrors(createMemoryDraft(linked), [], ['removed-mission'], linked)).toEqual({});
  });
  it('preserves original source/expiry in the editor payload and never forwards owner identity', async () => {
    const model = new MemoryEditorModel(memory), submit = vi.fn(async (_value: Partial<Memory>) => true);
    model.update('text', 'Owner edits the claim'); await model.save(submit, [], []);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ source: memory.source, expiresAt: memory.expiresAt }));
    expect(submit.mock.calls[0]?.[0]).not.toHaveProperty('id'); expect(submit.mock.calls[0]?.[0]).not.toHaveProperty('ownerId');
  });
  it.each([false, 'throw'] as const)('retains all draft choices after a failed save (%s)', async outcome => {
    const model = new MemoryEditorModel(memory); model.update('text', 'Keep private draft'); model.update('confirmation', 'conflicting');
    const before = model.getSnapshot().draft;
    expect(await model.save(async () => { if (outcome === 'throw') throw new Error('Fictional offline fixture'); return false; }, [], [])).toBe(false);
    expect(model.getSnapshot()).toMatchObject({ draft: before, error: expect.any(String), busy: false });
    expect(model.getSnapshot().error.length).toBeGreaterThan(0);
  });
  it('locks late edits and suppresses duplicate save/delete while a write is pending', async () => {
    const model = new MemoryEditorModel(memory), pending = deferred<boolean>(), submit = vi.fn(() => pending.promise), remove = vi.fn(async () => true);
    const saving = model.save(submit, [], []); model.update('text', 'Should not replace in-flight input'); model.update('disclosure', 'allowed');
    expect(model.getSnapshot().draft).toEqual(createMemoryDraft(memory));
    expect(await model.save(submit, [], [])).toBe(false); expect(await model.remove(remove)).toBe(false);
    expect(submit).toHaveBeenCalledTimes(1); expect(remove).not.toHaveBeenCalled();
    pending.resolve(true); expect(await saving).toBe(true); expect(model.getSnapshot().busy).toBe(false);
  });
  it('preserves failed deletion state and permits a subsequent explicit retry', async () => {
    const model = new MemoryEditorModel(memory);
    expect(await model.remove(async () => false)).toBe(false); expect(model.getSnapshot().error).toContain('Deletion was not confirmed');
    expect(model.getSnapshot().draft.text).toBe(memory.text);
    expect(await model.remove(async () => true)).toBe(true); expect(model.getSnapshot().error).toBe('');
  });
  it('does not share modal drafts between owner/account lifetimes', () => {
    const old = new MemoryEditorModel(memory); old.update('text', 'Owner A private edit');
    const next = new MemoryEditorModel(); expect(next.getSnapshot().draft.text).toBe('');
  });
});

describe('MEMORY-02 bounded filtering', () => {
  it('returns truly empty memory collections without samples', () => {
    expect(memoryPage([], '', 'all', 0, now)).toMatchObject({ memories: [], total: 0, pageCount: 1 });
  });
  it('filters all, review, private and expired independently and searches source/kind/text', () => {
    const confirmed = { ...memory, id: 'confirmed', confirmation: 'confirmed' as const, disclosure: 'allowed' as const };
    const expired = { ...confirmed, id: 'expired', expiresAt: '2026-10-26T00:00:00Z' };
    const list = [memory, confirmed, expired];
    expect(memoryPage(list, '', 'all', 0, now).total).toBe(3);
    expect(memoryPage(list, '', 'review', 0, now).memories.map(item => item.id)).toEqual([memory.id]);
    expect(memoryPage(list, '', 'private', 0, now).memories.map(item => item.id)).toEqual([memory.id]);
    expect(memoryPage(list, '', 'expired', 0, now).memories.map(item => item.id)).toEqual(['expired']);
    expect(memoryPage(list, 'cafe', 'all', 0, now).total).toBe(3);
    expect(memoryPage(list, 'recipient report', 'all', 0, now).total).toBe(3);
    expect(memoryPage(list, 'No such memory', 'all', 0, now).total).toBe(0);
  });
  it('bounds a 1,000-memory fixture to 50 stable rows and clamps stale pages after filters', () => {
    const fixture = Array.from({ length: 1000 }, (_, index) => ({ ...memory, id: `fictional-${String(index).padStart(4, '0')}`, text: `Fictional memory ${String(index).padStart(4, '0')}` }));
    expect(memoryPage(fixture, '', 'all', 0, now)).toMatchObject({ total: 1000, page: 0, pageCount: 20 });
    expect(memoryPage(fixture, '', 'all', 0, now).memories).toHaveLength(50);
    expect(memoryPage(fixture, '', 'all', 999, now).page).toBe(19);
    expect(memoryPage(fixture, '0999', 'all', 19, now)).toMatchObject({ total: 1, page: 0, pageCount: 1 });
    expect(fixture[0]?.id).toBe('fictional-0000');
  });
});
