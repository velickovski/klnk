import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  NetworkCalendarSchema,
  NetworkIdentitySchema,
  NetworkPreferencesSchema,
} from '@personal-agent/domain';
import { getSessionSnapshot, isSessionCurrent, onSessionChange } from '../../api';
import type { NetworkDataClient } from './data-client';
import type { DeviceReminderAccess } from './device-reminders.types';
import {
  deviceReminderCoordinator as coordinator,
  installDeviceReminderHandler,
} from './reminder-device.native';

const Context = createContext<DeviceReminderAccess | null>(null);
export function DeviceRemindersProvider({
  client,
  children,
}: {
  client: NetworkDataClient;
  children: React.ReactNode;
}) {
  const state = useSyncExternalStore(
    coordinator.subscribe,
    coordinator.snapshot,
    coordinator.snapshot,
  );
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  const ticket = useRef<number | undefined>(undefined),
    sync = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const removeHandler = installDeviceReminderHandler();
    let alive = true,
      foreground = AppState.currentState === 'active',
      pending = false;
    const session = getSessionSnapshot();
    // Discard schedules from a previous process before trusting a restored identity.
    const cleared = coordinator.end();
    const current = () => alive && !!session.token && isSessionCurrent(session);
    const update = async () => {
      if (!current() || !foreground || pending) return;
      pending = true;
      try {
        await cleared;
        if (!current()) return;
        if (ticket.current === undefined) {
          const identity = NetworkIdentitySchema.parse(
            await client.read('/network/identity', true),
          );
          if (!current()) return;
          const scope = await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            JSON.stringify([session.url, identity.member.id]),
          );
          if (!current()) return;
          const started = coordinator.begin(identity.member.id, scope);
          ticket.current = started.ticket;
          await started.ready;
          if (!current()) return;
          setReady(true);
        }
        const [calendar, preferences] = await Promise.all([
          client.read('/network/calendar', true),
          client.read('/network/preferences', true),
        ]);
        if (!current()) return;
        const parsed = NetworkCalendarSchema.parse(calendar);
        await coordinator.sync(ticket.current!, {
          events: parsed.events,
          reminders: parsed.reminders,
          preferences: NetworkPreferencesSchema.parse(preferences),
        });
      } catch {
        if (current() && ticket.current !== undefined)
          await coordinator.suspend(ticket.current).catch(() => undefined);
      } finally {
        pending = false;
      }
    };
    sync.current = update;
    const stop = () => {
      if (!alive) return;
      alive = false;
      if (ticket.current !== undefined) void coordinator.end(ticket.current).catch(() => undefined);
      ticket.current = undefined;
    };
    const unsubscribe = onSessionChange(() => {
      if (!isSessionCurrent(session)) stop();
    });
    const subscription = AppState.addEventListener('change', (value) => {
      foreground = value === 'active';
      if (foreground) void update();
    });
    const stopCalendar = session.token
      ? client.subscribe('/network/calendar', () => {
          if (foreground) void update();
        })
      : () => undefined;
    const stopPreferences = session.token
      ? client.subscribe('/network/preferences', () => {
          if (foreground) void update();
        })
      : () => undefined;
    const interval = setInterval(() => {
      if (foreground) void update();
    }, 30000);
    if (session.token) void update();
    else void cleared.catch(() => undefined);
    return () => {
      stop();
      unsubscribe();
      subscription.remove();
      stopCalendar();
      stopPreferences();
      clearInterval(interval);
      removeHandler();
    };
  }, [client]);
  const run = async (operation: (lease: number) => Promise<void>) => {
    const lease = ticket.current;
    if (lease === undefined) return;
    setBusy(true);
    try {
      await operation(lease);
      await sync.current();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Context.Provider
      value={{
        ...state,
        supported: true,
        ready,
        busy,
        enable: () => run((lease) => coordinator.enable(lease)),
        disable: () => run((lease) => coordinator.disable(lease)),
        refresh: () => sync.current(),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useDeviceReminders(): DeviceReminderAccess {
  const value = useContext(Context);
  if (!value) throw new Error('Device reminders require the signed-in session provider.');
  return value;
}
