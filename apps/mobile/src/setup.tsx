import React, { useEffect, useRef, useState } from 'react';
import { Platform, Switch, Text, View } from 'react-native';
import {
  changeApiUrl,
  checkConnection,
  getConnectionSettings,
  isDeviceLoopback,
  type Health,
  type LiveReadiness,
} from './api';
import { Badge, Button, Card, Field, Notice, useUI } from './ui';

export function CallingReadiness({
  readiness,
  liveCallsEnabled,
  mode,
}: {
  readiness?: LiveReadiness;
  liveCallsEnabled?: boolean;
  mode: string;
}) {
  const { styles } = useUI();
  if (!readiness)
    return mode === 'elevenlabs' && liveCallsEnabled === false ? (
      <Notice>
        Real calling is disabled on this backend. You can prepare and review a mission without
        dialing.
      </Notice>
    ) : null;
  return (
    <Card>
      <Text accessibilityRole="header" style={styles.h3}>
        Calling setup
      </Text>
      <Badge
        text={
          mode === 'simulator'
            ? 'Simulation selected'
            : readiness.ready
              ? 'Setup checks ready'
              : 'Setup incomplete'
        }
        tone={readiness.ready ? 'green' : 'amber'}
      />
      <Text style={styles.small}>
        {liveCallsEnabled
          ? 'The backend still requires your approved mission before dialing.'
          : 'Real calling is disabled. These checks do not place a call.'}
      </Text>
      {readiness.checks.map((check) => (
        <View key={check.id} style={{ gap: 4 }}>
          <Text style={styles.text}>
            {check.status === 'ready' ? '✓' : '○'} {check.label}
          </Text>
          <Text style={styles.small}>{check.detail}</Text>
        </View>
      ))}
    </Card>
  );
}

export function ConnectionPanel({ compact = false }: { compact?: boolean }) {
  const { colors, styles } = useUI();
  const current = getConnectionSettings();
  const developmentConnection = __DEV__ || process.env.EXPO_PUBLIC_ALLOW_LOCAL_HTTP === 'true';
  const [url, setUrl] = useState(current.url);
  const [localHttp, setLocalHttp] = useState(developmentConnection && current.allowLocalHttp);
  const [expanded, setExpanded] = useState(!compact || isDeviceLoopback());
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(true),
    running = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (save: boolean) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await checkConnection(url, localHttp);
      if (!mounted.current) return;
      setHealth(result);
      if (save) {
        await changeApiUrl(url, localHttp);
        if (!mounted.current) return;
        setUrl(getConnectionSettings().url);
        setMessage('Server selected. Sign in to this backend.');
      } else setMessage('Backend reachable. This health check does not sign in or place a call.');
    } catch (err) {
      if (mounted.current) {
        setHealth(null);
        setError(err instanceof Error ? err.message : 'Could not reach this backend.');
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <Card>
      <Text accessibilityRole="header" style={styles.h3}>
        Server connection
      </Text>
      <Text selectable style={styles.small}>
        {current.url}
      </Text>
      {isDeviceLoopback() ? (
        <Notice tone="warning">
          Localhost points to this iPhone. Enter a reachable HTTPS server address
          {developmentConnection ? ' or your computer’s private LAN address on the same Wi-Fi' : ''}
          .
        </Notice>
      ) : null}
      {!expanded ? (
        <Button
          label="Server connection & setup"
          secondary
          compact
          onPress={() => setExpanded(true)}
        />
      ) : (
        <>
          <Field
            label="Backend address"
            value={url}
            editable={!busy}
            onChangeText={(value) => {
              setUrl(value);
              setHealth(null);
              setMessage('');
              setError('');
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://agent.example.com"
            hint="Use the API server origin. Do not enter a provider key or password here."
          />
          {developmentConnection ? (
            <View style={styles.spread}>
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={styles.text}>Allow local development HTTP</Text>
                <Text style={styles.small}>
                  Only a private LAN or loopback address. Use HTTPS for a hosted backend.
                </Text>
              </View>
              <Switch
                accessibilityLabel="Allow local development HTTP"
                disabled={busy}
                value={localHttp}
                onValueChange={(value) => {
                  setLocalHttp(value);
                  setHealth(null);
                  setMessage('');
                  setError('');
                }}
                trackColor={{ true: colors.green }}
              />
            </View>
          ) : null}
          {localHttp ? (
            <Notice>
              Use trusted private Wi-Fi for this development connection. The iPhone build must allow
              local networking; iOS may ask for Local Network permission.
            </Notice>
          ) : null}
          <Button
            label="Check connection without calling"
            secondary
            loading={busy}
            onPress={() => void run(false)}
          />
          <Button label="Save connection & sign in" loading={busy} onPress={() => void run(true)} />
          <Text style={styles.small}>
            Changing servers signs you out and clears unsaved workspace drafts. Save preferences
            first. Your session token is tied to one backend and is never sent to a different
            address.{' '}
            {Platform.OS === 'web'
              ? 'Browser connection selection lasts for this page session.'
              : 'The selected address is stored on this iPhone.'}
          </Text>
          {message ? <Notice>{message}</Notice> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          {health ? (
            <>
              <Text style={styles.small}>
                Backend connected · {health.storage ?? 'storage available'}
              </Text>
              <CallingReadiness
                readiness={health.liveReadiness}
                liveCallsEnabled={health.liveCallsEnabled}
                mode={health.mode ?? 'unavailable'}
              />
            </>
          ) : null}
        </>
      )}
    </Card>
  );
}
