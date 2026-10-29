import React, { useEffect } from 'react';
import { Linking, View } from 'react-native';
import { AppText as Text } from '../../components/primitives';
import type { NetworkPreferences } from '@personal-agent/domain';
import { Button, Card, Choice, Notice, useUI } from '../../ui';
import { useNetworkClient, useNetworkQuery, useSessionState } from './data-provider';
import { usePanelTask } from './panel-hooks';
import { useDeviceReminders } from './device-reminders';

export function PreferencesPanel({ ownerId }: { ownerId: string }) {
  const { styles } = useUI(),
    task = usePanelTask(),
    deviceReminders = useDeviceReminders(),
    networkApi = useNetworkClient(),
    query = useNetworkQuery<NetworkPreferences>('/network/preferences'),
    [saved, setSaved] = useSessionState<NetworkPreferences | undefined>(
      `${ownerId}:preferences:saved`,
      undefined,
    ),
    [draft, setDraft] = useSessionState<NetworkPreferences | undefined>(
      `${ownerId}:preferences:draft`,
      undefined,
    );
  const refresh = () => task.run(query.refetch, () => undefined);
  useEffect(() => {
    if (query.data && (!draft || JSON.stringify(draft) === JSON.stringify(saved))) {
      setSaved(query.data);
      setDraft(query.data);
    }
  }, [query.data]);
  return (
    <Card>
      <Text accessibilityRole="header" style={styles.h2}>
        Retention & notifications
      </Text>
      <Text style={styles.text}>
        Completed shared conversations and past meetings use the shorter participant retention
        setting. The clock starts after the meeting ends or the last terminal update. Future
        meetings and pending decisions are preserved.
      </Text>
      {draft ? (
        <View style={{ gap: 16 }}>
          <Choice
            label="Keep completed shared records"
            value={String(draft.retentionDays)}
            options={[
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
            ]}
            onChange={(value) =>
              setDraft({ ...draft, retentionDays: Number(value) as 7 | 30 | 90 })
            }
          />
          <Choice
            label="In-app notifications"
            value={draft.notificationMode}
            options={[
              { value: 'decisions_results', label: 'Decisions and results' },
              { value: 'decisions_only', label: 'Decisions only' },
              { value: 'quiet', label: 'Quiet' },
            ]}
            onChange={(notificationMode) => setDraft({ ...draft, notificationMode })}
          />
          <Text style={styles.small}>
            These choices control notices inside klnk. Quiet and Decisions only also suppress
            on-device meeting reminders. The Inbox stays available. Retention removes server shared
            records, including the other participant’s copy; it cannot erase information already
            read or copied.
          </Text>
          <Button
            label="Save privacy preferences"
            loading={task.busy}
            onPress={() =>
              void task.run(
                () =>
                  networkApi.request<NetworkPreferences>('/network/preferences', 'PUT', {
                    preferences: {
                      retentionDays: draft.retentionDays,
                      notificationMode: draft.notificationMode,
                    },
                    expectedVersion: saved!.version,
                  }),
                (p) => {
                  setSaved(p);
                  setDraft(p);
                  task.setNotice(
                    'Preferences saved. The worker applies retention at its next hourly sweep.',
                  );
                },
                'Save unconfirmed. Your choices are retained; refresh to inspect the saved revision. ',
              )
            }
          />
        </View>
      ) : (
        <Text style={styles.small}>
          {query.loading
            ? 'Loading saved preferences…'
            : 'Preferences unavailable. Use Refresh privacy preferences to retry.'}
        </Text>
      )}
      {deviceReminders.supported ? (
        <View style={{ gap: 12 }}>
          <Text accessibilityRole="header" style={styles.h2}>
            On-device meeting reminders
          </Text>
          <Text style={styles.small}>
            Optional local alerts for upcoming confirmed klnk meetings. Permission is requested only
            when you enable them. Alerts use generic text, with no private meeting details. This
            uses this device only; no APNs, SMS or email is registered.
          </Text>
          <Text style={styles.small} accessibilityLiveRegion="polite">
            {!deviceReminders.ready
              ? 'Connect and sign in to check reminder settings.'
              : deviceReminders.permission === 'denied'
                ? 'Notifications are denied in device Settings.'
                : deviceReminders.enabled
                  ? deviceReminders.quiet
                    ? 'Enabled on this device, paused by your saved notification preference.'
                    : `${deviceReminders.scheduled} future reminders scheduled on this device.`
                  : 'On-device reminders are off.'}
          </Text>
          <Text style={styles.small}>
            Reminders update while klnk is open and when you return. Changes made while it is closed
            cannot cancel an existing local alert until the next sync. Device settings, Focus and
            operating-system limits may delay or suppress alerts.
          </Text>
          <Button
            label={
              deviceReminders.enabled ? 'Turn off device reminders' : 'Enable device reminders'
            }
            loading={deviceReminders.busy}
            disabled={!deviceReminders.ready}
            onPress={() =>
              void task.run(
                deviceReminders.enabled ? deviceReminders.disable : deviceReminders.enable,
                () => undefined,
              )
            }
          />
          {deviceReminders.permission === 'denied' ? (
            <Button
              label="Open device notification settings"
              secondary
              onPress={() => void Linking.openSettings()}
            />
          ) : null}
          <Button
            label="Refresh device reminders"
            secondary
            loading={deviceReminders.busy}
            onPress={() => void task.run(deviceReminders.refresh, () => undefined)}
          />
          {deviceReminders.error ? <Notice tone="warning">{deviceReminders.error}</Notice> : null}
        </View>
      ) : (
        <Text style={styles.small}>
          On-device reminders are available in the native app. This browser uses in-app notices.
        </Text>
      )}
      {task.error || query.error ? <Notice tone="error">{task.error || query.error}</Notice> : null}
      {task.notice ? <Notice>{task.notice}</Notice> : null}
      <Button
        label="Refresh privacy preferences"
        secondary
        loading={task.busy}
        onPress={() => void refresh()}
      />
    </Card>
  );
}
