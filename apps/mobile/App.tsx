import React, { useEffect, useRef, useState } from 'react';
import { Platform, Linking, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  getSessionSnapshot,
  onSessionChange,
  restoreSession,
  type SessionSnapshot,
} from './src/api';
import { ThemeProvider } from './src/design/ThemeProvider';
import { useUI, Button, Notice } from './src/ui';
import { LaunchScreen } from './src/features/launch/LaunchScreen';
import { useLiveConversation } from './src/features/live/useLiveConversation';
import { NetworkSessionProvider } from './src/features/network/data-provider';
import { NetworkAgentWorkspace } from './src/features/network/NetworkAgent';
import { LegacyAgentWorkspace } from './src/legacy/LegacyWorkspace';
import { AuthScreen, parseAccountLink, type AccountLink } from './src/features/auth/AuthScreen';
const previewEnabled = __DEV__ || process.env.EXPO_PUBLIC_DEV_PREVIEW === 'true';
const legacyEnabled = process.env.EXPO_PUBLIC_LEGACY_ENABLED === 'true';
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
  const { theme, colors, reducedMotion } = useUI();
  const [workspace, setWorkspace] = useState(
    () =>
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      ((previewEnabled && new URLSearchParams(window.location.search).get('workspace') === '1') ||
        /^\/(workspace|join)(\/|$)/.test(window.location.pathname) ||
        new URLSearchParams(window.location.hash.slice(1)).has('account')),
  );
  const [legacyMode, setLegacyMode] = useState(
    () =>
      legacyEnabled &&
      previewEnabled &&
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('legacy') === '1',
  );
  const WorkspaceComponent = legacyMode ? LegacyAgentWorkspace : NetworkAgentWorkspace;
  const live = useLiveConversation();
  const [incomingLink, setIncomingLink] = useState<string>();
  const [accountLink, setAccountLink] = useState<AccountLink | undefined>(() =>
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? parseAccountLink(window.location.href)
      : undefined,
  );
  const [accountNotice, setAccountNotice] = useState('');
  const [accountLinkGeneration, setAccountLinkGeneration] = useState(0);
  useEffect(() => {
    const accept = (value: string) => {
      const account = parseAccountLink(value);
      if (account) {
        setAccountLinkGeneration((generation) => generation + 1);
        setAccountLink(account);
        setWorkspace(true);
        void live.end();
        return;
      }
      try {
        const url = new URL(value);
        const path = ['http:', 'https:'].includes(url.protocol)
          ? url.pathname
          : '/' + url.host + url.pathname;
        if (/^\/(workspace|join)(\/|$)/.test(path)) {
          setIncomingLink(value);
          setWorkspace(true);
        }
      } catch {}
    };
    if (Platform.OS === 'web') {
      const update = () => accept(window.location.href);
      window.addEventListener('hashchange', update);
      return () => window.removeEventListener('hashchange', update);
    }
    const subscription = Linking.addEventListener('url', (event) => accept(event.url));
    void Linking.getInitialURL().then(
      (value) => {
        if (value) accept(value);
      },
      () => {},
    );
    return () => subscription.remove();
  }, []);

  const [voiceRequested, setVoiceRequested] = useState(false);
  const voiceGestureAt = useRef(0);
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
  const [preview] = useState(
    () =>
      previewEnabled &&
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('preview') === 'iphone',
  );
  const content = accountLink ? (
    <AuthScreen
      key={accountLinkGeneration}
      initialError=""
      initialLink={accountLink}
      onVoiceHome={() => {
        setAccountLink(undefined);
        setWorkspace(false);
      }}
      onLinkComplete={(message) => {
        setAccountNotice(message);
        setAccountLink(undefined);
        setWorkspace(true);
      }}
    />
  ) : workspace ? (
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
      <WorkspaceComponent
        key={identityScope}
        identity={identity}
        restoring={restoring}
        restoreError={restoreError}
        onBeforeSignOut={() => live.end()}
        onSessionError={(error) => setRestoreError(error.message)}
        onVoiceHome={() => {
          setVoiceRequested(false);
          setLegacyMode(false);
          setWorkspace(false);
        }}
        onLegacy={legacyEnabled ? () => setLegacyMode(true) : undefined}
        onNetworkWorkspace={() => setLegacyMode(false)}
        incomingLink={incomingLink}
        accountNotice={accountNotice}
        voiceRequested={voiceRequested}
        voiceAutoStart={voiceRequested && Date.now() - voiceGestureAt.current < 60000}
        onVoiceRequested={setVoiceRequested}
      />
    </View>
  ) : (
    <LaunchScreen
      live={live}
      recordedAvailable={Platform.OS !== 'web'}
      onWorkspace={() => setWorkspace(true)}
      onCall={() => {
        if (Platform.OS !== 'web') {
          voiceGestureAt.current = Date.now();
          setVoiceRequested(true);
          setWorkspace(true);
        } else if (!identity.token) {
          setWorkspace(true);
        } else {
          void live.start();
        }
      }}
    />
  );
  const presentation = preview ? (
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
  return (
    <>
      {Platform.OS === 'web' && reducedMotion ? (
        <style>
          {
            '*,*::before,*::after{animation-duration:0.01ms!important;transition-duration:0.01ms!important;scroll-behavior:auto!important}'
          }
        </style>
      ) : null}
      <NetworkSessionProvider key={identityScope} active={workspace}>
        {presentation}
      </NetworkSessionProvider>
    </>
  );
}
