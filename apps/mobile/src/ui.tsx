import { a11yState } from './components/accessibility';
import React, { useState } from 'react';
import { Platform, Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';
import { useDesign } from './design/ThemeProvider';
import { typeRoles } from './design/tokens';
import { Icon, IconName } from './components/Icon';
import { StatusLabel } from './components/primitives';
export { useDesign, useUI } from './design/ThemeProvider';
export { a11yState } from './components/accessibility';
export {
  SwitchControl,
  CheckboxControl,
  ChoiceChip,
  WeekdayChips,
  LoadingState,
  EmptyState,
  ErrorState,
} from './components/choices';
export { Icon, IconName } from './components/Icon';
export { FeatureHeader } from './components/FeatureHeader';
export {
  ActionButton as Button,
  AppText,
  AppScreen,
  TextField as Field,
  IconButton,
  Notice,
  StatusLabel,
  Disclosure,
  DetailSheet,
} from './components/primitives';

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { styles } = useDesign();
  return <View style={[styles.card, style]}>{children}</View>;
}
export function Badge({
  text,
  tone = 'neutral',
}: {
  text: string;
  tone?:
    'green' | 'amber' | 'red' | 'blue' | 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  return (
    <StatusLabel
      text={text}
      tone={
        {
          green: 'success',
          amber: 'warning',
          red: 'danger',
          blue: 'accent',
          neutral: 'neutral',
          success: 'success',
          warning: 'warning',
          danger: 'danger',
          accent: 'accent',
        }[tone] as 'success' | 'warning' | 'danger' | 'accent' | 'neutral'
      }
    />
  );
}
function ChoiceItem({
  label,
  selected,
  onPress,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { semantic } = useDesign(),
    [focused, setFocused] = useState(false);
  return (
    <Pressable
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={label}
      {...a11yState({ checked: selected, disabled })}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => ({
        minHeight: 48,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 16,
        backgroundColor: selected
          ? pressed
            ? semantic.actionPressed
            : semantic.action
          : pressed
            ? semantic.surfaceRaised
            : semantic.surface,
        borderWidth: 1,
        borderColor: semantic.borderStrong,
        ...(Platform.OS === 'web' && focused
          ? {
              outlineColor: semantic.focus,
              outlineStyle: 'solid' as const,
              outlineWidth: 3,
              outlineOffset: 3,
            }
          : {}),
      })}
    >
      <Text
        style={[
          typeRoles.supporting,
          {
            color: selected ? semantic.onAction : semantic.text,
            fontWeight: selected ? '600' : '400',
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const { styles } = useDesign();
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.h3}>{label}</Text>
      <View style={styles.chips}>
        {options.map((option) => (
          <ChoiceItem
            key={option.value}
            disabled={disabled}
            label={option.label}
            selected={value === option.value}
            onPress={() => onChange(option.value)}
          />
        ))}
      </View>
    </View>
  );
}
export function Empty({ icon, title, detail }: { icon: IconName; title: string; detail: string }) {
  const { colors, styles } = useDesign();
  return (
    <View style={{ paddingVertical: 24, gap: 12, alignItems: 'center' }}>
      <Icon name={icon} size={32} color={colors.muted} />
      <Text style={[styles.h3, { textAlign: 'center' }]}>{title}</Text>
      <Text style={[styles.subtitle, { textAlign: 'center' }]}>{detail}</Text>
    </View>
  );
}
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const { colors } = useDesign();
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      {...(Platform.OS === 'web' ? { 'aria-hidden': true } : {})}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.lightGreen,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: colors.green, fontSize: size * 0.34, fontWeight: '600' }}>
        {name
          .split(' ')
          .filter(Boolean)
          .map((word) => word[0])
          .slice(0, 2)
          .join('')}
      </Text>
    </View>
  );
}
export function statusLabel(status: string) {
  return (
    (
      {
        draft: 'Ready to review',
        authorized: 'Authorized',
        queued: 'In the queue',
        calling: 'Conversation in progress',
        awaiting_owner: 'Your decision needed',
        completed: 'Completed',
        partial: 'Partially completed',
        unresolved: 'Unresolved',
        cancelled: 'Cancelled',
      } as Record<string, string>
    )[status] ?? 'Status unavailable'
  );
}
