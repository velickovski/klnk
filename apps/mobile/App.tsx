import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  findNodeHandle,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type {
  Contact,
  Memory,
  Mission,
  MissionInput,
  MissionTemplate,
} from '@personal-agent/domain';
import {
  ApiError,
  api,
  getSessionSnapshot,
  isSessionCurrent,
  onSessionChange,
  restoreSession,
  setSession,
  type SessionSnapshot,
} from './src/api';
import { ACTIVE, Bootstrap, MissionDetail, ReviewedMission } from './src/models';
import {
  Avatar,
  Badge,
  Button,
  Card,
  DetailSheet,
  Field,
  Icon,
  IconButton,
  IconName,
  Notice,
  statusLabel,
  useUI,
  a11yState,
} from './src/ui';
import { ThemeProvider } from './src/design/ThemeProvider';
import type { UIColors } from './src/design/tokens';
import { LaunchScreen } from './src/features/launch/LaunchScreen';
import { VoiceWorkspaceProvider } from './src/features/voice/VoiceWorkspaceProvider';
import { useLiveConversation } from './src/features/live/useLiveConversation';
import { presentMission } from './src/features/voice/presentation';
import { MissionComposer, MissionReview } from './src/mission-composer';
import { MissionConversation } from './src/mission-conversation';
import { PeopleScreen, MemoryScreen, ContactEditor, MemoryEditor } from './src/people-memory';
import { SettingsScreen, Onboarding } from './src/settings';
import { SettingsDraftProvider } from './src/features/settings/SettingsDraftProvider';
import { CallingReadiness, ConnectionPanel } from './src/setup';
import { VoiceConversation } from './src/voice-conversation';
import { voiceRequestId } from './src/features/voice/controller';
import { NetworkWorkspace } from './src/features/network/Workspace';

const legacyEnabled = process.env.EXPO_PUBLIC_LEGACY_ENABLED === 'true';
type Tab = 'Home' | 'People' | 'Memory' | 'Settings';
type Route =
  | { kind: 'compose'; template?: MissionTemplate; missionId?: string }
  | { kind: 'review'; mission: ReviewedMission }
  | { kind: 'mission'; id: string }
  | { kind: 'person'; contact?: Contact }
  | { kind: 'memory'; memory?: Memory }
  | null;

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Application />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
function Application() {
  const { theme, colors } = useUI();
  const [workspace, setWorkspace] = useState(
    () =>
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('workspace') === '1',
  );
  const live = useLiveConversation();
  const [identity, setIdentity] = useState(getSessionSnapshot),
    [identityScope, setIdentityScope] = useState(0),
    [restoring, setRestoring] = useState(true),
    [restoreError, setRestoreError] = useState('');
  const identityRef = useRef(identity);
  useEffect(() => {
    let active = true;
    const update = () => {
      if (!active) return;
      const next = getSessionSnapshot(),
        previous = identityRef.current;
      identityRef.current = next;
      if (next.token) setRestoreError('');
      if (previous.url !== next.url || previous.token !== next.token)
        setIdentityScope((scope) => scope + 1);
      setIdentity(next);
    };
    const unsubscribe = onSessionChange(update);
    restoreSession()
      .catch((error) => {
        if (active) setRestoreError((error as Error).message);
      })
      .finally(() => {
        if (active) {
          update();
          setRestoring(false);
        }
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const { width, height } = useWindowDimensions();
  const preview =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('preview') === 'iphone';
  const content = workspace ? (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      {live.closureUnconfirmed ? (
        <View style={{ gap: 12, padding: 16, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
          <Notice tone="warning">
            The microphone is off. Live session closure is still unconfirmed.
          </Notice>
          <Button
            label="Retry ending voice session"
            secondary
            loading={live.state === 'ending'}
            onPress={() => void live.end()}
          />
        </View>
      ) : null}
      <AgentApp
        key={identityScope}
        identity={identity}
        restoring={restoring}
        restoreError={restoreError}
        onBeforeSignOut={() => live.end()}
        onSessionError={(error) => setRestoreError(error.message)}
        onVoiceHome={() => setWorkspace(false)}
      />
    </View>
  ) : (
    <LaunchScreen live={live} onWorkspace={() => setWorkspace(true)} />
  );
  return preview ? (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.paper,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        gap: 10,
      }}
    >
      <Text style={{ color: colors.muted, fontSize: 13 }}>
        iPhone layout preview · running in your browser
      </Text>
      <View
        style={{
          width: Math.min(390, width - 24),
          height: Math.max(360, Math.min(844, height - 64)),
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: width > 460 ? 28 : 0,
          overflow: 'hidden',
          backgroundColor: colors.paper,
        }}
      >
        {content}
      </View>
    </View>
  ) : (
    content
  );
}

function AgentApp({
  onVoiceHome,
  identity,
  restoring,
  restoreError,
  onBeforeSignOut,
  onSessionError,
}: {
  onVoiceHome: () => void;
  identity: SessionSnapshot;
  restoring: boolean;
  restoreError: string;
  onBeforeSignOut: () => Promise<void>;
  onSessionError: (error: Error) => void;
}) {
  const { colors, styles } = useUI(),
    appStyles = useAppStyles();
  const dimensions = useWindowDimensions(),
    roomyTabs = dimensions.width <= 360 || dimensions.fontScale >= 1.6;
  const authenticated = !!identity.token;
  const [data, setData] = useState<Bootstrap | null>(null);
  const [tab, setTab] = useState<Tab>('Home');
  const [legacy, setLegacy] = useState(
    () =>
      legacyEnabled &&
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('legacy') === '1',
  );
  const [route, setRoute] = useState<Route>(null);
  const [error, setError] = useState(restoreError);
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState(false);
  const [detail, setDetail] = useState<MissionDetail | null>(null);
  const [guidanceFeedback, setGuidanceFeedback] = useState('');
  const [dirty, setDirty] = useState(false),
    [confirmClose, setConfirmClose] = useState(false);
  const editorSave = useRef<(() => void) | null>(null);
  const creationRequest = useRef<string | null>(null);
  const confirmationRef = useRef<React.ElementRef<typeof View>>(null);
  const onEditorDirty = useCallback((value: boolean) => setDirty(value), []);
  const onRegisterSave = useCallback((save: (() => void) | null) => {
    editorSave.current = save;
  }, []);
  const mounted = useRef(true);

  const closeRoute = () => {
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    setRoute(null);
    setError('');
  };
  const clearEditor = () => {
    setDirty(false);
    setConfirmClose(false);
    editorSave.current = null;
  };
  useEffect(() => {
    if (Platform.OS !== 'web' || !dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  useEffect(() => {
    setConfirmClose(false);
  }, [route]);
  useEffect(() => {
    if (route?.kind !== 'compose') creationRequest.current = null;
  }, [route?.kind]);
  useEffect(() => {
    if (!confirmClose) return;
    const previous = Platform.OS === 'web' ? (document.activeElement as HTMLElement | null) : null;
    const frame = requestAnimationFrame(() => {
      if (Platform.OS === 'web') {
        const heading = confirmationRef.current as unknown as HTMLElement | null;
        heading?.focus();
        heading?.scrollIntoView({ block: 'nearest' });
      } else {
        Keyboard.dismiss();
        const handle = findNodeHandle(confirmationRef.current);
        if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      if (previous?.isConnected) previous.focus();
    };
  }, [confirmClose]);

  useEffect(() => {
    if (restoreError) setError(restoreError);
  }, [restoreError]);

  const refresh = useCallback(async (showSpinner = true) => {
    const snapshot = getSessionSnapshot();
    if (showSpinner) setRefreshing(true);
    try {
      const next = await api<Bootstrap>('/bootstrap');
      if (mounted.current && isSessionCurrent(snapshot)) {
        setData(next);
        setError('');
        return true;
      }
      return false;
    } catch (err) {
      if (mounted.current && isSessionCurrent(snapshot))
        setError(err instanceof Error ? err.message : 'Could not refresh.');
      return false;
    } finally {
      if (mounted.current && isSessionCurrent(snapshot)) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!restoring && authenticated) void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh, restoring, authenticated]);
  useEffect(() => {
    if (!authenticated) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh(false);
    });
    const timer = setInterval(() => {
      if (
        AppState.currentState === 'active' &&
        data?.missions.some((mission) => ACTIVE.includes(mission.status))
      )
        void refresh(false);
    }, 3000);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [authenticated, data?.missions, refresh]);
  useEffect(() => {
    setGuidanceFeedback('');
    if (route?.kind !== 'mission') {
      setDetail(null);
      return;
    }
    let cancelled = false;
    const update = async () => {
      const snapshot = getSessionSnapshot();
      try {
        const item = await api<MissionDetail>(`/missions/${route.id}`);
        if (!cancelled && isSessionCurrent(snapshot)) setDetail(item);
      } catch (err) {
        if (!cancelled && isSessionCurrent(snapshot)) setError((err as Error).message);
      }
    };
    void update();
    const timer = setInterval(() => {
      void update();
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [route?.kind === 'mission' ? route.id : undefined]);

  async function perform(action: () => Promise<void>) {
    const snapshot = getSessionSnapshot();
    setWorking(true);
    setError('');
    try {
      await action();
      return isSessionCurrent(snapshot);
    } catch (err) {
      if (mounted.current && isSessionCurrent(snapshot)) setError((err as Error).message);
      return false;
    } finally {
      if (mounted.current && isSessionCurrent(snapshot)) setWorking(false);
    }
  }
  async function signOut() {
    const snapshot = getSessionSnapshot();
    await onBeforeSignOut();
    if (!isSessionCurrent(snapshot)) return;
    await api('/logout', 'POST', {}).catch(() => {});
    if (isSessionCurrent(snapshot))
      try {
        await setSession(null);
      } catch (error) {
        onSessionError(error as Error);
      }
  }

  if (restoring)
    return (
      <SafeAreaView style={appStyles.shell}>
        <View style={appStyles.center}>
          <Mark />
          <ActivityIndicator color={colors.green} />
        </View>
      </SafeAreaView>
    );
  if (!authenticated) return <AuthScreen onVoiceHome={onVoiceHome} initialError={restoreError} />;
  if (!data)
    return (
      <SafeAreaView style={appStyles.shell}>
        <ScrollView
          contentContainerStyle={[styles.page, { flexGrow: 1, justifyContent: 'center' }]}
        >
          <Mark />
          <Text style={styles.h2}>Connecting to your agent</Text>
          {error ? (
            <Notice tone="error">{error}</Notice>
          ) : (
            <ActivityIndicator color={colors.green} />
          )}
          <Button label="Try again" onPress={() => void refresh()} />
          <ConnectionPanel compact />
          <Button label="Back to sign in" secondary onPress={() => void signOut()} />
        </ScrollView>
      </SafeAreaView>
    );
  if (!legacy)
    return (
      <NetworkWorkspace
        key={data.profile.id}
        ownerId={data.profile.id}
        onVoiceHome={onVoiceHome}
        onLegacy={
          legacyEnabled
            ? () => {
                setLegacy(true);
                setTab('Settings');
              }
            : undefined
        }
        onSignOut={() => void signOut()}
      />
    );

  const modalTitle =
    route?.kind === 'compose'
      ? 'A new conversation'
      : route?.kind === 'review'
        ? 'Review & authorize'
        : route?.kind === 'mission'
          ? 'Your conversation'
          : route?.kind === 'person'
            ? route.contact
              ? 'Relationship'
              : 'Add a person'
            : route?.kind === 'memory'
              ? route.memory
                ? 'Memory detail'
                : 'Add a memory'
              : '';
  return (
    <VoiceWorkspaceProvider key={data.profile.id}>
      <SettingsDraftProvider profile={data.profile}>
        <SafeAreaView
          {...(Platform.OS === 'web' ? { 'aria-hidden': !!route } : {})}
          style={appStyles.shell}
          edges={['top', 'left', 'right']}
        >
          <View style={appStyles.header}>
            <View style={styles.row}>
              <IconButton name="arrow-back" label="Back to voice home" onPress={onVoiceHome} />
              <Text
                style={{ fontSize: 21, fontWeight: '600', letterSpacing: -0.4, color: colors.ink }}
              >
                klnk
              </Text>
            </View>
            <IconButton
              name="person-circle-outline"
              label="Open your profile and settings"
              onPress={() => setTab('Settings')}
            />
          </View>
          {error && !route ? (
            <View style={{ paddingHorizontal: 24, paddingTop: 12 }}>
              <Notice tone="error">{error}</Notice>
              <Button compact secondary label="Reconnect" onPress={() => void refresh()} />
            </View>
          ) : null}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.page}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void refresh()}
                tintColor={colors.green}
              />
            }
          >
            <Button label="Open agent inbox" secondary onPress={() => setLegacy(false)} />
            {tab === 'Home' ? (
              <Home
                data={data}
                onCompose={(template) => setRoute({ kind: 'compose', template })}
                onMission={(mission) =>
                  setRoute(
                    mission.status === 'draft'
                      ? { kind: 'review', mission }
                      : { kind: 'mission', id: mission.id },
                  )
                }
                onMissionId={(id) => {
                  setRoute({ kind: 'mission', id });
                  void refresh(false);
                }}
              />
            ) : null}
            {tab === 'People' ? (
              <PeopleScreen
                contacts={data.contacts}
                onEdit={(contact) => setRoute({ kind: 'person', contact })}
              />
            ) : null}
            {tab === 'Memory' ? (
              <MemoryScreen
                memories={data.memories}
                contacts={data.contacts}
                onEdit={(memory) => setRoute({ kind: 'memory', memory })}
              />
            ) : null}
            {tab === 'Settings' ? (
              <SettingsScreen
                data={data}
                working={working}
                onSave={(profile) =>
                  perform(async () => {
                    await api('/profile', 'PUT', profile);
                    if (!(await refresh()))
                      throw new Error(
                        'Your preferences were accepted, but could not be reloaded. Your draft is preserved; reconnect before retrying.',
                      );
                  })
                }
                onSignOut={() => void signOut()}
                onDelete={() =>
                  perform(async () => {
                    await api('/account', 'DELETE');
                    await signOut();
                  })
                }
              />
            ) : null}
          </ScrollView>
          <View style={[appStyles.nav, roomyTabs ? { flexWrap: 'wrap' } : null]}>
            {(
              [
                { name: 'Home', icon: 'grid-outline' },
                { name: 'People', icon: 'people-outline' },
                { name: 'Memory', icon: 'layers-outline' },
                { name: 'Settings', icon: 'options-outline' },
              ] as { name: Tab; icon: IconName }[]
            ).map((item) => (
              <Pressable
                key={item.name}
                onPress={() => setTab(item.name)}
                accessibilityRole="tab"
                accessibilityLabel={item.name}
                {...a11yState({ selected: tab === item.name })}
                style={[
                  appStyles.navItem,
                  roomyTabs
                    ? { flexGrow: 0, flexShrink: 0, flexBasis: '50%', paddingVertical: 4 }
                    : null,
                ]}
              >
                <View
                  style={{
                    backgroundColor: tab === item.name ? colors.action : 'transparent',
                    paddingVertical: 6,
                    paddingHorizontal: 20,
                    borderRadius: 15,
                  }}
                >
                  <Icon
                    name={item.icon}
                    color={tab === item.name ? colors.onAction : colors.muted}
                    size={23}
                  />
                </View>
                <Text
                  style={{
                    color: tab === item.name ? colors.ink : colors.muted,
                    fontWeight: tab === item.name ? '600' : '400',
                    fontSize: 13,
                    lineHeight: 18,
                    maxWidth: '100%',
                    flexShrink: 1,
                    textAlign: 'center',
                  }}
                >
                  {item.name}
                </Text>
              </Pressable>
            ))}
          </View>

          <DetailSheet
            visible={!!route}
            title={modalTitle}
            onClose={closeRoute}
            revealTop={confirmClose}
          >
            {confirmClose ? (
              <Card>
                <View
                  ref={confirmationRef}
                  accessible
                  accessibilityRole="header"
                  accessibilityLabel="Save your changes?"
                  {...(Platform.OS === 'web' ? { tabIndex: -1 } : {})}
                >
                  <Text style={styles.h2}>Save your changes?</Text>
                </View>
                <Text style={styles.text}>Your changes have not been saved yet.</Text>
                <Button
                  label="Save changes"
                  loading={working}
                  disabled={!editorSave.current}
                  onPress={() => {
                    setConfirmClose(false);
                    editorSave.current?.();
                  }}
                />
                <Button
                  label="Discard changes"
                  danger
                  secondary
                  disabled={working}
                  onPress={() => {
                    clearEditor();
                    setRoute(null);
                    setError('');
                  }}
                />
                <Button
                  label="Stay and edit"
                  secondary
                  disabled={working}
                  onPress={() => setConfirmClose(false)}
                />
              </Card>
            ) : null}
            {error ? (
              <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
                <Notice tone="error">{error}</Notice>
              </View>
            ) : null}
            {route?.kind === 'compose' ? (
              <MissionComposer
                data={data}
                template={route.template}
                working={working}
                onDirtyChange={onEditorDirty}
                onRegisterSave={onRegisterSave}
                onSave={(input: MissionInput) =>
                  perform(async () => {
                    if (!route.missionId) creationRequest.current ??= voiceRequestId();
                    const created = await api<ReviewedMission>(
                      route.missionId ? `/missions/${route.missionId}` : '/missions',
                      route.missionId ? 'PATCH' : 'POST',
                      route.missionId ? input : { ...input, requestId: creationRequest.current },
                    );
                    clearEditor();
                    setRoute({ kind: 'review', mission: created });
                    await refresh(false);
                  })
                }
              />
            ) : null}
            {route?.kind === 'review' ? (
              <MissionReview
                data={data}
                mission={route.mission}
                working={working}
                onEdit={() =>
                  setRoute({
                    kind: 'compose',
                    missionId: route.mission.id,
                    template: {
                      id: route.mission.kind,
                      title: route.mission.title,
                      description: '',
                      icon: '',
                      input: route.mission,
                    },
                  })
                }
                onAuthorize={(scenario) =>
                  perform(async () => {
                    try {
                      await api(`/missions/${route.mission.id}/authorize`, 'POST', {
                        version: route.mission.reviewVersion ?? 1,
                        scenario,
                      });
                    } catch (err) {
                      if (
                        err instanceof ApiError &&
                        err.status === 409 &&
                        err.code === 'stale_authorization'
                      ) {
                        const current = await api<ReviewedMission>(`/missions/${route.mission.id}`);
                        setRoute({ kind: 'review', mission: current });
                        throw new Error(
                          'Request changed. Review the current instructions before authorizing again.',
                        );
                      }
                      throw err;
                    }
                    await refresh(false);
                    setRoute({ kind: 'mission', id: route.mission.id });
                  })
                }
              />
            ) : null}
            {route?.kind === 'mission' ? (
              detail ? (
                <MissionConversation
                  key={detail.id}
                  onDirtyChange={onEditorDirty}
                  onRegisterSave={onRegisterSave}
                  mission={detail}
                  data={data}
                  working={working}
                  guidanceFeedback={guidanceFeedback}
                  onCancel={() =>
                    perform(async () => {
                      await api(`/missions/${route.id}/cancel`, 'POST', {});
                      setDetail(await api(`/missions/${route.id}`));
                      await refresh(false);
                    })
                  }
                  onGuidance={(kind, text) =>
                    perform(async () => {
                      const response = await api<{ applied: boolean; message: string }>(
                        `/missions/${route.id}/intervene`,
                        'POST',
                        { kind, text },
                      );
                      setGuidanceFeedback(
                        `${response.applied ? 'Applied' : 'Saved for review'}: ${response.message}`,
                      );
                      setDetail(await api(`/missions/${route.id}`));
                    })
                  }
                  onRetryActions={() =>
                    perform(async () => {
                      await api(`/missions/${route.id}/actions/retry`, 'POST', {});
                      setDetail(await api(`/missions/${route.id}`));
                    })
                  }
                  onDelete={() =>
                    perform(async () => {
                      await api(`/missions/${route.id}`, 'DELETE');
                      await refresh(false);
                      setRoute(null);
                    })
                  }
                />
              ) : (
                <ActivityIndicator color={colors.green} accessibilityLabel="Loading conversation" />
              )
            ) : null}
            {route?.kind === 'person' ? (
              <ContactEditor
                contact={route.contact}
                working={working}
                onDirtyChange={onEditorDirty}
                onRegisterSave={onRegisterSave}
                onSave={(contact) =>
                  perform(async () => {
                    await api(
                      route.contact ? `/contacts/${route.contact.id}` : '/contacts',
                      route.contact ? 'PATCH' : 'POST',
                      contact,
                    );
                    await refresh(false);
                    clearEditor();
                    setRoute(null);
                  })
                }
                onDelete={
                  route.contact
                    ? () =>
                        perform(async () => {
                          await api(`/contacts/${route.contact!.id}`, 'DELETE');
                          await refresh(false);
                          clearEditor();
                          setRoute(null);
                        })
                    : undefined
                }
              />
            ) : null}
            {route?.kind === 'memory' ? (
              <MemoryEditor
                memory={route.memory}
                data={data}
                working={working}
                onDirtyChange={onEditorDirty}
                onRegisterSave={onRegisterSave}
                onSave={(memory) =>
                  perform(async () => {
                    await api(
                      route.memory ? `/memories/${route.memory.id}` : '/memories',
                      route.memory ? 'PATCH' : 'POST',
                      memory,
                    );
                    await refresh(false);
                    clearEditor();
                    setRoute(null);
                  })
                }
                onDelete={
                  route.memory
                    ? () =>
                        perform(async () => {
                          await api(`/memories/${route.memory!.id}`, 'DELETE');
                          await refresh(false);
                          clearEditor();
                          setRoute(null);
                        })
                    : undefined
                }
              />
            ) : null}
          </DetailSheet>
        </SafeAreaView>
      </SettingsDraftProvider>
    </VoiceWorkspaceProvider>
  );
}

function Mark({ small = false }: { small?: boolean }) {
  const { colors } = useUI();
  return (
    <View
      accessible={false}
      style={{
        width: small ? 35 : 72,
        height: small ? 35 : 72,
        backgroundColor: colors.green,
        borderRadius: small ? 12 : 24,
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'row',
        gap: small ? 3 : 5,
      }}
    >
      {[0.35, 0.65, 0.9, 0.5].map((height, i) => (
        <View
          key={i}
          style={{
            width: small ? 3 : 5,
            height: height * (small ? 22 : 40),
            borderRadius: 4,
            backgroundColor: colors.paper,
          }}
        />
      ))}
    </View>
  );
}

function Home({
  data,
  onCompose,
  onMission,
  onMissionId,
}: {
  data: Bootstrap;
  onCompose: (template?: MissionTemplate) => void;
  onMission: (mission: Mission) => void;
  onMissionId: (id: string) => void;
}) {
  const { colors, styles } = useUI(),
    appStyles = useAppStyles();
  const [showTools, setShowTools] = useState(false);
  const decision = data.missions.filter((mission) => mission.status === 'awaiting_owner');
  const active = data.missions.filter(
    (mission) => ACTIVE.includes(mission.status) && mission.status !== 'awaiting_owner',
  );
  const other = data.missions.filter((mission) => !ACTIVE.includes(mission.status));
  const icons: Record<string, IconName> = {
    appointment: 'calendar-outline',
    late: 'chatbubble-ellipses-outline',
    information: 'search-outline',
    refund: 'return-down-back-outline',
    personal: 'heart-outline',
    follow_up: 'time-outline',
    cross_language: 'language-outline',
    custom: 'sparkles-outline',
  };
  return (
    <>
      <VoiceConversation mode={data.mode} onMission={onMissionId} />
      {decision.length ? (
        <View style={{ gap: 12 }}>
          <View style={styles.spread}>
            <Text accessibilityRole="header" style={styles.h2}>
              Your decision needed
            </Text>
            <Badge text={String(decision.length)} tone="amber" />
          </View>
          {decision.map((mission) => (
            <MissionCard
              key={mission.id}
              mission={mission}
              data={data}
              onPress={() => onMission(mission)}
            />
          ))}
        </View>
      ) : null}
      {active.length ? (
        <View style={{ gap: 12 }}>
          <Text accessibilityRole="header" style={styles.h2}>
            In progress
          </Text>
          {active.map((mission) => (
            <MissionCard
              key={mission.id}
              mission={mission}
              data={data}
              onPress={() => onMission(mission)}
            />
          ))}
        </View>
      ) : null}
      {other.length ? (
        <View style={{ gap: 14 }}>
          <Text accessibilityRole="header" style={styles.h2}>
            Your conversations
          </Text>
          {other.map((mission) => (
            <MissionCard
              key={mission.id}
              mission={mission}
              data={data}
              onPress={() => onMission(mission)}
            />
          ))}
        </View>
      ) : null}
      <Button
        label={showTools ? 'Hide optional text tools' : 'Optional text tools & templates'}
        secondary
        compact
        onPress={() => setShowTools(!showTools)}
      />
      {showTools ? (
        <>
          <Button label="Compose a request using text" secondary onPress={() => onCompose()} />
          <View style={{ gap: 14 }}>
            <Text accessibilityRole="header" style={styles.h2}>
              A place to start
            </Text>
            <View style={appStyles.templateGrid}>
              {data.templates.map((template) => (
                <Pressable
                  key={template.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${template.title}. ${template.description}`}
                  onPress={() => onCompose(template)}
                  style={({ pressed }) => [
                    appStyles.template,
                    { backgroundColor: pressed ? colors.lightGreen : colors.white },
                  ]}
                >
                  <View style={appStyles.templateIcon}>
                    <Icon name={icons[template.id] ?? 'sparkles-outline'} size={22} />
                  </View>
                  <Text
                    style={{ color: colors.ink, fontSize: 17, lineHeight: 24, fontWeight: '600' }}
                  >
                    {template.title}
                  </Text>
                  <Text style={styles.small}>{template.description}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <CallingReadiness
            readiness={data.liveReadiness}
            liveCallsEnabled={data.liveCallsEnabled}
            mode={data.mode}
          />
        </>
      ) : null}
    </>
  );
}

function MissionCard({
  mission,
  data,
  onPress,
}: {
  mission: Mission;
  data: Bootstrap;
  onPress: () => void;
}) {
  const { colors, styles } = useUI();
  const contact = data.contacts.find((item) => item.id === mission.contactId);
  const presentation = presentMission(mission.status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${mission.title}, ${contact?.name ?? 'recipient'}, ${presentation.label}`}
      onPress={onPress}
    >
      <Card>
        <View style={styles.spread}>
          <View style={[styles.row, { flex: 1 }]}>
            <Avatar name={contact?.name ?? '?'} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.h3}>{mission.title}</Text>
              <Text style={styles.small}>
                {contact?.name ?? 'Recipient removed'} · {contact?.relationship ?? ''}
              </Text>
            </View>
          </View>
          <Icon name="chevron-forward" color={colors.muted} size={18} />
        </View>
        <View style={styles.chips}>
          <Badge text={presentation.label} tone={presentation.tone} />
          {mission.executionProvider ? (
            <Badge
              text={mission.executionProvider === 'simulator' ? 'Simulation' : 'Provider call'}
              tone="neutral"
            />
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

function AuthScreen({
  onVoiceHome,
  initialError,
}: {
  onVoiceHome: () => void;
  initialError: string;
}) {
  const { colors, styles } = useUI(),
    appStyles = useAppStyles();
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const submit = async (demo = false) => {
    let snapshot = getSessionSnapshot();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ token: string }>(
        demo ? '/auth/demo' : `/auth/${mode}`,
        'POST',
        demo ? {} : { name, email, password },
      );
      if (!mounted.current || !isSessionCurrent(snapshot)) return;
      const saving = setSession(result.token);
      snapshot = getSessionSnapshot();
      await saving;
    } catch (err) {
      if (mounted.current && isSessionCurrent(snapshot)) setError((err as Error).message);
    } finally {
      if (mounted.current && isSessionCurrent(snapshot)) setBusy(false);
    }
  };
  if (!showAuthForm)
    return (
      <SafeAreaView style={appStyles.shell}>
        <ScrollView
          contentContainerStyle={[styles.page, { flexGrow: 1, justifyContent: 'center', gap: 26 }]}
        >
          <View style={{ alignItems: 'center', gap: 18 }}>
            <Mark />
            <Text
              accessibilityRole="header"
              style={[styles.title, { fontSize: 34, textAlign: 'center' }]}
            >
              Your workspace.
            </Text>
            <Text style={[styles.subtitle, { textAlign: 'center' }]}>
              Connect with members and delegate inside klnk. Earlier simulations remain available in
              account settings.
            </Text>
          </View>
          <Button
            label="Try the simulation"
            icon="flask-outline"
            loading={busy}
            onPress={() => void submit(true)}
          />
          <Text style={[styles.small, { textAlign: 'center' }]}>
            Local demo · fictional people · simulated calls{'\n'}Live voice is on the voice home.
          </Text>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button label="Back to voice home" secondary onPress={onVoiceHome} />
          <ConnectionPanel compact />
          <Button
            label="Sign in or create an account instead"
            secondary
            compact
            onPress={() => setShowAuthForm(true)}
          />
        </ScrollView>
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={appStyles.shell}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.page,
            { flexGrow: 1, justifyContent: 'center', paddingVertical: 40 },
          ]}
        >
          <Mark />
          <View style={{ gap: 12 }}>
            <Text style={styles.label}>PERSONAL VOICE AGENT</Text>
            <Text style={[styles.title, { fontSize: 38 }]}>A voice in{'\n'}your corner.</Text>
            <Text style={styles.subtitle}>
              Your agent talks with their agent.{'\n'}Your words, your boundaries, your choice.
            </Text>
          </View>
          <ConnectionPanel compact />
          <Card>
            {mode === 'register' ? (
              <Field
                label="Your name"
                value={name}
                onChangeText={setName}
                textContentType="name"
                autoComplete="name"
              />
            ) : null}
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="emailAddress"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType={mode === 'login' ? 'password' : 'newPassword'}
              hint="Use at least 12 characters."
            />
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Button
              label={mode === 'register' ? 'Create your account' : 'Sign in'}
              loading={busy}
              onPress={() => void submit()}
            />
            <Button
              label={mode === 'register' ? 'Already have an account? Sign in' : 'Create an account'}
              secondary
              onPress={() => setMode(mode === 'register' ? 'login' : 'register')}
            />
          </Card>
          <Button
            label="Explore the local demo"
            icon="flask-outline"
            secondary
            loading={busy}
            onPress={() => void submit(true)}
          />
          <Text style={[styles.small, { textAlign: 'center' }]}>
            This workspace uses fictional people and simulated conversations.
          </Text>
          <Button label="Back to voice home" secondary onPress={onVoiceHome} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createAppStyles = (colors: UIColors, bottom: number) =>
  StyleSheet.create({
    shell: {
      flex: 1,
      backgroundColor: colors.paper,
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 },
    header: {
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
    },
    nav: {
      paddingTop: 8,
      paddingBottom: Math.max(12, bottom),
      flexDirection: 'row',
      justifyContent: 'space-around',
      borderTopWidth: 1,
      borderTopColor: colors.line,
      backgroundColor: colors.paper,
    },
    navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 56 },
    hero: { padding: 23, borderRadius: 26, backgroundColor: colors.green },
    heroIcon: {
      width: 48,
      height: 48,
      borderRadius: 17,
      backgroundColor: '#426554',
      alignItems: 'center',
      justifyContent: 'center',
    },
    templateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    template: {
      flexBasis: '46%',
      flexGrow: 1,
      borderRadius: 18,
      backgroundColor: colors.white,
      borderColor: colors.line,
      borderWidth: 1,
      padding: 16,
      gap: 10,
      minWidth: 140,
    },
    templateIcon: {
      width: 40,
      height: 40,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.lightGreen,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
      gap: 12,
    },
  });
function useAppStyles() {
  const { colors } = useUI(),
    { bottom } = useSafeAreaInsets();
  return useMemo(() => createAppStyles(colors, bottom), [colors, bottom]);
}
