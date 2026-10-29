import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../../components/primitives';
import { Button, Choice, Disclosure, Field, useUI } from '../../ui';
import { deviceTimezone } from './format';
import { timezoneLabel } from './date-fields';

export function TimezoneField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { styles } = useUI(),
    [query, setQuery] = useState('');
  const zones = useMemo(
    () => [
      ...new Set([
        'UTC',
        deviceTimezone(),
        ...(typeof Intl.supportedValuesOf === 'function'
          ? Intl.supportedValuesOf('timeZone')
          : ['America/New_York', 'Europe/Skopje']),
      ]),
    ],
    [],
  );
  const matching = zones
    .filter((zone) =>
      `${zone} ${timezoneLabel(zone)}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    )
    .slice(0, 8);
  return (
    <Disclosure title={`${label}: ${timezoneLabel(value)}`}>
      <View style={{ gap: 12 }}>
        <Button
          label={`Use device timezone for ${label.toLowerCase()}`}
          secondary
          disabled={disabled}
          onPress={() => onChange(deviceTimezone())}
        />
        <Field
          label={`Search ${label.toLowerCase()}`}
          value={query}
          onChangeText={setQuery}
          editable={!disabled}
          placeholder="City or region"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {matching.length ? (
          <Choice
            label={`Choose ${label.toLowerCase()}`}
            value={value}
            disabled={disabled}
            options={matching.map((zone) => ({ value: zone, label: timezoneLabel(zone) }))}
            onChange={onChange}
          />
        ) : (
          <Text style={styles.small}>No matching timezones. Search another city or region.</Text>
        )}
      </View>
    </Disclosure>
  );
}
