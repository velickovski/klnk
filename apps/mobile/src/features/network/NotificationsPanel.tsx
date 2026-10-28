import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Notice, useUI } from '../../ui';
import { networkApi } from './api';
import { usePanelTask } from './panel-hooks';
type NoticeItem = { id: string; conversationId: string; kind: string; at: string };
export function NotificationsPanel({ ownerId }: { ownerId: string }) {
  const { styles } = useUI(),
    task = usePanelTask(),
    [items, setItems] = useState<NoticeItem[]>([]);
  const refresh = () =>
    task.run(
      () =>
        networkApi.request<{ items: NoticeItem[]; delivery: 'in_app' }>('/network/notifications'),
      (result) => setItems(result.items),
    );
  useEffect(() => {
    void refresh();
  }, [ownerId]);
  return (
    <View style={{ gap: 12 }}>
      {items.length ? (
        <>
          <Text accessibilityRole="header" style={styles.h2}>
            Notices for you
          </Text>
          {items.map((item) => (
            <Card key={item.id}>
              <Text style={styles.h3}>
                {item.kind === 'decision'
                  ? 'Your decision is needed'
                  : item.kind.startsWith('calendar_')
                    ? 'Calendar update'
                    : 'A request has an update'}
              </Text>
              <Text style={styles.small}>
                {new Date(item.at).toLocaleString()}. Open the matching conversation below for its
                current summary. Reading a notice never accepts a proposal.
              </Text>
              <Button
                label="Dismiss this notice"
                secondary
                compact
                onPress={() =>
                  void task.run(
                    () => networkApi.request(`/network/notifications/${item.id}/read`, 'POST', {}),
                    () => setItems((current) => current.filter((x) => x.id !== item.id)),
                  )
                }
              />
            </Card>
          ))}
        </>
      ) : null}
      {task.error ? <Notice tone="error">{task.error}</Notice> : null}
      <Button
        label="Refresh in-app notices"
        secondary
        compact
        loading={task.busy}
        onPress={() => void refresh()}
      />
    </View>
  );
}
