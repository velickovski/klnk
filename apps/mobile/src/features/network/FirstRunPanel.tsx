import React from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../../components/primitives';
import type { NetworkAvailability, NetworkConnection } from '@personal-agent/domain';
import { Button, Disclosure, useUI } from '../../ui';
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
    <Disclosure
      title="Make klnk yours"
      icon="sparkles-outline"
      detail="People, availability & rules"
      preserveContent
    >
      <View style={{ gap: 16 }}>
        <View style={{ gap: 12 }}>
          <Button
            label={connected ? 'Review your connected people' : '1. Connect your first person'}
            secondary
            icon="person-add-outline"
            onPress={onPeople}
          />
          <Button
            label="2. Review busy times in your calendar"
            icon="calendar-outline"
            secondary
            onPress={onCalendar}
          />
          <Button
            label="3. Optional: choose delegation rules"
            icon="options-outline"
            secondary
            onPress={onSettings}
          />
        </View>
        <Text style={styles.small}>
          Exact messages work between accepted members. Automatic answers and meetings need scoped
          delegation. Voice needs separate permission.
        </Text>
        <Button
          label="Keep meetings under my review for now"
          secondary
          compact
          onPress={() => setDismissed(true)}
        />
      </View>
    </Disclosure>
  );
}
