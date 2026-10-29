import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AppState, Platform } from 'react-native';
import { api } from '../../api';
import { NetworkDataClient, NetworkDraftStore, type QuerySnapshot } from './data-client';
import { DeviceRemindersProvider } from './device-reminders';

type SessionData = { client: NetworkDataClient; drafts: NetworkDraftStore };
const Context = createContext<SessionData | null>(null);
const disabled: QuerySnapshot<never> = { loading: false, error: '' };

/** Mount above both voice home and workspace, keyed by the auth-session scope. */
export function NetworkSessionProvider({
  active = true,
  children,
}: {
  active?: boolean;
  children: React.ReactNode;
}) {
  const [session] = useState<SessionData>(() => ({
    client: new NetworkDataClient(api),
    drafts: new NetworkDraftStore(),
  }));
  const lifetime = useRef(0);
  useEffect(() => {
    let foreground = AppState.currentState !== 'background';
    const update = () =>
      session.client.setActive(
        active &&
          foreground &&
          (Platform.OS !== 'web' || typeof document === 'undefined' || !document.hidden),
      );
    const subscription = AppState.addEventListener('change', (state) => {
      foreground = state === 'active';
      update();
    });
    update();
    const refresh = () => {
      update();
      session.client.refresh();
    };
    const interval = setInterval(() => session.client.refresh(), 10_000);
    if (Platform.OS === 'web') {
      document.addEventListener('visibilitychange', refresh);
      window.addEventListener('online', refresh);
    }
    return () => {
      clearInterval(interval);
      subscription.remove();
      if (Platform.OS === 'web') {
        document.removeEventListener('visibilitychange', refresh);
        window.removeEventListener('online', refresh);
      }
    };
  }, [active, session]);
  useEffect(() => {
    const ticket = ++lifetime.current;
    return () => {
      queueMicrotask(() => {
        // Strict Mode replays setup immediately. Clear only a departed auth
        // scope, rather than destroying the provider reused by that replay.
        if (lifetime.current === ticket) {
          session.client.dispose();
          session.drafts.clear();
        }
      });
    };
  }, [session]);
  return (
    <Context.Provider value={session}>
      <DeviceRemindersProvider client={session.client}>{children}</DeviceRemindersProvider>
    </Context.Provider>
  );
}
function useSessionData() {
  const value = useContext(Context);
  if (!value) throw new Error('NetworkSessionProvider must wrap the signed-in workspace.');
  return value;
}
export function useNetworkClient() {
  return useSessionData().client;
}
export function useNetworkQuery<T>(path?: string) {
  const client = useNetworkClient();
  const subscribe = useCallback(
    (listener: () => void) => (path ? client.subscribe(path, listener) : () => undefined),
    [client, path],
  );
  const snapshot = useCallback(
    () => (path ? client.snapshot<T>(path) : (disabled as QuerySnapshot<T>)),
    [client, path],
  );
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const refetch = useCallback(
    () => (path ? client.read<T>(path, true) : Promise.resolve(undefined)),
    [client, path],
  );
  return { ...state, refetch };
}
export function useSessionState<T>(
  key: string,
  initial: T | (() => T),
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const { drafts } = useSessionData();
  drafts.ensure(key, () => (typeof initial === 'function' ? (initial as () => T)() : initial));
  const subscribe = useCallback(
    (listener: () => void) => drafts.subscribe(key, listener),
    [drafts, key],
  );
  const read = useCallback(() => drafts.get<T>(key), [drafts, key]);
  const value = useSyncExternalStore(subscribe, read, read);
  const setValue = useCallback(
    (next: React.SetStateAction<T>) => drafts.set(key, next),
    [drafts, key],
  );
  return [value, setValue];
}
export function useSessionRef<T>(key: string, initial: () => T): React.MutableRefObject<T> {
  return useSessionData().drafts.ensure(key, () => ({ current: initial() }));
}
