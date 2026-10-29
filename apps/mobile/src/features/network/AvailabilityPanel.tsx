import React from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../../components/primitives';
import {
  NetworkBusyInputSchema,
  type NetworkAvailability,
  type NetworkBusy,
} from '@personal-agent/domain';
import { Badge, Button, Card, Disclosure, FeatureHeader, Field, Notice, useUI } from '../../ui';
import { DateTimeField } from './DateTimeField';
import { TimezoneField } from './TimezoneField';
import { deviceTimezone, formatDateTime } from './format';
import { useNetworkClient, useNetworkQuery, useSessionRef, useSessionState } from './data-provider';
import { usePanelTask } from './panel-hooks';

type BusyInput = { label: string; slot: NetworkBusy['slot'] };
type CalendarAvailability = {
  busyBlocks?: NetworkBusy[];
  availability?: NetworkAvailability | null;
};
const emptyDraft = (): BusyInput => ({
  label: 'Busy',
  slot: {
    startAt: new Date(Date.now() + 3600000).toISOString(),
    endAt: new Date(Date.now() + 7200000).toISOString(),
    timezone: deviceTimezone(),
  },
});
export function AvailabilityPanel({ ownerId }: { ownerId: string }) {
  const { styles } = useUI(),
    task = usePanelTask(),
    client = useNetworkClient(),
    query = useNetworkQuery<CalendarAvailability>('/network/calendar');
  const [editing, setEditing] = useSessionState(`${ownerId}:busy:editing`, false),
    [draft, setDraft] = useSessionState(`${ownerId}:busy:draft`, emptyDraft),
    [uncertain, setUncertain] = useSessionState(`${ownerId}:busy:uncertain`, false);
  const pending = useSessionRef<BusyInput | undefined>(`${ownerId}:busy:pending`, () => undefined);
  const availability = query.data?.availability;
  const save = () => {
    const parsed = NetworkBusyInputSchema.safeParse(pending.current ?? draft);
    if (!parsed.success || Date.parse(parsed.data.slot.endAt) <= Date.now()) {
      task.setError('Choose a valid busy interval that has not ended.');
      return;
    }
    pending.current ??= parsed.data;
    setUncertain(true);
    void task.run(
      async () => {
        const calendar = await client.read<CalendarAvailability>('/network/calendar', true),
          input = pending.current!;
        const existing = calendar.busyBlocks?.find(
          (block) =>
            block.label === input.label &&
            block.slot.startAt === input.slot.startAt &&
            block.slot.endAt === input.slot.endAt &&
            block.slot.timezone === input.slot.timezone,
        );
        const result =
          existing ?? (await client.request<NetworkBusy>('/network/calendar/busy', 'POST', input));
        // Session-owned refs/state retain completion even when this panel is away.
        pending.current = undefined;
        setUncertain(false);
        setEditing(false);
        setDraft(emptyDraft());
        return result;
      },
      () =>
        task.setNotice(
          'Busy time saved privately. Other members do not receive its label or details.',
        ),
      'Save unconfirmed. Check this same busy block before retrying. ',
    );
  };
  return (
    <View style={{ gap: 16 }}>
      <Card>
        <FeatureHeader
          icon="time-outline"
          title="Your availability"
          detail="Add busy time before enabling automatic acceptance."
        />
        <Badge
          text={
            availability && Date.parse(availability.confirmedThrough) > Date.now()
              ? `Manual calendar confirmed through ${formatDateTime(availability.confirmedThrough)}`
              : 'Manual availability needs your review'
          }
          tone="neutral"
        />
        <Disclosure title="How manual availability works">
          <Text style={styles.small}>
            klnk checks shared meetings and private busy blocks, not your other calendars.
            Confirmation means you maintain these commitments. It does not enable delegation.
            Automatic acceptance still needs your saved rules and a current source covering the full
            meeting.
          </Text>
        </Disclosure>
        <Button
          label="Confirm my manual calendar for 7 days"
          icon="checkmark-circle-outline"
          secondary
          disabled={!query.data}
          loading={task.busy}
          onPress={() =>
            void task.run(
              () =>
                client.request('/network/calendar/availability', 'PUT', {
                  confirmedThrough: new Date(Date.now() + 7 * 86400000).toISOString(),
                }),
              () =>
                task.setNotice(
                  'Manual availability confirmation saved for seven days. Delegation settings were not changed.',
                ),
              'Confirmation unconfirmed. Refresh calendar to check the saved source. ',
            )
          }
        />
        <Button
          label={editing ? 'Keep busy draft and close editor' : 'Add a private busy block'}
          icon={editing ? 'chevron-up-outline' : 'add-outline'}
          secondary
          disabled={task.busy || !query.data}
          onPress={() => setEditing(!editing)}
        />
      </Card>
      {editing ? (
        <Card>
          <FeatureHeader icon="lock-closed-outline" title="A private commitment" />
          <Field
            label="Busy block label"
            value={draft.label}
            onChangeText={(label) => setDraft({ ...draft, label })}
            maxLength={120}
            editable={!task.busy && !uncertain}
          />
          <DateTimeField
            label="Busy starts at"
            value={draft.slot.startAt}
            timezone={draft.slot.timezone}
            disabled={task.busy || uncertain}
            onChange={(startAt) => setDraft({ ...draft, slot: { ...draft.slot, startAt } })}
          />
          <DateTimeField
            label="Busy ends at"
            value={draft.slot.endAt}
            timezone={draft.slot.timezone}
            disabled={task.busy || uncertain}
            onChange={(endAt) => setDraft({ ...draft, slot: { ...draft.slot, endAt } })}
          />
          <TimezoneField
            label="Busy timezone"
            value={draft.slot.timezone}
            disabled={task.busy || uncertain}
            onChange={(timezone) => setDraft({ ...draft, slot: { ...draft.slot, timezone } })}
          />
          <Button
            label={uncertain ? 'Check and retry this same busy block' : 'Save private busy block'}
            icon="checkmark-outline"
            loading={task.busy}
            onPress={save}
          />
          {!uncertain ? (
            <Button
              label="Discard busy draft"
              secondary
              onPress={() => {
                setEditing(false);
                setDraft(emptyDraft());
              }}
            />
          ) : (
            <Notice tone="warning">
              This exact interval is retained for readback. Its outcome is not confirmed.
            </Notice>
          )}
        </Card>
      ) : null}

      {task.error ? <Notice tone="error">{task.error}</Notice> : null}
      {task.notice ? <Notice>{task.notice}</Notice> : null}
    </View>
  );
}

/** One virtualized calendar row. Its commitment label remains owner-private. */
export function BusyBlockRow({ block }: { block: NetworkBusy }) {
  const { styles } = useUI(),
    task = usePanelTask(),
    client = useNetworkClient();
  return (
    <View style={{ gap: 12 }}>
      <Card key={block.id}>
        <Text style={styles.h3}>{block.label || 'Busy'}</Text>
        <Text style={styles.text}>
          {formatDateTime(block.slot.startAt, block.slot.timezone)} –{' '}
          {formatDateTime(block.slot.endAt, block.slot.timezone)}
        </Text>
        <Button
          label={`Remove busy block: ${block.label || 'Busy'}`}
          secondary
          danger
          disabled={task.busy}
          onPress={() =>
            void task.run(
              () =>
                client.request(`/network/calendar/busy/${block.id}`, 'DELETE', {
                  version: block.version,
                }),
              () => task.setNotice('The private busy block was removed.'),
              'Removal unconfirmed. Refresh calendar before retrying. ',
            )
          }
        />
      </Card>

      {task.error ? <Notice tone="error">{task.error}</Notice> : null}
      {task.notice ? <Notice>{task.notice}</Notice> : null}
    </View>
  );
}
