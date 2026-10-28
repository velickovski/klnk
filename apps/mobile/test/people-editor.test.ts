import { describe, expect, it, vi } from 'vitest';
import type { Contact } from '@personal-agent/domain';
import { contactErrors, ContactEditorModel, createContactDraft, normalizePhone, peoplePage, PEOPLE_PAGE_SIZE } from '../src/features/people/model';

const contact: Contact = { id: 'fictional-contact-a', ownerId: 'fictional-owner-a', name: 'Zoë Example', phone: '+12025550101', relationship: 'Fictional colleague', language: 'en', context: 'Fictional fixture only', verified: true, optedOut: false };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(complete => { resolve = complete; }); return { promise, resolve }; }

describe('PEOPLE-01 contact validation and recipient boundaries', () => {
  it('validates fields individually and normalizes familiar phone punctuation', () => {
    expect(normalizePhone(' +1 (202) 555-0101 ')).toBe('+12025550101');
    expect(contactErrors({ ...createContactDraft(), name: ' ', phone: '020 2555', relationship: '' })).toEqual({ name: expect.any(String), phone: expect.any(String), relationship: expect.any(String) });
    expect(contactErrors({ ...createContactDraft(contact), phone: '+1 (202) 555-0101' })).toEqual({});
  });
  it.each(['', '12025550101', '+02025550101', '+1202', '+1234567890123456', '+12025550101 ext 9', 'call +12025550101'])('rejects invalid international phone %s', phone => {
    expect(contactErrors({ ...createContactDraft(contact), phone }).phone).toBeTruthy();
  });
  it('clears verification when the phone changes, including changing it back', () => {
    const model = new ContactEditorModel(contact);
    model.update('phone', '+12025550199'); expect(model.getSnapshot().draft.verified).toBe(false);
    model.update('phone', contact.phone); expect(model.getSnapshot().draft.verified).toBe(false);
    model.update('verified', true); expect(model.getSnapshot().draft.verified).toBe(true);
  });
  it('does not clear verification for punctuation changes to the same number', () => {
    const model = new ContactEditorModel(contact); model.update('phone', '+1 (202) 555-0101');
    expect(model.getSnapshot().draft.verified).toBe(true);
  });
  it('never removes an existing or newly refreshed recipient opt-out', async () => {
    const model = new ContactEditorModel({ ...contact, optedOut: true }), submit = vi.fn(async () => true);
    model.update('phone', '+12025550199'); model.update('verified', true); await model.save(submit);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ optedOut: true, verified: true }));
    model.retainOptOut({ ...contact, optedOut: false }); await model.save(submit);
    expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ optedOut: true }));
    const refreshed = new ContactEditorModel(contact); refreshed.retainOptOut({ ...contact, optedOut: true });
    await refreshed.save(submit); expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ optedOut: true }));
  });
  it('creates a partial contact without forwarding owner or record identifiers', async () => {
    const model = new ContactEditorModel(contact), submit = vi.fn(async (_value: Partial<Contact>) => true);
    model.update('name', ' Name with spaces '); model.update('relationship', ' Friend '); await model.save(submit);
    expect(submit).toHaveBeenCalledWith({ name: 'Name with spaces', phone: contact.phone, relationship: 'Friend', context: contact.context, language: 'en', verified: true, optedOut: false });
    expect(submit.mock.calls[0]?.[0]).not.toHaveProperty('ownerId');
  });
  it('creates a new unverified contact from explicit input with no inferred context', async () => {
    const model = new ContactEditorModel(), submit = vi.fn(async (_value: Partial<Contact>) => true);
    model.update('name', 'Fictional new person'); model.update('phone', '+12025550199'); model.update('relationship', 'Fictional supplier');
    expect(await model.save(submit)).toBe(true);
    expect(submit).toHaveBeenCalledWith({ name: 'Fictional new person', phone: '+12025550199', relationship: 'Fictional supplier', language: 'en', context: '', verified: false, optedOut: false });
  });
});

describe('PEOPLE-02 failed saves and modal operations', () => {
  it('does not submit invalid fields and clears only the edited field error', async () => {
    const model = new ContactEditorModel(), submit = vi.fn();
    expect(await model.save(submit)).toBe(false); expect(submit).not.toHaveBeenCalled();
    model.update('name', 'Fictional person');
    expect(model.getSnapshot().errors.name).toBeUndefined(); expect(model.getSnapshot().errors.phone).toBeTruthy();
  });
  it.each([false, 'throw'] as const)('preserves the complete draft on network/not-found save failure (%s)', async outcome => {
    const model = new ContactEditorModel(contact); model.update('context', 'Keep this unsaved context');
    const before = model.getSnapshot().draft;
    expect(await model.save(async () => { if (outcome === 'throw') throw new Error('Fictional relationship was removed.'); return false; })).toBe(false);
    expect(model.getSnapshot()).toMatchObject({ draft: before, busy: false, error: expect.any(String) });
    expect(model.getSnapshot().error.length).toBeGreaterThan(0);
  });
  it('locks edits while saving and suppresses duplicate save/delete operations', async () => {
    const model = new ContactEditorModel(contact), pending = deferred<boolean>(), submit = vi.fn(() => pending.promise), remove = vi.fn(async () => true);
    const saving = model.save(submit); model.update('name', 'Late name'); model.update('verified', false);
    expect(model.getSnapshot().draft.name).toBe(contact.name); expect(model.getSnapshot().draft.verified).toBe(true);
    expect(await model.save(submit)).toBe(false); expect(await model.remove(remove)).toBe(false);
    expect(submit).toHaveBeenCalledTimes(1); expect(remove).not.toHaveBeenCalled();
    pending.resolve(true); expect(await saving).toBe(true); expect(model.getSnapshot().busy).toBe(false);
  });
  it('retains failed deletion state and allows a later successful retry', async () => {
    const model = new ContactEditorModel(contact);
    expect(await model.remove(async () => false)).toBe(false); expect(model.getSnapshot().error).toContain('Deletion was not confirmed');
    expect(model.getSnapshot().draft).toEqual(createContactDraft(contact));
    expect(await model.remove(async () => true)).toBe(true); expect(model.getSnapshot().error).toBe('');
  });
  it('keeps separate modal/account fixture stores isolated', () => {
    const ownerA = new ContactEditorModel(contact); ownerA.update('name', 'Owner A private draft');
    const ownerB = new ContactEditorModel(); expect(ownerB.getSnapshot().draft.name).toBe('');
    expect(createContactDraft(contact).name).toBe(contact.name);
  });
});

describe('PEOPLE-02 bounded list and truthful search', () => {
  it('returns a genuine empty result without injecting sample contacts', () => {
    expect(peoplePage([], '')).toMatchObject({ contacts: [], total: 0, page: 0, pageCount: 1 });
  });
  it('searches accents, relationships and formatted phone numbers without mutating the fixture', () => {
    const contacts = [{ ...contact, id: 'z', name: 'Zoë Example' }, { ...contact, id: 'a', name: 'Alex Example', phone: '+12025550199' }];
    expect(peoplePage(contacts, ' zoe ').contacts.map(item => item.id)).toEqual(['z']);
    expect(peoplePage(contacts, 'COLLEAGUE').total).toBe(2);
    expect(peoplePage(contacts, '+1 (202) 555-0199').contacts.map(item => item.id)).toEqual(['a']);
    expect(peoplePage(contacts, 'No such person').total).toBe(0);
    expect(contacts[0]?.id).toBe('z');
  });
  it('paginates a 1,000-contact fixture into stable bounded pages and clamps stale indices', () => {
    const fixture = Array.from({ length: 1000 }, (_, index) => ({ ...contact, id: `fictional-${index}`, name: `Person ${String(index).padStart(4, '0')}` }));
    const first = peoplePage(fixture, ''), last = peoplePage(fixture, '', 999);
    expect(first).toMatchObject({ total: 1000, page: 0, pageCount: 20 }); expect(first.contacts).toHaveLength(PEOPLE_PAGE_SIZE);
    expect(last).toMatchObject({ page: 19, pageCount: 20 }); expect(last.contacts[49]?.name).toBe('Person 0999');
    expect(new Set([...first.contacts, ...last.contacts].map(item => item.id)).size).toBe(100);
    expect(peoplePage(fixture, 'Person 0999', 19)).toMatchObject({ total: 1, page: 0, pageCount: 1 });
  });
  it('keeps duplicate names as distinct records with deterministic ordering and searchable numbers', () => {
    const fixture = [{ ...contact, id: 'b', phone: '+12025550199' }, { ...contact, id: 'a' }];
    expect(peoplePage(fixture, 'Zoe').contacts.map(item => item.id)).toEqual(['a', 'b']);
    expect(peoplePage(fixture, '50199').contacts.map(item => item.id)).toEqual(['b']);
  });
});
