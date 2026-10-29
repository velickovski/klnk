export type QuerySnapshot<T> = Readonly<{ data?: T; loading: boolean; error: string }>;
type Transport = (path: string, method?: string, body?: unknown) => Promise<unknown>;
type Entry = {
  snapshot: QuerySnapshot<unknown>;
  listeners: Set<() => void>;
  checkedAt?: number;
  generation: number;
  pending?: Promise<unknown>;
  refreshAfterPending: boolean;
  serialized?: string;
};

/** One instance belongs to one signed-in session. Only GETs are cached/retried;
 * a mutation is sent once and invalidates readbacks even if its outcome is lost. */
export class NetworkDataClient {
  private entries = new Map<string, Entry>();
  private active = true;
  private disposed = false;
  constructor(
    private transport: Transport,
    private clock = Date.now,
    private staleMs = 10_000,
  ) {}

  private entry(path: string): Entry {
    if (!path.startsWith('/network/')) throw new Error('Use an internal network endpoint.');
    let entry = this.entries.get(path);
    if (!entry) {
      entry = {
        snapshot: { loading: true, error: '' },
        listeners: new Set(),
        checkedAt: undefined,
        generation: 0,
        refreshAfterPending: false,
      };
      this.entries.set(path, entry);
    }
    return entry;
  }
  snapshot<T>(path: string): QuerySnapshot<T> {
    return this.entry(path).snapshot as QuerySnapshot<T>;
  }
  private publish(entry: Entry, snapshot: QuerySnapshot<unknown>) {
    if (this.disposed) return;
    entry.snapshot = snapshot;
    entry.listeners.forEach((listener) => listener());
  }
  subscribe(path: string, listener: () => void) {
    const entry = this.entry(path);
    entry.listeners.add(listener);
    if (this.active && !this.disposed) void this.read(path).catch(() => undefined);
    return () => {
      entry.listeners.delete(listener);
    };
  }
  async read<T>(path: string, force = false): Promise<T> {
    if (this.disposed) throw new Error('This workspace session ended.');
    const entry = this.entry(path);
    if (entry.pending) return entry.pending as Promise<T>;
    if (
      !force &&
      entry.snapshot.data !== undefined &&
      entry.checkedAt !== undefined &&
      this.clock() - entry.checkedAt < this.staleMs
    )
      return entry.snapshot.data as T;
    const generation = entry.generation;
    if (entry.snapshot.data === undefined && (!entry.snapshot.loading || entry.snapshot.error))
      this.publish(entry, { loading: true, error: '' });
    const pending = this.transport(path)
      .then(
        (data) => {
          if (!this.disposed && generation === entry.generation) {
            const serialized = JSON.stringify(data);
            entry.checkedAt = this.clock();
            if (serialized !== entry.serialized || entry.snapshot.loading || entry.snapshot.error) {
              entry.serialized = serialized;
              this.publish(entry, { data, loading: false, error: '' });
            }
          }
          return data;
        },
        (failure: unknown) => {
          if (!this.disposed && generation === entry.generation)
            this.publish(entry, {
              ...entry.snapshot,
              loading: false,
              error:
                failure instanceof Error
                  ? failure.message
                  : 'The latest update could not be loaded.',
            });
          throw failure;
        },
      )
      .finally(() => {
        entry.pending = undefined;
        if (entry.refreshAfterPending && this.active && !this.disposed && entry.listeners.size) {
          entry.refreshAfterPending = false;
          void this.read(path, true).catch(() => undefined);
        }
      });
    entry.pending = pending;
    return pending as Promise<T>;
  }
  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    this.entry(path);
    if (method.toUpperCase() === 'GET') return this.read<T>(path);
    if (this.disposed) throw new Error('This workspace session ended.');
    try {
      return (await this.transport(path, method, body)) as T;
    } finally {
      this.invalidate();
    }
  }
  invalidate() {
    if (this.disposed) return;
    for (const [path, entry] of this.entries) {
      entry.generation++;
      entry.checkedAt = undefined;
      if (entry.pending) entry.refreshAfterPending = true;
      else if (this.active && entry.listeners.size)
        void this.read(path, true).catch(() => undefined);
    }
  }
  refresh() {
    if (!this.active || this.disposed) return;
    for (const [path, entry] of this.entries)
      if (entry.listeners.size) void this.read(path, true).catch(() => undefined);
  }
  setActive(active: boolean) {
    const resumed = active && !this.active;
    this.active = active;
    if (resumed) this.invalidate();
  }
  update<T>(path: string, update: (previous: T | undefined) => T) {
    const entry = this.entry(path),
      data = update(entry.snapshot.data as T | undefined);
    entry.generation++;
    if (entry.pending) entry.refreshAfterPending = true;
    entry.checkedAt = this.clock();
    entry.serialized = JSON.stringify(data);
    this.publish(entry, { data, loading: false, error: '' });
  }
  dispose() {
    this.disposed = true;
    this.active = false;
    for (const entry of this.entries.values()) entry.listeners.clear();
    this.entries.clear();
  }
}

/** RAM-only drafts and idempotence objects survive lazy panels, never sign-out. */
export class NetworkDraftStore {
  private values = new Map<string, unknown>();
  private listeners = new Map<string, Set<() => void>>();
  ensure<T>(key: string, create: () => T): T {
    if (!this.values.has(key)) this.values.set(key, create());
    return this.values.get(key) as T;
  }
  get<T>(key: string): T {
    return this.values.get(key) as T;
  }
  set<T>(key: string, value: T | ((previous: T) => T)) {
    const next =
      typeof value === 'function' ? (value as (previous: T) => T)(this.get<T>(key)) : value;
    if (Object.is(this.values.get(key), next)) return;
    this.values.set(key, next);
    this.listeners.get(key)?.forEach((listener) => listener());
  }
  subscribe(key: string, listener: () => void) {
    const listeners = this.listeners.get(key) ?? new Set<() => void>();
    this.listeners.set(key, listeners);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
  clear() {
    this.values.clear();
    this.listeners.clear();
  }
}
