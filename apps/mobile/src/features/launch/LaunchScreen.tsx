import React, { useRef, useState } from 'react';
import {
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ActionButton, AppText, Icon, type IconName } from '../../components';
import { brand, radii, spacing, typeRoles } from '../../design/tokens';
import { ThemeProvider } from '../../design/ThemeProvider';
import type { LiveTurn, LiveConversation } from '../live/types';
import { useDesign } from '../../design/ThemeProvider';
import { LaunchArtwork } from './launch-artwork';

const features: { label: string; icon: IconName }[] = [
  { label: 'Meetings', icon: 'calendar-outline' },
  { label: 'Memory', icon: 'layers-outline' },
  { label: 'Answers', icon: 'chatbubbles-outline' },
];

/** Only an explicit owner gesture starts capture. Telephone actions are a separate workspace. */
export function LaunchScreen({
  onWorkspace,
  live,
  onCall,
  recordedAvailable = false,
}: {
  onWorkspace: () => void;
  live: LiveConversation;
  onCall?: () => void;
  recordedAvailable?: boolean;
}) {
  const { reducedMotion } = useDesign();
  const captionsRef = useRef<FlatList<LiveTurn>>(null);
  const [attempted, setAttempted] = useState(live.state !== 'idle'),
    { width, height, fontScale } = useWindowDimensions(),
    [availableHeight, setAvailableHeight] = useState(height);
  const active =
    live.state === 'connecting' || live.state === 'connected' || live.state === 'ending';
  const canExplore =
    ((!live.supported && !recordedAvailable) ||
      !!live.error ||
      attempted ||
      live.closureUnconfirmed ||
      live.state === 'ended') &&
    !active &&
    live.state !== 'checking';
  const call = () => {
    setAttempted(true);
    if (onCall) onCall();
    else void live.start();
  };
  const opening = live.state === 'idle' && !live.error && !live.closureUnconfirmed && !canExplore;
  const artSize = Math.min(260, width - 64, Math.max(120, availableHeight * 0.28));
  return (
    <View style={s.stage}>
      <StatusBar style="light" />
      <SafeAreaView
        style={s.screen}
        edges={['top', 'left', 'right', 'bottom']}
        onLayout={(event) => setAvailableHeight(event.nativeEvent.layout.height)}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.presence}>
            <View style={s.brandRow}>
              <Text style={s.wordmark}>klnk</Text>
              <View style={s.brandMark}>
                <Icon name="sparkles-outline" color={brand.coral} size={22} />
              </View>
            </View>
            <Text accessibilityRole="header" style={[s.headline, width < 360 && typeRoles.title]}>
              Your day.{'\n'}One conversation.
            </Text>
            <LaunchArtwork size={artSize} resting={opening} />
            {!opening ? (
              <Text accessibilityLiveRegion="polite" style={s.status}>
                {recordedAvailable && live.state === 'idle'
                  ? 'Voice turns, at your pace.'
                  : live.statusText}
              </Text>
            ) : null}
          </View>
          <ThemeProvider colorScheme="light">
            <View style={[s.conversation, opening && s.opening]}>
              {opening ? (
                <View style={s.features}>
                  {features.map(({ label, icon }) => (
                    <View key={label} style={[s.feature, { minWidth: 72 * fontScale }]}>
                      <View style={s.featureIcon}>
                        <Icon name={icon} color={brand.ink} size={24} />
                      </View>
                      <Text style={s.featureLabel}>{label}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <>
                  <Text accessibilityRole="header" style={s.panelTitle}>
                    {live.closureUnconfirmed
                      ? 'Check the earlier session.'
                      : live.state === 'connected'
                        ? 'I’m here.'
                        : live.state === 'ended'
                          ? 'Until next time.'
                          : live.state === 'error'
                            ? 'Let’s reconnect.'
                            : 'Let’s talk.'}
                  </Text>
                  <Text style={s.body}>
                    {live.closureUnconfirmed
                      ? 'An earlier session has no confirmed closure. Open your workspace for typed access; resolve that session before starting another.'
                      : live.state === 'connected'
                        ? 'Speak naturally. klnk will reply out loud.'
                        : live.state === 'ended'
                          ? 'Your microphone is off. You can talk again whenever you’re ready.'
                          : !live.supported && !recordedAvailable
                            ? 'Live voice is not available here. Open your workspace to continue.'
                            : 'Speak naturally. Hear a reply.'}
                  </Text>
                </>
              )}
              {live.error ? (
                <View accessibilityRole="alert" style={s.error}>
                  <Text style={s.errorText}>{live.error}</Text>
                </View>
              ) : null}
              {live.durationWarning ? (
                <Text accessibilityLiveRegion="polite" style={s.body}>
                  {live.durationWarning}
                </Text>
              ) : null}
              {live.closureUnconfirmed ? (
                <View accessibilityRole="alert" style={s.error}>
                  <Text style={s.errorText}>
                    The microphone is off. Server session closure is still unconfirmed; end it
                    before starting another conversation.
                  </Text>
                </View>
              ) : null}
              {live.state === 'connected' ? (
                <View style={s.controls}>
                  <ActionButton
                    label="End call"
                    icon="call-outline"
                    onPress={() => void live.end()}
                  />
                  {live.audioBlocked ? (
                    <ActionButton
                      label="Enable spoken audio"
                      secondary
                      icon="volume-high-outline"
                      onPress={() => void live.enableAudio()}
                    />
                  ) : null}
                  <View style={s.controlRow}>
                    <View style={s.control}>
                      <ActionButton
                        label={
                          live.mutePending ? 'Updating microphone…' : live.muted ? 'Unmute' : 'Mute'
                        }
                        secondary
                        disabled={live.mutePending}
                        icon={live.muted ? 'mic-off-outline' : 'mic-outline'}
                        onPress={live.toggleMute}
                      />
                    </View>
                    <View style={s.control}>
                      <ActionButton
                        label={live.captionsOpen ? 'Hide captions' : 'Captions'}
                        secondary
                        icon="chatbox-outline"
                        onPress={live.toggleCaptions}
                      />
                    </View>
                  </View>
                </View>
              ) : active ? (
                <ActionButton
                  label={live.state === 'ending' ? 'Ending call…' : 'Cancel connection'}
                  loading={live.state === 'ending'}
                  onPress={() => void live.end()}
                />
              ) : live.closureUnconfirmed ? (
                <ActionButton
                  label="Retry ending session"
                  icon="close-circle-outline"
                  onPress={() => void live.end()}
                />
              ) : (
                <ActionButton
                  label="Call klnk"
                  icon="call-outline"
                  prominent
                  loading={live.state === 'checking'}
                  onPress={call}
                />
              )}
              {live.captionsOpen && live.state === 'connected' ? (
                <View style={s.captions}>
                  <AppText role="action" style={{ color: brand.ink }}>
                    Recent captions
                  </AppText>
                  {live.turns.length ? (
                    <FlatList
                      ref={captionsRef}
                      style={{ maxHeight: 240 }}
                      nestedScrollEnabled
                      data={live.turns}
                      keyExtractor={(turn) => turn.id}
                      onContentSizeChange={() =>
                        captionsRef.current?.scrollToEnd({ animated: !reducedMotion })
                      }
                      renderItem={({ item: turn }) => (
                        <View style={{ gap: 4, paddingBottom: 12 }}>
                          <Text style={s.captionSpeaker}>{turn.speaker}</Text>
                          <Text style={s.caption}>{turn.text}</Text>
                        </View>
                      )}
                    />
                  ) : (
                    <Text style={s.caption}>Captions will appear as you speak.</Text>
                  )}
                </View>
              ) : null}
              {canExplore ? (
                <ActionButton
                  label="Open workspace"
                  secondary
                  icon="grid-outline"
                  onPress={onWorkspace}
                />
              ) : null}
              <Text style={s.footnote}>
                {live.closureUnconfirmed
                  ? 'Closure unconfirmed · Microphone off · Starting another conversation is blocked.'
                  : active
                    ? 'Up to five minutes · Owner-to-agent conversation · No telephone call is placed.'
                    : live.state === 'ended'
                      ? 'AI conversation ended · No telephone call was placed.'
                      : Platform.OS === 'web'
                        ? '5 min · Voice with OpenAI\nMicrophone starts when you call.'
                        : recordedAvailable
                          ? 'Up to five minutes of recorded turns. OpenAI transcribes; this device speaks the reply.'
                          : 'Native live audio requires a compatible transport.'}
              </Text>
            </View>
          </ThemeProvider>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
const s = StyleSheet.create({
  stage: { flex: 1, backgroundColor: brand.navy, alignItems: 'center' },
  screen: { flex: 1, width: '100%', maxWidth: 560, backgroundColor: brand.navy },
  scroll: { flexGrow: 1 },
  presence: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  brandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
  },
  wordmark: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '600',
    letterSpacing: -1,
    color: brand.cream,
  },
  brandMark: { padding: spacing.sm },
  headline: { ...typeRoles.hero, color: brand.cream, marginTop: spacing.xl, letterSpacing: -0.8 },
  status: { ...typeRoles.supporting, color: brand.onNavyMuted, textAlign: 'center', marginTop: 8 },
  conversation: {
    flexGrow: 1,
    backgroundColor: brand.lavender,
    borderTopLeftRadius: 64,
    borderTopRightRadius: radii.sheet,
    borderCurve: 'continuous',
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.screen,
    gap: spacing.xl,
  },
  opening: { justifyContent: 'center', gap: spacing.screen },
  features: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  feature: { flexGrow: 1, flexShrink: 0, alignItems: 'center', gap: spacing.sm },
  featureIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: brand.cream,
    borderRadius: radii.control,
    borderCurve: 'continuous',
  },
  featureLabel: {
    ...typeRoles.supporting,
    color: brand.ink,
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  panelTitle: { ...typeRoles.title, color: brand.ink, letterSpacing: -0.5 },
  body: { ...typeRoles.body, color: brand.muted },
  controls: { gap: 12 },
  controlRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  control: { flexGrow: 1, flexBasis: 140 },
  error: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#8E2035',
    backgroundColor: '#FBE9EE',
  },
  errorText: { ...typeRoles.supporting, color: '#8E2035' },
  captions: {
    gap: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: brand.cream,
    borderWidth: 1,
    borderColor: brand.edge,
  },
  captionSpeaker: { ...typeRoles.caption, color: brand.muted },
  caption: { ...typeRoles.body, color: brand.ink },
  footnote: { ...typeRoles.caption, color: brand.muted, textAlign: 'center' },
});
