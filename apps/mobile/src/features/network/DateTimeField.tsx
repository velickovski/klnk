import React, { useEffect, useId, useRef, useState } from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../../components/primitives';
import { Choice, Notice, useUI } from '../../ui';
import { deviceTimezone, formatDateTime } from './format';
import { localDateTime, possibleInstants, type DateFieldProps } from './date-fields';

/** Browser-native form control. Native builds resolve DateTimeField.native. */
export function DateTimeField({
  label,
  value,
  onChange,
  timezone = deviceTimezone(),
  disabled,
  mode = 'datetime',
  endOfDay,
}: DateFieldProps) {
  const { colors, styles } = useUI(),
    id = useId();
  const [local, setLocal] = useState(() =>
      mode === 'time' ? (value === '24:00' ? '00:00' : value) : localDateTime(value, timezone),
    ),
    [choices, setChoices] = useState<string[]>([]),
    [error, setError] = useState('');
  const editing = useRef(false);
  const previousTimezone = useRef(timezone);
  useEffect(() => {
    if (previousTimezone.current !== timezone) {
      previousTimezone.current = timezone;
      editing.current = false;
      setChoices([]);
      setError('');
    }
    if (value || !editing.current)
      setLocal(
        mode === 'time' ? (value === '24:00' ? '00:00' : value) : localDateTime(value, timezone),
      );
  }, [value, timezone, mode]);
  const change = (text: string) => {
    editing.current = true;
    setLocal(text);
    setError('');
    setChoices([]);
    if (mode === 'time') {
      onChange(endOfDay && text === '00:00' ? '24:00' : text);
      return;
    }
    if (!text) {
      onChange('');
      return;
    }
    const candidates = possibleInstants(text, timezone);
    if (candidates.length === 1) onChange(candidates[0]);
    else {
      onChange('');
      setChoices(candidates);
      setError(
        candidates.length
          ? 'This local time occurs twice. Choose its first or second occurrence.'
          : 'This local time does not exist or is incomplete. Choose another time.',
      );
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <input
        id={id}
        aria-label={label}
        type={mode === 'time' ? 'time' : 'datetime-local'}
        value={local}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => change(event.currentTarget.value)}
        style={{
          boxSizing: 'border-box',
          width: '100%',
          minHeight: 48,
          borderRadius: 12,
          padding: 12,
          border: `1px solid ${colors.line}`,
          background: colors.white,
          color: colors.ink,
          font: 'inherit',
        }}
      />
      {error ? (
        <View nativeID={`${id}-error`}>
          <Notice tone="error">{error}</Notice>
        </View>
      ) : null}
      {choices.length > 1 ? (
        <Choice
          label={`${label}: clock-change occurrence`}
          value={value}
          disabled={disabled}
          options={choices.map((instant, index) => ({
            value: instant,
            label: `${index ? 'Second' : 'First'}: ${formatDateTime(instant, timezone)}`,
          }))}
          onChange={(instant) => {
            setChoices([]);
            setError('');
            onChange(instant);
          }}
        />
      ) : null}
    </View>
  );
}
