import React, { useEffect } from 'react';
import { Linking, View } from 'react-native';
import { AppText as Text } from '../../components/primitives';
import type { NetworkPreferences } from '@personal-agent/domain';
import { Button, Card, Choice, Disclosure, FeatureHeader, Notice, useUI } from '../../ui';
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
      <FeatureHeader icon="notifications-outline" title="Retention & notifications" />
      <Text style={styles.text}>
        Completed records use the shorter participant retention. The clock starts after a meeting
        ends or its final update. Future meetings and pending decisions stay.
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
            Quiet and Decisions only also suppress device reminders; Inbox stays available.
            Retention removes both participants’ shared server records, but cannot erase copies
            already read or saved.
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
          <FeatureHeader icon="alarm-outline" title="On-device meeting reminders" />
          <Text style={styles.small}>
            Generic alerts for confirmed klnk meetings, without private details. Enable to request
            this device’s permission. No APNs, SMS or email is registered.
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
          <Disclosure title="Reminder delivery details">
            <Text style={styles.small}>
              Reminders sync when klnk is open or you return. Changes made while closed cannot
              cancel a local alert until the next sync. Device settings, Focus and system limits may
              delay or suppress alerts.
            </Text>
          </Disclosure>
          <Button
            label={
              deviceReminders.enabled ? 'Turn off device reminders' : 'Enable device reminders'
            }
            icon="alarm-outline"
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
          Device alerts need the native app. This browser uses in-app notices.
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
