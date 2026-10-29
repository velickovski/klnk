import React from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../../components/primitives';
import { Button, Card, FeatureHeader, Notice, useUI } from '../../ui';
import { useNetworkClient, useNetworkQuery } from './data-provider';
import { formatDateTime } from './format';
import { usePanelTask } from './panel-hooks';
export type NoticeItem = { id: string; conversationId: string; kind: string; at: string };
export type NoticesView = { items: NoticeItem[]; delivery: 'in_app' };
export function NotificationsPanel({
  ownerId: _ownerId,
  onConversation,
}: {
  ownerId: string;
  onConversation?: (id: string) => void;
}) {
  const { styles } = useUI(),
    task = usePanelTask(),
    networkApi = useNetworkClient(),
    query = useNetworkQuery<NoticesView>('/network/notifications');
  const items = query.data?.items ?? [];
  const refresh = () => task.run(query.refetch, () => undefined);
  return (
    <View style={{ gap: 12 }}>
      {query.loading ? <Text style={styles.small}>Loading in-app notices…</Text> : null}
      {query.data && !items.length ? <Text style={styles.small}>No unread notices.</Text> : null}
      {items.length ? (
        <>
          <FeatureHeader
            icon="notifications-outline"
            title="Notices for you"
            detail="Reading or dismissing never accepts a proposal."
          />
          {items.map((item) => (
            <Card key={item.id}>
              <Text style={styles.h3}>
                {item.kind === 'decision'
                  ? 'Your decision is needed'
                  : item.kind.startsWith('calendar_')
                    ? 'Calendar update'
                    : 'A request has an update'}
              </Text>
              <Text style={styles.small}>{formatDateTime(item.at)}</Text>
              {onConversation ? (
                <Button
                  label="Open notice conversation"
                  icon="chatbubble-outline"
                  secondary
                  onPress={() => onConversation(item.conversationId)}
                />
              ) : null}
              <Button
                label="Dismiss this notice"
                secondary
                compact
                onPress={() =>
                  void task.run(
                    () => networkApi.request(`/network/notifications/${item.id}/read`, 'POST', {}),
                    () =>
                      networkApi.update<NoticesView>('/network/notifications', (current) => ({
                        delivery: 'in_app',
                        items: (current?.items ?? []).filter((x) => x.id !== item.id),
                      })),
                  )
                }
              />
            </Card>
          ))}
        </>
      ) : null}
      {task.error || query.error ? <Notice tone="error">{task.error || query.error}</Notice> : null}
      <Button
        label="Refresh in-app notices"
        icon="refresh-outline"
        secondary
        compact
        loading={task.busy}
        onPress={() => void refresh()}
      />
    </View>
  );
}
