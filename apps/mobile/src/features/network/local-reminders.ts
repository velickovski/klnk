import type { NetworkEvent, NetworkPreferences, NetworkReminder } from '@personal-agent/domain';

export const REMINDER_PREFIX = 'klnk-reminder-v1:';
export type ReminderPermission = 'undetermined' | 'granted' | 'denied';
export type ReminderNotice = { id: string; dueAt: number; fingerprint: string };
export type ReminderState = Readonly<{
  enabled: boolean;
  permission: ReminderPermission;
  scheduled: number;
  quiet: boolean;
  error: string;
}>;
export type ReminderSource = {
  events: NetworkEvent[];
  reminders: NetworkReminder[];
  preferences: NetworkPreferences;
};
export interface ReminderDriver {
  permission(): Promise<ReminderPermission>;
  requestPermission(): Promise<ReminderPermission>;
  optedIn(scope: string): Promise<boolean>;
  setOptedIn(scope: string, value: boolean): Promise<void>;
  pending(): Promise<ReminderNotice[]>;
  schedule(notice: ReminderNotice): Promise<void>;
  cancel(id: string): Promise<void>;
  clearManaged(): Promise<void>;
}

/** Uses canonical future reminders only. Generic lock-screen text lives in the
 * native adapter; private meeting text never enters the OS notification store. */
export function planLocalReminders(
  owner: string,
  scope: string,
  source: ReminderSource,
  now: number,
) {
  if (
    source.preferences.ownerId !== owner ||
    source.preferences.notificationMode !== 'decisions_results'
  )
    return [];
  const events = new Map(
    source.events
      .filter((event) => event.status === 'confirmed' && event.terms.participants.includes(owner))
      .map((event) => [event.id, event]),
  );
  const seen = new Set<string>();
  return source.reminders
    .filter((reminder) => {
      const event = events.get(reminder.eventId),
        dueAt = Date.parse(reminder.dueAt);
      if (
        !event ||
        reminder.ownerId !== owner ||
        reminder.status !== 'scheduled' ||
        !Number.isFinite(dueAt) ||
        dueAt <= now + 1000 ||
        dueAt > Date.parse(event.terms.slot.startAt) ||
        Date.parse(event.terms.slot.endAt) <= now ||
        seen.has(reminder.id)
      )
        return false;
      seen.add(reminder.id);
      return true;
    })
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.id.localeCompare(b.id))
    .slice(0, 32)
    .map((reminder) => ({
      id: `${REMINDER_PREFIX}${scope}:${reminder.id}`,
      dueAt: Date.parse(reminder.dueAt),
      fingerprint: `${reminder.dueAt}:${events.get(reminder.eventId)!.revision}`,
    }));
}

/** One serialized device queue fences old auth scopes, permission prompts and
 * in-flight schedules. OS permission is requested only by enable(), never sync. */
export class LocalReminderCoordinator {
  private epoch = 0;
  private authority = 0;
  private syncRevision = 0;
  private scope = '';
  private owner = '';
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private state: ReminderState = {
    enabled: false,
    permission: 'undetermined',
    scheduled: 0,
    quiet: false,
    error: '',
  };
  constructor(
    private driver: ReminderDriver,
    private now = Date.now,
  ) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<ReminderState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private enqueue<T>(operation: () => Promise<T>) {
    const work = this.queue.catch(() => undefined).then(operation);
    this.queue = work.catch(() => undefined);
    return work;
  }
  begin(owner: string, scope: string) {
    const ticket = ++this.epoch;
    this.authority++;
    this.scope = scope;
    this.owner = owner;
    this.publish({
      enabled: false,
      permission: 'undetermined',
      scheduled: 0,
      quiet: false,
      error: '',
    });
    const ready = this.enqueue(async () => {
      await this.driver.clearManaged();
      if (ticket !== this.epoch) return;
      const [enabled, permission] = await Promise.all([
        this.driver.optedIn(scope),
        this.driver.permission(),
      ]);
      if (ticket === this.epoch) this.publish({ enabled, permission });
    });
    return { ticket, ready };
  }
  end(ticket?: number) {
    if (ticket !== undefined && ticket !== this.epoch) return Promise.resolve();
    this.epoch++;
    this.authority++;
    this.publish({ enabled: false, scheduled: 0, error: '' });
    return this.enqueue(() => this.driver.clearManaged());
  }
  enable(ticket: number) {
    if (ticket !== this.epoch) return Promise.resolve();
    const authority = ++this.authority;
    return this.enqueue(async () => {
      if (ticket !== this.epoch) return;
      let permission = await this.driver.permission();
      if (permission === 'undetermined') permission = await this.driver.requestPermission();
      if (ticket !== this.epoch || authority !== this.authority) return;
      this.publish({
        permission,
        error:
          permission === 'denied'
            ? 'Notifications are denied. You can allow them in your device Settings.'
            : '',
      });
      if (permission !== 'granted') return;
      await this.driver.setOptedIn(this.scope, true);
      if (ticket === this.epoch && authority === this.authority) this.publish({ enabled: true });
    });
  }
  disable(ticket: number) {
    if (ticket !== this.epoch) return Promise.resolve();
    this.authority++;
    this.publish({ enabled: false, scheduled: 0 });
    const scope = this.scope;
    return this.enqueue(async () => {
      try {
        await this.driver.setOptedIn(scope, false);
      } finally {
        await this.driver.clearManaged();
      }
    });
  }
  suspend(ticket: number) {
    if (ticket !== this.epoch) return Promise.resolve();
    this.syncRevision++;
    this.publish({
      scheduled: 0,
      error:
        'Local reminders paused because current server state could not be checked. Reopen or refresh while connected.',
    });
    return this.enqueue(() => this.driver.clearManaged());
  }
  sync(ticket: number, source: ReminderSource) {
    if (ticket !== this.epoch) return Promise.resolve();
    const revision = ++this.syncRevision,
      authority = this.authority;
    const current = () =>
      ticket === this.epoch && authority === this.authority && revision === this.syncRevision;
    return this.enqueue(async () => {
      if (!current()) return;
      const permission = await this.driver.permission();
      if (!current()) return;
      const quiet = source.preferences.notificationMode !== 'decisions_results';
      this.publish({ permission, quiet, error: '' });
      const planned =
        this.state.enabled && permission === 'granted'
          ? planLocalReminders(this.owner, this.scope, source, this.now())
          : [];
      const desired = new Map(planned.map((notice) => [notice.id, notice]));
      const pending = await this.driver.pending();
      if (!current()) return;
      for (const notice of pending.filter((notice) => notice.id.startsWith(REMINDER_PREFIX))) {
        if (!current()) return;
        if (desired.get(notice.id)?.fingerprint !== notice.fingerprint)
          await this.driver.cancel(notice.id);
      }
      for (const notice of planned) {
        if (!current() || !this.state.enabled) return;
        if (pending.some((old) => old.id === notice.id && old.fingerprint === notice.fingerprint))
          continue;
        await this.driver.schedule(notice);
        if (!current() || !this.state.enabled) {
          await this.driver.cancel(notice.id);
          return;
        }
      }
      if (current()) this.publish({ scheduled: planned.length });
    });
  }
}
