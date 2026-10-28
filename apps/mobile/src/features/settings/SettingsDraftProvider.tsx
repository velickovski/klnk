import React, { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import type { Profile } from '@personal-agent/domain';
import { Platform } from 'react-native';
import { SettingsDraftStore } from './draft';

const Context = createContext<SettingsDraftStore | null>(null);

/** Mount under the identity-keyed shell, never above authentication/origin changes. */
export function SettingsDraftProvider({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const store = useRef<SettingsDraftStore | null>(null);
  if (!store.current) store.current = new SettingsDraftStore(profile);
  const state = useSyncExternalStore(store.current.subscribe, store.current.getSnapshot, store.current.getSnapshot);
  useEffect(() => { store.current?.reconcile(profile); }, [profile]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !state.dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [state.dirty]);
  return <Context.Provider value={store.current}>{children}</Context.Provider>;
}

export function useSettingsDraft(profile: Profile) {
  const supplied = useContext(Context);
  const fallback = useRef<SettingsDraftStore | null>(null);
  if (!fallback.current) fallback.current = new SettingsDraftStore(profile);
  const store = supplied ?? fallback.current;
  useEffect(() => { if (!supplied) store.reconcile(profile); }, [profile, store, supplied]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { store, state };
}
