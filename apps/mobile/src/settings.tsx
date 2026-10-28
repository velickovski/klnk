import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Linking, Platform, Share, Text, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import type { Profile } from '@personal-agent/domain';
import { api, API_URL, authenticatedAudioHeaders, getSessionSnapshot, isSessionCurrent } from './api';
import { Bootstrap, LANGUAGES, localDate } from './models';
import { Avatar, Badge, Button, Card, Choice, Disclosure, Field, Icon, Notice, useUI } from './ui';
import { CallingReadiness, ConnectionPanel } from './setup';
import { useSettingsDraft } from './features/settings/SettingsDraftProvider';
import { CalendarConnectionsController, canConnectCalendar, canDisconnectCalendar, connectionPresentation, pendingGoogleAuthorization } from './features/settings/connections';
import { ToolAccessPanel } from './features/settings/ToolAccessPanel';

type SaveProfile = (profile: Profile) => Promise<boolean>;
type Voice = { id: string; name: string; kind?: string; isOwnerClone?: boolean; enabled?: boolean; status?: string };
type VoiceSettings = { voices: Voice[]; voiceId?: string; cloneEnrollment: { available: boolean; reason: string }; previewAvailable: boolean };

function ProfilePreferences({ profile: savedProfile, working, onSave }: { profile: Profile; working: boolean; onSave: SaveProfile }) {
  const { styles } = useUI();
  const { store, state } = useSettingsDraft(savedProfile);
  const profile = state.profile;
  return <Card>
    <View style={styles.row}><Avatar name={profile.name} size={54} /><View style={{ flex: 1 }}><Text accessibilityRole="header" style={styles.h2}>{savedProfile.name}</Text><Text style={styles.small}>Personal profile</Text></View></View>
    {state.dirty ? <Badge text="Unsaved preferences" tone="amber" /> : null}
    <Field label="Your name" value={profile.name} onChangeText={name => store.update('name', name)} textContentType="name" error={state.errors.name} />
    <Choice label="Your language" value={profile.language} options={LANGUAGES.some(option => option.value === profile.language) ? LANGUAGES : [...LANGUAGES, { label: profile.language, value: profile.language }]} onChange={language => store.update('language', language)} />
    <Field label="Timezone" value={profile.timezone} onChangeText={timezone => store.update('timezone', timezone)} autoCapitalize="none" autoCorrect={false} hint="Use an IANA timezone, such as Europe/Skopje." error={state.errors.timezone} />
    <Field label="Communication style" multiline value={profile.tone} onChangeText={tone => store.update('tone', tone)} />
    <Field label="Pronunciation notes" multiline value={profile.pronunciation} onChangeText={pronunciation => store.update('pronunciation', pronunciation)} />
    {state.error ? <Notice tone="error">{state.error}</Notice> : null}
    {state.message ? <Text {...(Platform.OS === 'web' ? { role: 'status' } : { accessibilityLiveRegion: 'polite' })} style={styles.small}>{state.message}{state.dirty ? ' New edits have not been saved yet.' : ''}</Text> : null}
    <Button label="Save your preferences" secondary loading={working || state.saving} onPress={() => void store.save(onSave, true)} />
    {state.dirty ? <><Button label="Discard unsaved preferences" secondary disabled={working || state.saving} onPress={() => store.discard()} /><Text style={styles.small}>Edits stay here when you switch workspace tabs. Save before signing out, changing servers or leaving the workspace.</Text></> : null}
  </Card>;
}

/** Optional progressive setup, shown only inside the subsequent workspace. */
export function Onboarding({ profile, working, error, onSave }: { profile: Profile; working: boolean; error: string; onSave: SaveProfile }) {
  const { styles } = useUI();
  return <View style={{ gap: 16 }}><Text accessibilityRole="header" style={styles.h2}>A little about you, when you are ready.</Text><Text style={styles.text}>These preferences are optional. Typed requests work without a microphone, voice clone or connected app. Your agent introduces itself as an AI assistant acting for you.</Text>{error ? <Notice tone="error">{error}</Notice> : null}<ProfilePreferences profile={profile} working={working} onSave={onSave} /></View>;
}

export function SettingsScreen({ data, working, onSave, onSignOut, onDelete }: { data: Bootstrap; working: boolean; onSave: SaveProfile; onSignOut: () => void; onDelete: () => Promise<boolean> }) {
  const { colors, styles } = useUI();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings | null>(null);
  const [voiceId, setVoiceId] = useState('standard');
  const [voiceError, setVoiceError] = useState('');
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(true);
  const [voiceMessage, setVoiceMessage] = useState('');
  const [cloneToDelete, setCloneToDelete] = useState<string | null>(null);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportData, setExportData] = useState('');
  const [exportError, setExportError] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [connections] = useState(() => {
    const snapshot = getSessionSnapshot();
    return new CalendarConnectionsController(api, url => Linking.openURL(url), () => mounted.current && isSessionCurrent(snapshot));
  });
  const connectionState = useSyncExternalStore(connections.subscribe, connections.getSnapshot, connections.getSnapshot);
  useEffect(() => { if (Platform.OS !== 'web' && connectionState.message) AccessibilityInfo.announceForAccessibility(connectionState.message); }, [connectionState.message]);
  const integrationBusy = connectionState.loading || connectionState.operation !== null;
  const [disconnectId, setDisconnectId] = useState<string | null>(null);
  const player = useAudioPlayer(null);
  const playerStatus = useAudioPlayerStatus(player);
  const isDemo = data.mode === 'simulator';

  const loadVoices = async () => {
    const snapshot = getSessionSnapshot();
    setVoiceLoading(true); setVoiceError('');
    try {
      const settings = await api<VoiceSettings>('/settings/voice');
      if (!mounted.current || !isSessionCurrent(snapshot)) return;
      setVoiceSettings(settings);
      setVoiceId(settings.voiceId ?? settings.voices.find(voice => voice.enabled)?.id ?? settings.voices.find(voice => voice.kind === 'standard')?.id ?? settings.voices[0]?.id ?? 'standard');
    } catch (error) { if (mounted.current && isSessionCurrent(snapshot)) setVoiceError((error as Error).message); }
    finally { if (mounted.current && isSessionCurrent(snapshot)) setVoiceLoading(false); }
  };
  useEffect(() => { void loadVoices(); void connections.refresh(); }, [connections]);
  useEffect(() => { if (playerStatus.error) setVoiceError('The voice preview could not play. Check your connection and try again. Your selected voice has not changed.'); }, [playerStatus.error]);
  useEffect(() => () => { try { player.pause(); } catch { /* The audio hook may already have released its player. */ } }, [player]);

  const saveVoice = async (id: string, enabled = true) => {
    if (voiceBusy || voiceLoading) return;
    const snapshot = getSessionSnapshot();
    setVoiceBusy(true); setVoiceError(''); setVoiceMessage('');
    try {
      player.pause();
      await api('/settings/voice', 'PATCH', { voiceId: id, enabled });
      if (!mounted.current || !isSessionCurrent(snapshot)) return;
      setVoiceId(enabled ? id : 'standard');
      setVoiceMessage(enabled ? 'Outbound voice preference saved.' : 'Clone disabled for outbound calling.');
      await loadVoices();
    } catch (error) { if (mounted.current && isSessionCurrent(snapshot)) setVoiceError((error as Error).message); }
    finally { if (mounted.current && isSessionCurrent(snapshot)) setVoiceBusy(false); }
  };
  const preview = () => {
    setVoiceError('');
    try { player.replace({ uri: `${API_URL}/voices/${encodeURIComponent(voiceId)}/preview`, headers: authenticatedAudioHeaders() }); player.play(); }
    catch { setVoiceError('The voice preview could not start. Check your connection and try again.'); }
  };
  const deleteClone = async (id: string) => {
    const snapshot = getSessionSnapshot();
    setVoiceBusy(true); setVoiceError(''); setVoiceMessage('');
    try {
      player.pause();
      await api(`/voices/${encodeURIComponent(id)}`, 'DELETE');
      if (!mounted.current || !isSessionCurrent(snapshot)) return;
      setCloneToDelete(null);
      setVoiceMessage('Clone removed from this app. Provider deletion is queued when a provider asset exists; completion is not confirmed here.');
      await loadVoices();
    } catch (error) { if (mounted.current && isSessionCurrent(snapshot)) setVoiceError((error as Error).message); }
    finally { if (mounted.current && isSessionCurrent(snapshot)) setVoiceBusy(false); }
  };
  const exportAccount = async () => {
    const snapshot = getSessionSnapshot();
    setExportBusy(true); setExportError(''); setShareMessage('');
    try {
      const result = await api('/export');
      if (!mounted.current || !isSessionCurrent(snapshot)) return;
      setExportData(JSON.stringify(result, null, 2));
    } catch (error) { if (mounted.current && isSessionCurrent(snapshot)) setExportError((error as Error).message); }
    finally { if (mounted.current && isSessionCurrent(snapshot)) setExportBusy(false); }
  };
  const shareExport = async () => {
    setShareMessage('');
    try { const result = await Share.share({ title: 'Personal agent data export', message: exportData }); if (mounted.current) setShareMessage(result.action === Share.dismissedAction ? 'Sharing cancelled. Your export is still available below.' : 'Export handed to the sharing interface. Delivery is not confirmed by this app.'); }
    catch { if (mounted.current) setShareMessage('Sharing is unavailable. Select and copy the export below.'); }
  };
  const deleteAccount = async () => {
    setDeleteError('');
    try { const accepted = await onDelete(); if (mounted.current && !accepted) setDeleteError('Account deletion was not confirmed. Check the error above and retry only after any active call termination is confirmed.'); }
    catch (error) { if (mounted.current) setDeleteError((error as Error).message); }
  };

  return <>
    <View style={{ gap: 8 }}><Text style={styles.label}>MAKE IT YOURS</Text><Text accessibilityRole="header" style={styles.title}>Your agent. Your rules.</Text><Text style={styles.subtitle}>Voice, language, connections, and privacy. Always in your hands.</Text></View>
    <Disclosure title="Calling and server connection"><View style={{ gap: 16 }}><ConnectionPanel compact /><CallingReadiness readiness={data.liveReadiness} liveCallsEnabled={data.liveCallsEnabled} mode={data.mode} /></View></Disclosure>
    <Disclosure title="Profile">{data.profile.onboardingComplete ? <ProfilePreferences profile={data.profile} working={working} onSave={onSave} /> : <Onboarding profile={data.profile} working={working} error="" onSave={onSave} />}</Disclosure>
    <Disclosure title="Voice"><Card>
      <Text accessibilityRole="header" style={styles.h2}>Outbound assistant voice</Text>
      <Text style={styles.text}>The live telephone adapter currently uses its configured standard assistant voice. A saved voice preference does not confirm clone activation. The OpenAI owner conversation uses a separate voice and does not place telephone calls.</Text>
      {voiceLoading ? <Text style={styles.small}>Loading current voice settings…</Text> : null}
      {voiceSettings ? <>
        {voiceSettings.voices.length ? <Choice disabled={voiceBusy||voiceLoading} label="Selected outbound voice" value={voiceId} onChange={id => { if (!voiceBusy && !voiceLoading) void saveVoice(id); }} options={voiceSettings.voices.filter(voice => voice.kind === 'standard' || voice.status === 'verified').map(voice => ({ label: voice.name, value: voice.id }))} /> : <Text style={styles.small}>No selectable outbound voice is reported by this backend.</Text>}
        {voiceSettings.previewAvailable ? <><Button label={playerStatus.playing ? 'Stop voice preview' : 'Preview selected voice'} icon={playerStatus.playing ? 'stop-outline' : 'play-outline'} secondary disabled={voiceBusy || voiceLoading} onPress={playerStatus.playing ? () => player.pause() : preview} /><Text style={styles.small}>Plays a provider-generated preview. This does not record your microphone or place a call.</Text></> : <Text style={styles.small}>Voice audio preview is unavailable on this backend. No preview audio is fabricated.</Text>}
        <View style={styles.divider} /><Text accessibilityRole="header" style={styles.h3}>Your own voice, optionally</Text>
        <Badge text={voiceSettings.cloneEnrollment.available ? 'Provider enrollment required' : 'Enrollment unavailable'} tone="amber" />
        <Text style={styles.small}>{voiceSettings.cloneEnrollment.reason || 'Verified owner enrollment and provider account provisioning are required before a clone can be enabled.'}</Text>
        {voiceSettings.voices.filter(voice => voice.isOwnerClone || voice.kind === 'clone').map(voice => <View key={voice.id} style={{ gap: 12 }}>
          <Text style={styles.h3}>{voice.name}</Text><Badge text={voice.status === 'verified' ? 'Verified clone' : 'Verification unavailable'} tone={voice.status === 'verified' ? 'green' : 'amber'} />
          {voice.enabled ? <Button label={`Disable ${voice.name}`} secondary loading={voiceBusy} onPress={() => void saveVoice(voice.id, false)} /> : null}
          {cloneToDelete === voice.id ? <><Notice tone="warning">Remove this clone from the app and queue deletion of its provider asset. Remote cleanup may take time and provider retention may remain.</Notice><Button label={`Confirm deletion of ${voice.name}`} danger secondary loading={voiceBusy} onPress={() => void deleteClone(voice.id)} /><Button label="Keep this clone" secondary disabled={voiceBusy} onPress={() => setCloneToDelete(null)} /></> : <Button label={`Delete ${voice.name}`} danger secondary disabled={voiceBusy} onPress={() => setCloneToDelete(voice.id)} />}
        </View>)}
      </> : !voiceLoading ? <Text style={styles.small}>Voice settings could not be loaded. Your saved preference has not been changed.</Text> : null}
      {voiceMessage ? <Notice>{voiceMessage}</Notice> : null}{voiceError ? <><Notice tone="error">{voiceError}</Notice><Button label="Reload voice settings" secondary loading={voiceLoading} onPress={() => void loadVoices()} /></> : null}
      <Notice>A recognizable voice does not reproduce your judgment or authority. The caller still identifies itself as an AI assistant. Text-only use requires no clone.</Notice>
    </Card></Disclosure>
    <Disclosure title="Voice permissions and activity"><ToolAccessPanel key={data.profile.id} ownerId={data.profile.id} timezone={data.profile.timezone} /></Disclosure>
    <Disclosure title="Apps and device access"><Card>
      <Text accessibilityRole="header" style={styles.h2}>Connections</Text>
      {data.integrations.filter(integration => integration.id !== 'calendar').map(integration => { const state = connectionPresentation(integration.status); return <Connection key={integration.id} icon="people-outline" title={integration.name} status={state.label} description={`${integration.detail} ${state.detail}`} />; })}
      <Connection icon="chatbubbles-outline" title="Messages & other apps" status="Unavailable" description="There is no access to SMS/iMessage history, private app data or ordinary cellular-call audio. Share relevant text explicitly in a request." />
      <Connection icon="mic-outline" title="Microphone" status="Optional · permission checked on use" description="Settings does not inspect microphone permission or start capture. Use the text workspace without granting microphone access." />
      <Text accessibilityRole="header" style={styles.h3}>Service connections</Text>
      {connectionState.loading ? <Text style={styles.small}>Checking service connections…</Text> : connectionState.connections.length === 0 ? <Text style={styles.small}>Connection information is unavailable. Refresh to check this backend; no service access is assumed.</Text> : null}
      {connectionState.connections.map(integration => { const state = connectionPresentation(integration.status); return <View key={integration.id} style={{ gap: 12 }}>
        <Text accessibilityRole="header" style={styles.h3}>{integration.name}</Text><Badge text={connectionState.uncertain ? 'Status needs verification' : state.label} tone={connectionState.uncertain ? 'amber' : state.tone} /><Text style={styles.small}>{integration.detail}</Text>
        {connectionState.uncertain ? <Text style={styles.small}>This is the last reported state. Refresh before assuming access or revocation.</Text> : null}
        {integration.status === 'connected' && !connectionState.uncertain ? <><Text style={styles.small}>Read existing events: {integration.capabilities.readExisting ? 'Available' : 'Unavailable'}{'\n'}Update existing events: {integration.capabilities.updateExisting ? 'Available after request authorization' : 'Unavailable'}</Text>{integration.verifiedAt ? <Text style={styles.small}>Account verified {localDate(integration.verifiedAt, data.profile.timezone)}</Text> : null}{integration.tokenExpiresAt ? <Text style={styles.small}>Access expires {localDate(integration.tokenExpiresAt, data.profile.timezone)}; renewal is checked by the backend.</Text> : null}</> : null}
        {canConnectCalendar(integration) && !connectionState.authorization && !connectionState.uncertain ? <Button label={integration.status === 'disconnected' ? 'Connect Google Calendar' : 'Reconnect Google Calendar'} secondary loading={connectionState.operation === 'connect'} disabled={integrationBusy} onPress={() => void connections.connect(integration)} /> : null}
        {pendingGoogleAuthorization(integration) || connectionState.authorization ? <><Text style={styles.small}>{connectionState.authorization ? 'Complete authorization in your browser, then return and refresh.' : 'Authorization is pending in the browser. If it did not open, cancel and start again.'} A browser window is not proof of a connected account.</Text>{connectionState.authorization ? <Button label="Continue Google authorization in browser" secondary disabled={integrationBusy} onPress={() => void connections.openAuthorization()} /> : null}<Button label="Cancel pending Google authorization" secondary loading={connectionState.operation === 'cancel'} disabled={integrationBusy} onPress={() => void connections.cancelAuthorization()} /></> : null}
        {canDisconnectCalendar(integration) ? disconnectId === integration.id ? <><Notice tone="warning">Block this app's Calendar access and ask Google to revoke this grant. If Google cannot confirm revocation, the connection stays visible as pending until verified. Existing calendar events are not deleted.</Notice><Button label="Confirm disconnect Google Calendar" secondary danger loading={connectionState.operation === 'disconnect'} disabled={integrationBusy} onPress={() => { void connections.disconnect(integration).then(accepted => { if (mounted.current && accepted) setDisconnectId(null); }); }} /><Button label="Keep Google Calendar connection" secondary disabled={integrationBusy} onPress={() => setDisconnectId(null)} /></> : <Button label={integration.status === 'revoke_pending' ? 'Retry Google Calendar disconnect' : 'Disconnect Google Calendar'} secondary danger disabled={integrationBusy} onPress={() => setDisconnectId(integration.id)} /> : null}
      </View>; })}
      {connectionState.message ? <View {...(Platform.OS === 'web' ? { role: 'status' } : {})}><Notice>{connectionState.message}</Notice></View> : null}{connectionState.error ? <Notice tone="error">{connectionState.error}</Notice> : null}
      <Button label="Refresh connection status" secondary loading={connectionState.loading} disabled={integrationBusy} onPress={() => void connections.refresh()} />
    </Card></Disclosure>
    <Disclosure title="Calling capabilities"><Card>
      <Text accessibilityRole="header" style={styles.h2}>Calling capabilities</Text><Badge text={isDemo ? 'Simulation' : 'Configured telephone adapter'} tone="blue" />
      <Text style={styles.small}>Availability comes from this backend. Supported adapter controls do not by themselves enable real calls.</Text>
      {Object.entries(data.capabilities).filter(([, value]) => typeof value === 'boolean').map(([name, value]) => <View key={name} style={styles.spread}><Text style={[styles.text, { flex: 1 }]}>{name.replace(/([A-Z])/g, ' $1').replace(/^./, first => first.toUpperCase())}</Text><Text style={[styles.small, { color: value ? colors.green : colors.muted }]}>{value ? 'Supported' : 'Unavailable'}</Text></View>)}
      <Text style={styles.small}>Microphone capture, spoken playback and telephone execution are separate capabilities.</Text>
    </Card></Disclosure>
    <Disclosure title="Privacy and data"><Card>
      <Text accessibilityRole="header" style={styles.h2}>Privacy & your data</Text>
      <Text style={styles.text}>Your content is processed by the backend and configured AI providers. It is not end-to-end encrypted.</Text>
      <Text style={styles.small}>Choose transcript retention in each request. Telephone audio recording is off. Owner voice input is processed for transcription when you choose to use it. Provider terms and retention settings also apply.</Text>
      <Text style={styles.small}>An export contains private profile, people, memories, request and conversation records held by this app. Prepare it here, then choose whether to share it. External provider records and backups are not included.</Text>
      <Button label="Export your account data" secondary icon="download-outline" loading={exportBusy} onPress={() => void exportAccount()} />
      {exportError ? <Notice tone="error">{exportError}</Notice> : null}
      {exportData ? <View style={{ gap: 12 }}><Text style={styles.small}>Export is ready. Select and copy the full data below, or open the sharing interface.</Text><Button label="Share prepared export" secondary onPress={() => void shareExport()} />{shareMessage ? <Notice>{shareMessage}</Notice> : null}<Text selectable style={styles.small}>{exportData}</Text><Button label="Hide prepared export" secondary onPress={() => { setExportData(''); setShareMessage(''); }} /></View> : null}
      {deleteConfirmed ? <><Notice tone="warning">This cancels queued work and requests active call termination. Deletion waits for confirmed termination, removes app records and sessions, and queues supported provider cleanup. Remote deletion is not confirmed here; provider retention and contractual backups may remain. This cannot be undone.</Notice><Button label="Confirm account deletion" danger secondary loading={working} onPress={() => void deleteAccount()} /><Button label="Keep your account" secondary disabled={working} onPress={() => { setDeleteConfirmed(false); setDeleteError(''); }} /></> : <Button label="Delete your account" danger secondary disabled={working} onPress={() => setDeleteConfirmed(true)} />}
      {deleteError ? <Notice tone="error">{deleteError}</Notice> : null}
    </Card></Disclosure>
    <Button label="Sign out" secondary icon="log-out-outline" disabled={working} onPress={onSignOut} />
    <Text style={[styles.small, { textAlign: 'center' }]}>Personal Voice Agent{__DEV__ ? ' · development build' : ''}{'\n'}{isDemo ? 'Simulation uses fictional outcomes.' : 'Real calls require backend authorization and an allowed recipient.'}</Text>
  </>;
}

function Connection({ icon, title, status, description }: { icon: React.ComponentProps<typeof Icon>['name']; title: string; status: string; description: string }) {
  const { styles } = useUI();
  return <View style={{ gap: 8, paddingVertical: 10 }}><View style={styles.row}><Icon name={icon} /><Text style={[styles.h3, { flex: 1 }]}>{title}</Text></View><Badge text={status} tone="neutral" /><Text style={styles.small}>{description}</Text></View>;
}
