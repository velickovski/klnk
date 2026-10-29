import { describe, expect, it, vi } from 'vitest';
import { event, ownerId, peerId } from '../component-test/fixtures';
import {
  LocalReminderCoordinator,
  REMINDER_PREFIX,
  planLocalReminders,
  type ReminderDriver,
  type ReminderNotice,
  type ReminderPermission,
  type ReminderSource,
} from '../src/features/network/local-reminders';

const now = Date.parse('2026-10-29T12:00:00Z');
function source(owner = ownerId): ReminderSource {
  return {
    events: [
      {
        ...event,
        terms: {
          ...event.terms,
          purpose: 'PRIVATE_QA_PURPOSE',
          location: 'PRIVATE_QA_LOCATION',
          participants: [owner, peerId],
          slot: {
            startAt: new Date(now + 7200000).toISOString(),
            endAt: new Date(now + 9000000).toISOString(),
            timezone: 'UTC',
          },
        },
      },
    ],
    reminders: [
      {
        id: '00000000-0000-4000-8000-000000000071',
        ownerId: owner,
        eventId: event.id,
        text: 'PRIVATE_QA_REMINDER',
        dueAt: new Date(now + 3600000).toISOString(),
        timezone: 'UTC',
        status: 'scheduled',
        createdAt: new Date(now).toISOString(),
      },
    ],
    preferences: {
      ownerId: owner,
      version: 1,
      retentionDays: 30,
      notificationMode: 'decisions_results',
      updatedAt: new Date(now).toISOString(),
    },
  };
}
function fixture() {
  const scheduled = new Map<string, ReminderNotice>(),
    opted = new Map<string, boolean>();
  let permission: ReminderPermission = 'granted';
  const driver: ReminderDriver = {
    permission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => permission),
    optedIn: vi.fn(async (scope) => opted.get(scope) ?? false),
    setOptedIn: vi.fn(async (scope, value) => {
      opted.set(scope, value);
    }),
    pending: vi.fn(async () => [...scheduled.values()]),
    schedule: vi.fn(async (notice) => {
      scheduled.set(notice.id, notice);
    }),
    cancel: vi.fn(async (id) => {
      scheduled.delete(id);
    }),
    clearManaged: vi.fn(async () => {
      for (const id of scheduled.keys()) if (id.startsWith(REMINDER_PREFIX)) scheduled.delete(id);
    }),
  };
  return {
    driver,
    scheduled,
    opted,
    coordinator: new LocalReminderCoordinator(driver, () => now),
    permission: (value: ReminderPermission) => {
      permission = value;
    },
  };
}
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('independent device reminder authority with injected operating-system driver', () => {
  it('never prompts or schedules on sign-in alone, and passes only generic scheduling metadata after explicit opt-in', async () => {
    const f = fixture(),
      scope = f.coordinator.begin(ownerId, 'fictional-scope-A');
    await scope.ready;
    await f.coordinator.sync(scope.ticket, source());
    expect(f.driver.requestPermission).not.toHaveBeenCalled();
    expect(f.driver.schedule).not.toHaveBeenCalled();
    await f.coordinator.enable(scope.ticket);
    await f.coordinator.sync(scope.ticket, source());
    await f.coordinator.sync(scope.ticket, source());
    expect(f.driver.schedule).toHaveBeenCalledTimes(1);
    const notice = vi.mocked(f.driver.schedule).mock.calls[0][0];
    expect(Object.keys(notice).sort()).toEqual(['dueAt', 'fingerprint', 'id']);
    expect(JSON.stringify(notice)).not.toContain('PRIVATE_QA');
    expect(f.coordinator.snapshot()).toMatchObject({ enabled: true, scheduled: 1 });
  });

  it('cancels a late old-owner OS schedule before the next owner can restore any reminders', async () => {
    const f = fixture(),
      a = f.coordinator.begin(ownerId, 'scope-A');
    await a.ready;
    await f.coordinator.enable(a.ticket);
    const entered = deferred(),
      release = deferred();
    vi.mocked(f.driver.schedule).mockImplementationOnce(async (notice) => {
      entered.resolve();
      await release.promise;
      f.scheduled.set(notice.id, notice);
    });
    const old = f.coordinator.sync(a.ticket, source());
    await entered.promise;
    const ending = f.coordinator.end(a.ticket);
    const b = f.coordinator.begin(peerId, 'scope-B');
    release.resolve();
    await old;
    await ending;
    await b.ready;
    expect([...f.scheduled.keys()]).toEqual([]);
    expect(f.driver.cancel).toHaveBeenCalledWith(expect.stringContaining('scope-A'));
    expect(f.coordinator.snapshot()).toMatchObject({ enabled: false, scheduled: 0 });
    await f.coordinator.end(a.ticket); // An old cleanup must not end the new scope.
    await f.coordinator.enable(b.ticket);
    await f.coordinator.sync(b.ticket, source(peerId));
    expect([...f.scheduled.keys()]).toEqual([expect.stringContaining('scope-B')]);
  });

  it('does not let a late permission grant undo an explicit disable while the OS prompt was open', async () => {
    const f = fixture();
    f.permission('undetermined');
    const scope = f.coordinator.begin(ownerId, 'scope-A');
    await scope.ready;
    const entered = deferred(),
      release = deferred();
    vi.mocked(f.driver.requestPermission).mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return 'granted';
    });
    const enabling = f.coordinator.enable(scope.ticket);
    await entered.promise;
    const disabling = f.coordinator.disable(scope.ticket);
    release.resolve();
    await enabling;
    await disabling;
    expect(f.driver.setOptedIn).toHaveBeenCalledExactlyOnceWith('scope-A', false);
    expect(f.coordinator.snapshot()).toMatchObject({ enabled: false, scheduled: 0 });
    expect(f.driver.schedule).not.toHaveBeenCalled();
  });

  it('removes cancelled and quiet reminders and replaces changed canonical event revisions without duplicates', async () => {
    const f = fixture(),
      scope = f.coordinator.begin(ownerId, 'scope-A');
    await scope.ready;
    await f.coordinator.enable(scope.ticket);
    const current = source();
    await f.coordinator.sync(scope.ticket, current);
    const changed = {
      ...current,
      events: current.events.map((value) => ({ ...value, revision: value.revision + 1 })),
    };
    await f.coordinator.sync(scope.ticket, changed);
    expect(f.driver.cancel).toHaveBeenCalledTimes(1);
    expect(f.driver.schedule).toHaveBeenCalledTimes(2);
    await f.coordinator.sync(scope.ticket, {
      ...changed,
      events: changed.events.map((value) => ({ ...value, status: 'cancelled' as const })),
    });
    expect(f.scheduled.size).toBe(0);
    await f.coordinator.sync(scope.ticket, current);
    await f.coordinator.sync(scope.ticket, {
      ...current,
      preferences: { ...current.preferences, notificationMode: 'quiet' },
    });
    expect(f.scheduled.size).toBe(0);
    expect(f.coordinator.snapshot()).toMatchObject({ quiet: true, scheduled: 0 });
  });

  it('fences a late OS schedule when server state becomes unavailable and clears all managed notices', async () => {
    const f = fixture(),
      scope = f.coordinator.begin(ownerId, 'scope-A');
    await scope.ready;
    await f.coordinator.enable(scope.ticket);
    const entered = deferred(),
      release = deferred();
    vi.mocked(f.driver.schedule).mockImplementationOnce(async (notice) => {
      entered.resolve();
      await release.promise;
      f.scheduled.set(notice.id, notice);
    });
    const sending = f.coordinator.sync(scope.ticket, source());
    await entered.promise;
    const suspended = f.coordinator.suspend(scope.ticket);
    release.resolve();
    await sending;
    await suspended;
    expect(f.scheduled.size).toBe(0);
    expect(f.coordinator.snapshot().error).toMatch(/paused/i);
    expect(f.driver.requestPermission).not.toHaveBeenCalled();
  });

  it('rejects foreign, dismissed and past canonical reminders and limits a large source to32 future notices', () => {
    const current = source();
    current.reminders = Array.from({ length: 80 }, (_, index) => ({
      ...current.reminders[0],
      id: `fixture-${index}`,
      dueAt: new Date(now + 3600000 + index * 1000).toISOString(),
    }));
    current.reminders.push(
      { ...current.reminders[0], id: 'foreign', ownerId: peerId },
      { ...current.reminders[0], id: 'dismissed', status: 'dismissed' },
      { ...current.reminders[0], id: 'past', dueAt: new Date(now - 1).toISOString() },
    );
    const planned = planLocalReminders(ownerId, 'scope-A', current, now);
    expect(planned).toHaveLength(32);
    expect(planned.some((notice) => /foreign|dismissed|past/.test(notice.id))).toBe(false);
    expect(planLocalReminders(peerId, 'scope-B', current, now)).toEqual([]);
  });
});
