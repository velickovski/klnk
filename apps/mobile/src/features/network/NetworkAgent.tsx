import React from 'react';
import { Platform, View } from 'react-native';
import {
  api,
  getSessionSnapshot,
  isSessionCurrent,
  setSession,
  type SessionSnapshot,
} from '../../api';
import { AppScreen, Button, ErrorState, LoadingState, useUI } from '../../ui';
import { AuthScreen } from '../auth/AuthScreen';
import { NetworkWorkspace } from './Workspace';
import { AccountPanel } from './AccountPanel';
import { NativeVoicePanel } from './NativeVoicePanel';
import { useNetworkQuery } from './data-provider';
export type AgentWorkspaceProps = {
  identity: SessionSnapshot;
  restoring: boolean;
  restoreError: string;
  accountNotice?: string;
  incomingLink?: string;
  voiceRequested: boolean;
  voiceAutoStart: boolean;
  onVoiceRequested: (requested: boolean) => void;
  onVoiceHome: () => void;
  onBeforeSignOut: () => Promise<void>;
  onSessionError: (error: Error) => void;
  onLegacy?: () => void;
  onNetworkWorkspace?: () => void;
};
/** Current product shell reads only owner-bound network data; no legacy bootstrap poll. */
export function NetworkAgentWorkspace(props: AgentWorkspaceProps) {
  const { styles } = useUI();
  const identity = useNetworkQuery<{ member: { id: string; name: string } }>(
    props.identity.token && !props.restoring ? '/network/identity' : undefined,
  );
  async function signOut() {
    const scope = getSessionSnapshot();
    try {
      await props.onBeforeSignOut();
      if (!isSessionCurrent(scope)) return;
      await api('/logout', 'POST', {});
      if (isSessionCurrent(scope)) await setSession(null);
    } catch (error) {
      if (isSessionCurrent(scope))
        props.onSessionError(
          error instanceof Error ? error : new Error('Sign out could not be confirmed.'),
        );
    }
  }
  const forget = () => {
    void setSession(null).catch(props.onSessionError);
  };
  if (props.restoring)
    return (
      <AppScreen>
        <LoadingState label="Restoring your account" />
      </AppScreen>
    );
  if (!props.identity.token)
    return (
      <AuthScreen
        initialError={props.restoreError}
        initialMessage={props.accountNotice}
        onVoiceHome={props.onVoiceHome}
      />
    );
  if (!identity.data)
    return (
      <AppScreen>
        <View style={{ gap: 24 }}>
          {identity.error ? (
            <ErrorState
              message={identity.error}
              onRetry={() => void identity.refetch().catch(props.onSessionError)}
            />
          ) : (
            <LoadingState label="Opening your agent network" />
          )}
          <Button label="Back to voice home" secondary onPress={props.onVoiceHome} />
          <Button label="Sign out" secondary onPress={() => void signOut()} />
        </View>
      </AppScreen>
    );
  const ownerId = identity.data.member.id;
  return (
    <NetworkWorkspace
      ownerId={ownerId}
      initialLink={props.incomingLink}
      onVoiceHome={props.onVoiceHome}
      onSignOut={() => void signOut()}
      onLegacy={props.onLegacy}
      accountPanel={<AccountPanel ownerId={ownerId} onSignOut={forget} onDeleted={forget} />}
      voicePanel={
        Platform.OS !== 'web' ? (
          props.voiceRequested ? (
            <NativeVoicePanel
              ownerId={ownerId}
              autoStart={props.voiceAutoStart}
              onClose={() => props.onVoiceRequested(false)}
            />
          ) : (
            <Button
              label="Talk to klnk"
              icon="mic-outline"
              onPress={() => props.onVoiceRequested(true)}
            />
          )
        ) : undefined
      }
    />
  );
}
