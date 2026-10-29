import React from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../../components/primitives';
import type { NetworkAvailability, NetworkConnection } from '@personal-agent/domain';
import { Button, Card, useUI } from '../../ui';
import { useNetworkQuery, useSessionState } from './data-provider';

/** Subsequent-screen guidance only. No grant, tool or meeting is enabled here. */
export function FirstRunPanel({
  ownerId,
  onPeople,
  onCalendar,
  onSettings,
}: {
  ownerId: string;
  onPeople: () => void;
  onCalendar: () => void;
  onSettings: () => void;
}) {
  const { styles } = useUI(),
    people = useNetworkQuery<{ connections: NetworkConnection[] }>('/network/connections'),
    calendar = useNetworkQuery<{ availability?: NetworkAvailability | null }>('/network/calendar');
  const [dismissed, setDismissed] = useSessionState(`${ownerId}:setup:dismissed`, false);
  const connected = !!people.data?.connections.some(
      (connection) => connection.status === 'accepted',
    ),
    availability =
      !!calendar.data?.availability &&
      Date.parse(calendar.data.availability.confirmedThrough) > Date.now();
  if (dismissed || (connected && availability)) return null;
  return (
    <Card>
      <Text accessibilityRole="header" style={styles.h2}>
        Make klnk yours
      </Text>
      <Text style={styles.text}>
        Connect a person, then choose how much your agent may arrange.
      </Text>
      <View style={{ gap: 12 }}>
        <Button
          label={connected ? 'Review your connected people' : '1. Connect your first person'}
          secondary
          onPress={onPeople}
        />
        <Button label="2. Review busy times in your calendar" secondary onPress={onCalendar} />
        <Button label="3. Optional: choose delegation rules" secondary onPress={onSettings} />
      </View>
      <Text style={styles.small}>
        Accepted members can exchange exact messages. Automatic answers and meetings remain off
        until you explicitly set their scope. Voice permissions require a separate choice.
      </Text>
      <Button
        label="Keep meetings under my review for now"
        secondary
        compact
        onPress={() => setDismissed(true)}
      />
    </Card>
  );
}
