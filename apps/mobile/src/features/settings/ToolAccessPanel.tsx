import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform, Text, View } from 'react-native';
import { api, getSessionSnapshot, isSessionCurrent } from '../../api';
import { localDate } from '../../models';
import { Badge, Button, Card, Notice, useUI } from '../../ui';
import {
  canEnableInAppTools,
  IN_APP_VOICE_TOOLS,
  recentToolDecisions,
  ToolAccessController,
  toolDecisionPresentation,
  toolPermissionName,
} from './tool-access';

export function ToolAccessPanel({ ownerId, timezone }: { ownerId: string; timezone: string }) {
  const { styles } = useUI();
  const mounted = useRef(true);
  const [controller] = useState(() => {
    const snapshot = getSessionSnapshot();
    return new ToolAccessController(
      api,
      ownerId,
      Platform.OS,
      () => mounted.current && isSessionCurrent(snapshot),
    );
  });
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    mounted.current = true;
    void controller.refreshAccess();
    void controller.refreshActivity();
    return () => {
      mounted.current = false;
    };
  }, [controller]);
  useEffect(() => {
    if (Platform.OS !== 'web' && state.message)
      AccessibilityInfo.announceForAccessibility(state.message);
  }, [state.message]);
  const access = state.access,
    decisions = recentToolDecisions(state.events);
  const busy = state.saving || state.accessLoading;
  return (
    <Card>
      <Text accessibilityRole="header" style={styles.h2}>
        In-app voice permissions
      </Text>
      <Text style={styles.text}>
        Allow your voice conversation to look up your people, read confirmed memories that may be
        shared in scope, prepare a request draft, and check a request's status.
      </Text>
      <Text style={styles.small}>
        A prepared draft still needs review and authorization. This permission does not enable
        outbound calls, messages or Calendar changes.
      </Text>
      {state.accessLoading ? <Text style={styles.small}>Checking voice permissions…</Text> : null}
      {access ? (
        <>
          <Badge
            text={`${state.uncertain ? 'Last confirmed: ' : ''}${access.grant.enabled ? 'Voice permissions on' : 'Voice permissions off'}`}
            tone={state.uncertain ? 'amber' : 'neutral'}
          />
          {Platform.OS !== 'web' ? (
            <Notice>
              In-app voice tools are unavailable on this device. Any saved permission can still be
              turned off here.
            </Notice>
          ) : !access.runtimeAvailable ? (
            <Notice>
              In-app voice tools are unavailable on this server. Permissions are not being enabled
              by a connection or credential alone.
            </Notice>
          ) : null}
          <Text accessibilityRole="header" style={styles.h3}>
            This action allows
          </Text>
          {IN_APP_VOICE_TOOLS.map((name) => (
            <Text key={name} style={styles.small}>
              • {toolPermissionName[name]}
            </Text>
          ))}
          {access.grant.tools.length ? (
            <View style={{ gap: 8 }}>
              <Text accessibilityRole="header" style={styles.h3}>
                Saved permission list{access.grant.enabled ? '' : ' · currently off'}
              </Text>
              {access.grant.tools.map((name) => (
                <Text key={name} style={styles.small}>
                  • {toolPermissionName[name]}
                </Text>
              ))}
            </View>
          ) : null}
          {access.grant.enabled ? (
            <Button
              label="Turn off voice tools"
              secondary
              loading={state.saving}
              disabled={busy}
              onPress={() => void controller.setEnabled(false)}
            />
          ) : (
            <Button
              label="Allow in-app voice tools"
              secondary
              loading={state.saving}
              disabled={busy || !canEnableInAppTools(access, Platform.OS, state.uncertain)}
              onPress={() => void controller.setEnabled(true)}
            />
          )}
        </>
      ) : !state.accessLoading ? (
        <Text style={styles.small}>
          Voice permissions are not verified. Refresh before changing access.
        </Text>
      ) : null}
      {state.message ? (
        <View {...(Platform.OS === 'web' ? { role: 'status' } : {})}>
          <Notice>{state.message}</Notice>
        </View>
      ) : null}
      {state.accessError ? <Notice tone="error">{state.accessError}</Notice> : null}
      <Button
        label="Refresh voice permissions"
        secondary
        loading={state.accessLoading}
        disabled={busy}
        onPress={() => void controller.refreshAccess()}
      />
      <View style={styles.divider} />
      <Text accessibilityRole="header" style={styles.h3}>
        Recent voice activity
      </Text>
      <Text style={styles.small}>
        The latest 12 recorded decisions from the last seven days. Conversation text and request
        arguments are not shown here. An operation result does not prove that an external call or
        Calendar change completed.
      </Text>
      {state.activityLoading ? <Text style={styles.small}>Loading recent activity…</Text> : null}
      {!state.activityLoading && !decisions.length && !state.activityError ? (
        <Text style={styles.small}>No recent voice decisions are recorded.</Text>
      ) : null}
      {decisions.map((event) => {
        const presentation = toolDecisionPresentation(event);
        return (
          <View key={event.eventId} style={{ gap: 8 }}>
            <Text style={styles.h3}>{presentation.title}</Text>
            <Badge text={presentation.label} tone={presentation.tone} />
            <Text style={styles.small}>{presentation.detail}</Text>
            <Text style={styles.small}>{localDate(event.occurredAt, timezone)}</Text>
          </View>
        );
      })}
      {state.activityError ? (
        <>
          <Notice tone="error">{state.activityError}</Notice>
          {decisions.length ? (
            <Text style={styles.small}>
              Previously loaded activity is shown. It may not include newer decisions.
            </Text>
          ) : null}
        </>
      ) : null}
      <Button
        label="Refresh voice activity"
        secondary
        loading={state.activityLoading}
        onPress={() => void controller.refreshActivity()}
      />
    </Card>
  );
}
