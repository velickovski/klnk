import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type {
  NetworkConnection,
  NetworkMemory,
  NetworkPolicy,
  NetworkPolicyInput,
} from '@personal-agent/domain';
import { Badge, Button, Card, Choice, Field, Notice, useUI } from '../../ui';
import { networkApi } from './api';
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
  const { ownerId: _owner, version: _version, updatedAt: _updated, ...input } = policy;
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
    task = usePanelTask();
  const [saved, setSaved] = useState<NetworkPolicy>(),
    [draft, setDraft] = useState<NetworkPolicyInput>(),
    [fields, setFields] = useState<Fields>(),
    [connections, setConnections] = useState<NetworkConnection[]>([]),
    [memories, setMemories] = useState<NetworkMemory[]>([]),
    [acknowledged, setAcknowledged] = useState(false);
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
        const [policy, people, memory] = await Promise.all([
          networkApi.request<NetworkPolicy>('/network/policy'),
          networkApi.request<{ connections: NetworkConnection[] }>('/network/connections'),
          networkApi.request<{ memories: NetworkMemory[] }>('/network/memories'),
        ]);
        return { policy, people: people.connections, memories: memory.memories };
      },
      (result) => {
        setSaved(result.policy);
        setConnections(result.people);
        setMemories(result.memories);
        if (!draft) hydrate(result.policy);
      },
    );
  useEffect(() => {
    void refresh();
  }, []);
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
      <View style={{ gap: 8 }}>
        <Text style={styles.label}>AUTONOMY</Text>
        <Text accessibilityRole="header" style={styles.title}>
          Your rules, explicitly.
        </Text>
        <Text style={styles.subtitle}>
          Choose who your representative can work with, what it may share and when it may agree.
        </Text>
      </View>
      <Notice>
        Autonomy starts off. Connecting a member does not enable it. These controls authorize only
        internal klnk coordination; external calls, messages and calendar services remain
        unavailable.
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
            tone={saved.enabled && Date.parse(saved.expiresAt) > Date.now() ? 'green' : 'neutral'}
          />
          <Text style={styles.small}>
            Revision {saved.version} · expires {saved.expiresAt}
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
      {task.error ? <Notice tone="error">{task.error}</Notice> : null}
      {task.notice ? <Notice>{task.notice}</Notice> : null}
      <Button
        label={task.busy ? 'Updating autonomy' : 'Refresh saved autonomy'}
        loading={task.busy}
        secondary
        onPress={() => void refresh()}
      />
      {!draft || !fields ? (
        <Text style={styles.small}>
          {task.busy
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
          <Choice
            label="Enable background delegation"
            value={draft.enabled ? 'on' : 'off'}
            disabled={task.busy}
            onChange={(value) => update('enabled', value === 'on')}
            options={[
              { label: 'Off', value: 'off' },
              { label: 'On, within these limits', value: 'on' },
            ]}
          />
          <Card>
            <Text accessibilityRole="header" style={styles.h2}>
              Trusted members
            </Text>
            {accepted.length ? (
              accepted.map((connection) => {
                const id = peerId(connection, ownerId),
                  selected = draft.trustedMemberIds.includes(id);
                return (
                  <Button
                    key={id}
                    label={`${selected ? 'Remove' : 'Trust'} ${peerName(connection)}${selected ? ' from delegation' : ' for delegation'}`}
                    secondary
                    disabled={task.busy}
                    onPress={() =>
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
              <Choice
                key={key}
                label={label}
                value={draft[key] ? 'yes' : 'no'}
                disabled={task.busy}
                onChange={(value) => update(key, value === 'yes')}
                options={[
                  { label: `${label}: no`, value: 'no' },
                  { label: `${label}: yes`, value: 'yes' },
                ]}
              />
            ))}
          </Card>
          <Card>
            <Text accessibilityRole="header" style={styles.h2}>
              Meeting boundaries
            </Text>
            <Field
              label="Delegation timezone"
              value={draft.timezone}
              onChangeText={(value) => update('timezone', value)}
              editable={!task.busy}
              autoCapitalize="none"
              autoCorrect={false}
              hint="IANA timezone, for example Europe/Skopje. Stored meeting instants use UTC."
            />
            <Text style={styles.h3}>Allowed weekdays</Text>
            {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
              (day, index) => (
                <Button
                  key={day}
                  label={`${draft.weekdays.includes(index) ? 'Remove' : 'Allow'} ${day}`}
                  secondary
                  disabled={task.busy}
                  onPress={() =>
                    update(
                      'weekdays',
                      draft.weekdays.includes(index)
                        ? draft.weekdays.filter((value) => value !== index)
                        : [...draft.weekdays, index],
                    )
                  }
                />
              ),
            )}
            <Field
              label="Working hours start"
              value={fields.start}
              onChangeText={(value) => field('start', value)}
              editable={!task.busy}
              hint="24-hour HH:mm in the delegation timezone, for example 09:00."
            />
            <Field
              label="Working hours end"
              value={fields.end}
              onChangeText={(value) => field('end', value)}
              editable={!task.busy}
              hint="24-hour HH:mm, for example 17:00. Overnight hours require a later policy version."
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
              Only checked, unexpired memories explicitly scoped to members are offered here.
              Selection is additional permission; it does not broaden their member scope.
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
                  <Button
                    key={memory.id}
                    label={`${selected ? 'Exclude' : 'Permit'} memory: ${memory.topic}`}
                    secondary
                    disabled={task.busy}
                    onPress={() =>
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
            <Text style={styles.small}>{draft.sharedMemoryIds.length} memory items selected.</Text>
            <Button
              label="Clear all delegation memory permissions"
              secondary
              disabled={task.busy || !draft.sharedMemoryIds.length}
              onPress={() => update('sharedMemoryIds', [])}
            />
            <Field
              label="Delegation expires at"
              value={draft.expiresAt}
              editable={!task.busy}
              onChangeText={(value) => update('expiresAt', value)}
              autoCapitalize="none"
              autoCorrect={false}
              hint="ISO date and time with offset, for example 2026-11-30T18:00:00Z."
            />
            <Field
              label="In-app reminders, minutes before a meeting"
              value={fields.reminders}
              editable={!task.busy}
              onChangeText={(value) => field('reminders', value)}
              hint="Up to four comma-separated values, for example 30, 5. Leave blank for none. Reminders are available in klnk; alerts while the app is closed are not guaranteed."
            />
          </Card>
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
              {fields.window} days.{'\n'}Expires {draft.expiresAt}. {draft.sharedMemoryIds.length}{' '}
              memory permissions; reminders: {fields.reminders || 'none'}.
            </Text>
            <Text style={styles.small}>
              Only the internal klnk calendar is checked. A match does not prove availability on
              external calendars.
            </Text>
            {draft.enabled ? (
              <Choice
                label="Authorize this exact delegation draft"
                value={acknowledged ? 'yes' : 'no'}
                disabled={task.busy}
                onChange={(value) => setAcknowledged(value === 'yes')}
                options={[
                  { label: 'Not yet authorized', value: 'no' },
                  { label: 'I authorize these limits and disclosure permissions', value: 'yes' },
                ]}
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
