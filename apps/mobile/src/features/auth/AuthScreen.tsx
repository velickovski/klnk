import React, { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { api, getSessionSnapshot, isSessionCurrent, setSession } from '../../api';
import { AppScreen, AppText, Button, Card, Disclosure, Field, Icon, Notice, useUI } from '../../ui';
import { brand, radii, spacing } from '../../design/tokens';
import { ConnectionPanel } from '../../setup';

export type AccountLink = { kind: 'verify' | 'reset' | 'email-change'; token: string };
export function parseAccountLink(value: string): AccountLink | undefined {
  try {
    const url = new URL(value),
      params = new URLSearchParams(url.hash.slice(1)),
      kind = params.get('account'),
      token = params.get('token');
    if (
      (kind === 'verify' || kind === 'reset' || kind === 'email-change') &&
      token &&
      /^[A-Za-z0-9_-]{43}$/.test(token)
    )
      return { kind, token };
  } catch {
    /* An unrelated link is not an account operation. */
  }
  return undefined;
}
/** Real-account entry is subsequent to Call klnk. Link tokens remain in memory. */
export function AuthScreen({
  onVoiceHome,
  initialError,
  initialMessage = '',
  initialLink,
  onLinkComplete,
}: {
  onVoiceHome: () => void;
  initialError: string;
  initialMessage?: string;
  initialLink?: AccountLink;
  onLinkComplete?: (message: string) => void;
}) {
  const { styles } = useUI();
  const [mode, setMode] = useState<'login' | 'register' | 'reset-request' | 'verify' | 'reset'>(
    initialLink ? (initialLink.kind === 'reset' ? 'reset' : 'verify') : 'login',
  );
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError),
    [notice, setNotice] = useState(initialMessage);
  const alive = useRef(true),
    inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const fixture = __DEV__ || process.env.EXPO_PUBLIC_LEGACY_ENABLED === 'true';
  async function submit(demo = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    let scope = getSessionSnapshot();
    setBusy(true);
    setError('');
    try {
      if (demo || mode === 'login') {
        const result = await api<{ token: string }>(
          demo ? '/auth/demo' : '/auth/login',
          'POST',
          demo ? {} : { email, password },
        );
        if (!alive.current || !isSessionCurrent(scope)) return;
        const saved = setSession(result.token);
        scope = getSessionSnapshot();
        await saved;
      } else if (mode === 'register' || mode === 'reset-request') {
        const result = await api<{ message: string; delivery: 'configured' | 'disabled' }>(
          mode === 'register' ? '/auth/register' : '/auth/reset-request',
          'POST',
          mode === 'register' ? { name, email, password } : { email },
        );
        if (!alive.current || !isSessionCurrent(scope)) return;
        setNotice(
          result.message +
            (result.delivery === 'disabled'
              ? ' Email sending is disabled in this local build.'
              : ''),
        );
        setMode('login');
      } else {
        if (!initialLink) throw new Error('Open a valid account link from your email.');
        await api(
          mode === 'reset' ? '/auth/reset' : '/auth/verify-email',
          'POST',
          mode === 'reset'
            ? { token: initialLink.token, newPassword: password }
            : { token: initialLink.token, password },
        );
        if (!alive.current || !isSessionCurrent(scope)) return;
        const message =
          mode === 'reset'
            ? 'Your password was changed. Sign in again.'
            : 'Your email was verified. Sign in again.';
        setPassword('');
        setMode('login');
        setNotice(message);
        if (scope.token) await setSession(null);
        if (Platform.OS === 'web' && typeof window !== 'undefined')
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
        onLinkComplete?.(message);
      }
    } catch (cause) {
      if (alive.current && isSessionCurrent(scope))
        setError(cause instanceof Error ? cause.message : 'Could not complete this request.');
    } finally {
      inFlight.current = false;
      if (alive.current && isSessionCurrent(scope)) setBusy(false);
    }
  }
  const title =
    mode === 'register'
      ? 'Create your account'
      : mode === 'reset-request'
        ? 'Reset your password'
        : mode === 'verify'
          ? 'Verify your email'
          : mode === 'reset'
            ? 'Choose a new password'
            : 'Welcome to klnk';
  return (
    <AppScreen>
      <View
        style={{ flex: 1, gap: spacing.screen, width: '100%', maxWidth: 560, alignSelf: 'center' }}
      >
        <View
          style={{
            backgroundColor: brand.navy,
            padding: spacing.screen,
            borderRadius: radii.sheet,
            borderCurve: 'continuous',
            gap: spacing.lg,
          }}
        >
          <Icon name="sparkles-outline" color={brand.coral} size={28} />
          <AppText
            role="hero"
            accessibilityRole="header"
            style={{ color: brand.cream, letterSpacing: -0.8 }}
          >
            {title}
          </AppText>
        </View>
        {notice ? <Notice>{notice}</Notice> : null}
        <Card>
          {mode === 'register' ? (
            <Field
              label="Your name"
              value={name}
              onChangeText={setName}
              textContentType="name"
              autoComplete="name"
              maxLength={80}
            />
          ) : null}
          {mode === 'login' || mode === 'register' || mode === 'reset-request' ? (
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="emailAddress"
              autoComplete="email"
              maxLength={254}
            />
          ) : null}
          {mode !== 'reset-request' ? (
            <Field
              label={mode === 'reset' ? 'New password' : 'Password'}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType={mode === 'register' || mode === 'reset' ? 'newPassword' : 'password'}
              autoComplete={
                mode === 'register' || mode === 'reset' ? 'new-password' : 'current-password'
              }
              hint="Use at least 12 characters."
              maxLength={128}
              onSubmitEditing={() => void submit()}
            />
          ) : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button
            label={
              mode === 'login'
                ? 'Sign in'
                : mode === 'register'
                  ? 'Create your account'
                  : mode === 'reset-request'
                    ? 'Request reset link'
                    : mode === 'verify'
                      ? 'Verify email'
                      : 'Set new password'
            }
            loading={busy}
            onPress={() => void submit()}
          />
          {mode === 'login' ? (
            <>
              <Button
                label="Create an account"
                secondary
                onPress={() => {
                  setMode('register');
                  setError('');
                }}
              />
              <Button
                label="Forgot password?"
                secondary
                onPress={() => {
                  setMode('reset-request');
                  setPassword('');
                  setError('');
                }}
              />
            </>
          ) : (
            <Button
              label="Already have an account? Sign in"
              secondary
              onPress={() => {
                setMode('login');
                setError('');
              }}
            />
          )}
        </Card>
        <Button
          label="Back to voice home"
          icon="arrow-back-outline"
          secondary
          onPress={onVoiceHome}
        />
        <Disclosure title="Connection settings">
          <ConnectionPanel compact />
        </Disclosure>
        {fixture ? (
          <Disclosure title="Local demo">
            <AppText style={styles.small}>
              Fictional members and local simulation. This creates a separate demo account.
            </AppText>
            <Button
              label="Try the simulation"
              icon="flask-outline"
              secondary
              loading={busy}
              onPress={() => void submit(true)}
            />
          </Disclosure>
        ) : null}
      </View>
    </AppScreen>
  );
}
