import type { Contact, Memory } from '@personal-agent/domain';

export type MemoryFilter = 'all' | 'review' | 'private' | 'expired';
export const MEMORY_PAGE_SIZE = 50;
export type MemoryDraft = Pick<Memory, 'text' | 'kind' | 'scope' | 'disclosure' | 'confirmation'> & { contactId: string };
export type MemoryErrors = Partial<Record<'text' | 'contactId' | 'scope', string>>;
type State = Readonly<{ draft: MemoryDraft; errors: MemoryErrors; error: string; busy: boolean }>;

export function expiryState(memory: Pick<Memory, 'expiresAt'>, now = Date.now()): 'none' | 'active' | 'expired' | 'invalid' {
  if (!memory.expiresAt) return 'none';
  const expiry = Date.parse(memory.expiresAt);
  return !Number.isFinite(expiry) ? 'invalid' : expiry <= now ? 'expired' : 'active';
}
export const confirmationLabel = { confirmed: 'Confirmed', unconfirmed: 'Unconfirmed', proposed: 'Proposed', conflicting: 'Conflicting' };
export const disclosureLabel = { allowed: 'May be shared in scope', private: 'Private', ask: 'Ask before sharing' };
export const sourceLabel = { owner: 'Owner source', recipient: 'Recipient report', model: 'Model suggestion', integration: 'Integration source' };
export function memoryScope(memory: Memory, contacts: Contact[]) {
  if (memory.scope === 'relationship') return contacts.find(contact => contact.id === memory.contactId)?.name ?? 'Removed relationship';
  return memory.scope === 'mission' ? 'Linked request only' : 'Owner context · selected requests only';
}
export function memoryEligibility(memory: Memory, contacts: Contact[], now = Date.now()) {
  if (memory.kind === 'permission') return 'Recorded permission does not authorize a request and is excluded from call context.';
  if (expiryState(memory, now) === 'expired') return 'Expired · excluded from new call context.';
  if (expiryState(memory, now) === 'invalid') return 'Expiry is invalid · excluded from new call context.';
  if (memory.confirmation !== 'confirmed') return 'Needs review · excluded from new call context.';
  if (memory.disclosure === 'private') return 'Private · excluded from new call context.';
  if (memory.disclosure === 'ask') return 'Ask first · excluded until sharing is explicitly allowed.';
  if (memory.scope === 'relationship' && !contacts.some(contact => contact.id === memory.contactId)) return 'Relationship removed · choose a current relationship before using this for a new request.';
  return memory.scope === 'owner' ? 'Eligible only when selected for a request.' : memory.scope === 'relationship' ? 'Eligible only for this relationship.' : 'Eligible only for its linked request.';
}
function searchText(value: string) { return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim(); }
export function memoryPage(memories: Memory[], query: string, filter: MemoryFilter, requestedPage = 0, now = Date.now()) {
  const needle = searchText(query);
  const filtered = memories.filter(memory => (filter === 'all' || filter === 'review' && memory.confirmation !== 'confirmed' || filter === 'private' && memory.disclosure === 'private' || filter === 'expired' && expiryState(memory, now) === 'expired') && (!needle || searchText(`${memory.text} ${memory.kind} ${memory.source.reference}`).includes(needle)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const pageCount = Math.max(1, Math.ceil(filtered.length / MEMORY_PAGE_SIZE));
  const page = Math.max(0, Math.min(Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0, pageCount - 1));
  return { memories: filtered.slice(page * MEMORY_PAGE_SIZE, (page + 1) * MEMORY_PAGE_SIZE), total: filtered.length, page, pageCount };
}
export function createMemoryDraft(memory?: Memory): MemoryDraft {
  return { text: memory?.text ?? '', kind: memory?.kind ?? 'fact', scope: memory?.scope ?? 'owner', contactId: memory?.contactId ?? '', disclosure: memory?.disclosure ?? 'private', confirmation: memory?.confirmation ?? 'confirmed' };
}
export function memoryErrors(draft: MemoryDraft, contacts: Contact[], missionIds: string[], existing?: Memory): MemoryErrors {
  const errors: MemoryErrors = {};
  if (!draft.text.trim()) errors.text = 'Enter the memory you want to keep.';
  if (draft.scope === 'relationship' && !contacts.some(contact => contact.id === draft.contactId)) errors.contactId = 'Choose a current relationship. A removed relationship cannot be used for this save.';
  if (draft.scope === 'mission' && (!existing?.missionId || !missionIds.includes(existing.missionId))) errors.scope = 'The linked request is unavailable. Choose owner context or a current relationship.';
  return errors;
}

/** One owner-scoped modal draft. Pending writes lock input instead of losing late edits. */
export class MemoryEditorModel {
  private state: State;
  private listeners = new Set<() => void>();
  constructor(private memory?: Memory) { this.state = { draft: createMemoryDraft(memory), errors: {}, error: '', busy: false }; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: Partial<State>) { this.state = { ...this.state, ...next }; this.listeners.forEach(listener => listener()); }
  update<K extends keyof MemoryDraft>(field: K, value: MemoryDraft[K]) {
    if (!this.state.busy) this.publish({ draft: { ...this.state.draft, [field]: value }, errors: { ...this.state.errors, [field]: undefined }, error: '' });
  }
  async save(submit: (value: Partial<Memory>) => Promise<boolean>, contacts: Contact[], missionIds: string[]) {
    if (this.state.busy) return false;
    const errors = memoryErrors(this.state.draft, contacts, missionIds, this.memory);
    if (Object.keys(errors).length) { this.publish({ errors, error: '' }); return false; }
    const { contactId, ...draft } = this.state.draft;
    const payload: Partial<Memory> = { ...draft, text: draft.text.trim(), ...(draft.scope === 'relationship' ? { contactId } : {}), ...(draft.scope === 'mission' ? { missionId: this.memory?.missionId } : {}), source: this.memory?.source ?? { type: 'owner', reference: 'Owner-entered memory' }, ...(this.memory?.expiresAt !== undefined ? { expiresAt: this.memory.expiresAt } : {}) };
    this.publish({ busy: true, errors: {}, error: '' });
    try { const accepted = await submit(payload); this.publish({ busy: false, error: accepted ? '' : 'Saving this memory was not confirmed. Your edits are still here. Check the connection and try again.' }); return accepted; }
    catch (error) { this.publish({ busy: false, error: error instanceof Error ? error.message : 'This memory could not be saved. Your edits are still here.' }); return false; }
  }
  async remove(remove: () => Promise<boolean>) {
    if (this.state.busy) return false;
    this.publish({ busy: true, error: '' });
    try { const accepted = await remove(); this.publish({ busy: false, error: accepted ? '' : 'Deletion was not confirmed. This editor is still available; refresh the list before retrying.' }); return accepted; }
    catch (error) { this.publish({ busy: false, error: error instanceof Error ? error.message : 'This memory could not be deleted.' }); return false; }
  }
}
