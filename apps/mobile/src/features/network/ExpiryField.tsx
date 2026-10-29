import React from 'react';
import { View } from 'react-native';
import { Button, useUI } from '../../ui';
import { DateTimeField } from './DateTimeField';

export function ExpiryField({
  label,
  value,
  onChange,
  disabled,
  timezone,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  timezone?: string;
}) {
  const { styles } = useUI();
  return (
    <View style={{ gap: 12 }}>
      <DateTimeField
        label={label}
        value={value}
        onChange={onChange}
        disabled={disabled}
        timezone={timezone}
      />
      <View style={styles.chips}>
        {[1, 7, 30].map((days) => (
          <Button
            key={days}
            label={`${label}: ${days === 1 ? 'tomorrow' : `in ${days} days`}`}
            secondary
            compact
            disabled={disabled}
            onPress={() => onChange(new Date(Date.now() + days * 86400000).toISOString())}
          />
        ))}
      </View>
    </View>
  );
}
