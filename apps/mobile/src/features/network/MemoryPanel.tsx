import React, {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import type {NetworkConnection, NetworkMemory} from '@personal-agent/domain';
import {Badge, Button, Card, Choice, Empty, Field, Notice, useUI} from '../../ui';
import {networkApi} from './api';
import {usePanelTask} from './panel-hooks';
import {acceptedConnections, buildMemory, memoryDraft, peerId, peerName, type MemoryInput} from './panel-state';

export function MemoryPanel({ownerId}: {ownerId: string}) {return <MemoryContent key={ownerId} ownerId={ownerId}/>;}
function MemoryContent({ownerId}: {ownerId: string}) {
  const {styles} = useUI(), task = usePanelTask();
  const [memories, setMemories] = useState<NetworkMemory[]>([]), [connections, setConnections] = useState<NetworkConnection[]>([]), [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<NetworkMemory>(), [draft, setDraft] = useState<MemoryInput>(() => memoryDraft()), [showEditor, setShowEditor] = useState(false), [deleteId, setDeleteId] = useState<string>();
  const accepted = acceptedConnections(connections), memberIds = accepted.map(connection => peerId(connection, ownerId));
  const update = <K extends keyof MemoryInput>(key: K, value: MemoryInput[K]) => setDraft(current => ({...current, [key]: value}));
  const refresh = () => task.run(async () => {
    const [result, people] = await Promise.all([networkApi.request<{memories: NetworkMemory[]}>('/network/memories'), networkApi.request<{connections: NetworkConnection[]}>('/network/connections')]);
    return {memories: result.memories, connections: people.connections};
  }, result => {setMemories(result.memories); setConnections(result.connections); setLoaded(true);});
  useEffect(() => {void refresh();}, []);
  const save = () => {
    let memory: MemoryInput;
    try {memory = buildMemory(draft, memberIds);} catch (error) {task.setError((error as Error).message); return;}
    void task.run(() => networkApi.request<NetworkMemory>(editing ? `/network/memories/${editing.id}` : '/network/memories', editing ? 'PATCH' : 'POST', editing ? {memory, version: editing.version} : memory), saved => {
      setMemories(current => [saved, ...current.filter(item => item.id !== saved.id)]); setEditing(saved); setDraft(memory); setShowEditor(false); task.setNotice('Memory saved with your chosen disclosure and expiry.');
    }, 'Save unconfirmed. Your memory draft is retained. Refresh to inspect current records before retrying. ');
  };
  const edit = (memory?: NetworkMemory) => {
    setEditing(memory); setDraft(memory ? {text: memory.text, topic: memory.topic, sharing: memory.sharing, memberIds: [...memory.memberIds], expiresAt: memory.expiresAt, confirmed: memory.confirmed} : memoryDraft()); setShowEditor(true); setDeleteId(undefined); task.setError('');
  };
  const remove = (memory: NetworkMemory) => void task.run(() => networkApi.request<{ok: true}>(`/network/memories/${memory.id}`, 'DELETE'), () => {
    setMemories(current => current.filter(item => item.id !== memory.id)); setDeleteId(undefined); if (editing?.id === memory.id) setShowEditor(false); task.setNotice('Memory deleted. Previously shared conversation content is retained.');
  }, 'Deletion unconfirmed. Refresh Memory to check whether the record remains. ');
  return <View testID="network-memory" style={{gap:24}}>
    <View style={{gap:8}}><Text style={styles.label}>MEMORY</Text><Text accessibilityRole="header" style={styles.title}>Context with boundaries.</Text><Text style={styles.subtitle}>Add only what you choose. Private is the default; no other-app history is imported.</Text></View>
    <Notice>These memories belong to your internal agent. Only confirmed, unexpired items with explicit member scope may be disclosed under your delegation settings. A memory never grants authority by itself.</Notice>
    {task.error ? <Notice tone="error">{task.error}</Notice> : null}{task.notice ? <Notice>{task.notice}</Notice> : null}
    <Button label={task.busy ? 'Updating Memory' : 'Refresh Memory'} secondary loading={task.busy} onPress={() => void refresh()}/>
    {showEditor ? <Card><Text accessibilityRole="header" style={styles.h2}>{editing ? 'Edit your memory' : 'A new memory'}</Text><Field label="Memory text" multiline value={draft.text} editable={!task.busy} onChangeText={value => update('text', value)} maxLength={1000}/><Field label="Memory topic" value={draft.topic} editable={!task.busy} onChangeText={value => update('topic', value)} hint="Match a permitted delegation topic, for example project planning." maxLength={80}/>
      <Choice label="Memory disclosure" value={draft.sharing} disabled={task.busy} onChange={value => {update('sharing', value); if (value === 'private') update('memberIds', []);}} options={[{label:'Private to me', value:'private'}, {label:'Only selected members', value:'connections'}]}/>
      {draft.sharing === 'connections' ? <View style={{gap:12}}><Text style={styles.h3}>Members allowed in scope</Text>{accepted.length ? accepted.map(connection => {const id = peerId(connection, ownerId), selected = draft.memberIds.includes(id); return <Button key={id} label={`${selected ? 'Remove' : 'Add'} ${peerName(connection)} ${selected ? 'from' : 'to'} memory scope`} secondary disabled={task.busy} onPress={() => update('memberIds', selected ? draft.memberIds.filter(value => value !== id) : [...draft.memberIds, id])}/>;}) : <Text style={styles.small}>Accept a connection in People before selecting a member.</Text>}{draft.memberIds.some(id => !memberIds.includes(id)) ? <Notice tone="warning">A selected connection is no longer accepted. Remove it by choosing Private, then select current members again.</Notice> : null}<Text style={styles.small}>{draft.memberIds.length} selected. Sharing still requires a permitted topic and delegation rule.</Text></View> : null}
      <Choice label="Have you checked this memory?" value={draft.confirmed ? 'yes' : 'no'} disabled={task.busy} onChange={value => update('confirmed', value === 'yes')} options={[{label:'Needs my review', value:'no'}, {label:'Confirmed by me', value:'yes'}]}/>
      <Field label="Memory expires at" value={draft.expiresAt} editable={!task.busy} onChangeText={value => update('expiresAt', value)} autoCapitalize="none" autoCorrect={false} hint="ISO date and time with UTC offset, for example 2026-11-30T18:00:00Z."/>
      <Text style={styles.small}>Source: owner entered{editing ? ` · revision ${editing.version}` : ''}. Saving never promotes this into permission to act.</Text><Button label="Save network memory" onPress={save} loading={task.busy}/><Button label="Discard memory draft" secondary disabled={task.busy} onPress={() => setShowEditor(false)}/>
    </Card> : <Button label="Add network memory" disabled={!loaded || task.busy} onPress={() => edit()}/>}
    {!loaded ? <Text style={styles.small}>{task.busy ? 'Loading your memory…' : 'Memory has not loaded. Use Refresh Memory to retry.'}</Text> : !memories.length ? <Card><Empty icon="layers-outline" title="Your context starts with you" detail="No network memory has been added. Existing telephone-contact memories are kept separately."/></Card> : null}
    {memories.map(memory => <Card key={memory.id}><Text accessibilityRole="header" style={styles.h3}>{memory.topic}</Text><Text style={styles.text}>{memory.text}</Text><View style={styles.chips}><Badge text={memory.sharing === 'private' ? 'Private' : `${memory.memberIds.length} selected members`} tone="blue"/><Badge text={memory.confirmed ? 'Confirmed by you' : 'Needs your review'} tone={memory.confirmed ? 'green' : 'amber'}/>{Date.parse(memory.expiresAt) <= Date.now() ? <Badge text="Expired" tone="amber"/> : null}</View><Text style={styles.small}>Source: owner entered · revision {memory.version}{'\n'}Expires {memory.expiresAt}{'\n'}Updated {memory.updatedAt}</Text><Button label={`Edit memory: ${memory.topic}`} secondary disabled={task.busy || showEditor} onPress={() => edit(memory)}/>{deleteId === memory.id ? <><Notice tone="warning">Delete this memory? Records already shared in permitted conversations remain. Pending requests must be cancelled separately.</Notice><Button label={`Confirm delete memory: ${memory.topic}`} secondary danger disabled={task.busy} onPress={() => remove(memory)}/><Button label={`Keep memory: ${memory.topic}`} secondary disabled={task.busy} onPress={() => setDeleteId(undefined)}/></> : <Button label={`Delete memory: ${memory.topic}`} secondary danger disabled={task.busy} onPress={() => setDeleteId(memory.id)}/>}</Card>)}
  </View>;
}
