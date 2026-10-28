import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { NetworkPreferences } from '@personal-agent/domain';
import { Button, Card, Choice, Notice, useUI } from '../../ui';
import { networkApi } from './api';
import { usePanelTask } from './panel-hooks';

export function PreferencesPanel({ ownerId }: { ownerId: string }) {
  const { styles } = useUI(),
    task = usePanelTask(),
    [saved, setSaved] = useState<NetworkPreferences>(),
    [draft, setDraft] = useState<NetworkPreferences>();
  const refresh = () =>
    task.run(
      () => networkApi.request<NetworkPreferences>('/network/preferences'),
      (p) => {
        setSaved(p);
        setDraft(p);
      },
    );
  useEffect(() => {
    void refresh();
  }, [ownerId]);
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
            These are notices inside klnk. Quiet mode keeps the Inbox available. No closed-app
            alert, APNs, SMS or email is enabled. Retention removes server shared records, including
            the other participant’s copy; it cannot erase information already read or copied.
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
        <Text style={styles.small}>Loading saved preferences…</Text>
      )}
      {task.error ? <Notice tone="error">{task.error}</Notice> : null}
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
