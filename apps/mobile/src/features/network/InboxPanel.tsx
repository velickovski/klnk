import React, { useEffect, useRef } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { AppText as Text } from '../../components/primitives';
import type { NetworkConnection, NetworkConversation, NetworkTerms } from '@personal-agent/domain';
import {
  Badge,
  Button,
  Card,
  Choice,
  DetailSheet,
  Disclosure,
  Empty,
  Field,
  Notice,
  useUI,
} from '../../ui';
import { useNetworkClient, useNetworkQuery, useSessionRef, useSessionState } from './data-provider';
import { formatDateTime } from './format';
import { DateTimeField } from './DateTimeField';
import { ExpiryField } from './ExpiryField';
import { TimezoneField } from './TimezoneField';
import { ConversationActions } from './ConversationActions';
import { usePanelTask } from './panel-hooks';
import {
  acceptedConnections,
  buildRequest,
  canDecide,
  inboxLabel,
  isTerminal,
  peerId,
  peerName,
  requestDraft,
  requestId,
  RequestSubmission,
  type RequestDraft,
} from './panel-state';

type Inbox = { conversations: NetworkConversation[]; unread: number };
type Props = {
  ownerId: string;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  onCalendar?: () => void;
  conversationId?: string;
  onConversation?: (id?: string) => void;
};
export function InboxPanel(props: Props) {
  return <InboxContent key={props.ownerId} {...props} />;
}
function InboxContent({
  ownerId,
  header,
  footer,
  onCalendar,
  conversationId,
  onConversation,
}: Props) {
  const { styles } = useUI(),
    task = usePanelTask(),
    networkApi = useNetworkClient();
  const inboxQuery = useNetworkQuery<Inbox>('/network/conversations'),
    peopleQuery = useNetworkQuery<{ connections: NetworkConnection[] }>('/network/connections');
  const inbox = inboxQuery.data,
    connections = peopleQuery.data?.connections ?? [];
  const returnFocus = useRef<React.ElementRef<typeof View> | null>(null),
    rowRefs = useRef(new Map<string, React.ElementRef<typeof View>>()),
    lastOpenedId = useRef<string | undefined>(conversationId);
  const [selectedId, setSelectedId] = useSessionState<string | undefined>(
      `${ownerId}:inbox:selected`,
      conversationId,
    ),
    [compose, setCompose] = useSessionState(`${ownerId}:inbox:compose`, false),
    [draft, setDraft] = useSessionState<RequestDraft>(`${ownerId}:inbox:draft`, () =>
      requestDraft(),
    ),
    [recovery, setRecovery] = useSessionState(`${ownerId}:inbox:recovery`, false),
    [filter, setFilter] = useSessionState<'all' | 'decision' | 'unread'>(
      `${ownerId}:inbox:filter`,
      'all',
    );
  const detailQuery = useNetworkQuery<NetworkConversation>(
      selectedId ? `/network/conversations/${selectedId}` : undefined,
    ),
    selected = detailQuery.data;
  const submission = useSessionRef(`${ownerId}:inbox:submission`, () => new RequestSubmission());
  const recorded = useSessionRef<NetworkConversation | undefined>(
    `${ownerId}:inbox:recorded`,
    () => undefined,
  );
  const setInbox = (update: (previous: Inbox | undefined) => Inbox) =>
    networkApi.update('/network/conversations', update);
  const setSelected = (conversation: NetworkConversation | undefined) => {
    setSelectedId(conversation?.id);
    onConversation?.(conversation?.id);
    if (conversation)
      networkApi.update<NetworkConversation>(
        `/network/conversations/${conversation.id}`,
        (current) => (current && current.version > conversation.version ? current : conversation),
      );
  };
  useEffect(() => {
    if (conversationId) {
      lastOpenedId.current = conversationId;
      returnFocus.current = rowRefs.current.get(conversationId) ?? null;
    }
    setSelectedId(conversationId);
  }, [conversationId]);
  const accepted = acceptedConnections(connections),
    pending = recovery || !!submission.current.pending;
  const update = <K extends keyof RequestDraft>(key: K, value: RequestDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const peer = (id: string) =>
    id === ownerId
      ? 'You'
      : connections.find((connection) => peerId(connection, ownerId) === id)?.peer?.name ||
        'Other member';
  const replace = (conversation: NetworkConversation) => {
    setSelected(conversation);
    setInbox((current) => {
      const conversations = [
        conversation,
        ...(current?.conversations ?? []).filter((item) => item.id !== conversation.id),
      ];
      return {
        conversations,
        unread: conversations.filter((item) => !item.readBy.includes(ownerId)).length,
      };
    });
  };
  const refresh = () =>
    task.run(
      async () => {
        await Promise.all([
          inboxQuery.refetch(),
          peopleQuery.refetch(),
          selectedId ? detailQuery.refetch() : Promise.resolve(),
        ]);
      },
      () => undefined,
    );
  const open = (conversation: NetworkConversation) => {
    // Present recorded data immediately. A late refresh may update that record,
    // but it must never select/reopen a conversation after its sheet was closed.
    setSelected(conversation);
    setCompose(false);
    void task.run(
      () => networkApi.read<NetworkConversation>(`/network/conversations/${conversation.id}`, true),
      () => undefined,
    );
  };
  const send = () => {
    try {
      if (!submission.current.pending)
        submission.current.stage(buildRequest(draft, connections, requestId()));
    } catch (error) {
      task.setError((error as Error).message);
      return;
    }
    setRecovery(true);
    void task.run(
      async () => {
        const result = await submission.current.send(
          (payload) =>
            networkApi.request<NetworkConversation>('/network/conversations', 'POST', payload),
          async () => (await networkApi.request<Inbox>('/network/conversations')).conversations,
        );
        recorded.current = result;
        return result;
      },
      (result) => {
        recorded.current = undefined;
        replace(result);
        setRecovery(false);
        setCompose(false);
        setDraft(requestDraft());
        task.setNotice(
          'Request recorded. The status below is the current server result. Reading it does not grant approval.',
        );
      },
      'Delivery could not be confirmed. The same request identifier is retained for safe readback and retry. ',
    );
  };
  // A known validation or authorization rejection releases the payload for correction.
  useEffect(() => {
    if (recorded.current) {
      replace(recorded.current);
      recorded.current = undefined;
      setCompose(false);
      setDraft(requestDraft());
    }
    if (!task.busy && recovery && !submission.current.pending) setRecovery(false);
  }, [task.busy, recovery]);
  const decide = (conversation: NetworkConversation, decision: 'approve' | 'decline') => {
    if (!conversation.proposal || !canDecide(conversation, ownerId)) {
      task.setError('This proposal is expired or no longer awaiting your decision. Refresh Inbox.');
      return;
    }
    void task.run(
      () =>
        networkApi.request<NetworkConversation>(
          `/network/conversations/${conversation.id}/decision`,
          'POST',
          {
            proposalHash: conversation.proposal!.hash,
            proposalVersion: conversation.proposal!.version,
            decision,
          },
        ),
      (result) => {
        replace(result);
        task.setNotice(
          'Your decision was recorded against that exact proposal. The current result is shown below.',
        );
      },
      'Decision unconfirmed. Refresh to inspect the current proposal before retrying. ',
    );
  };
  const control = (conversation: NetworkConversation, action: 'pause' | 'resume' | 'cancel') =>
    void task.run(
      () =>
        networkApi.request<NetworkConversation>(
          `/network/conversations/${conversation.id}/control`,
          'POST',
          { action },
        ),
      (result) => {
        replace(result);
        task.setNotice(
          `Server recorded ${action === 'pause' ? 'a pause' : action === 'resume' ? 'a resume request' : 'cancellation'}.`,
        );
      },
      'Action unconfirmed. Refresh Inbox to inspect current state. ',
    );
  const answer = (conversation: NetworkConversation, message: string) =>
    void task.run(
      () =>
        networkApi.request<NetworkConversation>(
          `/network/conversations/${conversation.id}/answer`,
          'POST',
          { version: conversation.version, answer: message },
        ),
      (result) => {
        replace(result);
        task.setNotice('Your exact reply was recorded in this shared conversation.');
      },
      'Reply unconfirmed. Read the existing conversation before trying again. ',
    );
  const counterpropose = (
    conversation: NetworkConversation,
    input: { version: number; slot: NetworkTerms['slot'] },
  ) =>
    void task.run(
      () =>
        networkApi.request<NetworkConversation>(
          `/network/conversations/${conversation.id}/counterproposal`,
          'POST',
          input,
        ),
      (result) => {
        replace(result);
        task.setNotice('Your alternative is recorded. The other owner must accept the new terms.');
      },
      'Counterproposal unconfirmed. Refresh the conversation before sending again. ',
    );
  const slot = (index: number, key: 'startAt' | 'endAt' | 'timezone', value: string) =>
    update(
      'candidateSlots',
      draft.candidateSlots.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    );
  const visible =
    inbox?.conversations.filter((item) =>
      filter === 'decision'
        ? item.state === 'awaiting_approval' && item.decisionOwnerIds.includes(ownerId)
        : filter === 'unread'
          ? !item.readBy.includes(ownerId)
          : true,
    ) ?? [];
  return (
    <FlatList
      testID="network-inbox"
      data={visible}
      keyExtractor={(conversation) => conversation.id}
      style={{ flex: 1 }}
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={5}
      ListHeaderComponent={
        <View style={{ gap: 24 }}>
          {header}
          <View style={{ gap: 8 }}>
            <Text style={styles.label}>INBOX</Text>
            <Text accessibilityRole="header" style={styles.title}>
              Your agent, in the loop.
            </Text>
            <Text style={styles.subtitle}>
              Read the result first. Make a decision when your representative needs your authority.
            </Text>
          </View>
          <Text style={styles.small}>
            Internal klnk delivery. Only the internal calendar is checked. Owner voice uses OpenAI
            cloud processing; requests here do not call or message anyone outside klnk.
          </Text>
          {task.error || inboxQuery.error || peopleQuery.error ? (
            <Notice tone="error">{task.error || inboxQuery.error || peopleQuery.error}</Notice>
          ) : null}
          {task.notice ? <Notice>{task.notice}</Notice> : null}
          <Button
            label={task.busy ? 'Updating Inbox' : 'Refresh Inbox'}
            secondary
            loading={task.busy}
            onPress={() => void refresh()}
          />
          <Button
            label={compose ? 'Keep draft and return to Inbox' : 'Write an internal request'}
            disabled={task.busy || !inbox}
            onPress={() => {
              setCompose(!compose);
              setSelected(undefined);
            }}
          />
          {compose ? (
            <Card>
              <Text accessibilityRole="header" style={styles.h2}>
                Delegate a specific request.
              </Text>
              <Text style={styles.small}>
                Choose the person and the exact purpose. Typed input is always available here.
              </Text>
              {!accepted.length ? (
                <Notice>
                  Accept a member connection in People before sending. Your draft stays here while
                  you connect.
                </Notice>
              ) : (
                <Choice
                  label="Accepted recipient"
                  value={draft.connectionId}
                  disabled={task.busy || pending}
                  onChange={(value) => update('connectionId', value)}
                  options={accepted.map((connection) => ({
                    label: peerName(connection),
                    value: connection.id,
                  }))}
                />
              )}
              <Choice
                label="Request scope"
                value={draft.kind}
                disabled={task.busy || pending}
                onChange={(value) => {
                  update('kind', value);
                  update('candidateSlots', []);
                }}
                options={[
                  { label: 'Deliver information', value: 'inform' },
                  { label: 'Ask a question', value: 'ask' },
                  { label: 'Coordinate a meeting', value: 'meeting' },
                ]}
              />
              <Field
                label="Exact delegated purpose"
                multiline
                value={draft.purpose}
                onChangeText={(value) => update('purpose', value)}
                editable={!task.busy && !pending}
                maxLength={500}
                hint="State what your own agent may do. A message does not authorize a meeting or another action."
              />
              <Field
                label="Request topic"
                value={draft.topic}
                onChangeText={(value) => update('topic', value)}
                editable={!task.busy && !pending}
                maxLength={80}
                hint="Use a specific topic the recipient may have allowed, such as project planning."
              />
              <Field
                label={
                  draft.kind === 'ask'
                    ? 'Question and permitted details'
                    : 'Exact message and permitted details'
                }
                multiline
                value={draft.message}
                onChangeText={(value) => update('message', value)}
                editable={!task.busy && !pending}
                maxLength={1500}
                hint="This text is shared with the other member. Include only the information you want to disclose."
              />
              {draft.kind === 'meeting' ? (
                <>
                  <Notice>
                    Choose one to three candidate times. Repeated clock-change times need your
                    explicit choice.
                  </Notice>
                  {draft.candidateSlots.map((candidate, index) => (
                    <View key={index} style={{ gap: 12 }}>
                      <Text accessibilityRole="header" style={styles.h3}>
                        Candidate {index + 1}
                      </Text>
                      <DateTimeField
                        label={`Candidate ${index + 1} starts at`}
                        value={candidate.startAt}
                        disabled={task.busy || pending}
                        timezone={candidate.timezone}
                        onChange={(value) => slot(index, 'startAt', value)}
                      />
                      <DateTimeField
                        label={`Candidate ${index + 1} ends at`}
                        value={candidate.endAt}
                        disabled={task.busy || pending}
                        timezone={candidate.timezone}
                        onChange={(value) => slot(index, 'endAt', value)}
                      />
                      <TimezoneField
                        label={`Candidate ${index + 1} timezone`}
                        value={candidate.timezone}
                        disabled={task.busy || pending}
                        onChange={(value) => slot(index, 'timezone', value)}
                      />
                      <Button
                        label={`Remove candidate ${index + 1}`}
                        secondary
                        disabled={task.busy || pending}
                        onPress={() =>
                          update(
                            'candidateSlots',
                            draft.candidateSlots.filter((_, i) => i !== index),
                          )
                        }
                      />
                    </View>
                  ))}
                  <Button
                    label="Add candidate time"
                    secondary
                    disabled={task.busy || pending || draft.candidateSlots.length >= 3}
                    onPress={() =>
                      update('candidateSlots', [
                        ...draft.candidateSlots,
                        {
                          startAt: '',
                          endAt: '',
                          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
                        },
                      ])
                    }
                  />
                  <Field
                    label="Meeting location"
                    value={draft.location}
                    editable={!task.busy && !pending}
                    onChangeText={(value) => update('location', value)}
                    maxLength={200}
                  />
                </>
              ) : null}
              <ExpiryField
                label="Request expires at"
                value={draft.expiresAt}
                onChange={(value) => update('expiresAt', value)}
                disabled={task.busy || pending}
              />
              {pending ? (
                <Notice tone="warning">
                  A save may have reached the server. Your submitted draft is locked until readback
                  confirms its outcome. Retry checks Inbox first and reuses the same request
                  identifier.
                </Notice>
              ) : (
                <Text style={styles.small}>
                  Sending authorizes this exact purpose and request scope. Both owners must
                  authorize the same meeting proposal before a shared event can be confirmed.
                </Text>
              )}
              <Button
                label={pending ? 'Check delivery and retry same request' : 'Send internal request'}
                loading={task.busy}
                disabled={!accepted.length && !pending}
                onPress={send}
              />
              {!pending ? (
                <Button
                  label="Discard request draft"
                  secondary
                  disabled={task.busy}
                  onPress={() => {
                    setDraft(requestDraft());
                    setCompose(false);
                  }}
                />
              ) : null}
            </Card>
          ) : null}
          <DetailSheet
            visible={!!selectedId}
            returnFocusRef={returnFocus}
            returnFocusId={
              lastOpenedId.current
                ? `network-request-${ownerId}-${lastOpenedId.current}`
                : undefined
            }
            title={selected?.request.purpose ?? 'Conversation'}
            onClose={() => setSelected(undefined)}
          >
            {detailQuery.error ? <Notice tone="error">{detailQuery.error}</Notice> : null}
            {task.error ? <Notice tone="error">{task.error}</Notice> : null}
            {selectedId && !selected && detailQuery.loading ? (
              <Text style={styles.text}>Loading conversation…</Text>
            ) : null}
            {selected ? (
              <Card>
                <Text accessibilityRole="header" style={styles.h2}>
                  {selected.request.purpose}
                </Text>
                <Badge
                  text={inboxLabel(selected, ownerId)}
                  tone={
                    selected.state === 'awaiting_approval' &&
                    selected.decisionOwnerIds.includes(ownerId)
                      ? 'warning'
                      : selected.state === 'agreed' ||
                          selected.state === 'delivered' ||
                          selected.state === 'answered'
                        ? 'success'
                        : 'neutral'
                  }
                />
                <Text style={styles.text}>
                  {selected.summary || 'The server has not produced a summary yet.'}
                </Text>
                <Text style={styles.small}>
                  {selected.nextAction || 'No next action is recorded.'}
                </Text>
                <Text style={styles.small}>
                  With{' '}
                  {peer(
                    selected.initiatorId === ownerId ? selected.recipientId : selected.initiatorId,
                  )}{' '}
                  · updated {formatDateTime(selected.updatedAt)}
                  {'\n'}
                  {selected.readBy.includes(ownerId) ? 'Read by you' : 'Unread by you'} · Reading is
                  separate from approval.
                </Text>
                <ConversationActions
                  key={selected.id}
                  conversation={selected}
                  ownerId={ownerId}
                  busy={task.busy}
                  onAnswer={(message) => answer(selected, message)}
                  onCounter={(input) => counterpropose(selected, input)}
                />
                {selected.proposal ? (
                  <View style={{ gap: 12 }}>
                    <Text accessibilityRole="header" style={styles.h3}>
                      Exact shared proposal
                    </Text>
                    <Text style={styles.text}>
                      {selected.proposal.terms.purpose}
                      {'\n'}Topic: {selected.proposal.terms.topic}
                      {'\n'}Participants:{' '}
                      {selected.proposal.terms.participants.map(peer).join(', ')}
                      {'\n'}Start:{' '}
                      {formatDateTime(
                        selected.proposal.terms.slot.startAt,
                        selected.proposal.terms.slot.timezone,
                      )}
                      {'\n'}End:{' '}
                      {formatDateTime(
                        selected.proposal.terms.slot.endAt,
                        selected.proposal.terms.slot.timezone,
                      )}
                      {'\n'}Timezone: {selected.proposal.terms.slot.timezone}
                      {'\n'}Location: {selected.proposal.terms.location || 'None specified'}
                      {'\n'}Expires:{' '}
                      {formatDateTime(
                        selected.proposal.expiresAt,
                        selected.proposal.terms.slot.timezone,
                      )}
                    </Text>
                    <Text style={styles.small}>Proposal revision {selected.proposal.version}</Text>
                    {selected.acceptances.map((acceptance) => (
                      <Text key={acceptance.ownerId} style={styles.small}>
                        {peer(acceptance.ownerId)}:{' '}
                        {acceptance.source === 'delegation_rule'
                          ? 'agent accepted under that owner’s delegation rules'
                          : acceptance.source === 'owner_approval'
                            ? 'owner explicitly approved this proposal'
                            : 'authorized by the owner’s original request'}
                        .
                      </Text>
                    ))}
                    {canDecide(selected, ownerId) ? (
                      <>
                        <Button
                          label="Approve this exact meeting proposal"
                          disabled={task.busy}
                          onPress={() => decide(selected, 'approve')}
                        />
                        <Button
                          label="Decline this meeting proposal"
                          secondary
                          danger
                          disabled={task.busy}
                          onPress={() => decide(selected, 'decline')}
                        />
                      </>
                    ) : selected.state === 'awaiting_approval' ? (
                      <Notice>
                        {selected.decisionOwnerIds.includes(ownerId)
                          ? 'This proposal has expired. Refresh to get its current status.'
                          : 'The other owner’s decision is needed. You cannot approve on their behalf.'}
                      </Notice>
                    ) : null}
                  </View>
                ) : null}
                {selected.eventId ? (
                  <>
                    <Badge text="Internal calendar event recorded" tone="success" />
                    {onCalendar ? (
                      <Button label="Open the internal calendar" secondary onPress={onCalendar} />
                    ) : null}
                  </>
                ) : null}
                <Disclosure title="Inspect permitted shared exchanges">
                  <View style={{ gap: 16 }}>
                    <Text style={styles.small}>
                      Shared messages only. Private planning and the other owner’s rules are not a
                      transcript.
                    </Text>
                    {selected.messages.length ? (
                      selected.messages.map((message) => (
                        <View key={message.id} style={{ gap: 4 }}>
                          <Text style={styles.h3}>
                            {message.role === 'server'
                              ? 'klnk service'
                              : message.role === 'agent'
                                ? `${peer(message.actorId)} · agent`
                                : `${peer(message.actorId)} · owner`}{' '}
                            · {message.kind.replace(/_/g, ' ')}
                          </Text>
                          <Text style={styles.text}>{message.text}</Text>
                          <Text style={styles.small}>{formatDateTime(message.at)}</Text>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.small}>No shared exchanges have been recorded yet.</Text>
                    )}
                  </View>
                </Disclosure>
                {!selected.readBy.includes(ownerId) ? (
                  <Button
                    label="Mark this conversation read"
                    secondary
                    disabled={task.busy}
                    onPress={() =>
                      void task.run(
                        () =>
                          networkApi.request<NetworkConversation>(
                            `/network/conversations/${selected.id}/read`,
                            'POST',
                          ),
                        replace,
                      )
                    }
                  />
                ) : null}
                {!isTerminal(selected.state) ? (
                  <>
                    <Button
                      label={
                        selected.state === 'paused' ? 'Resume this request' : 'Pause this request'
                      }
                      secondary
                      disabled={task.busy}
                      onPress={() =>
                        control(selected, selected.state === 'paused' ? 'resume' : 'pause')
                      }
                    />
                    <Button
                      label="Cancel this pending request"
                      danger
                      secondary
                      disabled={task.busy}
                      onPress={() => control(selected, 'cancel')}
                    />
                  </>
                ) : null}
                <Button
                  label="Close conversation details"
                  secondary
                  disabled={task.busy}
                  onPress={() => setSelected(undefined)}
                />
              </Card>
            ) : null}
          </DetailSheet>
          {inbox ? (
            <>
              <Text accessibilityRole="header" style={styles.h2}>
                {inbox.unread} unread ·{' '}
                {
                  inbox.conversations.filter(
                    (item) =>
                      item.state === 'awaiting_approval' && item.decisionOwnerIds.includes(ownerId),
                  ).length
                }{' '}
                need your decision
              </Text>
              <Choice
                label="Inbox filter"
                value={filter}
                onChange={setFilter}
                options={[
                  { label: 'All requests', value: 'all' },
                  { label: 'Your decisions', value: 'decision' },
                  { label: 'Unread', value: 'unread' },
                ]}
              />
            </>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        inbox ? (
          <Card>
            <Empty
              icon="mail-outline"
              title={filter === 'all' ? 'No internal requests yet' : 'Nothing in this filter'}
              detail={
                filter === 'all'
                  ? 'Write a request to an accepted member, or return after their agent contacts yours.'
                  : 'Try All requests to inspect recorded conversations.'
              }
            />
          </Card>
        ) : (
          <Text style={styles.small}>
            {task.busy || inboxQuery.loading || peopleQuery.loading
              ? 'Loading your Inbox…'
              : 'Inbox has not loaded. Use Refresh Inbox to retry.'}
          </Text>
        )
      }
      ListFooterComponent={<View style={{ gap: 24 }}>{footer}</View>}
      renderItem={({ item: conversation }) => (
        <Pressable
          nativeID={`network-request-${ownerId}-${conversation.id}`}
          ref={(node) => {
            if (node) {
              rowRefs.current.set(conversation.id, node);
              if (lastOpenedId.current === conversation.id) returnFocus.current = node;
            } else rowRefs.current.delete(conversation.id);
          }}
          key={conversation.id}
          accessibilityRole="button"
          accessibilityLabel={`Open request: ${conversation.request.purpose}`}
          disabled={task.busy}
          onPress={() => {
            lastOpenedId.current = conversation.id;
            returnFocus.current = rowRefs.current.get(conversation.id) ?? null;
            open(conversation);
          }}
        >
          <Card>
            <View style={styles.chips}>
              <Badge
                text={inboxLabel(conversation, ownerId)}
                tone={
                  conversation.state === 'awaiting_approval' &&
                  conversation.decisionOwnerIds.includes(ownerId)
                    ? 'warning'
                    : 'neutral'
                }
              />
              <Badge
                text={conversation.readBy.includes(ownerId) ? 'Read by you' : 'Unread'}
                tone="accent"
              />
            </View>
            <Text accessibilityRole="header" style={styles.h3}>
              {conversation.request.purpose}
            </Text>
            <Text style={styles.text}>{conversation.summary || 'Awaiting a server summary.'}</Text>
            <Text style={styles.small}>
              {conversation.nextAction || 'No next action recorded.'}
            </Text>
            <Text role="action">View request</Text>
          </Card>
        </Pressable>
      )}
    />
  );
}
