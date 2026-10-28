import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, findNodeHandle, Platform, Pressable, Text, View } from 'react-native';
import type { Contact, Memory } from '@personal-agent/domain';
import { useEditorGuard, type EditorGuard } from '../forms/useEditorGuard';
import { Bootstrap, localDate } from '../../models';
import { Badge, Button, Card, Choice, Empty, Field, Icon, Notice, useUI } from '../../ui';
import {
  confirmationLabel,
  disclosureLabel,
  expiryState,
  memoryEligibility,
  MemoryEditorModel,
  memoryPage,
  memoryScope,
  MEMORY_PAGE_SIZE,
  sourceLabel,
  type MemoryFilter,
} from './model';

function Expiry({ memory, now, timezone }: { memory: Memory; now: number; timezone?: string }) {
  const { styles } = useUI(),
    expiry = expiryState(memory, now);
  return (
    <Text style={styles.small}>
      {expiry === 'none'
        ? 'No expiry set'
        : expiry === 'invalid'
          ? 'Expiry unavailable · invalid stored date'
          : `${expiry === 'expired' ? 'Expired' : 'Expires'} ${localDate(memory.expiresAt!, timezone)}`}
    </Text>
  );
}

export function MemoryScreen({
  memories,
  contacts,
  onEdit,
}: {
  memories: Memory[];
  contacts: Contact[];
  onEdit: (memory?: Memory) => void;
}) {
  const { colors, styles } = useUI();
  const [filter, setFilter] = useState<MemoryFilter>('all'),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [now, setNow] = useState(Date.now);
  const summaryRef = useRef<React.ElementRef<typeof Text>>(null);
  useEffect(() => {
    if (!memories.some((memory) => memory.expiresAt)) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [memories]);
  const result = useMemo(
    () => memoryPage(memories, query, filter, page, now),
    [memories, query, filter, page, now],
  );
  const clearFilters = () => {
    setFilter('all');
    setQuery('');
    setPage(0);
  };
  const changePage = (value: number) => {
    setPage(value);
    requestAnimationFrame(() => {
      if (Platform.OS === 'web') {
        const target = summaryRef.current as unknown as HTMLElement | null;
        target?.focus();
        target?.scrollIntoView({ block: 'start' });
      } else {
        const target = findNodeHandle(summaryRef.current);
        if (target) AccessibilityInfo.setAccessibilityFocus(target);
      }
    });
  };
  return (
    <>
      <View style={{ gap: 8 }}>
        <Text style={styles.label}>SOURCE-AWARE MEMORY</Text>
        <Text accessibilityRole="header" style={styles.title}>
          What your agent knows.
        </Text>
        <Text style={styles.subtitle}>
          Inspect the source, review the claim and choose what may be shared.
        </Text>
      </View>
      <Button label="Add a memory" icon="add-outline" onPress={() => onEdit()} />
      {memories.length ? (
        <>
          <Choice
            label="Show memories"
            value={filter}
            onChange={(value) => {
              setFilter(value);
              setPage(0);
            }}
            options={[
              { label: 'All', value: 'all' },
              { label: 'Needs review', value: 'review' },
              { label: 'Private', value: 'private' },
              { label: 'Expired', value: 'expired' },
            ]}
          />
          <Field
            label="Search memory"
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              setPage(0);
            }}
            placeholder="Memory text, kind or source reference"
          />
          <Text
            ref={summaryRef}
            {...(Platform.OS === 'web'
              ? { role: 'status', tabIndex: -1 }
              : { accessible: true, accessibilityLiveRegion: 'polite' })}
            style={styles.small}
          >
            {result.total} {result.total === 1 ? 'memory' : 'memories'}
            {result.total
              ? ` · Showing ${result.page * MEMORY_PAGE_SIZE + 1}–${Math.min((result.page + 1) * MEMORY_PAGE_SIZE, result.total)}`
              : ' match these filters'}
          </Text>
        </>
      ) : null}
      {result.memories.map((memory) => (
        <Pressable
          key={memory.id}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${memory.kind} memory: ${memory.text}, ${confirmationLabel[memory.confirmation]}, ${disclosureLabel[memory.disclosure]}, ${memoryScope(memory, contacts)}`}
          onPress={() => onEdit(memory)}
        >
          <Card>
            <View style={styles.spread}>
              <Text style={styles.label}>{memory.kind.replace(/_/g, ' ')}</Text>
              <Icon
                name={memory.disclosure === 'private' ? 'lock-closed-outline' : 'chevron-forward'}
                color={colors.muted}
                size={18}
              />
            </View>
            <Text style={styles.text}>{memory.text}</Text>
            <View style={styles.chips}>
              <Badge
                text={confirmationLabel[memory.confirmation]}
                tone={memory.confirmation === 'confirmed' ? 'green' : 'amber'}
              />
              <Badge text={disclosureLabel[memory.disclosure]} tone="blue" />
              {expiryState(memory, now) === 'expired' ? (
                <Badge text="Expired" tone="amber" />
              ) : null}
            </View>
            <Text style={styles.small}>{memoryScope(memory, contacts)}</Text>
            <Text style={styles.small}>
              {sourceLabel[memory.source.type]} · {memory.source.reference}
            </Text>
            <Expiry memory={memory} now={now} />
            <Text style={styles.small}>{memoryEligibility(memory, contacts, now)}</Text>
          </Card>
        </Pressable>
      ))}
      {!result.total ? (
        <Card>
          <Empty
            icon="layers-outline"
            title={
              memories.length ? 'No memories match these filters' : 'Your memory starts with you'
            }
            detail={
              memories.length
                ? 'Change the filter or search to find another memory.'
                : 'Add useful context when you are ready. No private facts have been added for you.'
            }
          />
          {query || filter !== 'all' ? (
            <Button label="Clear memory filters" secondary onPress={clearFilters} />
          ) : null}
        </Card>
      ) : null}
      {result.pageCount > 1 ? (
        <View style={{ gap: 12 }}>
          <Text style={styles.small}>
            Page {result.page + 1} of {result.pageCount}
          </Text>
          <Button
            label="Previous memory page"
            secondary
            disabled={result.page === 0}
            onPress={() => changePage(result.page - 1)}
          />
          <Button
            label="Next memory page"
            secondary
            disabled={result.page === result.pageCount - 1}
            onPress={() => changePage(result.page + 1)}
          />
        </View>
      ) : null}
      <Notice>
        A preference or recorded permission does not authorize a new request. Unconfirmed,
        conflicting, private and expired memories are excluded from new call context.
      </Notice>
    </>
  );
}

type EditorProps = EditorGuard & {
  memory?: Memory;
  data: Bootstrap;
  working: boolean;
  onSave: (value: Partial<Memory>) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
};
export function MemoryEditor(props: EditorProps) {
  return <MemoryForm key={props.memory?.id ?? 'new-memory'} {...props} />;
}

function MemoryForm({
  memory,
  data,
  working,
  onSave,
  onDelete,
  onDirtyChange,
  onRegisterSave,
}: EditorProps) {
  const { styles } = useUI();
  const [model] = useState(() => new MemoryEditorModel(memory)),
    [deleteConfirmed, setDeleteConfirmed] = useState(false),
    [relationshipQuery, setRelationshipQuery] = useState('');
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot),
    draft = state.draft,
    busy = working || state.busy;
  const currentRelationship = data.contacts.find((contact) => contact.id === draft.contactId);
  const relationships = useMemo(
    () =>
      data.contacts
        .filter((contact) =>
          `${contact.name} ${contact.relationship} ${contact.phone}`
            .toLowerCase()
            .includes(relationshipQuery.toLowerCase().trim()),
        )
        .slice(0, 20),
    [data.contacts, relationshipQuery],
  );
  const save = () => {
    if (!busy)
      void model.save(
        onSave,
        data.contacts,
        data.missions.map((mission) => mission.id),
      );
  };
  useEditorGuard(draft, save, { onDirtyChange, onRegisterSave });
  return (
    <>
      <View style={{ gap: 8 }}>
        <Text style={styles.label}>SOURCE-AWARE MEMORY</Text>
        <Text accessibilityRole="header" style={styles.title}>
          You decide what stays.
        </Text>
        <Text style={styles.subtitle}>
          Keep useful context without giving every conversation access to everything.
        </Text>
      </View>
      <Field
        label="Memory"
        multiline
        value={draft.text}
        editable={!busy}
        onChangeText={(value) => model.update('text', value)}
        placeholder="A fact, a preference, or something promised…"
        error={state.errors.text}
      />
      <Choice
        label="Kind of memory"
        value={draft.kind}
        disabled={busy}
        onChange={(value) => model.update('kind', value)}
        options={[
          { label: 'Fact', value: 'fact' },
          { label: 'Preference', value: 'preference' },
          { label: 'Identity', value: 'identity' },
          { label: 'Appointment', value: 'appointment' },
          { label: 'Commitment', value: 'commitment' },
          { label: 'Permission', value: 'permission' },
          { label: 'Claim', value: 'claim' },
          { label: 'Inference', value: 'inference' },
        ]}
      />
      <Choice
        label="Where it applies"
        value={draft.scope}
        disabled={busy}
        onChange={(value) => model.update('scope', value)}
        options={[
          { label: 'Owner context', value: 'owner' },
          { label: 'One relationship', value: 'relationship' },
          ...(memory?.missionId ? [{ label: 'This mission only', value: 'mission' as const }] : []),
        ]}
      />
      {state.errors.scope ? <Notice tone="error">{state.errors.scope}</Notice> : null}
      {draft.scope === 'relationship' ? (
        <View style={{ gap: 12 }}>
          <Text style={styles.small}>
            {currentRelationship
              ? `Selected relationship: ${currentRelationship.name} · ${currentRelationship.phone}`
              : draft.contactId
                ? 'The selected relationship has been removed. Choose a current person or change the scope.'
                : 'Choose the person this memory applies to.'}
          </Text>
          {data.contacts.length ? (
            <>
              <Field
                label="Find a relationship"
                value={relationshipQuery}
                editable={!busy}
                onChangeText={setRelationshipQuery}
                placeholder="Name, relationship or number"
              />
              <Choice
                label="Relationship"
                value={draft.contactId}
                disabled={busy}
                onChange={(value) => model.update('contactId', value)}
                options={relationships.map((contact) => ({
                  label: `${contact.name} · ${contact.phone}`,
                  value: contact.id,
                }))}
              />
              {!relationships.length ? (
                <Text style={styles.small}>No relationships match your search.</Text>
              ) : data.contacts.length > 20 ? (
                <Text style={styles.small}>
                  Showing up to 20 matches. Search for the person you need.
                </Text>
              ) : null}
            </>
          ) : (
            <Notice>Add a person in People first, or choose owner context.</Notice>
          )}
          {state.errors.contactId ? <Notice tone="error">{state.errors.contactId}</Notice> : null}
        </View>
      ) : null}
      <Choice
        label="Disclosure rule"
        value={draft.disclosure}
        disabled={busy}
        onChange={(value) => model.update('disclosure', value)}
        options={[
          { label: 'Private', value: 'private' },
          { label: 'Ask first', value: 'ask' },
          { label: 'May share in scope', value: 'allowed' },
        ]}
      />
      <Choice
        label="Confirmation"
        value={draft.confirmation}
        disabled={busy}
        onChange={(value) => model.update('confirmation', value)}
        options={[
          { label: 'Confirmed by me', value: 'confirmed' },
          { label: 'Unconfirmed', value: 'unconfirmed' },
          { label: 'Proposed', value: 'proposed' },
          { label: 'Conflicting', value: 'conflicting' },
        ]}
      />
      {memory ? (
        <Card>
          <Text accessibilityRole="header" style={styles.h3}>
            Provenance and expiry
          </Text>
          <Text style={styles.text}>
            {sourceLabel[memory.source.type]} · {memory.source.reference}
          </Text>
          <Text style={styles.small}>
            Created {localDate(memory.createdAt, data.profile.timezone)}
            {'\n'}Updated {localDate(memory.updatedAt, data.profile.timezone)}
          </Text>
          <Expiry memory={memory} now={Date.now()} timezone={data.profile.timezone} />
          <Text style={styles.small}>
            Saving records an owner edit and preserves the prior source reference. This editor keeps
            the stored expiry unchanged.
          </Text>
        </Card>
      ) : (
        <Text style={styles.small}>
          New memories use an owner-entered source and have no automatic expiry set.
        </Text>
      )}
      {draft.kind === 'permission' ? (
        <Notice>
          A recorded permission is kept for review and excluded from call context. It never
          authorizes a request or expands its approved instructions.
        </Notice>
      ) : (
        <Notice>
          Only confirmed, explicitly shareable context in the correct scope can be selected for a
          new call. Editing or deleting this memory does not grant new authority.
        </Notice>
      )}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <Button label="Save memory" loading={busy} onPress={save} />
      {onDelete ? (
        deleteConfirmed ? (
          <>
            <Notice tone="warning">
              Remove this item from Memory. Copies in authorized request snapshots and conversation
              records remain. This does not cancel a request; use its controls separately to cancel
              pending work.
            </Notice>
            <Button
              label="Confirm delete memory"
              danger
              secondary
              loading={busy}
              onPress={() => {
                if (!busy) void model.remove(onDelete);
              }}
            />
            <Button
              label="Keep memory"
              secondary
              disabled={busy}
              onPress={() => setDeleteConfirmed(false)}
            />
          </>
        ) : (
          <Button
            label="Delete memory"
            danger
            secondary
            disabled={busy}
            onPress={() => setDeleteConfirmed(true)}
          />
        )
      ) : null}
    </>
  );
}
