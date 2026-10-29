import React, { useEffect } from 'react';
import { FlatList, Platform, Share, View } from 'react-native';
import { AppText as Text } from '../../components/primitives';
import { NetworkIdentitySchema, type NetworkConnection } from '@personal-agent/domain';
import { Badge, Button, Card, Empty, Field, Notice, useUI } from '../../ui';
import { useNetworkClient, useNetworkQuery, useSessionState } from './data-provider';
import { usePanelTask } from './panel-hooks';
import { peerName } from './panel-state';

type Identity = ReturnType<typeof NetworkIdentitySchema.parse>;
type ConnectionAction =
  | 'accept'
  | 'decline'
  | 'block'
  | 'unblock'
  | 'remove'
  | 'mute'
  | 'unmute'
  | 'allow_inbound'
  | 'deny_inbound';
export function PeoplePanel({ ownerId, memberCode }: { ownerId: string; memberCode?: string }) {
  return <PeopleContent key={ownerId} ownerId={ownerId} initialMemberCode={memberCode} />;
}

function PeopleContent({
  ownerId,
  initialMemberCode,
}: {
  ownerId: string;
  initialMemberCode?: string;
}) {
  const { styles } = useUI(),
    task = usePanelTask(),
    networkApi = useNetworkClient();
  const identityQuery = useNetworkQuery<Identity>('/network/identity'),
    connectionsQuery = useNetworkQuery<{ connections: NetworkConnection[] }>(
      '/network/connections',
    );
  const identity = identityQuery.data,
    connections = connectionsQuery.data?.connections ?? [],
    loaded = !!identity && connectionsQuery.data !== undefined;
  const [memberCode, setMemberCode] = useSessionState(`${ownerId}:people:memberCode`, ''),
    [confirmRemove, setConfirmRemove] = useSessionState<string | undefined>(
      `${ownerId}:people:remove`,
      undefined,
    ),
    [confirmBlock, setConfirmBlock] = useSessionState<string | undefined>(
      `${ownerId}:people:block`,
      undefined,
    ),
    [seenInvite, setSeenInvite] = useSessionState<string | undefined>(
      `${ownerId}:people:invite`,
      undefined,
    );
  useEffect(() => {
    if (initialMemberCode && initialMemberCode !== seenInvite) {
      setSeenInvite(initialMemberCode);
      if (/^klnk_[A-Za-z0-9_-]{8,128}$/.test(initialMemberCode)) setMemberCode(initialMemberCode);
      else task.setError('This connection link is invalid. Ask the member for a new link.');
    }
  }, [initialMemberCode]);
  const shareUrl = identity
    ? Platform.OS === 'web' && typeof window !== 'undefined'
      ? new URL(`/join/${encodeURIComponent(identity.member.memberCode)}`, window.location.origin)
          .href
      : `personal-agent://join/${encodeURIComponent(identity.member.memberCode)}`
    : '';
  const share = () =>
    void task.run(async () => {
      if (
        Platform.OS === 'web' &&
        typeof navigator !== 'undefined' &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(shareUrl);
        return 'Connection link copied. Share it with the member you choose.';
      }
      await Share.share({ message: shareUrl });
      return 'Connection link is ready to share. Opening it never accepts a connection automatically.';
    }, task.setNotice);
  const setConnections = (update: (current: NetworkConnection[]) => NetworkConnection[]) =>
    networkApi.update<{ connections: NetworkConnection[] }>('/network/connections', (previous) => ({
      connections: update(previous?.connections ?? []),
    }));
  const refresh = () =>
    task.run(
      async () => {
        await Promise.all([identityQuery.refetch(), connectionsQuery.refetch()]);
      },
      () => undefined,
    );
  const invite = (code = memberCode) => {
    if (code.trim().length < 8 || code.trim().length > 150) {
      task.setError(
        'Enter the full member code shared with you, between 8 and 150 characters. No invitation has been sent.',
      );
      return;
    }
    void task.run(
      () =>
        networkApi.request<NetworkConnection>('/network/connections', 'POST', {
          memberCode: code.trim(),
        }),
      (result) => {
        setConnections((current) => [result, ...current.filter((item) => item.id !== result.id)]);
        setMemberCode('');
        task.setNotice(
          result.status === 'pending'
            ? 'Connection request recorded. The invited member must accept it before coordination.'
            : result.status === 'accepted'
              ? 'You are already connected to this member.'
              : `This connection is ${result.status}. No new invitation was created.`,
        );
      },
      'Connection request could not be confirmed. Refresh before retrying. ',
    );
  };
  const change = (connection: NetworkConnection, action: ConnectionAction) =>
    void task.run(
      () =>
        networkApi.request<NetworkConnection>(`/network/connections/${connection.id}`, 'PATCH', {
          action,
          version: connection.version,
        }),
      (result) => {
        setConnections((current) =>
          current.map((item) =>
            item.id === result.id ? { ...result, peer: result.peer ?? item.peer } : item,
          ),
        );
        setConfirmBlock(undefined);
        setConfirmRemove(undefined);
        task.setNotice(
          `${peerName(connection)}: ${action === 'allow_inbound' ? 'inbound agent requests allowed' : action === 'deny_inbound' ? 'inbound agent requests denied' : action === 'accept' ? 'connection accepted; calendar authority is separate' : action === 'decline' ? 'connection declined' : action === 'mute' ? 'notifications muted' : action === 'unmute' ? 'notifications unmuted' : action === 'unblock' ? 'your block removed; current connection status is shown below' : action === 'remove' ? 'connection removed' : 'blocked'}.`,
        );
      },
      'Action unconfirmed. Refresh to read the current connection revision. ',
    );
  return (
    <FlatList
      testID="network-people"
      data={connections}
      keyExtractor={(connection) => connection.id}
      style={{ flex: 1 }}
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={5}
      ListHeaderComponent={
        <View style={{ gap: 24 }}>
          <View style={{ gap: 8 }}>
            <Text style={styles.label}>PEOPLE</Text>
            <Text accessibilityRole="header" style={styles.title}>
              A connection you choose.
            </Text>
            <Text style={styles.subtitle}>
              Connect two klnk members. Each person keeps their own agent and authority.
            </Text>
          </View>
          {identity ? (
            <Card>
              <Text style={styles.h3}>Invite someone to connect</Text>
              <Text selectable style={styles.text}>
                {shareUrl}
              </Text>
              <Button
                label={Platform.OS === 'web' ? 'Copy connection link' : 'Share connection link'}
                secondary
                onPress={share}
              />
              <Text accessibilityRole="header" style={styles.h3}>
                Your member code
              </Text>
              <Text selectable style={styles.text}>
                {identity.member.memberCode}
              </Text>
              <Text style={styles.small}>
                Share this code yourself with someone you trust. klnk does not contact anyone
                outside this app.
              </Text>
              <Badge text="Internal delivery only" tone="accent" />
            </Card>
          ) : null}
          <Card>
            <Text accessibilityRole="header" style={styles.h3}>
              Connect by member code
            </Text>
            <Field
              label="Member code"
              value={memberCode}
              onChangeText={setMemberCode}
              editable={!task.busy}
              autoCapitalize="none"
              autoCorrect={false}
              hint="Ask the other member for their klnk code. No phone number or email is needed."
            />
            <Button
              label="Request connection"
              onPress={() => invite()}
              loading={task.busy}
              disabled={!loaded}
            />
          </Card>
          {task.error || identityQuery.error || connectionsQuery.error ? (
            <Notice tone="error">
              {task.error || identityQuery.error || connectionsQuery.error}
            </Notice>
          ) : null}
          {task.notice ? <Notice>{task.notice}</Notice> : null}
          <Button
            label={task.busy ? 'Updating People' : 'Refresh People'}
            secondary
            onPress={() => void refresh()}
            loading={task.busy}
          />
          {!loaded ? (
            <Text style={styles.small}>
              {task.busy || identityQuery.loading || connectionsQuery.loading
                ? 'Loading your connections…'
                : 'Connections have not loaded. Retry using Refresh People.'}
            </Text>
          ) : !connections.length ? (
            <Card>
              <Empty
                icon="people-outline"
                title="No connections yet"
                detail="An accepted connection is needed to delegate an internal request. No sample people have been added."
              />
            </Card>
          ) : null}
        </View>
      }
      renderItem={({ item: connection }) => {
        const name = peerName(connection),
          incoming = connection.toId === ownerId,
          allowed = connection.inbound[ownerId] === true,
          muted = connection.mutedBy.includes(ownerId);
        return (
          <Card key={connection.id}>
            <Text accessibilityRole="header" style={styles.h2}>
              {name}
            </Text>
            <Badge
              text={
                connection.status === 'pending'
                  ? incoming
                    ? 'Invitation received'
                    : 'Awaiting their acceptance'
                  : connection.status === 'accepted'
                    ? 'Connected'
                    : connection.status === 'blocked'
                      ? 'Blocked'
                      : connection.status === 'removed'
                        ? 'Removed'
                        : 'Declined'
              }
              tone={connection.status === 'accepted' ? 'success' : 'neutral'}
            />
            <Text style={styles.small}>Connection revision {connection.version}</Text>
            {connection.status === 'blocked' &&
            (!connection.blockedBy || connection.blockedBy.includes(ownerId)) ? (
              <Button
                label={`Unblock ${name}`}
                secondary
                disabled={task.busy}
                onPress={() => change(connection, 'unblock')}
              />
            ) : null}
            {['declined', 'removed'].includes(connection.status) && connection.peer?.memberCode ? (
              <Button
                label={`Request connection again: ${name}`}
                secondary
                disabled={task.busy}
                onPress={() => invite(connection.peer!.memberCode)}
              />
            ) : null}
            {connection.status === 'pending' && incoming ? (
              <>
                <Button
                  label={`Accept ${name}'s connection`}
                  disabled={task.busy}
                  onPress={() => change(connection, 'accept')}
                />
                <Button
                  label={`Decline ${name}'s connection`}
                  secondary
                  disabled={task.busy}
                  onPress={() => change(connection, 'decline')}
                />
              </>
            ) : null}
            {connection.status === 'accepted' ? (
              <>
                {confirmRemove === connection.id ? (
                  <View style={{ gap: 12 }}>
                    <Notice tone="warning">
                      Remove this connection? New requests stop until both members connect again.
                      Shared history remains governed by retention.
                    </Notice>
                    <Button
                      label={`Confirm remove ${name}`}
                      danger
                      secondary
                      disabled={task.busy}
                      onPress={() => change(connection, 'remove')}
                    />
                    <Button
                      label={`Keep connection with ${name}`}
                      secondary
                      onPress={() => setConfirmRemove(undefined)}
                    />
                  </View>
                ) : (
                  <Button
                    label={`Remove connection with ${name}`}
                    danger
                    secondary
                    disabled={task.busy}
                    onPress={() => setConfirmRemove(connection.id)}
                  />
                )}
                <Text style={styles.text}>
                  Their agent may {allowed ? '' : 'not '}send inbound requests to yours.
                </Text>
                <Text style={styles.small}>
                  Allowing inbound requests does not approve a meeting or enable autonomy.
                </Text>
                <Button
                  label={`${allowed ? 'Deny' : 'Allow'} inbound requests from ${name}`}
                  secondary
                  disabled={task.busy}
                  onPress={() => change(connection, allowed ? 'deny_inbound' : 'allow_inbound')}
                />
                <Button
                  label={`${muted ? 'Unmute' : 'Mute'} ${name}`}
                  secondary
                  disabled={task.busy}
                  onPress={() => change(connection, muted ? 'unmute' : 'mute')}
                />
                {muted ? (
                  <Text style={styles.small}>
                    Muted. Inspect request state in Inbox; muting is separate from cancelling work.
                  </Text>
                ) : null}
              </>
            ) : null}
            {connection.status !== 'blocked' ? (
              confirmBlock === connection.id ? (
                <>
                  <Notice tone="warning">
                    Block {name}? Future requests and actions are checked against this connection.
                    Information already shared remains in conversation records.
                  </Notice>
                  <Button
                    label={`Confirm block ${name}`}
                    danger
                    secondary
                    disabled={task.busy}
                    onPress={() => change(connection, 'block')}
                  />
                  <Button
                    label={`Keep ${name}'s connection`}
                    secondary
                    disabled={task.busy}
                    onPress={() => setConfirmBlock(undefined)}
                  />
                </>
              ) : (
                <Button
                  label={`Block ${name}`}
                  danger
                  secondary
                  disabled={task.busy}
                  onPress={() => setConfirmBlock(connection.id)}
                />
              )
            ) : null}
          </Card>
        );
      }}
    />
  );
}
