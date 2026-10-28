import type { Contact } from '@personal-agent/domain';

export const PEOPLE_PAGE_SIZE = 50;
export type ContactDraft = Pick<
  Contact,
  'name' | 'phone' | 'relationship' | 'context' | 'language' | 'verified'
>;
export type ContactErrors = Partial<Record<'name' | 'phone' | 'relationship', string>>;
type State = Readonly<{
  draft: ContactDraft;
  errors: ContactErrors;
  error: string;
  busy: boolean;
  optedOut: boolean;
}>;

export function normalizePhone(value: string) {
  return value.trim().replace(/[\s().-]/g, '');
}
export function createContactDraft(contact?: Contact): ContactDraft {
  return {
    name: contact?.name ?? '',
    phone: contact?.phone ?? '',
    relationship: contact?.relationship ?? '',
    context: contact?.context ?? '',
    language: contact?.language ?? 'en',
    verified: contact?.verified ?? false,
  };
}
export function contactErrors(draft: ContactDraft): ContactErrors {
  const errors: ContactErrors = {};
  if (!draft.name.trim()) errors.name = 'Enter the person or business name.';
  if (!/^\+[1-9]\d{7,14}$/.test(normalizePhone(draft.phone)))
    errors.phone =
      'Enter an international number with +, country code and 8–15 digits, such as +12025550101. Extensions are not supported.';
  if (!draft.relationship.trim())
    errors.relationship = 'Describe your relationship, such as friend or supplier.';
  return errors;
}
function searchable(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();
}
export function peoplePage(contacts: Contact[], query: string, requestedPage = 0) {
  const needle = searchable(query),
    digits = normalizePhone(query);
  const filtered = contacts
    .filter(
      (contact) =>
        !needle ||
        searchable(`${contact.name} ${contact.relationship}`).includes(needle) ||
        (digits.length > 0 && normalizePhone(contact.phone).includes(digits)),
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PEOPLE_PAGE_SIZE));
  const page = Math.max(
    0,
    Math.min(Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0, pageCount - 1),
  );
  return {
    contacts: filtered.slice(page * PEOPLE_PAGE_SIZE, (page + 1) * PEOPLE_PAGE_SIZE),
    total: filtered.length,
    page,
    pageCount,
  };
}

/** One modal's draft. Editing is locked while its accepted operation is pending. */
export class ContactEditorModel {
  private state: State;
  private listeners = new Set<() => void>();
  constructor(contact?: Contact) {
    this.state = {
      draft: createContactDraft(contact),
      errors: {},
      error: '',
      busy: false,
      optedOut: contact?.optedOut ?? false,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(next: Partial<State>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }
  update<K extends keyof ContactDraft>(field: K, value: ContactDraft[K]) {
    if (this.state.busy) return;
    const changedNumber =
      field === 'phone' && normalizePhone(String(value)) !== normalizePhone(this.state.draft.phone);
    this.publish({
      draft: { ...this.state.draft, [field]: value, ...(changedNumber ? { verified: false } : {}) },
      errors: { ...this.state.errors, [field]: undefined },
      error: '',
    });
  }
  retainOptOut(contact?: Contact) {
    if (contact?.optedOut && !this.state.optedOut) this.publish({ optedOut: true });
  }
  async save(submit: (value: Partial<Contact>) => Promise<boolean>) {
    if (this.state.busy) return false;
    const errors = contactErrors(this.state.draft);
    if (Object.keys(errors).length) {
      this.publish({ errors, error: '' });
      return false;
    }
    const draft = this.state.draft;
    this.publish({ busy: true, errors: {}, error: '' });
    try {
      const accepted = await submit({
        ...draft,
        name: draft.name.trim(),
        phone: normalizePhone(draft.phone),
        relationship: draft.relationship.trim(),
        optedOut: this.state.optedOut,
      });
      this.publish({
        busy: false,
        error: accepted
          ? ''
          : 'Saving this relationship was not confirmed. Your edits are still here. Check the connection and try again.',
      });
      return accepted;
    } catch (error) {
      this.publish({
        busy: false,
        error:
          error instanceof Error
            ? error.message
            : 'This relationship could not be saved. Your edits are still here.',
      });
      return false;
    }
  }
  async remove(remove: () => Promise<boolean>) {
    if (this.state.busy) return false;
    this.publish({ busy: true, error: '' });
    try {
      const accepted = await remove();
      this.publish({
        busy: false,
        error: accepted
          ? ''
          : 'Deletion was not confirmed. This editor is still available; refresh the list before retrying.',
      });
      return accepted;
    } catch (error) {
      this.publish({
        busy: false,
        error: error instanceof Error ? error.message : 'This relationship could not be deleted.',
      });
      return false;
    }
  }
}
