import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type PressableProps,
} from 'react-native';
import { AppScreen } from '../../components/primitives';
import { StatusBar } from 'expo-status-bar';
import { brand, radii, spacing, typeRoles } from '../../design/tokens';
import { ThemeProvider } from '../../design/ThemeProvider';
import {
  createNavigatorFactory,
  NavigationContainer,
  TabRouter,
  useLinkProps,
  useNavigation,
  useNavigationBuilder,
  useRoute,
  DarkTheme,
  DefaultTheme,
  type DefaultNavigatorOptions,
  type NavigationHelpers,
  type NavigationProp,
  type ParamListBase,
  type RouteProp,
  type TabActionHelpers,
  type TabNavigationState,
  type TabRouterOptions,
} from '@react-navigation/native';
import {
  a11yState,
  Button,
  Card,
  Disclosure,
  Icon,
  IconButton,
  Notice,
  useUI,
  type IconName,
} from '../../ui';
import type { NetworkConversation } from '@personal-agent/domain';
import { InboxPanel } from './InboxPanel';
import { PeoplePanel } from './PeoplePanel';
import { MemoryPanel } from './MemoryPanel';
import { AutonomyPanel } from './AutonomyPanel';
import { CalendarPanel } from './CalendarPanel';
import { VoiceAccessPanel } from './VoiceAccessPanel';
import { PreferencesPanel } from './PreferencesPanel';
import { NotificationsPanel, type NoticesView } from './NotificationsPanel';
import { OwnerIntentPanel } from './OwnerIntentPanel';
import { useNetworkQuery } from './data-provider';
import { FirstRunPanel } from './FirstRunPanel';

export type NetworkRoutes = {
  Inbox: { conversationId?: string } | undefined;
  Calendar: undefined;
  People: { memberCode?: string } | undefined;
  Memory: undefined;
  Settings: undefined;
};
type Panel = keyof NetworkRoutes;
const panelIcons: Record<Panel, IconName> = {
  Inbox: 'chatbubbles-outline',
  Calendar: 'calendar-outline',
  People: 'people-outline',
  Memory: 'layers-outline',
  Settings: 'options-outline',
};
type WorkspaceProps = {
  ownerId: string;
  onVoiceHome: () => void;
  onLegacy?: () => void;
  onSignOut: () => void;
  accountPanel?: React.ReactNode;
  voicePanel?: React.ReactNode;
  initialLink?: string;
};
const Context = createContext<WorkspaceProps | null>(null);
function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error('Workspace context is missing.');
  return value;
}
const linking = {
  prefixes: ['personal-agent://', 'klnk://'],
  config: {
    screens: {
      Inbox: 'workspace/inbox/:conversationId?',
      Calendar: 'workspace/calendar',
      People: { path: 'workspace/people/:memberCode?', alias: ['join/:memberCode'] },
      Memory: 'workspace/memory',
      Settings: 'workspace/settings',
    },
  },
};

type NavigatorProps = DefaultNavigatorOptions<
  ParamListBase,
  undefined,
  TabNavigationState<ParamListBase>,
  {},
  {},
  NavigationHelpers<ParamListBase>
> &
  TabRouterOptions;
function WorkspaceNavigator(props: NavigatorProps) {
  const { state, navigation, descriptors, render } = useNavigationBuilder<
    TabNavigationState<ParamListBase>,
    TabRouterOptions,
    TabActionHelpers<ParamListBase>,
    {},
    {}
  >(TabRouter, props);
  const keyboardTab = useRef(false);
  const navigationStrip = useRef<React.ElementRef<typeof ScrollView>>(null);
  const tabOffsets = useRef(new Map<Panel, number>());
  const { width } = useWindowDimensions();
  const { onVoiceHome, ownerId } = useWorkspace(),
    { colors, styles, reducedMotion } = useUI();
  const title = useRef<React.ElementRef<typeof Text>>(null);
  const selected = state.routes[state.index],
    name = selected.name as Panel;
  const inbox = useNetworkQuery<{ conversations: NetworkConversation[]; unread: number }>(
    '/network/conversations',
  );
  const notices = useNetworkQuery<NoticesView>('/network/notifications');
  const unread = new Set([
    ...(inbox.data?.conversations
      .filter((item) => !item.readBy.includes(ownerId))
      .map((item) => item.id) ?? []),
    ...(notices.data?.items
      .filter((item) => !item.kind.startsWith('calendar_'))
      .map((item) => item.conversationId) ?? []),
  ]).size;
  const calendarUpdates =
    notices.data?.items.filter((item) => item.kind.startsWith('calendar_')).length ?? 0;
  useEffect(() => {
    const arrow = keyboardTab.current;
    keyboardTab.current = false;
    const frame = requestAnimationFrame(() => {
      navigationStrip.current?.scrollTo({
        x: Math.max(0, (tabOffsets.current.get(name) ?? 0) - 8),
        animated: !reducedMotion,
      });
      if (Platform.OS === 'web') {
        // A keyboard user may already have moved into the newly mounted panel
        // before this frame. Announce the heading only if that would not steal
        // focus from the control they chose.
        const panel = document.getElementById(`network-screen-${name.toLowerCase()}`);
        const active = document.activeElement;
        if (panel?.contains(active) || active?.closest('[role="dialog"]')) return;
        const target = arrow
          ? document.getElementById(`network-tab-${name}`)
          : (title.current as unknown as HTMLElement | null);
        target?.focus?.();
      } else {
        const handle = findNodeHandle(title.current);
        if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [name]);
  return render(
    <AppScreen
      scroll={false}
      safeAreaColor={brand.navy}
      style={{
        flex: 1,
        width: '100%',
        maxWidth: 720,
        alignSelf: 'center',
        backgroundColor: colors.paper,
      }}
    >
      <StatusBar style="light" />
      <ThemeProvider colorScheme="dark">
        <View
          style={{
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.md,
            paddingBottom: spacing.xl,
            gap: spacing.sm,
            backgroundColor: brand.navy,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: spacing.md,
            }}
          >
            <IconButton name="arrow-back" label="Back to voice home" onPress={onVoiceHome} />
            <Text style={{ ...typeRoles.action, color: brand.onNavyMuted, letterSpacing: -0.4 }}>
              klnk
            </Text>
          </View>
          <Text
            ref={title}
            accessibilityRole="header"
            nativeID={`network-heading-${name}`}
            {...(Platform.OS === 'web' ? { tabIndex: -1 } : {})}
            style={{
              ...(width < 360 ? typeRoles.compactTitle : typeRoles.title),
              color: brand.cream,
              letterSpacing: -0.8,
            }}
          >
            {name}
          </Text>
        </View>
      </ThemeProvider>
      <View style={{ flex: 1, backgroundColor: brand.navy }}>
        <View
          key={selected.key}
          nativeID={`network-screen-${name.toLowerCase()}`}
          testID={`network-screen-${name.toLowerCase()}`}
          style={{
            flex: 1,
            backgroundColor: colors.paper,
            borderTopLeftRadius: radii.sheet,
            borderTopRightRadius: radii.control,
            overflow: 'hidden',
          }}
          {...(Platform.OS === 'web'
            ? { role: 'tabpanel', 'aria-labelledby': `network-tab-${name}` }
            : {})}
        >
          {name === 'Settings' ? (
            <ScrollView
              style={{ flex: 1 }}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.page}
            >
              {descriptors[selected.key].render()}
            </ScrollView>
          ) : (
            descriptors[selected.key].render()
          )}
        </View>
      </View>
      <ScrollView
        ref={navigationStrip}
        horizontal
        showsHorizontalScrollIndicator
        testID="network-navigation"
        style={{ flexGrow: 0, flexShrink: 0, backgroundColor: colors.white }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          accessibilityRole="tablist"
          style={{
            flexDirection: 'row',
            padding: 8,
            gap: 4,
            alignItems: 'center',
            flexGrow: 1,
            justifyContent: 'space-around',
          }}
        >
          {state.routes.map((route, index) => (
            <Tab
              key={route.key}
              name={route.name as Panel}
              selected={state.index === index}
              onLayout={(event) => {
                tabOffsets.current.set(route.name as Panel, event.nativeEvent.layout.x);
                if (state.index === index)
                  navigationStrip.current?.scrollTo({
                    x: Math.max(0, event.nativeEvent.layout.x - 8),
                    animated: false,
                  });
              }}
              updates={
                route.name === 'Inbox' ? unread : route.name === 'Calendar' ? calendarUpdates : 0
              }
              onArrow={(direction) => {
                keyboardTab.current = true;
                navigation.navigate(
                  state.routes[(index + direction + state.routes.length) % state.routes.length]
                    .name,
                );
              }}
            />
          ))}
        </View>
      </ScrollView>
    </AppScreen>,
  );
}
function Tab({
  name,
  selected,
  updates,
  onArrow,
  onLayout,
}: {
  name: Panel;
  selected: boolean;
  updates: number;
  onArrow: (direction: number) => void;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  const [focused, setFocused] = useState(false);
  const { colors, styles, semantic } = useUI(),
    dimensions = useWindowDimensions();
  const link = useLinkProps<NetworkRoutes>({ screen: name });
  const minimum =
    Platform.OS === 'web'
      ? ('max-content' as unknown as number)
      : Math.min(dimensions.width - 48, 64 * Math.max(1, dimensions.fontScale));
  return (
    <Pressable
      nativeID={`network-tab-${name}`}
      accessibilityRole="tab"
      accessibilityLabel={name}
      accessibilityHint={updates ? `${updates} unread updates` : undefined}
      {...a11yState({ selected })}
      onPress={link.onPress}
      onLayout={onLayout}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      {...(Platform.OS === 'web'
        ? {
            href: link.href,
            tabIndex: selected ? 0 : -1,
            'aria-controls': `network-screen-${name.toLowerCase()}`,
            'aria-describedby': updates ? `network-updates-${name}` : undefined,
            onKeyDown: (event: Parameters<NonNullable<PressableProps['onKeyDown']>>[0]) => {
              const key = event.nativeEvent.key;
              if (key === 'ArrowRight' || key === 'ArrowLeft') {
                event.preventDefault();
                onArrow(key === 'ArrowRight' ? 1 : -1);
              }
            },
          }
        : {})}
      style={({ pressed }) => ({
        flexBasis: 'auto',
        flexGrow: 0,
        flexShrink: 0,
        minWidth: minimum,
        minHeight: 64,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: radii.group,
        backgroundColor: selected ? colors.action : pressed ? colors.lightGreen : colors.white,
        borderWidth: 1,
        borderColor: selected ? colors.ink : colors.white,
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        gap: 4,
        ...(Platform.OS === 'web' && focused
          ? {
              outlineColor: semantic.focus,
              outlineWidth: 3,
              outlineStyle: 'solid' as const,
              outlineOffset: 2,
            }
          : {}),
      })}
    >
      <Icon name={panelIcons[name]} color={selected ? colors.onAction : colors.ink} size={22} />
      <Text
        style={[
          styles.text,
          typeRoles.caption,
          {
            fontWeight: selected ? '600' : '400',
            color: selected ? colors.onAction : colors.ink,
            textAlign: 'center',
            flexShrink: Platform.OS === 'web' ? 0 : 1,
          },
        ]}
      >
        {name}
      </Text>
      {updates ? (
        <Text
          nativeID={`network-updates-${name}`}
          style={[styles.small, { color: selected ? colors.onAction : colors.ink }]}
        >
          {updates > 99 ? '99+' : updates}
        </Text>
      ) : null}
    </Pressable>
  );
}
const Tabs = createNavigatorFactory(WorkspaceNavigator)();
function InboxScreen() {
  const { ownerId, voicePanel } = useWorkspace(),
    navigation = useNavigation<NavigationProp<NetworkRoutes>>(),
    route = useRoute<RouteProp<NetworkRoutes, 'Inbox'>>();
  const conversation = (id?: string) => navigation.navigate('Inbox', { conversationId: id });
  return (
    <InboxPanel
      ownerId={ownerId}
      conversationId={route.params?.conversationId}
      onConversation={conversation}
      onCalendar={() => navigation.navigate('Calendar')}
      header={
        <View style={{ gap: 24 }}>
          {voicePanel}
          <FirstRunPanel
            ownerId={ownerId}
            onPeople={() => navigation.navigate('People')}
            onCalendar={() => navigation.navigate('Calendar')}
            onSettings={() => navigation.navigate('Settings')}
          />
          <OwnerIntentPanel ownerId={ownerId} />
        </View>
      }
      footer={<NotificationsPanel ownerId={ownerId} onConversation={conversation} />}
    />
  );
}
function CalendarScreen() {
  const { ownerId } = useWorkspace(),
    navigation = useNavigation<NavigationProp<NetworkRoutes>>();
  return (
    <CalendarPanel
      ownerId={ownerId}
      onConversation={(id) => navigation.navigate('Inbox', { conversationId: id })}
    />
  );
}
function PeopleScreen() {
  const { ownerId } = useWorkspace(),
    route = useRoute<RouteProp<NetworkRoutes, 'People'>>();
  return <PeoplePanel ownerId={ownerId} memberCode={route.params?.memberCode} />;
}
function MemoryScreen() {
  return <MemoryPanel ownerId={useWorkspace().ownerId} />;
}
function SettingsScreen() {
  const { ownerId, accountPanel, onLegacy, onSignOut } = useWorkspace(),
    { styles } = useUI();
  return (
    <View style={{ gap: 24 }}>
      <Disclosure
        title="Delegation"
        icon="options-outline"
        detail="Limits & approvals"
        preserveContent
      >
        <AutonomyPanel ownerId={ownerId} />
      </Disclosure>
      <Disclosure
        title="Voice permissions"
        icon="mic-outline"
        detail="What your voice agent can do"
        preserveContent
      >
        <VoiceAccessPanel ownerId={ownerId} />
      </Disclosure>
      <Disclosure
        title="Preferences"
        icon="notifications-outline"
        detail="Privacy & reminders"
        preserveContent
      >
        <PreferencesPanel ownerId={ownerId} />
      </Disclosure>
      <Disclosure
        title="Account"
        icon="person-circle-outline"
        detail="Sign-in & personal data"
        preserveContent
      >
        {accountPanel}
      </Disclosure>
      <Card>
        <Text accessibilityRole="header" style={styles.h2}>
          About your data
        </Text>
        <Disclosure title="How this works">
          <Notice>
            Messages, meetings and reminders stay inside klnk. Owner voice and optional model
            reasoning use OpenAI’s cloud. klnk’s server reads permitted content; this is not
            end-to-end encrypted processing.
          </Notice>
          <Text style={styles.text}>
            Only the klnk calendar is checked. Reminders appear in the app; closed-app delivery is
            not established.
          </Text>
        </Disclosure>
        {onLegacy ? (
          <Button label="Account settings & earlier requests" secondary onPress={onLegacy} />
        ) : null}
        <Button label="Sign out" secondary onPress={onSignOut} />
      </Card>
    </View>
  );
}
export function NetworkWorkspace(props: WorkspaceProps) {
  const { colors, theme } = useUI(),
    base = theme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <Context.Provider value={props}>
      <NavigationContainer
        linking={{
          ...linking,
          getInitialURL: async () => props.initialLink ?? Linking.getInitialURL(),
        }}
        documentTitle={{
          formatter: (options, route) => `${options?.title ?? route?.name ?? 'Your agent'} · klnk`,
        }}
        theme={{
          ...base,
          colors: {
            ...base.colors,
            background: colors.paper,
            card: colors.white,
            text: colors.ink,
            primary: colors.action,
            border: colors.line,
          },
        }}
      >
        <Tabs.Navigator initialRouteName="Inbox" backBehavior="fullHistory">
          <Tabs.Screen name="Inbox" component={InboxScreen} />
          <Tabs.Screen name="Calendar" component={CalendarScreen} />
          <Tabs.Screen name="People" component={PeopleScreen} />
          <Tabs.Screen name="Memory" component={MemoryScreen} />
          <Tabs.Screen name="Settings" component={SettingsScreen} />
        </Tabs.Navigator>
      </NavigationContainer>
    </Context.Provider>
  );
}
