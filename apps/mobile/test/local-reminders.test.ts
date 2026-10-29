let nextFixtureId = 0;
const fixtureId = () =>
  '00000000-0000-4000-a000-' + (++nextFixtureId).toString(16).padStart(12, '0');
import { describe, expect, it, vi } from 'vitest';
import {
  LocalReminderCoordinator,
  REMINDER_PREFIX,
  planLocalReminders,
  type ReminderDriver,
  type ReminderNotice,
  type ReminderPermission,
  type ReminderSource,
} from '../src/features/network/local-reminders';

const now = Date.parse('2026-10-29T10:00:00Z');
function source(owner = fixtureId()): ReminderSource {
  const peer = fixtureId(),
    event = fixtureId();
  return {
    events: [
      {
        id: event,
        conversationId: fixtureId(),
        proposalHash: 'fictional-hash',
        proposalVersion: 1,
        revision: 1,
        status: 'confirmed',
        createdAt: new Date(now).toISOString(),
        terms: {
          version: 1,
          participants: [owner, peer],
          purpose: 'PRIVATE_MEETING_TITLE',
          topic: 'routine',
          location: 'PRIVATE_LOCATION',
          obligations: [],
          slot: {
            startAt: new Date(now + 3600000).toISOString(),
            endAt: new Date(now + 5400000).toISOString(),
            timezone: 'UTC',
          },
        },
        acceptances: [owner, peer].map((ownerId) => ({
          ownerId,
          proposalHash: 'fictional-hash',
          proposalVersion: 1,
          source: 'owner_approval',
          policyVersion: 1,
          at: new Date(now).toISOString(),
        })),
      },
    ],
    reminders: [
      {
        id: fixtureId(),
        ownerId: owner,
        eventId: event,
        text: 'PRIVATE_REMINDER_TEXT',
        dueAt: new Date(now + 1800000).toISOString(),
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
  const pending = new Map<string, ReminderNotice>(),
    optedIn = new Map<string, boolean>();
  let permission: ReminderPermission = 'granted';
  const driver: ReminderDriver = {
    permission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => {
      permission = 'granted';
      return permission;
    }),
    optedIn: vi.fn(async (scope) => optedIn.get(scope) ?? false),
    setOptedIn: vi.fn(async (scope, enabled) => {
      optedIn.set(scope, enabled);
    }),
    pending: vi.fn(async () => [...pending.values()]),
    schedule: vi.fn(async (notice) => {
      pending.set(notice.id, notice);
    }),
    cancel: vi.fn(async (id) => {
      pending.delete(id);
    }),
    clearManaged: vi.fn(async () => {
      for (const id of pending.keys()) if (id.startsWith(REMINDER_PREFIX)) pending.delete(id);
    }),
  };
  const coordinator = new LocalReminderCoordinator(driver, () => now);
  return {
    driver,
    pending,
    optedIn,
    coordinator,
    permission: (value: ReminderPermission) => {
      permission = value;
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('canonical on-device local reminder coordination without native effects', () => {
  it('never asks permission or schedules on startup without explicit opt-in', async () => {
    const f = fixture(),
      data = source(),
      lease = f.coordinator.begin(data.preferences.ownerId, 'scope-a');
    await lease.ready;
    await f.coordinator.sync(lease.ticket, data);
    expect(f.driver.requestPermission).not.toHaveBeenCalled();
    expect(f.driver.schedule).not.toHaveBeenCalled();
    expect(f.coordinator.snapshot().enabled).toBe(false);
  });
  it('asks only after enable and keeps one stable schedule across unchanged refreshes', async () => {
    const f = fixture(),
      data = source();
    f.permission('undetermined');
    const lease = f.coordinator.begin(data.preferences.ownerId, 'scope-a');
    await lease.ready;
    await f.coordinator.enable(lease.ticket);
    await f.coordinator.sync(lease.ticket, data);
    await f.coordinator.sync(lease.ticket, data);
    expect(f.driver.requestPermission).toHaveBeenCalledTimes(1);
    expect(f.driver.schedule).toHaveBeenCalledTimes(1);
    expect(f.pending.size).toBe(1);
    expect(f.optedIn.get('scope-a')).toBe(true);
    expect(JSON.stringify([...f.pending.values()])).not.toContain('PRIVATE_');
  });
  it('does not prompt repeatedly after denial and reports device Settings', async () => {
    const f = fixture(),
      data = source();
    f.permission('denied');
    const lease = f.coordinator.begin(data.preferences.ownerId, 'scope-a');
    await lease.ready;
    await f.coordinator.enable(lease.ticket);
    await f.coordinator.sync(lease.ticket, data);
    expect(f.driver.requestPermission).not.toHaveBeenCalled();
    expect(f.pending.size).toBe(0);
    expect(f.coordinator.snapshot().permission).toBe('denied');
  });
  it.each(['quiet', 'decisions_only'] as const)(
    'cancels already scheduled reminders under saved %s preferences',
    async (notificationMode) => {
      const f = fixture(),
        data = source(),
        lease = f.coordinator.begin(data.preferences.ownerId, 'scope-a');
      await lease.ready;
      await f.coordinator.enable(lease.ticket);
      await f.coordinator.sync(lease.ticket, data);
      await f.coordinator.sync(lease.ticket, {
        ...data,
        preferences: { ...data.preferences, notificationMode },
      });
      expect(f.pending.size).toBe(0);
      expect(f.coordinator.snapshot()).toMatchObject({ enabled: true, quiet: true, scheduled: 0 });
    },
  );
  it.each(['cancelled', 'dismissed', 'removed', 'revoked_permission'] as const)(
    'removes old OS schedules after canonical %s changes',
    async (change) => {
      const f = fixture(),
        data = source(),
        lease = f.coordinator.begin(data.preferences.ownerId, 'scope-a');
      await lease.ready;
      await f.coordinator.enable(lease.ticket);
      await f.coordinator.sync(lease.ticket, data);
      if (change === 'cancelled') data.events[0].status = 'cancelled';
      if (change === 'dismissed') data.reminders[0].status = 'dismissed';
      if (change === 'removed') data.events = [];
      if (change === 'revoked_permission') f.permission('denied');
      await f.coordinator.sync(lease.ticket, data);
      expect(f.pending.size).toBe(0);
    },
  );
  it('replaces changed due times instead of duplicating a stable reminder identifier', async () => {
    const f = fixture(),
      data = source(),
      lease = f.coordinator.begin(data.preferences.ownerId, 'scope-a');
    await lease.ready;
    await f.coordinator.enable(lease.ticket);
    await f.coordinator.sync(lease.ticket, data);
    const first = [...f.pending.values()][0];
    data.reminders[0].dueAt = new Date(now + 2400000).toISOString();
    data.events[0].revision++;
    await f.coordinator.sync(lease.ticket, data);
    const next = [...f.pending.values()][0];
    expect(f.pending.size).toBe(1);
    expect(next.id).toBe(first.id);
    expect(next.dueAt).not.toBe(first.dueAt);
  });
  it('bounds scheduling to the nearest32 future current-owner reminders for confirmed events', () => {
    const data = source(),
      owner = data.preferences.ownerId;
    const reminder = data.reminders[0];
    data.reminders = Array.from({ length: 40 }, (_, index) => ({
      ...reminder,
      id: fixtureId(),
      dueAt: new Date(now + 2000 + index * 1000).toISOString(),
    })).reverse();
    data.reminders.push({ ...reminder, id: fixtureId(), ownerId: fixtureId() });
    data.reminders.push({ ...reminder, id: fixtureId(), dueAt: new Date(now - 1).toISOString() });
    const planned = planLocalReminders(owner, 'scope-a', data, now);
    expect(planned).toHaveLength(32);
    expect(planned[0].dueAt).toBe(now + 2000);
    expect(planned.at(-1)?.dueAt).toBe(now + 33000);
    expect(planLocalReminders(fixtureId(), 'scope-a', data, now)).toEqual([]);
  });
  it('clears managed reminders on signout without touching unrelated local notices', async () => {
    const f = fixture(),
      data = source(),
      lease = f.coordinator.begin(data.preferences.ownerId, 'scope-a');
    await lease.ready;
    await f.coordinator.enable(lease.ticket);
    await f.coordinator.sync(lease.ticket, data);
    f.pending.set('another-feature', {
      id: 'another-feature',
      dueAt: now + 10000,
      fingerprint: 'unrelated',
    });
    await f.coordinator.end(lease.ticket);
    expect([...f.pending.keys()]).toEqual(['another-feature']);
    await f.coordinator.sync(lease.ticket, data);
    expect([...f.pending.keys()]).toEqual(['another-feature']);
  });
  it('fences an in-flight OS schedule when the owner changes, including same-scope relogin', async () => {
    const f = fixture(),
      data = source(),
      lease = f.coordinator.begin(data.preferences.ownerId, 'scope-a');
    await lease.ready;
    await f.coordinator.enable(lease.ticket);
    const started = deferred<void>(),
      finish = deferred<void>();
    vi.mocked(f.driver.schedule).mockImplementationOnce(async (notice) => {
      started.resolve();
      await finish.promise;
      f.pending.set(notice.id, notice);
    });
    const old = f.coordinator.sync(lease.ticket, data);
    await started.promise;
    const ending = f.coordinator.end(lease.ticket);
    const replacement = f.coordinator.begin(data.preferences.ownerId, 'scope-a');
    finish.resolve();
    await old;
    await ending;
    await replacement.ready;
    await f.coordinator.sync(replacement.ticket, data);
    await f.coordinator.end(lease.ticket); // Old cleanup must not cancel the replacement.
    expect(f.pending.size).toBe(1);
    expect(f.coordinator.snapshot().enabled).toBe(true);
  });
  it('does not enable another account after an old permission request completes late', async () => {
    const f = fixture(),
      data = source(),
      lease = f.coordinator.begin(data.preferences.ownerId, 'scope-a');
    f.permission('undetermined');
    await lease.ready;
    const response = deferred<ReminderPermission>(),
      started = deferred<void>();
    vi.mocked(f.driver.requestPermission).mockImplementationOnce(() => {
      started.resolve();
      return response.promise;
    });
    const enabling = f.coordinator.enable(lease.ticket);
    await started.promise;
    const next = f.coordinator.begin(fixtureId(), 'scope-b');
    response.resolve('granted');
    await enabling;
    await next.ready;
    expect(f.optedIn.get('scope-b')).toBeUndefined();
    expect(f.coordinator.snapshot().enabled).toBe(false);
  });
  it('ignores stale owner controls instead of invalidating a new owner’s in-flight schedule', async () => {
    const f = fixture(),
      oldData = source(),
      old = f.coordinator.begin(oldData.preferences.ownerId, 'old-scope');
    await old.ready;
    const nextData = source(),
      next = f.coordinator.begin(nextData.preferences.ownerId, 'new-scope');
    await next.ready;
    await f.coordinator.enable(next.ticket);
    const started = deferred<void>(),
      finish = deferred<void>();
    vi.mocked(f.driver.schedule).mockImplementationOnce(async (notice) => {
      started.resolve();
      await finish.promise;
      f.pending.set(notice.id, notice);
    });
    const currentSync = f.coordinator.sync(next.ticket, nextData);
    await started.promise;
    await f.coordinator.enable(old.ticket);
    await f.coordinator.sync(old.ticket, oldData);
    finish.resolve();
    await currentSync;
    expect(f.pending.size).toBe(1);
    expect([...f.pending.keys()][0]).toContain('new-scope');
  });
  it('clears scheduled reminders when current server readback fails', async () => {
    const f = fixture(),
      data = source(),
      lease = f.coordinator.begin(data.preferences.ownerId, 'scope-a');
    await lease.ready;
    await f.coordinator.enable(lease.ticket);
    await f.coordinator.sync(lease.ticket, data);
    await f.coordinator.suspend(lease.ticket);
    expect(f.pending.size).toBe(0);
    expect(f.coordinator.snapshot().error).toContain('current server state');
  });
});
