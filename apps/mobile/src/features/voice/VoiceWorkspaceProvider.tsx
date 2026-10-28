import React, { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { api } from '../../api';
import { VoiceWorkspaceController } from './controller';
const Context = createContext<VoiceWorkspaceController | null>(null);
export function VoiceWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const controller = useRef<VoiceWorkspaceController | null>(null);
  if (!controller.current) controller.current = new VoiceWorkspaceController(api);
  useEffect(() => () => controller.current?.reset(), []);
  return <Context.Provider value={controller.current}>{children}</Context.Provider>;
}
export function useVoiceWorkspace() {
  const supplied = useContext(Context),
    fallback = useRef<VoiceWorkspaceController | null>(null);
  if (!fallback.current) fallback.current = new VoiceWorkspaceController(api);
  const controller = supplied ?? fallback.current;
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return { controller, state };
}
