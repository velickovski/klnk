import React, { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Guidance } from '@personal-agent/domain';
import { ACTIVE, Bootstrap, hasCapability, localDate, MissionDetail } from './models';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Choice,
  Disclosure,
  Empty,
  Field,
  Icon,
  Notice,
  statusLabel,
  useUI,
  a11yState,
} from './ui';
import { presentAction, presentMission } from './features/voice/presentation';
import { guidanceAfterSave } from './features/missions/request-state';
import { useEditorGuard, type EditorGuard } from './features/forms/useEditorGuard';

export function MissionConversation({
  mission,
  data,
  working,
  guidanceFeedback,
  onCancel,
  onGuidance,
  onRetryActions,
  onDelete,
  onDirtyChange,
  onRegisterSave,
}: EditorGuard & {
  mission: MissionDetail;
  data: Bootstrap;
  working: boolean;
  guidanceFeedback: string;
  onCancel: () => void;
  onGuidance: (kind: Guidance['kind'], text: string) => Promise<boolean>;
  onRetryActions: () => void;
  onDelete: () => void;
}) {
  const { colors, styles } = useUI();
  const [expanded, setExpanded] = useState(false);
  const [showTranscript, setShowTranscript] = useState(true);
  const [instruction, setInstruction] = useState<{
    missionId: string;
    kind: Guidance['kind'];
    text: string;
    error: string;
  }>({ missionId: mission.id, kind: 'clarify', text: '', error: '' });
  const draft =
    instruction.missionId === mission.id
      ? instruction
      : { missionId: mission.id, kind: 'clarify' as const, text: '', error: '' };
  const { kind, text: guidance } = draft;
  const changeInstruction = (patch: Partial<typeof instruction>) =>
    setInstruction((previous) => ({
      ...(previous.missionId === mission.id
        ? previous
        : { missionId: mission.id, kind: 'clarify', text: '', error: '' }),
      ...patch,
    }));
  const [confirmDeleteFor, setConfirmDeleteFor] = useState<string | null>(null),
    confirmDelete = confirmDeleteFor === mission.id;
  const contact = data.contacts.find((item) => item.id === mission.contactId);
  const active = ACTIVE.includes(mission.status);
  const presentation = presentMission(mission.status, mission.attempts);
  const isDemo =
    mission.demo ??
    (mission.executionProvider
      ? mission.executionProvider === 'simulator'
      : mission.attempts.length
        ? mission.attempts.every((attempt) => attempt.provider === 'simulator')
        : data.mode === 'simulator' || data.mode === 'demo');
  const canGuide =
    hasCapability(mission.capabilities ?? data.capabilities, 'typedIntervention') &&
    ['calling', 'awaiting_owner'].includes(mission.status);
  const sendGuidance = async () => {
    if (!canGuide || working || !guidance.trim()) return;
    const submitted = { missionId: mission.id, kind, text: guidance };
    changeInstruction({ error: '' });
    try {
      const success = await onGuidance(kind, guidance);
      setInstruction((previous) =>
        previous.missionId !== submitted.missionId
          ? previous
          : {
              ...previous,
              text:
                previous.kind === submitted.kind
                  ? guidanceAfterSave(previous.text, submitted.text, success)
                  : previous.text,
              error: success
                ? ''
                : 'Guidance was not confirmed. Your instruction is still here; reconnect before retrying.',
            },
      );
    } catch {
      setInstruction((previous) =>
        previous.missionId !== submitted.missionId
          ? previous
          : {
              ...previous,
              error:
                'Guidance was not confirmed. Your instruction is still here; reconnect before retrying.',
            },
      );
    }
  };
  const registerGuidanceSave = useCallback(
    (save: (() => void) | null) => onRegisterSave?.(canGuide ? save : null),
    [canGuide, onRegisterSave],
  );
  useEditorGuard(guidance, () => void sendGuidance(), {
    onDirtyChange,
    onRegisterSave: registerGuidanceSave,
  });
  const canDelete = presentation.known && !active && !presentation.pendingEnd;
  const outcome =
    mission.outcome ?? [...mission.attempts].reverse().find((attempt) => attempt.outcome)?.outcome;
  const transcript = mission.transcript?.length
    ? mission.transcript
    : mission.attempts.flatMap((attempt) => attempt.transcript);
  const actions = mission.actions?.length ? mission.actions : (outcome?.actions ?? []);
  return (
    <>
      <View style={{ gap: 12 }}>
        <View style={styles.spread}>
          <Badge text={presentation.label} tone={presentation.tone} />
          <Badge text={isDemo ? 'SIMULATED' : 'TELEPHONE PROVIDER'} tone="blue" />
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          {mission.title}
        </Text>
        <View style={styles.row}>
          <Avatar name={contact?.name ?? '?'} size={36} />
          <Text style={styles.subtitle}>
            {contact?.name ?? 'Recipient removed'} · {contact?.relationship}
          </Text>
        </View>
      </View>
      {isDemo ? (
        <Notice>
          This is a simulated conversation with fictional responses. No one was contacted.
        </Notice>
      ) : null}
      {presentation.pendingEnd ? (
        <Notice tone="warning">
          End requested. The attempt has no terminal provider evidence yet. Closing this screen does
          not prove that the telephone call ended.
        </Notice>
      ) : null}
      {!isDemo && outcome ? (
        <Notice tone="warning">
          Unverified provider summary. Read the transcript and source references before relying on
          an agreement or completed action.
        </Notice>
      ) : null}
      {mission.executionNotice ? <Notice tone="warning">{mission.executionNotice}</Notice> : null}
      {active ? (
        <Card>
          <View style={styles.row}>
            <Icon
              name={mission.status === 'awaiting_owner' ? 'hand-left-outline' : 'radio-outline'}
              size={26}
            />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.h3}>{statusLabel(mission.status)}</Text>
              <Text style={styles.small}>
                The backend owns this request. Closing the app does not cancel it. Reconnect to
                restore its actual state.
              </Text>
            </View>
          </View>
          {mission.status === 'awaiting_owner' ? (
            <Notice tone="warning">
              No new commitment has been accepted. Review the alternative below. A changed
              commitment requires a revised authorization; free-text guidance cannot expand
              authority.
            </Notice>
          ) : null}
          <Button
            label="End & revoke this request"
            danger
            secondary
            icon="stop-circle-outline"
            loading={working}
            onPress={onCancel}
          />
          <Text style={styles.small}>
            Stops queued work and requests supported active-call termination. Completed actions
            remain in the record.
          </Text>
        </Card>
      ) : null}
      {outcome ? (
        <Card>
          <Text style={styles.label}>WHAT HAPPENED</Text>
          <Text
            style={{
              color: colors.ink,
              fontSize: 23,
              lineHeight: 31,
              fontWeight: '500',
              letterSpacing: -0.4,
            }}
          >
            {outcome.overview}
          </Text>
          {outcome.recipientAgreements.length ? (
            <EvidenceList
              title={
                isDemo ? 'Recipient agreements in the simulation' : 'Recipient agreements reported'
              }
              items={outcome.recipientAgreements}
            />
          ) : null}
          {outcome.agentCommitments.length ? (
            <EvidenceList
              title={isDemo ? 'Agent commitments in the simulation' : 'Agent commitments reported'}
              items={outcome.agentCommitments}
            />
          ) : null}
          {outcome.unresolved.length ? (
            <EvidenceList title="Still unresolved" items={outcome.unresolved} warning />
          ) : null}
          {outcome.alternatives.length ? (
            <EvidenceList title="Options for your decision" items={outcome.alternatives} />
          ) : null}
          <Pressable
            accessibilityRole="button"
            {...a11yState({ expanded })}
            onPress={() => setExpanded(!expanded)}
            style={[styles.spread, { minHeight: 44 }]}
          >
            <Text style={{ color: colors.green, fontWeight: '600', fontSize: 14 }}>
              {expanded ? 'Less detail' : 'The full account'}
            </Text>
            <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} />
          </Pressable>
          {expanded ? (
            <>
              <View style={styles.divider} />
              <EvidenceList title="Your request" items={[outcome.requested]} />
              <EvidenceList title="Discussed during the conversation" items={outcome.discussed} />
              {outcome.questionsAndAnswers.map((qa, i) => (
                <View key={i} style={{ gap: 5 }}>
                  <Text style={styles.h3}>{qa.question}</Text>
                  <Text style={styles.text}>{qa.answer}</Text>
                  <Text selectable style={styles.small}>
                    Evidence: {qa.evidenceIds.join(', ') || 'No transcript reference available'}
                  </Text>
                </View>
              ))}
              <EvidenceList title="Follow-ups & deadlines" items={outcome.followUps} />
            </>
          ) : null}
        </Card>
      ) : !active ? (
        <Card>
          <Empty
            icon="document-text-outline"
            title="No outcome available"
            detail="The provider has not supplied a verified conversation result. No success is assumed."
          />
        </Card>
      ) : null}
      {actions.length ? (
        <Card>
          <Text accessibilityRole="header" style={styles.h2}>
            After the conversation
          </Text>
          {actions.map((action) => (
            <View key={action.id} style={{ gap: 7 }}>
              <View style={styles.spread}>
                <Text style={[styles.text, { flex: 1 }]}>{action.description}</Text>
                <Badge text={presentAction(action).label} tone={presentAction(action).tone} />
              </View>
              {action.error ? (
                <Text style={{ color: colors.red, fontSize: 13, lineHeight: 20 }}>
                  {action.error}
                </Text>
              ) : null}
              {action.externalId ? (
                <Text selectable style={styles.small}>
                  External reference: {action.externalId}
                </Text>
              ) : null}
              {action.prerequisiteEvidenceIds.length ? (
                <Text selectable style={styles.small}>
                  Based on: {action.prerequisiteEvidenceIds.join(', ')}
                </Text>
              ) : null}
            </View>
          ))}
          {actions.some((action) => ['failed', 'pending'].includes(action.status)) &&
          ['completed', 'partial', 'unresolved'].includes(mission.status) &&
          !presentation.pendingEnd ? (
            <Button
              label="Retry pending follow-up only"
              icon="refresh-outline"
              secondary
              loading={working}
              onPress={onRetryActions}
            />
          ) : null}
          <Text style={styles.small}>
            Retries use the same action identity. They do not repeat the conversation or create
            another agreement.
          </Text>
        </Card>
      ) : null}
      {active && mission.mode === 'assisted' ? (
        <Card>
          <Text accessibilityRole="header" style={styles.h2}>
            A quiet word to your agent
          </Text>
          {canGuide ? (
            <>
              <Text style={styles.small}>
                {isDemo
                  ? 'The simulator saves clarifications and proposed responses for review. Tightening a boundary stops the simulation before further commitments.'
                  : 'Supported by the configured telephone integration.'}
              </Text>
              <Choice
                label="Guidance type"
                value={kind}
                onChange={(value) => changeInstruction({ kind: value })}
                options={[
                  { label: 'Clarify', value: 'clarify' },
                  { label: 'Propose a response', value: 'propose_response' },
                  { label: 'Tighten a boundary', value: 'tighten_boundary' },
                ]}
              />
              <Field
                label="Your silent instruction"
                multiline
                value={guidance}
                onChangeText={(text) => changeInstruction({ text, error: '' })}
                placeholder="Add a clarification within the approved request…"
              />
              <Button
                label={
                  kind === 'tighten_boundary'
                    ? 'Apply boundary & stop simulation'
                    : 'Save guidance for review'
                }
                icon="paper-plane-outline"
                disabled={!guidance.trim()}
                loading={working}
                onPress={() => void sendGuidance()}
              />
            </>
          ) : (
            <Notice>
              Silent typed guidance is unavailable for this telephone adapter. You can end this
              request and authorize a revised brief.
            </Notice>
          )}
          {!canGuide && guidance ? (
            <Text selectable style={styles.text}>
              Unsent instruction kept: {guidance}
            </Text>
          ) : null}
          {draft.error ? <Notice tone="error">{draft.error}</Notice> : null}
          {guidanceFeedback ? <Notice>{guidanceFeedback}</Notice> : null}
          <Text style={styles.small}>
            New commitments require ending this request and authorizing a revised brief. Pausing,
            transfer, and voice takeover are unavailable in this adapter.
          </Text>
        </Card>
      ) : null}
      <Disclosure title="Approved request and boundaries">
        <Card>
          <Text style={styles.h3}>Approved statements and questions</Text>
          {mission.requiredTalkingPoints.map((point, i) => (
            <Text key={i} style={styles.text}>
              • {point}
            </Text>
          ))}
          <EvidenceList title="Boundaries" items={mission.boundaries.nonNegotiable} />
          <EvidenceList
            title="Permitted alternatives"
            items={mission.boundaries.allowedAlternatives}
          />
          <EvidenceList
            title="Facts permitted to disclose"
            items={mission.boundaries.disclosableFacts}
          />
          <Text style={styles.small}>
            Spending:{' '}
            {mission.boundaries.maxAmount === undefined
              ? 'No new spending authorized'
              : mission.boundaries.maxAmount + ' ' + mission.boundaries.currency}
          </Text>
          <Text style={styles.small}>
            Timezone: {mission.schedule.timezone} · {mission.schedule.maxDurationSeconds / 60}{' '}
            minute limit
          </Text>
          <Text style={styles.small}>
            Private context remains withheld. Closing this detail does not cancel a request.
          </Text>
        </Card>
      </Disclosure>
      <Card>
        <Pressable
          accessibilityRole="button"
          {...a11yState({ expanded: showTranscript })}
          onPress={() => setShowTranscript(!showTranscript)}
          style={styles.spread}
        >
          <Text accessibilityRole="header" style={styles.h2}>
            Conversation transcript
          </Text>
          <Icon name={showTranscript ? 'chevron-up' : 'chevron-down'} />
        </Pressable>
        <Text style={styles.small}>
          {mission.retention.transcript
            ? `${mission.recipientLanguage.toUpperCase()} original · translations separately labeled when available`
            : 'Transcript retention is disabled. Evidence may be unavailable after processing.'}
        </Text>
        {showTranscript ? (
          transcript.length ? (
            transcript.map((entry) => (
              <View
                key={entry.id}
                style={{
                  gap: 6,
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.line,
                }}
              >
                <View style={styles.spread}>
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.muted,
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: 0.8,
                    }}
                  >
                    {entry.speaker === 'agent'
                      ? 'AI assistant'
                      : entry.speaker === 'recipient'
                        ? (contact?.name ?? 'Recipient')
                        : entry.speaker === 'owner'
                          ? 'You · silent guidance'
                          : 'Call event'}{' '}
                    · {entry.language.toUpperCase()}
                  </Text>
                </View>
                <Text selectable style={styles.text}>
                  {entry.text}
                </Text>
                {entry.translation ? (
                  <View
                    style={{
                      marginTop: 4,
                      paddingLeft: 12,
                      borderLeftWidth: 2,
                      borderLeftColor: colors.sage,
                      gap: 3,
                    }}
                  >
                    <Text style={styles.small}>
                      TRANSLATION · {entry.translatedLanguage?.toUpperCase()}
                    </Text>
                    <Text selectable style={styles.text}>
                      {entry.translation}
                    </Text>
                  </View>
                ) : null}
                {expanded ? (
                  <Text selectable style={styles.small}>
                    {entry.id} · {localDate(entry.at, data.profile.timezone)}
                  </Text>
                ) : null}
              </View>
            ))
          ) : (
            <Empty
              icon="chatbubble-outline"
              title={active ? 'Waiting for the conversation' : 'No transcript available'}
              detail={
                active
                  ? 'Only actual provider or simulator events appear here.'
                  : 'No conversation text was retained or provided.'
              }
            />
          )
        ) : null}
      </Card>
      <Card>
        <Text style={styles.label}>ATTEMPT RECORD</Text>
        {mission.attempts.length ? (
          mission.attempts.map((attempt) => (
            <View key={attempt.id} style={{ gap: 4 }}>
              <Text style={styles.text}>
                {attempt.provider === 'simulator' ? 'Simulated call' : 'ElevenLabs telephone call'}{' '}
                · {attempt.status.replace(/_/g, ' ')}
              </Text>
              <Text style={styles.small}>
                {localDate(attempt.startedAt, data.profile.timezone)}
                {attempt.endedAt ? ` → ${localDate(attempt.endedAt, data.profile.timezone)}` : ''}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.small}>No attempt has started.</Text>
        )}
        <Text style={styles.small}>
          Authorization version {mission.authorization?.version ?? 'not approved'} ·{' '}
          {mission.authorization?.approvedAt
            ? localDate(mission.authorization.approvedAt, data.profile.timezone)
            : 'Draft only'}
        </Text>
      </Card>
      {canDelete ? (
        confirmDelete ? (
          <Notice tone="warning">
            Deleting removes the app conversation record. Provider retention and completed external
            actions may remain. Confirm below.
          </Notice>
        ) : null
      ) : null}
      {canDelete ? (
        <Button
          label={confirmDelete ? 'Confirm delete conversation' : 'Delete conversation'}
          danger
          secondary
          loading={working}
          onPress={confirmDelete ? onDelete : () => setConfirmDeleteFor(mission.id)}
        />
      ) : null}
    </>
  );
}

function EvidenceList({
  title,
  items,
  warning = false,
}: {
  title: string;
  items: string[];
  warning?: boolean;
}) {
  const { colors, styles } = useUI();
  if (!items.length) return null;
  return (
    <View style={{ gap: 7 }}>
      <Text
        style={{
          color: warning ? colors.amber : colors.muted,
          fontSize: 12,
          letterSpacing: 0.8,
          fontWeight: '600',
          textTransform: 'uppercase',
        }}
      >
        {title}
      </Text>
      {items.map((item, i) => (
        <Text key={i} style={styles.text}>
          • {item}
        </Text>
      ))}
    </View>
  );
}
