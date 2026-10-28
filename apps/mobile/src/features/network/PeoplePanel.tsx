import React, {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import {NetworkIdentitySchema, type NetworkConnection} from '@personal-agent/domain';
import {Badge, Button, Card, Empty, Field, Notice, useUI} from '../../ui';
import {networkApi} from './api';
import {usePanelTask} from './panel-hooks';
import {peerName} from './panel-state';

type Identity = ReturnType<typeof NetworkIdentitySchema.parse>;
type ConnectionAction = 'accept' | 'decline' | 'block' | 'mute' | 'unmute' | 'allow_inbound' | 'deny_inbound';
export function PeoplePanel({ownerId}: {ownerId: string}) { return <PeopleContent key={ownerId} ownerId={ownerId}/>; }

function PeopleContent({ownerId}: {ownerId: string}) {
  const {styles} = useUI(), task = usePanelTask();
  const [identity, setIdentity] = useState<Identity>(), [connections, setConnections] = useState<NetworkConnection[]>([]), [loaded, setLoaded] = useState(false);
  const [memberCode, setMemberCode] = useState(''), [confirmBlock, setConfirmBlock] = useState<string>();
  const refresh = () => task.run(async () => {
    const [identity, result] = await Promise.all([networkApi.request<Identity>('/network/identity'), networkApi.request<{connections: NetworkConnection[]}>('/network/connections')]);
    return {identity, connections: result.connections};
  }, result => {setIdentity(result.identity); setConnections(result.connections); setLoaded(true);});
  useEffect(() => {void refresh();}, []);
  const invite = () => {
    if (memberCode.trim().length < 8 || memberCode.trim().length > 150) {task.setError('Enter the full member code shared with you, between 8 and 150 characters. No invitation has been sent.'); return;}
    void task.run(() => networkApi.request<NetworkConnection>('/network/connections', 'POST', {memberCode: memberCode.trim()}), result => {
      setConnections(current => [result, ...current.filter(item => item.id !== result.id)]);
      setMemberCode(''); task.setNotice(result.status === 'pending' ? 'Connection request recorded. The invited member must accept it before coordination.' : result.status === 'accepted' ? 'You are already connected to this member.' : `This connection is ${result.status}. No new invitation was created.`);
    }, 'Connection request could not be confirmed. Refresh before retrying. ');
  };
  const change = (connection: NetworkConnection, action: ConnectionAction) => void task.run(() => networkApi.request<NetworkConnection>(`/network/connections/${connection.id}`, 'PATCH', {action, version: connection.version}), result => {
    setConnections(current => current.map(item => item.id === result.id ? {...result,peer:result.peer ?? item.peer} : item)); setConfirmBlock(undefined);
    task.setNotice(`${peerName(connection)}: ${action === 'allow_inbound' ? 'inbound agent requests allowed' : action === 'deny_inbound' ? 'inbound agent requests denied' : action === 'accept' ? 'connection accepted; calendar authority is separate' : action === 'decline' ? 'connection declined' : action === 'mute' ? 'muted' : action === 'unmute' ? 'unmuted' : 'blocked'}.`);
  }, 'Action unconfirmed. Refresh to read the current connection revision. ');
  return <View testID="network-people" style={{gap:24}}>
    <View style={{gap:8}}><Text style={styles.label}>PEOPLE</Text><Text accessibilityRole="header" style={styles.title}>A connection you choose.</Text><Text style={styles.subtitle}>Connect two klnk members. Each person keeps their own agent and authority.</Text></View>
    {identity ? <Card><Text accessibilityRole="header" style={styles.h3}>Your member code</Text><Text selectable style={styles.text}>{identity.member.memberCode}</Text><Text style={styles.small}>Share this code yourself with someone you trust. klnk does not contact anyone outside this app.</Text><Badge text="Internal delivery only" tone="blue"/></Card> : null}
    <Card><Text accessibilityRole="header" style={styles.h3}>Connect by member code</Text><Field label="Member code" value={memberCode} onChangeText={setMemberCode} editable={!task.busy} autoCapitalize="none" autoCorrect={false} hint="Ask the other member for their klnk code. No phone number or email is needed."/><Button label="Request connection" onPress={invite} loading={task.busy} disabled={!loaded}/></Card>
    {task.error ? <Notice tone="error">{task.error}</Notice> : null}{task.notice ? <Notice>{task.notice}</Notice> : null}
    <Button label={task.busy ? 'Updating People' : 'Refresh People'} secondary onPress={() => void refresh()} loading={task.busy}/>
    {!loaded ? <Text style={styles.small}>{task.busy ? 'Loading your connections…' : 'Connections have not loaded. Retry using Refresh People.'}</Text> : !connections.length ? <Card><Empty icon="people-outline" title="No connections yet" detail="An accepted connection is needed to delegate an internal request. No sample people have been added."/></Card> : null}
    {connections.map(connection => {
      const name = peerName(connection), incoming = connection.toId === ownerId, allowed = connection.inbound[ownerId] === true, muted = connection.mutedBy.includes(ownerId);
      return <Card key={connection.id}><Text accessibilityRole="header" style={styles.h2}>{name}</Text><Badge text={connection.status === 'pending' ? incoming ? 'Invitation received' : 'Awaiting their acceptance' : connection.status === 'accepted' ? 'Connected' : connection.status === 'blocked' ? 'Blocked' : 'Declined'} tone={connection.status === 'accepted' ? 'green' : 'neutral'}/><Text style={styles.small}>Connection revision {connection.version}</Text>
        {connection.status === 'pending' && incoming ? <><Button label={`Accept ${name}'s connection`} disabled={task.busy} onPress={() => change(connection, 'accept')}/><Button label={`Decline ${name}'s connection`} secondary disabled={task.busy} onPress={() => change(connection, 'decline')}/></> : null}
        {connection.status === 'accepted' ? <><Text style={styles.text}>Their agent may {allowed ? '' : 'not '}send inbound requests to yours.</Text><Text style={styles.small}>Allowing inbound requests does not approve a meeting or enable autonomy.</Text><Button label={`${allowed ? 'Deny' : 'Allow'} inbound requests from ${name}`} secondary disabled={task.busy} onPress={() => change(connection, allowed ? 'deny_inbound' : 'allow_inbound')}/><Button label={`${muted ? 'Unmute' : 'Mute'} ${name}`} secondary disabled={task.busy} onPress={() => change(connection, muted ? 'unmute' : 'mute')}/>{muted ? <Text style={styles.small}>Muted. Inspect request state in Inbox; muting is separate from cancelling work.</Text> : null}</> : null}
        {connection.status !== 'blocked' ? confirmBlock === connection.id ? <><Notice tone="warning">Block {name}? Future requests and actions are checked against this connection. Information already shared remains in conversation records.</Notice><Button label={`Confirm block ${name}`} danger secondary disabled={task.busy} onPress={() => change(connection, 'block')}/><Button label={`Keep ${name}'s connection`} secondary disabled={task.busy} onPress={() => setConfirmBlock(undefined)}/></> : <Button label={`Block ${name}`} danger secondary disabled={task.busy} onPress={() => setConfirmBlock(connection.id)}/> : null}
      </Card>;
    })}
  </View>;
}
