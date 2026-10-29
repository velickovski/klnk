import React from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../../components/primitives';
import {
  NetworkSlotSchema,
  type NetworkConversation,
  type NetworkTerms,
} from '@personal-agent/domain';
import { Button, Field, Notice, useUI } from '../../ui';
import { useSessionState } from './data-provider';
import { DateTimeField } from './DateTimeField';
import { TimezoneField } from './TimezoneField';

type Slot = NetworkTerms['slot'];
type Props = {
  conversation: NetworkConversation;
  ownerId: string;
  busy: boolean;
  onAnswer: (answer: string) => void;
  onCounter: (input: { version: number; slot: Slot }) => void;
};

export function ConversationActions({ conversation, ownerId, busy, onAnswer, onCounter }: Props) {
  const { styles } = useUI();
  const [answer, setAnswer] = useSessionState(`${ownerId}:answer:${conversation.id}`, ''),
    [counter, setCounter] = useSessionState<{ version: number; slot: Slot } | undefined>(
      `${ownerId}:counter:${conversation.id}`,
      undefined,
    );
  if (
    conversation.state !== 'awaiting_approval' ||
    !conversation.decisionOwnerIds.includes(ownerId) ||
    Date.parse(conversation.request.expiresAt) <= Date.now()
  )
    return null;
  if (conversation.request.kind === 'ask')
    return (
      <View style={{ gap: 12 }}>
        <Text accessibilityRole="header" style={styles.h3}>
          A question for you
        </Text>
        <Text style={styles.text}>{conversation.request.message}</Text>
        <Field
          label="Your exact reply"
          value={answer}
          onChangeText={setAnswer}
          multiline
          maxLength={1500}
          editable={!busy}
          hint="This reply is shared with the requesting member. Your private memories are not added."
        />
        <Button
          label="Send this exact reply"
          disabled={busy || !answer.trim()}
          onPress={() => onAnswer(answer.trim())}
        />
      </View>
    );
  if (conversation.request.kind !== 'meeting') return null;
  const original = conversation.proposal?.terms.slot ?? conversation.request.candidateSlots[0];
  const changed = !!counter && counter.version !== conversation.version;
  return (
    <View style={{ gap: 12 }}>
      {!counter ? (
        <Button
          label="Suggest another meeting time"
          secondary
          disabled={busy || !original}
          onPress={() => setCounter({ version: conversation.version, slot: { ...original } })}
        />
      ) : (
        <>
          <Text accessibilityRole="header" style={styles.h3}>
            Your alternative time
          </Text>
          <Notice>
            Sending this time approves these terms only for you. The other owner must accept the new
            proposal.
          </Notice>
          {changed ? (
            <Notice tone="warning">
              The request changed while you edited. Start again from its current terms before
              sending.
            </Notice>
          ) : null}
          <DateTimeField
            label="Alternative starts at"
            value={counter.slot.startAt}
            timezone={counter.slot.timezone}
            disabled={busy}
            onChange={(startAt) => setCounter({ ...counter, slot: { ...counter.slot, startAt } })}
          />
          <DateTimeField
            label="Alternative ends at"
            value={counter.slot.endAt}
            timezone={counter.slot.timezone}
            disabled={busy}
            onChange={(endAt) => setCounter({ ...counter, slot: { ...counter.slot, endAt } })}
          />
          <TimezoneField
            label="Alternative timezone"
            value={counter.slot.timezone}
            disabled={busy}
            onChange={(timezone) => setCounter({ ...counter, slot: { ...counter.slot, timezone } })}
          />
          <Button
            label="Send this counterproposal"
            disabled={
              busy ||
              changed ||
              !NetworkSlotSchema.safeParse(counter.slot).success ||
              Date.parse(counter.slot.startAt) <= Date.now()
            }
            onPress={() => onCounter(counter)}
          />
          <Button
            label={
              changed ? 'Discard alternative and review current time' : 'Discard alternative time'
            }
            secondary
            disabled={busy}
            onPress={() => setCounter(undefined)}
          />
        </>
      )}
    </View>
  );
}
