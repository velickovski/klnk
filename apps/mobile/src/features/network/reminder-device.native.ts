import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import {
  LocalReminderCoordinator,
  REMINDER_PREFIX,
  type ReminderDriver,
  type ReminderPermission,
} from './local-reminders';

function permission(value: Notifications.NotificationPermissionsStatus): ReminderPermission {
  if (
    value.granted ||
    (value.ios &&
      [
        Notifications.IosAuthorizationStatus.PROVISIONAL,
        Notifications.IosAuthorizationStatus.EPHEMERAL,
      ].includes(value.ios.status))
  )
    return 'granted';
  if (
    value.status === 'denied' ||
    value.ios?.status === Notifications.IosAuthorizationStatus.DENIED
  )
    return 'denied';
  return value.canAskAgain ? 'undetermined' : 'denied';
}
const channel = 'klnk-local-reminders';
const driver: ReminderDriver = {
  async permission() {
    return permission(await Notifications.getPermissionsAsync());
  },
  async requestPermission() {
    if (Platform.OS === 'android')
      await Notifications.setNotificationChannelAsync(channel, {
        name: 'klnk local reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: null,
      });
    return permission(
      await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: false, allowBadge: false },
      }),
    );
  },
  async optedIn(scope) {
    return (await SecureStore.getItemAsync(`klnk-local-reminders-${scope}`)) === 'enabled';
  },
  async setOptedIn(scope, enabled) {
    await SecureStore.setItemAsync(
      `klnk-local-reminders-${scope}`,
      enabled ? 'enabled' : 'disabled',
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
  },
  async pending() {
    return (await Notifications.getAllScheduledNotificationsAsync())
      .filter((item) => item.identifier.startsWith(REMINDER_PREFIX))
      .map((item) => ({
        id: item.identifier,
        dueAt: typeof item.content.data?.dueAt === 'number' ? item.content.data.dueAt : 0,
        fingerprint:
          typeof item.content.data?.fingerprint === 'string' ? item.content.data.fingerprint : '',
      }));
  },
  async schedule(notice) {
    if (Platform.OS === 'android')
      await Notifications.setNotificationChannelAsync(channel, {
        name: 'klnk local reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: null,
      });
    await Notifications.scheduleNotificationAsync({
      identifier: notice.id,
      content: {
        title: 'klnk reminder',
        body: 'Open klnk to review your upcoming meeting.',
        sound: false,
        data: { dueAt: notice.dueAt, fingerprint: notice.fingerprint },
        interruptionLevel: 'passive',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(notice.dueAt),
        channelId: channel,
      },
    });
  },
  async cancel(id) {
    await Notifications.cancelScheduledNotificationAsync(id);
    await Notifications.dismissNotificationAsync(id);
  },
  async clearManaged() {
    const [pending, delivered] = await Promise.all([
      Notifications.getAllScheduledNotificationsAsync(),
      Notifications.getPresentedNotificationsAsync(),
    ]);
    const ids = new Set(
      [
        ...pending.map((item) => item.identifier),
        ...delivered.map((item) => item.request.identifier),
      ].filter((id) => id.startsWith(REMINDER_PREFIX)),
    );
    for (const id of ids) await driver.cancel(id);
  },
};
export const deviceReminderCoordinator = new LocalReminderCoordinator(driver);
export function installDeviceReminderHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async (notice) => {
      const state = deviceReminderCoordinator.snapshot();
      const show =
        notice.request.identifier.startsWith(REMINDER_PREFIX) &&
        state.enabled &&
        state.permission === 'granted' &&
        !state.quiet;
      return {
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    },
  });
  return () => Notifications.setNotificationHandler(null);
}
