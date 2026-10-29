import React, { useState } from 'react';
import { Platform, View } from 'react-native';
import { AppText as Text } from '../../components/primitives';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Button, useUI } from '../../ui';
import { deviceTimezone, formatDateTime } from './format';
import { localDateTime, possibleInstants, type DateFieldProps } from './date-fields';

/** Uses the Expo-pinned native component. Device layout and route changes still
 * require physical-iPhone verification; browser tests do not exercise this UI. */
export function DateTimeField({
  label,
  value,
  onChange,
  timezone = deviceTimezone(),
  disabled,
  mode = 'datetime',
  endOfDay,
}: DateFieldProps) {
  const { styles, theme } = useUI(),
    [open, setOpen] = useState(false),
    [androidTime, setAndroidTime] = useState(false),
    [stage, setStage] = useState<Date>();
  let selected = new Date(value);
  if (mode === 'time') {
    const clock = value === '24:00' ? '00:00' : value;
    const wall = `${localDateTime(new Date().toISOString(), timezone).slice(0, 10)}T${clock}`;
    selected = new Date(possibleInstants(wall, timezone)[0] ?? Date.now());
  }
  if (!Number.isFinite(selected.getTime())) selected = new Date(Date.now() + 3600000);
  const choose = (date: Date) => {
    if (Platform.OS === 'android' && mode === 'datetime' && !androidTime) {
      setStage(date);
      setAndroidTime(true);
      return;
    }
    const clock = localDateTime(date.toISOString(), timezone).slice(11);
    onChange(
      mode === 'time' ? (endOfDay && clock === '00:00' ? '24:00' : clock) : date.toISOString(),
    );
    setOpen(false);
    setAndroidTime(false);
    setStage(undefined);
  };
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <Button
        label={`${label}: ${value ? (mode === 'time' ? (value === '24:00' ? 'Midnight, end of day' : value) : formatDateTime(value, timezone)) : 'Choose a time'}`}
        secondary
        disabled={disabled}
        onPress={() => setOpen(!open)}
      />
      {open ? (
        <DateTimePicker
          value={stage ?? selected}
          mode={
            mode === 'time' || androidTime ? 'time' : Platform.OS === 'ios' ? 'datetime' : 'date'
          }
          display={Platform.OS === 'ios' ? 'compact' : 'default'}
          timeZoneName={timezone}
          themeVariant={theme}
          disabled={disabled}
          accessibilityLabel={label}
          onValueChange={(_event, date) => choose(date)}
          onDismiss={() => {
            setOpen(false);
            setAndroidTime(false);
          }}
        />
      ) : null}
    </View>
  );
}
