import { describe, expect, it, vi } from 'vitest';
import type { Profile } from '@personal-agent/domain';
import { profileErrors, SettingsDraftStore } from '../src/features/settings/draft';
import { connectionPresentation } from '../src/features/settings/connections';

const profile: Profile = { id: 'fictional-owner-a', name: 'Alex Example', language: 'en', timezone: 'Europe/Skopje', tone: 'Clear', pronunciation: '', onboardingComplete: false };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(complete => { resolve = complete; }); return { promise, resolve }; }

describe('SETTINGS-01 owner profile draft', () => {
  it('survives panel unsubscribe/remount and an unchanged background refresh', () => {
    const store = new SettingsDraftStore(profile), firstPanel = vi.fn();
    const unmount = store.subscribe(firstPanel);
    store.update('name', 'Unsaved name'); unmount();
    store.reconcile({ ...profile });
    const remountedPanel = vi.fn(), unsubscribe = store.subscribe(remountedPanel);
    expect(store.getSnapshot().profile.name).toBe('Unsaved name');
    expect(store.getSnapshot().dirty).toBe(true);
    store.update('tone', 'Still here');
    expect(firstPanel).toHaveBeenCalledTimes(1); expect(remountedPanel).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
  it('merges clean refreshed fields and preserves conflicting dirty edits', () => {
    const store = new SettingsDraftStore(profile);
    store.update('name', 'Local name');
    store.reconcile({ ...profile, name: 'Server name', language: 'mk', timezone: 'America/New_York' });
    expect(store.getSnapshot().profile).toMatchObject({ name: 'Local name', language: 'mk', timezone: 'America/New_York' });
    store.discard();
    expect(store.getSnapshot().profile.name).toBe('Server name'); expect(store.getSnapshot().dirty).toBe(false);
  });
  it('normalizes name/timezone, completes optional setup and agrees with successful refetch', async () => {
    const store = new SettingsDraftStore(profile);
    store.update('name', ' Alex Fictional '); store.update('timezone', ' Europe/Skopje ');
    const submit = vi.fn(async (value: Profile) => { store.reconcile(value); return true; });
    expect(await store.save(submit, true)).toBe(true);
    expect(submit).toHaveBeenCalledWith({ ...profile, name: 'Alex Fictional', onboardingComplete: true });
    expect(store.getSnapshot()).toMatchObject({ dirty: false, saving: false, error: '', message: 'Preferences saved.' });
    expect(store.getSnapshot().profile).toMatchObject({ name: 'Alex Fictional', timezone: 'Europe/Skopje', onboardingComplete: true });
  });
  it('preserves changes typed while save and refetch are pending', async () => {
    const store = new SettingsDraftStore(profile), pending = deferred<boolean>();
    store.update('tone', 'Submitted tone');
    const saving = store.save(async submitted => { const accepted = await pending.promise; store.reconcile(submitted); return accepted; });
    store.update('tone', 'Newer local tone'); store.update('pronunciation', 'New notes');
    pending.resolve(true); expect(await saving).toBe(true);
    expect(store.getSnapshot().profile).toMatchObject({ tone: 'Newer local tone', pronunciation: 'New notes' });
    expect(store.getSnapshot().dirty).toBe(true);
    store.discard(); expect(store.getSnapshot().profile.tone).toBe('Submitted tone');
  });
  it('uses accepted refetch values as the saved baseline without making clean fields dirty', async () => {
    const store = new SettingsDraftStore(profile);
    store.update('name', 'Updated name');
    await store.save(async submitted => { store.reconcile({ ...submitted, tone: 'Authoritative refreshed tone' }); return true; });
    expect(store.getSnapshot().profile.tone).toBe('Authoritative refreshed tone');
    expect(store.getSnapshot().dirty).toBe(false);
    store.update('timezone', 'America/New_York'); store.discard();
    expect(store.getSnapshot().profile.tone).toBe('Authoritative refreshed tone');
  });
  it.each([false, 'throw'] as const)('preserves drafts when save fails (%s)', async result => {
    const store = new SettingsDraftStore(profile); store.update('name', 'Keep this draft');
    expect(await store.save(async () => { if (result === 'throw') throw new Error('Offline. Try again.'); return false; })).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ dirty: true, saving: false, message: '' });
    expect(store.getSnapshot().error).not.toBe(''); expect(store.getSnapshot().profile.name).toBe('Keep this draft');
  });
  it('rejects empty names and invalid/empty timezones without submitting', async () => {
    const store = new SettingsDraftStore(profile), submit = vi.fn();
    store.update('name', '  '); store.update('timezone', 'Not/A_Timezone');
    expect(await store.save(submit)).toBe(false); expect(submit).not.toHaveBeenCalled();
    expect(store.getSnapshot().errors.name).toBeTruthy(); expect(store.getSnapshot().errors.timezone).toBeTruthy();
    expect(profileErrors({ ...profile, timezone: ' ' }).timezone).toBeTruthy();
    store.update('name', 'Valid'); expect(store.getSnapshot().errors.name).toBeUndefined();
    expect(store.getSnapshot().errors.timezone).toBeTruthy();
  });
  it('does not duplicate a pending save or discard its in-flight values', async () => {
    const store = new SettingsDraftStore(profile), pending = deferred<boolean>(), submit = vi.fn(() => pending.promise);
    store.update('name', 'Pending name');
    const save = store.save(submit); store.discard();
    expect(await store.save(submit)).toBe(false); expect(submit).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().profile.name).toBe('Pending name'); pending.resolve(true); await save;
    expect(store.getSnapshot().dirty).toBe(false);
  });
  it('resets drafts and ignores an old save result after owner replacement', async () => {
    const store = new SettingsDraftStore(profile), pending = deferred<boolean>(); store.update('name', 'Owner A draft');
    const saving = store.save(() => pending.promise);
    const other = { ...profile, id: 'fictional-owner-b', name: 'Blair Example' };
    store.reconcile(other); pending.resolve(true);
    expect(await saving).toBe(false); expect(store.getSnapshot()).toMatchObject({ profile: other, dirty: false, saving: false, message: '' });
  });
  it('new owner/backend provider lifetimes do not reuse the previous memory store', () => {
    const oldScope = new SettingsDraftStore(profile); oldScope.update('name', 'Old backend draft');
    const newScope = new SettingsDraftStore(profile);
    expect(newScope.getSnapshot().profile.name).toBe(profile.name); expect(newScope.getSnapshot().dirty).toBe(false);
  });
});

describe('SETTINGS-03 server connection state presentation', () => {
  it.each(['disconnected', 'connecting', 'denied', 'connected', 'expired', 'insufficient_scope', 'revoked', 'unavailable'])('distinguishes explicit %s state', status => {
    const presentation = connectionPresentation(status);
    expect(presentation.label).not.toBe('Connection status unknown');
    expect(presentation.tone === 'green').toBe(status === 'connected');
  });
  it.each([undefined, '', 'authorized', 'server_token', 'invented'])('does not invent authorization for %s', status => {
    expect(connectionPresentation(status)).toMatchObject({ label: 'Connection status unknown', tone: 'amber' });
  });
  it('does not turn a calendar adapter or manual contacts into an OAuth connection', () => {
    expect(connectionPresentation('demo_or_server_token').label).toBe('OAuth setup unavailable');
    expect(connectionPresentation('manual_entry').label).toBe('Manual entry');
  });
});
