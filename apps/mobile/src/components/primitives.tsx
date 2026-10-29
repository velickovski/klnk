import { a11yState } from './accessibility';
import React, { useEffect, useId, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  findNodeHandle,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  Text,
  TextInput,
  TextInputProps,
  TextProps,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDesign } from '../design/ThemeProvider';
import { motion, radii, typeRoles } from '../design/tokens';
import Animated, { cubicBezier, useReducedMotion } from 'react-native-reanimated';
import { Icon, IconName } from './Icon';

export function AppText({
  role = 'body',
  style,
  ...props
}: Omit<TextProps, 'role'> & { role?: keyof typeof typeRoles }) {
  const { colors } = useDesign();
  return <Text {...props} style={[typeRoles[role], { color: colors.ink }, style]} />;
}
export function AppScreen({
  children,
  scroll = true,
  style,
  safeAreaColor,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  safeAreaColor?: string;
}) {
  const { colors, styles } = useDesign();
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: safeAreaColor ?? colors.paper }}
      edges={['top', 'left', 'right', 'bottom']}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.paper }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.page, style]}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1 }, style]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function ActionButton({
  label,
  onPress,
  icon,
  secondary = false,
  danger = false,
  disabled = false,
  loading = false,
  compact = false,
  prominent = false,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  prominent?: boolean;
}) {
  const { semantic, styles, reducedMotion } = useDesign(),
    systemReducedMotion = useReducedMotion(),
    [focused, setFocused] = useState(false),
    [pressed, setPressed] = useState(false);
  const inactive = disabled || loading;
  const feedback = prominent || (!secondary && !danger);
  const tint = inactive
    ? semantic.textSecondary
    : danger
      ? semantic.danger
      : secondary
        ? semantic.accent
        : semantic.onAction;
  const button = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      {...a11yState({ disabled: inactive, busy: loading })}
      disabled={inactive}
      onPress={onPress}
      onPressIn={feedback ? () => setPressed(true) : undefined}
      onPressOut={feedback ? () => setPressed(false) : undefined}
      pressRetentionOffset={16}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        prominent ? { minHeight: 64, borderRadius: radii.capsule, paddingVertical: 18 } : null,
        {
          backgroundColor: inactive
            ? semantic.surfaceRaised
            : danger
              ? semantic.dangerSurface
              : secondary
                ? semantic.surface
                : pressed
                  ? semantic.actionPressed
                  : semantic.action,
          borderWidth: 1,
          borderColor: pressed ? semantic.text : semantic.borderStrong,
          ...(compact ? { minHeight: 44, paddingVertical: 10 } : {}),
          ...(Platform.OS === 'web' && focused
            ? {
                outlineColor: semantic.focus,
                outlineStyle: 'solid' as const,
                outlineWidth: 3,
                outlineOffset: 3,
              }
            : {}),
        },
        secondary && pressed ? { backgroundColor: semantic.surfaceRaised } : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tint} />
      ) : icon ? (
        <Icon name={icon} color={tint} size={20} />
      ) : null}
      <Text style={[typeRoles.action, { color: tint, flexShrink: 1, textAlign: 'center' }]}>
        {label}
      </Text>
    </Pressable>
  );
  if (!feedback) return button;
  const reduce = reducedMotion || systemReducedMotion;
  return (
    <Animated.View
      style={
        reduce
          ? undefined
          : {
              transform: [{ scale: pressed && !inactive ? 0.97 : 1 }],
              transitionProperty: 'transform',
              transitionDuration: motion.pressMs,
              transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
            }
      }
    >
      {button}
    </Animated.View>
  );
}
export function IconButton({
  name,
  label,
  onPress,
}: {
  name: IconName;
  label: string;
  onPress: () => void;
}) {
  const { semantic } = useDesign(),
    [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => ({
        width: 48,
        minHeight: 48,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: semantic.borderStrong,
        backgroundColor: pressed ? semantic.surfaceRaised : semantic.surface,
        alignItems: 'center',
        justifyContent: 'center',
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
      <Icon name={name} />
    </Pressable>
  );
}
export function TextField({
  label,
  hint,
  error,
  multiline,
  style,
  onFocus,
  onBlur,
  ...props
}: TextInputProps & { label: string; hint?: string; error?: string }) {
  const { colors, styles } = useDesign(),
    [focused, setFocused] = useState(false),
    id = useId().replace(/:/g, '');
  const helpId = `field-help-${id}`;
  return (
    <View style={{ gap: 8 }}>
      <AppText role="action">{label}</AppText>
      <TextInput
        {...props}
        accessibilityLabel={props.accessibilityLabel ?? label}
        {...(Platform.OS === 'web'
          ? { 'aria-describedby': hint || error ? helpId : undefined, 'aria-invalid': !!error }
          : {})}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.field,
          multiline ? { minHeight: 108, textAlignVertical: 'top' } : null,
          {
            borderColor: error ? colors.red : focused ? colors.focus : colors.line,
            borderWidth: focused ? 2 : 1,
          },
          style,
        ]}
      />
      {error || hint ? (
        <AppText
          nativeID={helpId}
          role="supporting"
          accessibilityRole={error ? 'alert' : undefined}
          style={{ color: error ? colors.red : colors.muted }}
        >
          {error ?? hint}
        </AppText>
      ) : null}
    </View>
  );
}
export function Notice({
  children,
  tone = 'info',
}: {
  children: React.ReactNode;
  tone?: 'info' | 'error' | 'warning';
}) {
  const { colors } = useDesign();
  const text = tone === 'error' ? colors.red : tone === 'warning' ? colors.amber : colors.ink,
    background =
      tone === 'error'
        ? colors.lightRed
        : tone === 'warning'
          ? colors.lightAmber
          : colors.lightGreen;
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      style={{
        borderRadius: radii.control,
        backgroundColor: background,
        padding: 16,
        flexDirection: 'row',
        gap: 12,
        borderWidth: 1,
        borderColor: colors.line,
      }}
    >
      <Icon
        name={tone === 'error' ? 'alert-circle-outline' : 'information-circle-outline'}
        size={22}
        color={text}
      />
      <Text style={[typeRoles.supporting, { flex: 1, color: text }]}>{children}</Text>
    </View>
  );
}
export function StatusLabel({
  text,
  tone = 'neutral',
}: {
  text: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  const { semantic } = useDesign();
  const pair = {
    neutral: [semantic.text, semantic.surfaceRaised],
    accent: [semantic.accent, semantic.surfaceRaised],
    success: [semantic.success, semantic.successSurface],
    warning: [semantic.warning, semantic.warningSurface],
    danger: [semantic.danger, semantic.dangerSurface],
  }[tone];
  return (
    <View
      style={{
        backgroundColor: pair[1],
        alignSelf: 'flex-start',
        maxWidth: '100%',
        flexShrink: 1,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 10,
      }}
    >
      <Text style={[typeRoles.caption, { color: pair[0], maxWidth: '100%', flexShrink: 1 }]}>
        {text}
      </Text>
    </View>
  );
}
export function Disclosure({
  title,
  children,
  initiallyOpen = false,
  icon,
  detail,
  preserveContent = false,
}: {
  title: string;
  children: React.ReactNode;
  initiallyOpen?: boolean;
  icon?: IconName;
  detail?: string;
  preserveContent?: boolean;
}) {
  const { colors, semantic } = useDesign(),
    [open, setOpen] = useState(initiallyOpen),
    [visited, setVisited] = useState(initiallyOpen),
    [focused, setFocused] = useState(false),
    id = useId();
  return (
    <View style={{ gap: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        {...a11yState({ expanded: open })}
        {...(Platform.OS === 'web' ? { 'aria-controls': id } : {})}
        onPress={() => {
          setVisited(true);
          setOpen(!open);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={({ pressed }) => ({
          minHeight: icon ? 72 : 52,
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderRadius: radii.control,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: pressed ? colors.lightGreen : colors.white,
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
          ...(Platform.OS === 'web' && focused
            ? {
                outlineColor: semantic.focus,
                outlineWidth: 3,
                outlineStyle: 'solid' as const,
                outlineOffset: 3,
              }
            : {}),
        })}
      >
        {icon ? <Icon name={icon} color={semantic.accent} size={24} /> : null}
        <View
          style={{
            flex: 1,
            gap: 4,
            ...(Platform.OS === 'web' ? { minWidth: 'min-content' as unknown as number } : {}),
          }}
        >
          <AppText role="action">{title}</AppText>
          {detail ? (
            <AppText role="supporting" style={{ color: semantic.textSecondary }}>
              {detail}
            </AppText>
          ) : null}
        </View>
        <View style={{ marginLeft: 'auto' }}>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} />
        </View>
      </Pressable>
      {open || (preserveContent && visited) ? (
        <View nativeID={id} style={open ? undefined : { display: 'none' }}>
          {children}
        </View>
      ) : null}
    </View>
  );
}
export function DetailSheet({
  visible,
  title,
  onClose,
  children,
  revealTop = false,
  returnFocusRef,
  returnFocusId,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  revealTop?: boolean;
  returnFocusRef?: React.RefObject<React.ElementRef<typeof View> | null>;
  returnFocusId?: string;
}) {
  const { colors, styles, reducedTransparency, reducedMotion } = useDesign(),
    startupReducedMotion = useReducedMotion(),
    closeRef = useRef<React.ElementRef<typeof View>>(null),
    onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const scrollRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const mounted = useRef(true);
  const openRef = useRef(visible);
  openRef.current = visible;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (revealTop) scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [revealTop]);
  useEffect(() => {
    if (!visible) return;
    if (Platform.OS === 'web') previousFocus.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      if (Platform.OS === 'web') {
        const element = closeRef.current as unknown as HTMLElement | null;
        element?.focus?.();
      } else {
        const handle = findNodeHandle(closeRef.current);
        if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
      }
    });
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    if (Platform.OS === 'web') document.addEventListener('keydown', keyboard);
    return () => {
      cancelAnimationFrame(frame);
      if (Platform.OS === 'web') {
        document.removeEventListener('keydown', keyboard);
      }
    };
  }, [visible]);
  return (
    <Modal
      visible={visible}
      animationType={reducedMotion || startupReducedMotion ? 'none' : 'fade'}
      presentationStyle={reducedTransparency ? 'fullScreen' : 'pageSheet'}
      onRequestClose={onClose}
      onDismiss={() => {
        if (Platform.OS === 'web') {
          // RN Web removes its active focus trap before onDismiss. Resolve the
          // current trigger after that lifecycle, including virtualized row reuse.
          requestAnimationFrame(() => {
            if (!mounted.current || openRef.current) return;
            const currentNode = returnFocusId ? document.getElementById(returnFocusId) : null;
            const requested =
              currentNode ?? (returnFocusRef?.current as unknown as HTMLElement | null);
            const target = requested?.isConnected ? requested : previousFocus.current;
            if (target?.isConnected) target.focus({ preventScroll: true });
          });
        } else if (mounted.current && !openRef.current && returnFocusRef?.current) {
          const handle = findNodeHandle(returnFocusRef.current);
          if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
        }
      }}
    >
      <SafeAreaView
        accessibilityViewIsModal
        style={{ flex: 1, backgroundColor: colors.paper }}
        edges={['top', 'left', 'right', 'bottom']}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View
            style={{
              padding: 16,
              gap: 12,
              flexDirection: 'row',
              alignItems: 'center',
              borderBottomLeftRadius: radii.sheet,
              backgroundColor: colors.white,
            }}
          >
            <AppText role="section" accessibilityRole="header" style={{ flex: 1 }}>
              {title}
            </AppText>
            <Pressable
              ref={closeRef}
              accessibilityRole="button"
              accessibilityLabel={`Close ${title}`}
              onPress={onClose}
              style={{
                minHeight: 48,
                minWidth: 48,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 24,
                borderWidth: 1,
                borderColor: colors.line,
                backgroundColor: colors.white,
              }}
            >
              <Icon name="close" />
            </Pressable>
          </View>
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.page}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
