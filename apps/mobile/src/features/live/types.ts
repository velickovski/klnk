export type LivePhase =
  'idle' | 'checking' | 'connecting' | 'connected' | 'ending' | 'ended' | 'error';
export type LiveTurn = { id: string; speaker: string; text: string; endMs?: number };
export type LiveSnapshot = {
  state: LivePhase;
  configured: boolean | null;
  supported: boolean;
  statusText: string;
  error: string;
  closureUnconfirmed: boolean;
  muted: boolean;
  mutePending: boolean;
  captionsOpen: boolean;
  audioBlocked: boolean;
  durationWarning?: string;
  turns: LiveTurn[];
};
export type LiveConversation = LiveSnapshot & {
  start: () => Promise<void>;
  end: () => Promise<void>;
  toggleMute: () => void;
  toggleCaptions: () => void;
  enableAudio: () => Promise<void>;
};
export const nativeLiveSnapshot: LiveSnapshot = {
  state: 'idle',
  configured: null,
  supported: false,
  statusText: 'Native live voice needs a compatible transport.',
  error: '',
  closureUnconfirmed: false,
  muted: true,
  mutePending: false,
  captionsOpen: false,
  audioBlocked: false,
  turns: [],
};
/** GPT-Live deltas include significant whitespace and can overlap between speakers. */
export function appendLiveDelta(
  turns: LiveTurn[],
  speaker: string,
  delta: unknown,
  startMs?: number,
  endMs?: number,
): LiveTurn[] {
  if (typeof delta !== 'string' || !delta) return turns;
  const next = turns.map((turn) => ({ ...turn }));
  let index = -1;
  for (let i = next.length - 1; i >= 0; i--)
    if (next[i].speaker === speaker) {
      index = i;
      break;
    }
  const timed =
    Number.isFinite(startMs) && Number.isFinite(endMs) && startMs! >= 0 && endMs! >= startMs!;
  if (
    index < 0 ||
    (timed && next[index].endMs !== undefined && startMs! - next[index].endMs! >= 2000)
  ) {
    const sequence = Math.max(0, ...next.map((turn) => Number(turn.id) || 0)) + 1;
    next.push({
      id: `${sequence}`,
      speaker,
      text: delta.slice(-4000),
      ...(timed ? { endMs } : {}),
    });
  } else {
    next[index].text = (next[index].text + delta).slice(-4000);
    if (timed) next[index].endMs = endMs;
  }
  return next.slice(-40);
}
