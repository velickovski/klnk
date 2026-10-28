import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, findNodeHandle, Platform, Pressable, Text, View } from 'react-native';
import type { Contact } from '@personal-agent/domain';
import { useEditorGuard, type EditorGuard } from '../forms/useEditorGuard';
import { LANGUAGES } from '../../models';
import { Avatar, Badge, Button, Card, Choice, Empty, Field, Icon, Notice, useUI, a11yState } from '../../ui';
import { ContactEditorModel, peoplePage, PEOPLE_PAGE_SIZE } from './model';

export function PeopleScreen({ contacts, onEdit }: { contacts: Contact[]; onEdit: (contact?: Contact) => void }) {
  const { colors, styles } = useUI();
  const [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const resultsRef = useRef<React.ElementRef<typeof Text>>(null);
  const result = useMemo(() => peoplePage(contacts, query, page), [contacts, query, page]);
  const changeQuery = (value: string) => { setQuery(value); setPage(0); };
  const changePage = (value: number) => {
    setPage(value);
    requestAnimationFrame(() => {
      if (Platform.OS === 'web') { const target = resultsRef.current as unknown as HTMLElement | null; target?.focus(); target?.scrollIntoView({ block: 'start' }); }
      else { const target = findNodeHandle(resultsRef.current); if (target) AccessibilityInfo.setAccessibilityFocus(target); }
    });
  };
  return <>
    <View style={{ gap: 8 }}><Text style={styles.label}>RELATIONSHIPS, WITH CONTEXT</Text><Text accessibilityRole="header" style={styles.title}>The people in your life.</Text><Text style={styles.subtitle}>Keep the context that helps your agent speak thoughtfully. Add only the people you choose.</Text></View>
    <Button label="Add a person" icon="person-add-outline" onPress={() => onEdit()} />
    {contacts.length ? <><Field label="Find a person" value={query} onChangeText={changeQuery} placeholder="Name, relationship or phone number" autoCorrect={false} /><Text ref={resultsRef} {...(Platform.OS === 'web' ? { role: 'status', tabIndex: -1 } : { accessible: true, accessibilityLiveRegion: 'polite' })} style={styles.small}>{result.total} {result.total === 1 ? 'person' : 'people'}{query.trim() ? ' matching your search' : ''}{result.total ? ` · Showing ${result.page * PEOPLE_PAGE_SIZE + 1}–${Math.min((result.page + 1) * PEOPLE_PAGE_SIZE, result.total)}` : ''}</Text></> : null}
    {result.contacts.map(contact => <Pressable key={contact.id} accessibilityRole="button" accessibilityLabel={`Edit ${contact.name}, ${contact.relationship}, ${contact.phone}, ${contact.optedOut ? 'do not call' : contact.verified ? 'recipient checked' : 'needs verification'}`} onPress={() => onEdit(contact)}>
      <Card><View style={styles.row}><Avatar name={contact.name} size={52} /><View style={{ gap: 4, flex: 1 }}><Text style={styles.h3}>{contact.name}</Text><Text style={styles.small}>{contact.relationship}</Text><Text style={styles.small}>{contact.phone}</Text></View><Icon name="chevron-forward" size={19} color={colors.muted} /></View>
        {contact.context ? <Text style={styles.text}>{contact.context}</Text> : null}
        <View style={styles.chips}><Badge text={contact.optedOut ? 'Do not call' : contact.verified ? 'Recipient checked' : 'Needs verification'} tone={contact.optedOut ? 'red' : contact.verified ? 'green' : 'amber'} /><Badge text={contact.language.toUpperCase()} tone="blue" /></View>
      </Card>
    </Pressable>)}
    {!result.total ? <Card><Empty icon="people-outline" title={contacts.length ? 'No people match your search' : 'Your people, at your pace'} detail={contacts.length ? 'Try a different name, relationship or phone number.' : 'Add a person manually when you are ready. No address book has been imported.'} />{query ? <Button label="Clear people search" secondary onPress={() => changeQuery('')} /> : null}</Card> : null}
    {result.pageCount > 1 ? <View style={{ gap: 12 }}><Text style={styles.small}>Page {result.page + 1} of {result.pageCount}</Text><Button label="Previous people page" secondary disabled={result.page === 0} onPress={() => changePage(result.page - 1)} /><Button label="Next people page" secondary disabled={result.page === result.pageCount - 1} onPress={() => changePage(result.page + 1)} /></View> : null}
    <Notice>Contacts are entered explicitly. Phone address-book import is not implemented; the app does not request broad contact access.</Notice>
  </>;
}

type EditorProps = EditorGuard & { contact?: Contact; working: boolean; onSave: (value: Partial<Contact>) => Promise<boolean>; onDelete?: () => Promise<boolean> };
export function ContactEditor(props: EditorProps) { return <ContactForm key={props.contact?.id ?? 'new-contact'} {...props} />; }

function ContactForm({ contact, working, onSave, onDelete, onDirtyChange, onRegisterSave }: EditorProps) {
  const { styles } = useUI();
  const [model] = useState(() => new ContactEditorModel(contact));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const draft = state.draft, busy = working || state.busy;
  useEffect(() => { model.retainOptOut(contact); }, [contact?.optedOut, model]);
  const save = () => { if (!busy) void model.save(onSave); };
  useEditorGuard(draft, save, { onDirtyChange, onRegisterSave });
  const languages = LANGUAGES.some(option => option.value === draft.language) ? LANGUAGES : [...LANGUAGES, { label: draft.language, value: draft.language }];
  return <>
    <View style={{ gap: 12 }}><Avatar name={draft.name || '?'} size={64} /><Text accessibilityRole="header" style={styles.title}>{contact ? 'A little more context.' : 'Someone your agent should know.'}</Text></View>
    <Field label="Name" value={draft.name} editable={!busy} onChangeText={value => model.update('name', value)} placeholder="Person or business name" textContentType="name" error={state.errors.name} />
    <Field label="Phone number" value={draft.phone} editable={!busy} onChangeText={value => model.update('phone', value)} keyboardType="phone-pad" textContentType="telephoneNumber" placeholder="+12025550101" hint="Start with + and the country code. Spaces, parentheses and hyphens are accepted. Changing the number clears recipient verification." error={state.errors.phone} />
    <Field label="Relationship" value={draft.relationship} editable={!busy} onChangeText={value => model.update('relationship', value)} placeholder="Friend, colleague, plumber, supplier…" error={state.errors.relationship} />
    <Choice label="Their language" value={draft.language} disabled={busy} onChange={value => { if (!busy) model.update('language', value); }} options={languages} />
    <Field label="Relationship context" multiline value={draft.context} editable={!busy} onChangeText={value => model.update('context', value)} placeholder="How you know them and useful background." hint="Sensitive facts belong in Memory with explicit disclosure rules." />
    <Pressable accessibilityRole="checkbox" accessibilityLabel="I have checked this is the intended recipient and their correct number." {...a11yState({ checked: draft.verified, disabled: busy })} disabled={busy} onPress={() => model.update('verified', !draft.verified)} style={[styles.row, { minHeight: 54 }]}><Icon name={draft.verified ? 'checkbox' : 'square-outline'} /><Text style={[styles.text, { flex: 1 }]}>I have checked this is the intended recipient and their correct number.</Text></Pressable>
    {state.optedOut ? <Notice tone="warning">This recipient requested no further calls. Calls to them are blocked. Editing, checking their number or saving this relationship does not remove the opt-out.</Notice> : null}
    {state.error ? <Notice tone="error">{state.error}</Notice> : null}
    <Button label="Save relationship" onPress={save} loading={busy} />
    {onDelete ? deleteConfirmed ? <><Notice tone="warning">Remove this relationship from your people list. Existing conversation records and separately scoped memories remain; remove those separately when needed. Deleting a relationship does not authorize a new call.</Notice><Button label="Confirm delete relationship" danger secondary onPress={() => { if (!busy) void model.remove(onDelete); }} loading={busy} /><Button label="Keep relationship" secondary disabled={busy} onPress={() => setDeleteConfirmed(false)} /></> : <Button label="Delete relationship" danger secondary onPress={() => setDeleteConfirmed(true)} disabled={busy} /> : null}
  </>;
}
