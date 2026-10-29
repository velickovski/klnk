import React, { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { AppText as Text } from '../../components/primitives';
import {
  NETWORK_VOICE_TOOLS,
  type ApplicationToolName,
  type NetworkPolicy,
} from '@personal-agent/domain';
import { api } from '../../api';
import { Badge, Button, Card, Notice, useUI } from '../../ui';
import type { ToolAccess } from '../settings/tool-access';
import { usePanelTask } from './panel-hooks';
import { useNetworkQuery, useSessionState } from './data-provider';
import { formatDateTime } from './format';

export function VoiceAccessPanel({ ownerId }: { ownerId: string }) {
  return <VoiceAccessContent key={ownerId} ownerId={ownerId} />;
}
function VoiceAccessContent({ ownerId }: { ownerId: string }) {
  const { styles } = useUI(),
    task = usePanelTask();
  const [access, setAccess] = useState<ToolAccess>(),
    [uncertain, setUncertain] = useSessionState(`${ownerId}:voice-access:uncertain`, false);
  const policyQuery = useNetworkQuery<NetworkPolicy>('/network/policy'),
    policy = policyQuery.data;
  const check = (access: ToolAccess) => {
    if (access.grant.ownerId !== ownerId || access.externalEffectsEnabled !== false)
      throw new Error(
        'The voice-permission response does not match this account. Refresh after signing in again.',
      );
    return access;
  };
  const refresh = () =>
    task.run(
      async () => {
        const [access] = await Promise.all([
          api<ToolAccess>('/tools/access'),
          policyQuery.refetch(),
        ]);
        return { access: check(access) };
      },
      (result) => {
        setAccess(result.access);
        setUncertain(false);
      },
    );
  useEffect(() => {
    void refresh();
  }, []);
  const activeNames = access?.grant.enabled
    ? access.grant.tools.filter((name) => (NETWORK_VOICE_TOOLS as readonly string[]).includes(name))
    : [];
  const enabled = activeNames.length === NETWORK_VOICE_TOOLS.length,
    ownPolicyActive = policy?.enabled && Date.parse(policy.expiresAt) > Date.now();
  const change = (enable: boolean) => {
    setUncertain(true);
    void task.run(
      async () => {
        // Read the current shared grant before changing only the network subset.
        const current = check(await api<ToolAccess>('/tools/access'));
        if (enable && (!current.runtimeAvailable || Platform.OS !== 'web' || !ownPolicyActive))
          throw new Error(
            'Enable a current scoped delegation and use the supported browser voice runtime first.',
          );
        const others: ApplicationToolName[] = current.grant.enabled
          ? current.grant.tools.filter(
              (name) => !(NETWORK_VOICE_TOOLS as readonly string[]).includes(name),
            )
          : [];
        const tools = [...others, ...(enable ? NETWORK_VOICE_TOOLS : [])];
        return check(
          await api<ToolAccess>('/tools/access', 'PUT', { enabled: tools.length > 0, tools }),
        );
      },
      (result) => {
        setAccess(result);
        setUncertain(false);
        task.setNotice(
          enable
            ? 'Internal voice permissions saved. Start a new voice conversation to use them; every action still checks your current delegation.'
            : 'Internal voice permissions removed. Previously submitted requests have their own controls in Inbox.',
        );
      },
      'Permission change unconfirmed. The last confirmed state remains shown. Refresh to verify it before assuming access changed. ',
    );
  };
  return (
    <Card>
      <View testID="network-voice-access" style={{ gap: 16 }}>
        <Text accessibilityRole="header" style={styles.h2}>
          Connect voice to your agent network.
        </Text>
        <Text style={styles.text}>
          Explicitly allow your owner voice conversation to find accepted members, submit your exact
          scoped internal request and read its current result.
        </Text>
        <Text style={styles.small}>
          This uses the existing OpenAI browser voice conversation. It does not enable external
          calls, messaging or calendar services. Native Live voice remains unavailable.
        </Text>
        {access ? (
          <>
            <Badge
              text={`${uncertain ? 'Last confirmed: ' : ''}${enabled ? 'Internal voice permissions on' : activeNames.length ? 'Some internal voice permissions on' : 'Internal voice permissions off'}`}
              tone={uncertain ? 'warning' : enabled ? 'success' : 'neutral'}
            />
            <Text style={styles.small}>
              Server voice runtime: {access.runtimeAvailable ? 'available' : 'unavailable'} ·
              current delegation:{' '}
              {ownPolicyActive ? 'enabled within saved limits' : 'off or expired'}. Saved{' '}
              {formatDateTime(access.grant.updatedAt)}.
            </Text>
            {!ownPolicyActive ? (
              <Notice>
                Save an enabled, unexpired delegation above, then refresh these voice permissions to
                update this status. A voice permission alone never enables network authority.
              </Notice>
            ) : null}
            {Platform.OS !== 'web' ? (
              <Notice>
                Live voice transport is unavailable on this device. You can still remove saved
                permissions here and use the typed Inbox.
              </Notice>
            ) : null}
            <Text style={styles.small}>
              The three permissions are: accepted member lookup, internal request submission and
              internal status readback. Existing separately enabled legacy voice permissions are
              preserved; this control changes only internal network access.
            </Text>
            {activeNames.length ? (
              <Button
                label="Turn off internal voice permissions"
                secondary
                danger
                disabled={task.busy || uncertain}
                onPress={() => change(false)}
              />
            ) : null}
            {!enabled ? (
              <Button
                label="Allow these three internal voice permissions"
                disabled={
                  task.busy ||
                  uncertain ||
                  !access.runtimeAvailable ||
                  !ownPolicyActive ||
                  Platform.OS !== 'web'
                }
                onPress={() => change(true)}
              />
            ) : null}
          </>
        ) : (
          <Text style={styles.small}>
            {task.busy
              ? 'Checking your voice grant…'
              : 'Voice permissions have not been verified. Refresh to retry.'}
          </Text>
        )}
        {task.error ? <Notice tone="error">{task.error}</Notice> : null}
        {task.notice ? <Notice>{task.notice}</Notice> : null}
        <Button
          label={
            task.busy ? 'Updating internal voice permissions' : 'Refresh internal voice permissions'
          }
          secondary
          loading={task.busy}
          onPress={() => void refresh()}
        />
      </View>
    </Card>
  );
}
