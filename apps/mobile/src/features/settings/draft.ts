import type { Profile } from '@personal-agent/domain';

const fields = [
  'name',
  'language',
  'timezone',
  'tone',
  'pronunciation',
  'onboardingComplete',
] as const;
type Field = (typeof fields)[number];
export type ProfileErrors = Partial<Record<'name' | 'timezone', string>>;
export type SettingsDraftState = Readonly<{
  profile: Profile;
  dirty: boolean;
  saving: boolean;
  errors: ProfileErrors;
  error: string;
  message: string;
}>;

export function profileErrors(profile: Profile): ProfileErrors {
  const errors: ProfileErrors = {};
  if (!profile.name.trim()) errors.name = 'Enter the name your agent should use.';
  try {
    if (!profile.timezone.trim()) throw new Error('Missing timezone');
    new Intl.DateTimeFormat('en', { timeZone: profile.timezone.trim() });
  } catch {
    errors.timezone = 'Enter an IANA timezone, such as Europe/Skopje or America/New_York.';
  }
  return errors;
}

/** Memory only. Its provider lives inside the authenticated owner/backend shell. */
export class SettingsDraftStore {
  private saved: Profile;
  private state: SettingsDraftState;
  private lifetime = 0;
  private refreshRevision = 0;
  private listeners = new Set<() => void>();
  constructor(profile: Profile) {
    this.saved = { ...profile };
    this.state = {
      profile: { ...profile },
      dirty: false,
      saving: false,
      errors: {},
      error: '',
      message: '',
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(next: Partial<SettingsDraftState>) {
    const profile = next.profile ?? this.state.profile;
    this.state = {
      ...this.state,
      ...next,
      profile,
      dirty: fields.some((field) => profile[field] !== this.saved[field]),
    };
    this.listeners.forEach((listener) => listener());
  }
  update<K extends Field>(field: K, value: Profile[K]) {
    this.publish({
      profile: { ...this.state.profile, [field]: value },
      errors: { ...this.state.errors, [field]: undefined },
      error: '',
      message: '',
    });
  }
  reconcile(profile: Profile) {
    this.refreshRevision++;
    if (profile.id !== this.saved.id) {
      this.lifetime++;
      this.saved = { ...profile };
      this.publish({ profile: { ...profile }, saving: false, errors: {}, error: '', message: '' });
      return;
    }
    const merged = { ...profile };
    for (const field of fields) {
      // A refresh updates untouched fields, while locally edited values survive.
      if (this.state.profile[field] !== this.saved[field])
        Object.assign(merged, { [field]: this.state.profile[field] });
    }
    this.saved = { ...profile };
    this.publish({ profile: merged });
  }
  discard() {
    if (!this.state.saving)
      this.publish({ profile: { ...this.saved }, errors: {}, error: '', message: '' });
  }
  async save(submit: (profile: Profile) => Promise<boolean>, completeSetup = false) {
    if (this.state.saving) return false;
    const initialDraft = this.state.profile;
    const submitted = {
      ...initialDraft,
      name: initialDraft.name.trim(),
      timezone: initialDraft.timezone.trim(),
      ...(completeSetup ? { onboardingComplete: true } : {}),
    };
    const errors = profileErrors(submitted);
    if (Object.keys(errors).length) {
      this.publish({ errors, error: '', message: '' });
      return false;
    }
    const lifetime = this.lifetime;
    const refreshRevision = this.refreshRevision;
    this.publish({ saving: true, errors: {}, error: '', message: '' });
    try {
      const accepted = await submit(submitted);
      if (lifetime !== this.lifetime) return false;
      if (!accepted) {
        this.publish({
          saving: false,
          error:
            'Saving preferences was not confirmed. Your edits are still here; check the connection and refresh before trying again.',
        });
        return false;
      }
      const acknowledged = refreshRevision === this.refreshRevision ? submitted : this.saved;
      const merged = { ...this.state.profile };
      for (const field of fields) {
        // The user may keep typing while the save/refetch is in flight.
        if (
          this.state.profile[field] === initialDraft[field] ||
          this.state.profile[field] === submitted[field]
        )
          Object.assign(merged, { [field]: acknowledged[field] });
      }
      this.saved = { ...acknowledged };
      this.publish({ profile: merged, saving: false, message: 'Preferences saved.', error: '' });
      return true;
    } catch (error) {
      if (lifetime === this.lifetime)
        this.publish({
          saving: false,
          error:
            error instanceof Error
              ? error.message
              : 'Preferences could not be saved. Your edits are still here.',
        });
      return false;
    }
  }
}
