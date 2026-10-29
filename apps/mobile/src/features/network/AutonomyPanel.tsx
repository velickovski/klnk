import React, { useEffect } from 'react';
import { View } from 'react-native';
import { AppText as Text } from '../../components/primitives';
import type {
  NetworkConnection,
  NetworkMemory,
  NetworkPolicy,
  NetworkPolicyInput,
} from '@personal-agent/domain';
import {
  Badge,
  Button,
  Card,
  CheckboxControl,
  Disclosure,
  FeatureHeader,
  Field,
  Notice,
  SwitchControl,
  WeekdayChips,
  useUI,
} from '../../ui';
import { useNetworkClient, useNetworkQuery, useSessionState } from './data-provider';
import { formatDateTime } from './format';
import { DateTimeField } from './DateTimeField';
import { ExpiryField } from './ExpiryField';
import { TimezoneField } from './TimezoneField';
import { usePanelTask } from './panel-hooks';
import { acceptedConnections, buildPolicy, futureInstant, peerId, peerName } from './panel-state';

type Fields = {
  start: string;
  end: string;
  duration: string;
  notice: string;
  window: string;
  reminders: string;
  topics: string;
};
const clock = (minutes: number) =>
  `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
function minutes(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value) && value !== '24:00') return NaN;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}
function inputPolicy(policy: NetworkPolicy): NetworkPolicyInput {
  const {
    ownerId: _owner,
    version: _version,
    updatedAt: _updated,
    authorityVersions: _authority,
    ...input
  } = policy as NetworkPolicy & { authorityVersions?: unknown };
  return input;
}
function fieldsFor(policy: NetworkPolicyInput): Fields {
  return {
    start: clock(policy.workStartMinute),
    end: clock(policy.workEndMinute),
    duration: String(policy.maxDurationMinutes),
    notice: String(policy.minNoticeMinutes),
    window: String(policy.schedulingWindowDays),
    reminders: policy.reminderMinutes.join(', '),
    topics: policy.topics.join(', '),
  };
}
export function AutonomyPanel({ ownerId }: { ownerId: string }) {
  return <AutonomyContent key={ownerId} ownerId={ownerId} />;
}
function AutonomyContent({ ownerId }: { ownerId: string }) {
  const { styles } = useUI(),
    task = usePanelTask(),
    networkApi = useNetworkClient();
  const policyQuery = useNetworkQuery<NetworkPolicy>('/network/policy'),
    peopleQuery = useNetworkQuery<{ connections: NetworkConnection[] }>('/network/connections'),
    memoryQuery = useNetworkQuery<{ memories: NetworkMemory[] }>('/network/memories');
  const connections = peopleQuery.data?.connections ?? [],
    memories = memoryQuery.data?.memories ?? [];
  const [saved, setSaved] = useSessionState<NetworkPolicy | undefined>(
      `${ownerId}:autonomy:saved`,
      undefined,
    ),
    [draft, setDraft] = useSessionState<NetworkPolicyInput | undefined>(
      `${ownerId}:autonomy:draft`,
      undefined,
    ),
    [fields, setFields] = useSessionState<Fields | undefined>(
      `${ownerId}:autonomy:fields`,
      undefined,
    ),
    [acknowledged, setAcknowledged] = useSessionState(`${ownerId}:autonomy:acknowledged`, false);
  const dirty =
    !!saved &&
    ((!!draft && JSON.stringify(draft) !== JSON.stringify(inputPolicy(saved))) ||
      (!!fields && JSON.stringify(fields) !== JSON.stringify(fieldsFor(inputPolicy(saved)))));
  const changedElsewhere =
    !!saved && !!policyQuery.data && saved.version !== policyQuery.data.version;
  const accepted = acceptedConnections(connections),
    trustedNames = accepted
      .filter((connection) => draft?.trustedMemberIds.includes(peerId(connection, ownerId)))
      .map(peerName);
  const update = <K extends keyof NetworkPolicyInput>(key: K, value: NetworkPolicyInput[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setAcknowledged(false);
  };
  const field = (key: keyof Fields, value: string) => {
    setFields((current) => (current ? { ...current, [key]: value } : current));
    setAcknowledged(false);
  };
  const hydrate = (policy: NetworkPolicy) => {
    const input = inputPolicy(policy);
    setDraft(input);
    setFields(fieldsFor(input));
    setAcknowledged(false);
  };
  const refresh = () =>
    task.run(
      async () => {
        await Promise.all([policyQuery.refetch(), peopleQuery.refetch(), memoryQuery.refetch()]);
      },
      () => undefined,
    );
  useEffect(() => {
    const latest = policyQuery.data;
    if (latest && (!saved || !draft || (latest.version !== saved.version && !dirty))) {
      setSaved(latest);
      hydrate(latest);
    }
  }, [policyQuery.data, saved?.version, dirty]);
  const save = () => {
    if (!draft || !fields || !saved) return;
    let policy: NetworkPolicyInput;
    try {
      if (draft.enabled && !acknowledged)
        throw new Error(
          'Review the preview and explicitly authorize these settings before enabling delegation.',
        );
      const numeric = [fields.duration, fields.notice, fields.window];
      if (numeric.some((value) => !/^\d+$/.test(value.trim())))
        throw new Error('Duration, notice and window must be whole numbers.');
      const reminders = fields.reminders.trim()
        ? fields.reminders.split(',').map((value) => value.trim())
        : [];
      if (reminders.some((value) => !/^\d+$/.test(value)))
        throw new Error('Use comma-separated whole minutes for reminders, or leave it blank.');
      policy = buildPolicy(
        {
          ...draft,
          topics: fields.topics
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          workStartMinute: minutes(fields.start),
          workEndMinute: minutes(fields.end),
          maxDurationMinutes: Number(fields.duration),
          minNoticeMinutes: Number(fields.notice),
          schedulingWindowDays: Number(fields.window),
          reminderMinutes: reminders.map(Number),
        },
        accepted.map((connection) => peerId(connection, ownerId)),
      );
    } catch (error) {
      task.setError((error as Error).message);
      return;
    }
    void task.run(
      () =>
        networkApi.request<NetworkPolicy>('/network/policy', 'PUT', {
          policy,
          expectedVersion: saved.version,
        }),
      (policy) => {
        setSaved(policy);
        hydrate(policy);
        task.setNotice(
          `Delegation settings saved at revision ${policy.version}. ${policy.enabled ? 'Only this scope is enabled.' : 'Autonomy is off.'}`,
        );
      },
      'Save unconfirmed. Existing saved authority may still apply; your draft is retained. Refresh to inspect the current revision. ',
    );
  };
  const revoke = () => {
    if (!saved) return;
    void task.run(
      () =>
        networkApi.request<NetworkPolicy>('/network/policy', 'PUT', {
          policy: { ...inputPolicy(saved), enabled: false },
          expectedVersion: saved.version,
        }),
      (policy) => {
        setSaved(policy);
        hydrate(policy);
        task.setNotice(
          'Autonomy is off in the saved settings. New background effects must recheck this revision.',
        );
      },
      'Revocation unconfirmed. Authority may still be active. Refresh and retry revocation with the current revision. ',
    );
  };
  const preset = (mode: 'off' | 'review' | 'routine') => {
    if (!draft) return;
    const value = {
      ...draft,
      enabled: mode !== 'off',
      allowMessages: mode !== 'off',
      allowQuestions: mode !== 'off',
      allowMeetings: mode !== 'off',
      autoAcceptMeetings: mode === 'routine',
      maxDurationMinutes: 30,
      minNoticeMinutes: 1440,
      schedulingWindowDays: 14,
      expiresAt: futureInstant(30),
      reminderMinutes: [30],
    };
    setDraft(value);
    setFields({
      ...fieldsFor(value),
      topics: fields?.topics ?? value.topics.join(', '),
      start: fields?.start ?? clock(value.workStartMinute),
      end: fields?.end ?? clock(value.workEndMinute),
    });
    setAcknowledged(false);
  };
  return (
    <View testID="network-autonomy" style={{ gap: 24 }}>
      <FeatureHeader
        icon="options-outline"
        title="Delegation"
        detail="Choose people, topics and limits."
      />
      <Notice>
        Autonomy starts off. A connection grants no authority. Your rules cover internal klnk
        coordination only; external calls, messages and calendar services stay unavailable.
      </Notice>
      {saved ? (
        <Card>
          <Text accessibilityRole="header" style={styles.h3}>
            Currently saved authority
          </Text>
          <Badge
            text={
              !saved.enabled
                ? 'Autonomy off'
                : Date.parse(saved.expiresAt) <= Date.now()
                  ? 'Grant expired'
                  : 'Scoped autonomy enabled'
            }
            tone={saved.enabled && Date.parse(saved.expiresAt) > Date.now() ? 'success' : 'neutral'}
          />
          <Text style={styles.small}>
            Revision {saved.version} · expires {formatDateTime(saved.expiresAt, saved.timezone)}
            {'\n'}Changes below take effect only after a confirmed save.
          </Text>
          {saved.enabled ? (
            <Button
              label="Revoke autonomy now"
              danger
              secondary
              disabled={task.busy}
              onPress={revoke}
            />
          ) : null}
        </Card>
      ) : null}
      {task.error || policyQuery.error || peopleQuery.error || memoryQuery.error ? (
        <Notice tone="error">
          {task.error || policyQuery.error || peopleQuery.error || memoryQuery.error}
        </Notice>
      ) : null}
      {changedElsewhere && dirty ? (
        <Card>
          <Notice tone="warning">
            Saved rules changed while you were editing. Your draft is retained; load the saved rules
            before preparing another change.
          </Notice>
          <Button
            label="Load saved rules and discard draft"
            secondary
            onPress={() => {
              if (policyQuery.data) {
                setSaved(policyQuery.data);
                hydrate(policyQuery.data);
              }
            }}
          />
        </Card>
      ) : null}
      {saved?.enabled &&
      Date.parse(saved.expiresAt) > Date.now() &&
      Date.parse(saved.expiresAt) - Date.now() < 7 * 86400000 ? (
        <Notice tone="warning">
          Your delegation expires {formatDateTime(saved.expiresAt, saved.timezone)}. Review and
          renew it to keep background coordination available.
        </Notice>
      ) : null}
      {task.notice ? <Notice>{task.notice}</Notice> : null}
      <Button
        label={task.busy ? 'Updating autonomy' : 'Refresh saved autonomy'}
        loading={task.busy}
        secondary
        onPress={() => void refresh()}
      />
      {!draft || !fields ? (
        <Text style={styles.small}>
          {task.busy || policyQuery.loading
            ? 'Loading your saved delegation…'
            : 'Settings have not loaded. Use Refresh saved autonomy to retry.'}
        </Text>
      ) : (
        <>
          <Card>
            <Text accessibilityRole="header" style={styles.h2}>
              Start with a preset
            </Text>
            <Button
              label="Preset: autonomy off"
              secondary
              disabled={task.busy}
              onPress={() => preset('off')}
            />
            <Button
              label="Preset: ask me about every meeting"
              secondary
              disabled={task.busy}
              onPress={() => preset('review')}
            />
            <Button
              label="Preset: accept routine meetings within my limits"
              secondary
              disabled={task.busy}
              onPress={() => preset('routine')}
            />
            <Text style={styles.small}>
              A preset fills this draft. Choose members and topics, review the limits and save to
              apply it.
            </Text>
          </Card>
          <SwitchControl
            label="Enable background delegation"
            checked={draft.enabled}
            disabled={task.busy}
            onChange={(value) => update('enabled', value)}
          />
          <Disclosure title="Advanced delegation settings">
            <Card>
              <Text accessibilityRole="header" style={styles.h2}>
                Trusted members
              </Text>
              {accepted.length ? (
                accepted.map((connection) => {
                  const id = peerId(connection, ownerId),
                    selected = draft.trustedMemberIds.includes(id);
                  return (
                    <CheckboxControl
                      key={id}
                      label={`Trust ${peerName(connection)} for delegation`}
                      checked={selected}
                      disabled={task.busy}
                      onChange={() =>
                        update(
                          'trustedMemberIds',
                          selected
                            ? draft.trustedMemberIds.filter((value) => value !== id)
                            : [...draft.trustedMemberIds, id],
                        )
                      }
                    />
                  );
                })
              ) : (
                <Text style={styles.small}>
                  Accept a connection in People before enabling delegation.
                </Text>
              )}
              {draft.trustedMemberIds.some(
                (id) => !accepted.some((connection) => peerId(connection, ownerId) === id),
              ) ? (
                <>
                  <Notice tone="warning">
                    A trusted member is no longer an accepted connection. Remove unavailable members
                    before saving an enabled grant.
                  </Notice>
                  <Button
                    label="Remove unavailable trusted members"
                    secondary
                    disabled={task.busy}
                    onPress={() =>
                      update(
                        'trustedMemberIds',
                        draft.trustedMemberIds.filter((id) =>
                          accepted.some((connection) => peerId(connection, ownerId) === id),
                        ),
                      )
                    }
                  />
                </>
              ) : null}
              <Field
                label="Permitted topics"
                value={fields.topics}
                onChangeText={(value) => field('topics', value)}
                editable={!task.busy}
                hint="Separate exact topics with commas, for example project planning, lunch. No topic means no enabled delegation."
              />
            </Card>
            <Card>
              <Text accessibilityRole="header" style={styles.h2}>
                Permitted capabilities
              </Text>
              {(
                [
                  ['allowMessages', 'Deliver information'],
                  ['allowQuestions', 'Answer permitted questions'],
                  ['allowMeetings', 'Coordinate meetings'],
                  ['autoAcceptMeetings', 'Accept a matching meeting without asking me'],
                ] as const
              ).map(([key, label]) => (
                <SwitchControl
                  key={key}
                  label={label}
                  checked={draft[key]}
                  disabled={task.busy}
                  onChange={(value) => update(key, value)}
                />
              ))}
            </Card>
            <Card>
              <Text accessibilityRole="header" style={styles.h2}>
                Meeting boundaries
              </Text>
              <TimezoneField
                label="Delegation timezone"
                value={draft.timezone}
                onChange={(value) => update('timezone', value)}
                disabled={task.busy}
              />
              <Text style={styles.h3}>Allowed weekdays</Text>
              <WeekdayChips
                values={draft.weekdays}
                disabled={task.busy}
                onChange={(days) => update('weekdays', days)}
              />
              <DateTimeField
                label="Working hours start"
                value={fields.start}
                onChange={(value) => field('start', value)}
                disabled={task.busy}
                mode="time"
                timezone={draft.timezone}
              />
              <DateTimeField
                label="Working hours end"
                value={fields.end}
                onChange={(value) => field('end', value)}
                disabled={task.busy}
                mode="time"
                endOfDay
                timezone={draft.timezone}
              />
              <Field
                label="Maximum meeting duration, minutes"
                value={fields.duration}
                onChangeText={(value) => field('duration', value)}
                editable={!task.busy}
                keyboardType="number-pad"
                hint="5 to 240 minutes."
              />
              <Field
                label="Minimum notice, minutes"
                value={fields.notice}
                onChangeText={(value) => field('notice', value)}
                editable={!task.busy}
                keyboardType="number-pad"
                hint="0 to 43200 minutes. 1440 minutes is one day."
              />
              <Field
                label="Scheduling window, days"
                value={fields.window}
                onChangeText={(value) => field('window', value)}
                editable={!task.busy}
                keyboardType="number-pad"
                hint="1 to 90 days ahead."
              />
            </Card>
            <Card>
              <Text accessibilityRole="header" style={styles.h2}>
                Memory and expiry
              </Text>
              <Text style={styles.small}>
                Choose confirmed, unexpired memories already shared with members. Selection does not
                broaden their member scope.
              </Text>
              {memories
                .filter(
                  (memory) =>
                    memory.confirmed &&
                    memory.sharing === 'connections' &&
                    Date.parse(memory.expiresAt) > Date.now(),
                )
                .map((memory) => {
                  const selected = draft.sharedMemoryIds.includes(memory.id);
                  return (
                    <CheckboxControl
                      key={memory.id}
                      label={`Permit memory: ${memory.topic}`}
                      checked={selected}
                      disabled={task.busy}
                      onChange={() =>
                        update(
                          'sharedMemoryIds',
                          selected
                            ? draft.sharedMemoryIds.filter((id) => id !== memory.id)
                            : [...draft.sharedMemoryIds, memory.id],
                        )
                      }
                    />
                  );
                })}
              <Text style={styles.small}>
                {draft.sharedMemoryIds.length} memory items selected.
              </Text>
              <Button
                label="Clear all delegation memory permissions"
                secondary
                disabled={task.busy || !draft.sharedMemoryIds.length}
                onPress={() => update('sharedMemoryIds', [])}
              />
              <ExpiryField
                label="Delegation expires at"
                value={draft.expiresAt}
                disabled={task.busy}
                timezone={draft.timezone}
                onChange={(value) => update('expiresAt', value)}
              />
              <Field
                label="In-app reminders, minutes before a meeting"
                value={fields.reminders}
                editable={!task.busy}
                onChangeText={(value) => field('reminders', value)}
                hint="Up to four comma-separated values, for example 30, 5. Leave blank for none. Reminders are available in klnk; alerts while the app is closed are not guaranteed."
              />
            </Card>
          </Disclosure>
          <Card>
            <Text accessibilityRole="header" style={styles.h2}>
              Review your draft
            </Text>
            <Text style={styles.text}>
              {draft.enabled
                ? `Allow ${trustedNames.join(', ') || 'no selected members yet'} on ${fields.topics || 'no topics yet'}.`
                : 'Autonomy will be off after a confirmed save.'}
              {'\n'}Information: {draft.allowMessages ? 'allowed' : 'off'} · Questions:{' '}
              {draft.allowQuestions ? 'allowed' : 'off'}
              {'\n'}Meetings:{' '}
              {draft.allowMeetings
                ? draft.autoAcceptMeetings
                  ? 'may accept within limits'
                  : 'ask me before acceptance'
                : 'off'}
              {'\n'}
              {draft.weekdays
                .map((day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day])
                .join(', ')}{' '}
              · {fields.start}–{fields.end} · {draft.timezone}
              {'\n'}Up to {fields.duration} minutes, {fields.notice} minutes notice, within{' '}
              {fields.window} days.{'\n'}Expires {formatDateTime(draft.expiresAt, draft.timezone)}.{' '}
              {draft.sharedMemoryIds.length} memory permissions; reminders:{' '}
              {fields.reminders || 'none'}.
            </Text>
            <Text style={styles.small}>
              Only the internal klnk calendar is checked. A match does not prove availability on
              external calendars.
            </Text>
            {draft.enabled ? (
              <CheckboxControl
                label="I authorize these limits and disclosure permissions"
                checked={acknowledged}
                disabled={task.busy}
                onChange={setAcknowledged}
              />
            ) : null}
            <Button label="Save delegation settings" loading={task.busy} onPress={save} />
            <Button
              label="Discard draft and use saved settings"
              secondary
              disabled={task.busy || !saved}
              onPress={() => saved && hydrate(saved)}
            />
          </Card>
        </>
      )}
    </View>
  );
}
