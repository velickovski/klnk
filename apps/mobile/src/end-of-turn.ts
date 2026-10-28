export type TurnMeter = { startedAtMs: number; lastSpeechAtMs?: number; lastSampleAtMs?: number };
export type TurnDecision = {
  state: TurnMeter;
  action: 'listen' | 'submit' | 'cancel_silence' | 'hold';
};
export const TURN_LIMITS = {
  speechThresholdDb: -45,
  quietAfterSpeechMs: 2000,
  initialSilenceMs: 8000,
  maximumMs: 30000,
} as const;

/** A bounded level-based pause detector, not a recognizer or proof that an utterance is complete. */
export function advanceTurnMeter(
  state: TurnMeter,
  atMs: number,
  levelDb?: number,
  manualSend = false,
): TurnDecision {
  if (
    !Number.isFinite(atMs) ||
    atMs < state.startedAtMs ||
    (state.lastSampleAtMs !== undefined && atMs < state.lastSampleAtMs)
  )
    return { state, action: 'listen' };
  const next = { ...state, lastSampleAtMs: atMs };
  if (atMs - state.startedAtMs >= TURN_LIMITS.maximumMs) return { state: next, action: 'hold' };
  if (manualSend) return { state: next, action: 'listen' };
  // Some devices do not expose metering. Do not mistake missing measurements for silence.
  if (levelDb === undefined || !Number.isFinite(levelDb)) return { state: next, action: 'listen' };
  if (levelDb >= TURN_LIMITS.speechThresholdDb)
    return { state: { ...next, lastSpeechAtMs: atMs }, action: 'listen' };
  if (
    next.lastSpeechAtMs !== undefined &&
    atMs - next.lastSpeechAtMs >= TURN_LIMITS.quietAfterSpeechMs
  )
    return { state: next, action: 'submit' };
  if (next.lastSpeechAtMs === undefined && atMs - next.startedAtMs >= TURN_LIMITS.initialSilenceMs)
    return { state: next, action: 'cancel_silence' };
  return { state: next, action: 'listen' };
}
