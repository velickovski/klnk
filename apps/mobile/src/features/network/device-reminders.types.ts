import type { ReminderState } from './local-reminders';
export type DeviceReminderAccess = ReminderState & {
  supported: boolean;
  ready: boolean;
  busy: boolean;
  enable(): Promise<void>;
  disable(): Promise<void>;
  refresh(): Promise<void>;
};
