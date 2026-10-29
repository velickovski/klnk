import React from 'react';
import type { NetworkDataClient } from './data-client';
import type { DeviceReminderAccess } from './device-reminders.types';
const unsupported: DeviceReminderAccess = {
  supported: false,
  ready: false,
  busy: false,
  enabled: false,
  permission: 'undetermined',
  scheduled: 0,
  quiet: false,
  error: '',
  enable: async () => {},
  disable: async () => {},
  refresh: async () => {},
};
export function DeviceRemindersProvider({
  children,
}: {
  client: NetworkDataClient;
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
export function useDeviceReminders(): DeviceReminderAccess {
  return unsupported;
}
