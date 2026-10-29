import React from 'react';
import { ActivityIndicator, Platform, Pressable, Switch as NativeSwitch, View } from 'react-native';
import { useDesign } from '../design/ThemeProvider';
import { radii, spacing } from '../design/tokens';
import { a11yState } from './accessibility';
import { Icon } from './Icon';
import { ActionButton, AppText, Notice } from './primitives';

type ChoiceProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
};
export function SwitchControl({ label, checked, onChange, disabled = false }: ChoiceProps) {
  const { semantic } = useDesign();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        minHeight: 48,
      }}
    >
      <AppText style={{ flex: 1 }}>{label}</AppText>
      <NativeSwitch
        accessibilityLabel={label}
        {...(Platform.OS === 'web'
          ? {}
          : { accessibilityRole: 'switch' as const, ...a11yState({ checked, disabled }) })}
        value={checked}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: semantic.borderStrong, true: semantic.accent }}
        thumbColor={semantic.surface}
      />
    </View>
  );
}
export function CheckboxControl({ label, checked, onChange, disabled = false }: ChoiceProps) {
  const { semantic } = useDesign();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      {...a11yState({ checked, disabled })}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => ({
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.xs,
        borderRadius: radii.control,
        backgroundColor: pressed ? semantic.surfaceRaised : semantic.surface,
      })}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderWidth: 2,
          borderRadius: 6,
          borderColor: semantic.borderStrong,
          backgroundColor: checked ? semantic.accent : semantic.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Icon name="checkmark-outline" color={semantic.onAccent} size={20} /> : null}
      </View>
      <AppText style={{ flex: 1 }}>{label}</AppText>
    </Pressable>
  );
}
export function ChoiceChip({ label, checked, onChange, disabled = false }: ChoiceProps) {
  const { semantic } = useDesign();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      {...a11yState({ checked, disabled })}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => ({
        minHeight: 48,
        minWidth: 48,
        padding: spacing.md,
        borderRadius: radii.capsule,
        borderWidth: 1,
        borderColor: semantic.borderStrong,
        backgroundColor: checked
          ? semantic.accent
          : pressed
            ? semantic.surfaceRaised
            : semantic.surface,
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      <AppText role="action" style={{ color: checked ? semantic.onAccent : semantic.text }}>
        {label}
      </AppText>
    </Pressable>
  );
}
export function WeekdayChips({
  values,
  onChange,
  disabled = false,
}: {
  values: number[];
  onChange: (days: number[]) => void;
  disabled?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {Array.from({ length: 7 }, (_, day) => {
        const label = new Intl.DateTimeFormat(undefined, {
          weekday: 'short',
          timeZone: 'UTC',
        }).format(new Date(Date.UTC(2024, 0, 7 + day)));
        return (
          <ChoiceChip
            key={day}
            label={label}
            checked={values.includes(day)}
            disabled={disabled}
            onChange={(checked) =>
              onChange(checked ? [...values, day].sort() : values.filter((value) => value !== day))
            }
          />
        );
      })}
    </View>
  );
}
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  const { semantic } = useDesign();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={{ gap: spacing.md, padding: spacing.lg }}
    >
      <ActivityIndicator color={semantic.accent} />
      <AppText>{label}</AppText>
    </View>
  );
}
export function EmptyState({
  title,
  detail,
  action,
  onAction,
}: {
  title: string;
  detail?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={{ gap: spacing.md }}>
      <AppText role="section" accessibilityRole="header">
        {title}
      </AppText>
      {detail ? <AppText>{detail}</AppText> : null}
      {action && onAction ? <ActionButton label={action} onPress={onAction} /> : null}
    </View>
  );
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={{ gap: spacing.md }}>
      <Notice tone="error">{message}</Notice>
      {onRetry ? <ActionButton label="Try again" secondary onPress={onRetry} /> : null}
    </View>
  );
}
