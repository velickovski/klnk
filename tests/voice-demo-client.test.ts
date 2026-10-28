import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

// Execute the shipped browser script with controlled browser boundaries. These
// tests never access a microphone, open a socket, or contact a provider.
const source = readFileSync(new URL('../apps/voice-demo/app.js', import.meta.url), 'utf8');
type Listener = (event?: any) => void;
class FakeElement {
  hidden = false; disabled = false; focused = false; textContent = ''; innerHTML = '';
  dataset: Record<string, string> = {}; attrs: Record<string, string> = {};
  handlers: Record<string, Listener[]> = {}; children: FakeElement[] = [];
  srcObject: unknown = null; plays = 0; style = { setProperty() {} };
  playError = false;
  addEventListener(name: string, listener: Listener) { (this.handlers[name] ??= []).push(listener); }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  getAttribute(name: string) { return this.attrs[name]; }
  append(...items: FakeElement[]) { this.children.push(...items); }
  replaceChildren(...items: FakeElement[]) { this.children = items; }
  focus() { this.focused = true; }
  pause() {}
  async play() { this.plays++; if (this.playError) throw new Error('Playback blocked'); }
  click() { for (const listener of this.handlers.click ?? []) listener(); }
}
class FakeTrack {
  enabled = true; readyState = 'live'; handlers: Record<string, Listener> = {};
  stop() { this.readyState = 'ended'; }
  addEventListener(name: string, listener: Listener) { this.handlers[name] = listener; }
  loseDevice() { this.readyState = 'ended'; this.handlers.ended?.(); }
}
type FakeStream = { getTracks: () => FakeTrack[]; getAudioTracks: () => FakeTrack[] };
class FakeChannel {
  readyState = 'open'; handlers: Record<string, Listener> = {}; sent: any[] = [];
  addEventListener(name: string, listener: Listener) { this.handlers[name] = listener; }
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 'closed'; }
  receive(value: unknown) { this.handlers.message?.({ data: JSON.stringify(value) }); }
  loseConnection() { this.readyState = 'closed'; this.handlers.close?.(); }
}
function harness(options: {
  configured?: unknown;
  media?: (make: () => FakeStream) => Promise<FakeStream>;
  sessionError?: boolean;
  sessionResponse?: () => Promise<unknown>;
  closeStatus?: 'closing' | 'closed';
  closeResponse?: () => Promise<unknown>;
  ownedStatus?: { sessionId: string; status: string };
  statusResponse?: () => Promise<unknown>;
  authResponse?: unknown;
  playbackBlocked?: boolean;
  requestReceipt?: (requestId:string) => unknown;
} = {}) {
  const elements = new Map<string, FakeElement>();
  const calls: string[] = []; const tracks: FakeTrack[] = []; const channels: FakeChannel[] = [];
  const peers: FakePeer[] = []; const windowHandlers: Record<string, Listener> = {};
  const timers = new Map<number, { callback: Listener; milliseconds: number }>();
  let nextTimer = 0;
  const makeStream = () => {
    const track = new FakeTrack(); tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  };
  class FakePeer {
    iceGatheringState = 'complete'; connectionState = 'new';
    localDescription?: { type: string; sdp: string }; handlers: Record<string, Listener> = {};
    constructor() { peers.push(this); }
    addEventListener(name: string, listener: Listener) { this.handlers[name] = listener; }
    removeEventListener() {} addTrack() {}
    createDataChannel() { const channel = new FakeChannel(); channels.push(channel); return channel; }
    async createOffer() { return { type: 'offer', sdp: 'v=0\nm=audio 1' }; }
    async setLocalDescription(value: { type: string; sdp: string }) { this.localDescription = value; }
    async setRemoteDescription() {}
    close() { this.connectionState = 'closed'; }
  }
  const element = (id: string) => {
    if (!elements.has(id)) {
      const item = new FakeElement(); item.playError = id === 'remote-audio' && !!options.playbackBlocked;
      elements.set(id, item);
    }
    return elements.get(id)!;
  };
  const context = createContext({
    console, crypto: webcrypto, DOMException, AbortController, AbortSignal, Date, JSON, Number, String, Math,
    RTCPeerConnection: FakePeer, MediaStream: class {},
    document: { getElementById: element, createElement: () => new FakeElement() },
    window: {
      isSecureContext: true, RTCPeerConnection: FakePeer, matchMedia: () => ({ matches: true }),
      addEventListener: (name: string, listener: Listener) => { windowHandlers[name] = listener; },
    },
    navigator: { mediaDevices: { getUserMedia: async () => {
      calls.push('microphone');
      return options.media ? options.media(makeStream) : makeStream();
    } } },
    fetch: async (url: string) => {
      calls.push(url);
      const body = url === '/demo/status' ? options.statusResponse ? await options.statusResponse() : { configured: options.configured ?? true }
        : url === '/auth/demo' ? options.authResponse ?? { token: 'test-token' }
        : url.startsWith('/voice/live/requests/') ? options.requestReceipt?.(url.split('/').at(-1)!) ?? {status:'unconfirmed'}
        : url.endsWith('/close') ? options.closeResponse ? await options.closeResponse() : { status: options.closeStatus ?? 'closed' }
        : url.startsWith('/voice/live/session/') ? options.ownedStatus ?? { sessionId: 'mock/session', status: 'closing' }
        : options.sessionResponse ? await options.sessionResponse()
        : { session: { id: 'mock/session' }, transport: { type: 'webrtc', sdp: 'answer' }, maxDurationSeconds: 300 };
      return {
        ok: !(options.sessionError && url === '/voice/live/session'), status: 503,
        json: async () => options.sessionError && url === '/voice/live/session' ? { message: 'Unavailable' } : body,
      };
    },
    setTimeout: (callback: Listener, milliseconds: number) => {
      const id = ++nextTimer; timers.set(id, { callback, milliseconds }); return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
    setInterval: () => ++nextTimer, clearInterval() {}, requestAnimationFrame: () => ++nextTimer, cancelAnimationFrame() {},
  });
  runInContext(source, context);
  return {
    calls, tracks, channels, peers, element, windowHandlers,
    run: (code: string): any => runInContext(code, context),
    expire: (milliseconds: number) => {
      for (const [id, timer] of [...timers]) if (timer.milliseconds === milliseconds) {
        timers.delete(id); timer.callback();
      }
    },
    timerCallbacks: (milliseconds: number) => [...timers.values()].filter(timer => timer.milliseconds === milliseconds).map(timer => timer.callback),
  };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function connected(options: Parameters<typeof harness>[0] = {}) {
  const h = harness(options); await tick(); await h.run('startCall()');
  h.channels[0].receive({ type: 'session.started' });
  return h;
}

describe('voice demo browser lifecycle', () => {
  it('loads only readiness, and never acquires media or starts a session without the call gesture', async () => {
    const h = harness({ configured: false }); await tick();
    expect(h.calls).toEqual(['/demo/status']);
    expect(h.element('call-button').disabled).toBe(true);
    await h.run('startCall()');
    expect(h.calls).toEqual(['/demo/status']);
    expect(h.run('phase')).toBe('setup');
  });

  it('waits for the provider start event and moves keyboard focus to the connecting cancel control', async () => {
    const h = harness(); await tick(); await h.run('startCall()');
    expect(h.run('phase')).toBe('connecting');
    expect(h.element('end-button').focused).toBe(true);
    expect(h.channels[0].sent).toEqual([]);
    h.channels[0].receive({ type: 'session.started' });
    expect(h.run('phase')).toBe('connected');
  });

  it('preserves caption deltas exactly and stops capture while awaiting the provider mute acknowledgment', async () => {
    const h = await connected();
    h.channels[0].receive({ type: 'session.output_transcript.delta', delta: 'Hello ' });
    h.channels[0].receive({ type: 'session.output_transcript.delta', delta: 'there.' });
    expect(h.element('caption-text').textContent).toBe('Hello there.');
    h.element('mute-button').click();
    expect(h.tracks[0].enabled).toBe(false);
    expect(h.element('mute-button').getAttribute('aria-pressed')).toBe('true');
    expect(h.element('mute-button').disabled).toBe(true);
    expect(h.channels[0].sent.at(-1).type).toBe('session.input_audio.mute');
    await h.run('endSession()');
  });

  it('stops capture immediately and confirms closure using the owned session fallback', async () => {
    const h = await connected(); await h.run('endSession()');
    expect(h.tracks[0].readyState).toBe('ended');
    expect(h.channels[0].sent).toContainEqual({ type: 'session.close' });
    expect(h.calls).toContain('/voice/live/session/mock%2Fsession/close');
    expect(h.run('phase')).toBe('ended');
    expect(h.element('connection-label').textContent).toBe('Conversation ended');
  });

  it('does not call an unconfirmed server close a confirmed end', async () => {
    const h = await connected({ closeStatus: 'closing' }); await h.run('endSession()');
    expect(h.run('phase')).toBe('closing');
    h.expire(8000);
    expect(h.tracks[0].readyState).toBe('ended');
    expect(h.element('connection-label').textContent).toBe('Disconnected on this device');
    expect(h.element('message').textContent).toContain('did not confirm');
    expect(h.element('call-button').disabled).toBe(true);
    expect(h.element('retry-close').hidden).toBe(false);
    expect(h.element('retry-close').focused).toBe(true);
  });

  it('offers the separate text workspace after permission denial without creating a paid session', async () => {
    const h = harness({ media: async () => { throw new DOMException('Denied', 'NotAllowedError'); } });
    await tick(); await h.run('startCall()');
    expect(h.run('phase')).toBe('error');
    expect(h.element('text-workspace').hidden).toBe(false);
    expect(h.calls).not.toContain('/auth/demo');
    expect(h.calls).not.toContain('/voice/live/session');
  });

  it('discards a microphone stream that resolves after the user already cancelled', async () => {
    let finishMedia!: () => void;
    const h = harness({ media: make => new Promise(resolve => { finishMedia = () => resolve(make()); }) });
    await tick(); const starting = h.run('startCall()'); await h.run('endSession()');
    finishMedia(); await starting;
    expect(h.tracks[0].readyState).toBe('ended');
    expect(h.calls).not.toContain('/auth/demo');
  });

  it('closes a late session answer after cancellation and never resurrects the call', async () => {
    let answer!: (value: unknown) => void;
    const h = harness({ sessionResponse: () => new Promise(resolve => { answer = resolve; }) });
    await tick(); const starting = h.run('startCall()'); await tick();
    expect(h.calls).toContain('/voice/live/session');
    await h.run('endSession()');
    answer({ session: { id: 'late/session' }, transport: { type: 'webrtc', sdp: 'answer' } });
    await starting; await tick();
    expect(h.calls).toContain('/voice/live/session/late%2Fsession/close');
    expect(h.run('phase')).toBe('ended');
    expect(h.tracks[0].readyState).toBe('ended');
  });

  it('stops capture on a failed handshake and ignores late audio-track callbacks', async () => {
    const h = harness({ sessionError: true }); await tick(); await h.run('startCall()');
    expect(h.run('phase')).toBe('error');
    expect(h.tracks[0].readyState).toBe('ended');
    h.peers[0].handlers.track({ streams: [{}] });
    expect(h.element('remote-audio').srcObject).toBeNull();
    expect(h.element('remote-audio').plays).toBe(0);
    expect(h.element('message').textContent).toBe('Unavailable');
  });

  it('handles microphone loss during connecting before announcing a connected call', async () => {
    const h = harness(); await tick(); await h.run('startCall()');
    h.tracks[0].loseDevice(); await tick();
    h.channels[0].receive({ type: 'session.started' });
    expect(h.run('phase')).toBe('ended');
    expect(h.element('announcer').textContent).not.toContain('microphone is on');
  });

  it('restores a disconnected screen after browser back-forward cache navigation', async () => {
    const h = await connected(); h.windowHandlers.pagehide();
    expect(h.tracks[0].readyState).toBe('ended');
    h.windowHandlers.pageshow({ persisted: true }); await tick();
    expect(h.run('phase')).toBe('ended');
    expect(h.element('call-button').hidden).toBe(false);
    expect(h.element('call-controls').hidden).toBe(true);
    expect(h.element('connection-label').textContent).toBe('Disconnected on this device');
  });

  it('accepts only explicit configured readiness, not a truthy string', async () => {
    const h = harness({ configured: 'true' }); await tick(); await h.run('startCall()');
    expect(h.element('call-button').disabled).toBe(true);
    expect(h.calls).toEqual(['/demo/status']);
  });

  it('blocks capture when the broker cannot confirm an earlier session creation', async () => {
    const h = harness({ statusResponse: async () => ({ configured: true, startupUnconfirmed: true }) });
    await tick(); await h.run('startCall()');
    expect(h.element('call-button').disabled).toBe(true);
    expect(h.element('connection-label').textContent).toBe('Earlier session unresolved');
    expect(h.calls).toEqual(['/demo/status']);
  });

  it('refreshes readiness on returning to the window without acquiring the microphone', async () => {
    let ready = false;
    const h = harness({ statusResponse: async () => ({ configured: ready }) }); await tick();
    ready = true; h.windowHandlers.focus(); await tick();
    expect(h.element('call-button').disabled).toBe(false);
    expect(h.calls).toEqual(['/demo/status', '/demo/status']);
  });

  it('keeps the active controls when a background readiness check fails', async () => {
    let offline = false;
    const h = await connected({ statusResponse: async () => {
      if (offline) throw new Error('Offline');
      return { configured: true };
    } });
    offline = true; h.windowHandlers.online(); await tick();
    expect(h.run('phase')).toBe('connected');
    expect(h.element('end-button').disabled).toBe(false);
    expect(h.element('call-controls').hidden).toBe(false);
  });

  it('rejects an unusable authorization response before creating a provider session', async () => {
    const h = harness({ authResponse: { token: 123 } }); await tick(); await h.run('startCall()');
    expect(h.calls).not.toContain('/voice/live/session');
    expect(h.tracks[0].readyState).toBe('ended');
    expect(h.element('message').textContent).toContain('did not authorize');
  });

  it('cleans up an owned session even when its transport answer is malformed', async () => {
    const h = harness({ sessionResponse: async () => ({ session: { id: 'bad/answer' }, transport: {} }) });
    await tick(); await h.run('startCall()'); await tick();
    expect(h.calls).toContain('/voice/live/session/bad%2Fanswer/close');
    expect(h.tracks[0].readyState).toBe('ended');
    expect(h.run('phase')).toBe('ended');
  });

  it('handles a data-channel close during setup without leaving the microphone running', async () => {
    const h = harness(); await tick(); await h.run('startCall()');
    h.channels[0].loseConnection(); await tick();
    expect(h.tracks[0].readyState).toBe('ended');
    expect(h.run('phase')).toBe('ended');
    expect(h.element('message').textContent).toContain('closed unexpectedly');
  });

  it('retries closure of the same owned session before allowing another paid session', async () => {
    let status = 'closing';
    const h = await connected({ closeResponse: async () => ({ status }) });
    await h.run('endSession()'); h.expire(8000);
    await h.run('startCall()');
    expect(h.tracks).toHaveLength(1);
    status = 'closed'; h.element('retry-close').click(); await tick();
    expect(h.calls.filter(url => url.endsWith('/close'))).toHaveLength(2);
    expect(h.run('pendingClosure')).toBeNull();
    expect(h.element('retry-close').hidden).toBe(true);
    expect(h.element('call-button').disabled).toBe(false);
    expect(h.element('message').textContent).toContain('confirmed session closure');
  });

  it('confirms closure by owner-bound readback if the broker receives its event first', async () => {
    const h = await connected({ closeStatus: 'closing', ownedStatus: { sessionId: 'mock/session', status: 'closed' } });
    await h.run('endSession()');
    expect(h.calls).toContain('/voice/live/session/mock%2Fsession');
    expect(h.run('phase')).toBe('ended');
    expect(h.element('connection-label').textContent).toBe('Conversation ended');
  });

  it('never accepts closure readback identifying a different session', async () => {
    const h = await connected({ closeStatus: 'closing', ownedStatus: { sessionId: 'someone-else', status: 'closed' } });
    await h.run('endSession()'); h.expire(8000);
    expect(h.element('connection-label').textContent).toBe('Disconnected on this device');
    expect(h.run('pendingClosure.id')).toBe('mock/session');
  });

  it('ignores an old close response while a subsequent session is ending', async () => {
    const finishClose: Array<(result: unknown) => void> = [];
    const h = await connected({ closeResponse: () => new Promise(resolve => { finishClose.push(resolve); }) });
    const firstEnd = h.run('endSession()');
    h.channels[0].receive({ type: 'session.closed' });
    await h.run('startCall()'); h.channels[1].receive({ type: 'session.started' });
    const secondEnd = h.run('endSession()');
    finishClose[0]({ status: 'closed' }); await firstEnd;
    expect(h.run('phase')).toBe('closing');
    finishClose[1]({ status: 'closed' }); await secondEnd;
    expect(h.run('phase')).toBe('ended');
  });

  it('deduplicates disconnect timers and ignores a stale timeout after a new call starts', async () => {
    const h = await connected();
    h.peers[0].connectionState = 'disconnected'; h.peers[0].handlers.connectionstatechange();
    const stale = h.timerCallbacks(10000)[0];
    h.peers[0].handlers.connectionstatechange();
    expect(h.timerCallbacks(10000)).toHaveLength(1);
    await h.run('endSession()'); await h.run('startCall()');
    h.channels[1].receive({ type: 'session.started' }); stale();
    expect(h.run('phase')).toBe('connected');
    expect(h.tracks[1].readyState).toBe('live');
  });

  it('never reopens capture until the matching provider unmute acknowledgment arrives', async () => {
    const h = await connected(); h.element('mute-button').click();
    const mute = h.channels[0].sent.at(-1);
    h.channels[0].receive({ type: 'session.input_audio.muted', client_event_id: mute.event_id });
    expect(h.element('mute-button').disabled).toBe(false);
    h.element('mute-button').click(); const unmute = h.channels[0].sent.at(-1);
    expect(unmute.type).toBe('session.input_audio.unmute');
    h.channels[0].receive({ type: 'session.input_audio.unmuted', client_event_id: 'another-command' });
    expect(h.tracks[0].enabled).toBe(false);
    h.channels[0].receive({ type: 'session.input_audio.unmuted', client_event_id: unmute.event_id });
    expect(h.tracks[0].enabled).toBe(true);
    expect(h.element('mute-button').getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps capture off and explains an unanswered microphone command', async () => {
    const h = await connected(); h.element('mute-button').click(); h.expire(5000);
    expect(h.tracks[0].enabled).toBe(false);
    expect(h.element('mute-button').disabled).toBe(false);
    expect(h.element('message').textContent).toContain('did not confirm the microphone change');
  });

  it('retains overlapping speaker deltas and their service timing without inventing completed turns', async () => {
    const h = await connected();
    h.channels[0].receive({ type: 'session.output_transcript.delta', delta: 'Hello ', start_ms: 100, end_ms: 300 });
    h.channels[0].receive({ type: 'session.input_transcript.delta', delta: 'yes yes ', start_ms: 200, end_ms: 400 });
    h.channels[0].receive({ type: 'session.output_transcript.delta', delta: 'there.', start_ms: 300, end_ms: 600 });
    expect(h.run('transcriptEntries.length')).toBe(2);
    expect(h.run('transcriptEntries[0].value')).toBe('Hello there.');
    expect(h.run('transcriptEntries[1].value')).toBe('yes yes ');
    expect(h.run('transcriptEntries[0].fragments[1].endMs')).toBe(600);
    h.channels[0].receive({ type: 'session.output_transcript.delta', delta: 'Next.', start_ms: 3000, end_ms: 3400 });
    expect(h.run('transcriptEntries.length')).toBe(3);
  });

  it('shows a real playback-recovery control and ignores malformed channel messages', async () => {
    const h = await connected({ playbackBlocked: true });
    h.channels[0].receive(null); h.channels[0].receive([]);
    h.peers[0].handlers.track({ streams: [{}] }); await tick();
    expect(h.run('phase')).toBe('connected');
    expect(h.element('enable-audio').hidden).toBe(false);
    expect(h.element('announcer').textContent).toContain('browser paused the audio');
    h.element('remote-audio').playError = false;
    h.element('enable-audio').click(); await tick();
    expect(h.element('enable-audio').hidden).toBe(true);
  });

  it('keeps a cancelled in-flight creation uncertain and waits for its owned answer before retrying', async () => {
    let answer!: (value: unknown) => void;
    const h = harness({ sessionResponse: () => new Promise(resolve => { answer = resolve; }) });
    await tick(); const starting = h.run('startCall()'); await tick();
    await h.run('endSession()');
    expect(h.element('connection-label').textContent).toBe('Disconnected on this device');
    expect(h.element('call-button').disabled).toBe(true);
    await h.run('startCall()'); expect(h.tracks).toHaveLength(1);
    answer({ session: { id: 'late/owned' }, transport: { type: 'webrtc', sdp: 'answer' } });
    await starting; await tick();
    expect(h.calls).toContain('/voice/live/session/late%2Fowned/close');
    expect(h.element('call-button').disabled).toBe(false);
  });
  it('recovers a lost SDP response by its retained request UUID without a replacement paid start',async()=>{
    const h=harness({sessionResponse:async()=>{throw new TypeError('Lost fixture response');},requestReceipt:requestId=>({requestId,receiptId:'fixture-receipt',status:'active',sessionId:'recovered-fixture',expiresAt:Date.now()+300000})});
    await tick();await h.run('startCall()');const id=h.run('pendingClosure.requestId');expect(id).toMatch(/^[0-9a-f-]{36}$/);expect(h.element('call-button').disabled).toBe(true);
    await h.run('retryClosure()');expect(h.calls).toContain(`/voice/live/requests/${id}`);expect(h.calls).toContain('/voice/live/session/recovered-fixture/close');expect(h.calls.filter(url=>url==='/voice/live/session')).toHaveLength(1);expect(h.run('pendingClosure')).toBeNull();
  });
  it('keeps lost creation blocked if the receipt belongs to a different request identity',async()=>{
    const h=harness({sessionResponse:async()=>{throw new TypeError('Lost fixture response');},requestReceipt:()=>({requestId:'wrong',receiptId:'fixture-receipt',status:'closed',expiresAt:Date.now()})});
    await tick();await h.run('startCall()');await h.run('retryClosure()');await h.run('startCall()');expect(h.calls.filter(url=>url==='/voice/live/session')).toHaveLength(1);expect(h.element('call-button').disabled).toBe(true);
  });
});
