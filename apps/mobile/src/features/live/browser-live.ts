import { appendLiveDelta, type LiveSnapshot } from './types';
import {
  invalidLiveResponse,
  liveAnswer,
  liveClosure,
  liveJson,
  liveReadiness,
  liveReceipt,
  liveRecovery,
  liveRequestId,
  liveSessionId,
  objectValue,
} from './payloads';

type OwnedSession = { id: string; address: string; authorization: string };
export type LiveIdentity = Readonly<{ generation: number; url: string; token: string | null }>;
export type LiveEnvironment = {
  supported: boolean;
  request: <T = any>(path: string, method?: string, body?: unknown) => Promise<T>;
  connection: () => { address: string; authorization?: string };
  identity: () => LiveIdentity;
  saveToken: (token: string) => Promise<void>;
  fetcher: typeof fetch;
  capture: () => Promise<MediaStream>;
  peer: () => RTCPeerConnection;
  audio: () => HTMLAudioElement;
};
const initial = (supported: boolean): LiveSnapshot => ({
  state: 'idle',
  configured: null,
  supported,
  statusText: supported ? 'Ready when you are' : 'Live voice is unavailable in this browser.',
  error: '',
  closureUnconfirmed: false,
  muted: false,
  mutePending: false,
  captionsOpen: false,
  audioBlocked: false,
  turns: [],
});
export class BrowserLiveController {
  private value: LiveSnapshot;
  private listeners = new Set<() => void>();
  private generation = 0;
  private readiness = 0;
  private recovery = 0;
  private stream: MediaStream | null = null;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private audio: HTMLAudioElement | null = null;
  private owned: OwnedSession | null = null;
  private creationPending = false;
  private creationAttempted = false;
  private ending: Promise<void> | null = null;
  private creationReference: {
    requestId: string;
    receiptId?: string;
    address: string;
    authorization: string;
  } | null = null;
  private warningTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private durationTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private muteTimer: ReturnType<typeof setTimeout> | null = null;
  private command: { id: string; muted: boolean } | null = null;
  private commandSequence = 0;
  private iceCancel: (() => void) | null = null;
  private identity: LiveIdentity;
  private selfAuthorization: { source: LiveIdentity; token: string } | null = null;
  constructor(private env: LiveEnvironment) {
    this.value = initial(env.supported);
    this.identity = env.identity();
  }
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<LiveSnapshot>) {
    this.value = { ...this.value, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  identityChanged = () => {
    const next = this.env.identity(),
      previous = this.identity;
    if (
      next.generation === previous.generation &&
      next.url === previous.url &&
      next.token === previous.token
    )
      return;
    const own = this.selfAuthorization;
    if (
      own &&
      next.generation === own.source.generation + 1 &&
      next.url === own.source.url &&
      (next.token === null || next.token === own.token)
    ) {
      this.identity = next;
      return;
    }
    this.selfAuthorization = null;
    this.identity = next;
    this.generation++;
    this.readiness++;
    this.recovery++;
    const cleanupRequired =
      !!this.owned ||
      this.creationPending ||
      this.creationAttempted ||
      this.value.closureUnconfirmed;
    this.stopMedia();
    this.update({
      turns: [],
      captionsOpen: false,
      muted: true,
      mutePending: false,
      audioBlocked: false,
      configured: null,
      error: '',
    });
    if (cleanupRequired) {
      void this.end().finally(() => {
        if (this.env.identity().token && this.sameIdentity()) void this.refresh();
      });
    } else {
      this.cleanup();
      this.update({ ...initial(this.env.supported), muted: true });
    }
  };
  private sameIdentity() {
    const next = this.env.identity();
    return (
      next.generation === this.identity.generation &&
      next.url === this.identity.url &&
      next.token === this.identity.token
    );
  }
  async refresh() {
    const revision = ++this.readiness,
      identity = this.env.identity();
    try {
      const result = liveReadiness(await this.env.request('/demo/status'));
      if (
        revision !== this.readiness ||
        identity.generation !== this.env.identity().generation ||
        !this.sameIdentity()
      )
        return;
      this.update({
        configured: result.configured,
        ...(result.startupUnconfirmed
          ? {
              closureUnconfirmed: true,
              error:
                'An earlier live start is unconfirmed. Another session is blocked by the server.',
            }
          : {}),
      });
      if (identity.token) await this.recover();
    } catch {
      if (revision === this.readiness && this.sameIdentity()) this.update({ configured: false });
    }
  }
  private async recover(allowConnecting = false): Promise<boolean> {
    const identity = this.env.identity(),
      generation = this.generation;
    if (!identity.token) return true;
    if (
      this.creationPending ||
      ['connected', 'ending'].includes(this.value.state) ||
      (['checking', 'connecting'].includes(this.value.state) && !allowConnecting)
    )
      return !this.value.closureUnconfirmed;
    const revision = ++this.recovery;
    const requests = liveRecovery(await this.env.request('/voice/live/recovery'));
    const current = () =>
      revision === this.recovery &&
      generation === this.generation &&
      this.sameIdentity() &&
      identity.generation === this.env.identity().generation;
    if (!current()) return false;
    const previous = this.creationReference ?? this.owned,
      previousId = this.creationReference?.requestId,
      pending = requests.find((receipt) => !['closed', 'rejected'].includes(receipt.status));
    const sameSaved =
      pending &&
      (pending.receiptId === this.creationReference?.receiptId ||
        (pending.sessionId !== undefined && pending.sessionId === this.owned?.id) ||
        (pending.requestId === previousId &&
          previous?.authorization === `Bearer ${identity.token}`));
    if (previous && (!sameSaved || previous.address !== identity.url)) {
      const originalActor =
        previous.authorization === `Bearer ${identity.token}` ||
        !!this.owned ||
        !!this.creationReference?.receiptId;
      if (previous.address === identity.url && originalActor) {
        try {
          const result = await this.env.request(
            this.owned
              ? `/voice/live/session/${encodeURIComponent(this.owned.id)}`
              : `/voice/live/requests/${encodeURIComponent(previousId!)}`,
          );
          if (!current()) return false;
          const receipt = this.owned ? undefined : liveReceipt(result, previousId!);
          const confirmed = this.owned
            ? liveClosure(result, this.owned.id)
            : !!receipt &&
              ['closed', 'rejected'].includes(receipt.status) &&
              (!this.creationReference?.receiptId ||
                receipt.receiptId === this.creationReference.receiptId);
          if (confirmed) {
            this.finishClosed();
            return !pending;
          }
        } catch {}
      }
      return false;
    }
    if (!pending) return !this.value.closureUnconfirmed;
    this.creationReference = {
      requestId: pending.requestId,
      receiptId: pending.receiptId,
      address: identity.url,
      authorization: `Bearer ${identity.token}`,
    };
    this.creationAttempted = true;
    this.owned = pending.sessionId
      ? { id: pending.sessionId, address: identity.url, authorization: `Bearer ${identity.token}` }
      : null;
    this.generation++;
    this.update({
      state: 'ended',
      closureUnconfirmed: true,
      muted: true,
      mutePending: false,
      captionsOpen: false,
      audioBlocked: false,
      turns: [],
      statusText: 'Saved voice session needs attention',
      error: pending.sessionId
        ? 'A saved voice session still needs confirmed closure. End that same session before calling again.'
        : 'A saved voice start has no confirmed provider identity. It remains blocked until the service can reconcile that request.',
    });
    this.cleanup();
    return false;
  }
  private current(generation: number) {
    if (!this.sameIdentity()) this.identityChanged();
    return generation === this.generation && this.value.state === 'connecting';
  }
  async start() {
    if (!this.sameIdentity()) this.identityChanged();
    if (
      ['checking', 'connecting', 'connected', 'ending'].includes(this.value.state) ||
      this.value.closureUnconfirmed ||
      this.creationPending
    )
      return;
    if (!this.env.supported) {
      this.update({
        state: 'error',
        error: 'Use a current browser on localhost or HTTPS with microphone and WebRTC support.',
      });
      return;
    }
    const generation = ++this.generation;
    this.creationAttempted = false;
    this.update({
      state: 'checking',
      error: '',
      durationWarning: '',
      muted: false,
      mutePending: false,
      audioBlocked: false,
      turns: [],
      statusText: 'Checking live voice…',
    });
    try {
      const readiness = liveReadiness(await this.env.request('/demo/status'));
      if (!this.sameIdentity()) this.identityChanged();
      if (generation !== this.generation || this.value.state !== 'checking') return;
      this.update({ configured: readiness.configured === true });
      if (readiness.startupUnconfirmed) {
        this.update({ closureUnconfirmed: true });
        throw new Error(
          'An earlier live start is unconfirmed. Another session is blocked by the server.',
        );
      }
      if (!readiness.configured)
        throw new Error('Live voice is not configured on the server. Your microphone is off.');
      if (!(await this.recover(true))) return;
      if (generation !== this.generation || !this.sameIdentity()) return;
      this.update({ state: 'connecting', statusText: 'Allow your microphone to connect.' });
      const captured = await this.env.capture();
      if (!this.current(generation)) {
        captured.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = captured;
      this.connectionTimer = setTimeout(() => {
        if (this.current(generation)) {
          this.update({ error: 'The live connection took too long. Your microphone is off.' });
          void this.end();
        }
      }, 50000);
      captured.getAudioTracks().forEach((track) =>
        track.addEventListener('ended', () => {
          if (
            generation === this.generation &&
            ['connecting', 'connected'].includes(this.value.state)
          ) {
            this.update({ error: 'The microphone became unavailable.' });
            void this.end();
          }
        }),
      );
      const peer = this.env.peer();
      this.peer = peer;
      captured.getTracks().forEach((track) => peer.addTrack(track, captured));
      peer.addEventListener('track', (event) => {
        if (
          generation !== this.generation ||
          !['connecting', 'connected'].includes(this.value.state)
        )
          return;
        this.audio ??= this.env.audio();
        this.audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void this.enableAudio();
      });
      peer.addEventListener('connectionstatechange', () => {
        if (
          generation !== this.generation ||
          !['connecting', 'connected'].includes(this.value.state)
        )
          return;
        if (peer.connectionState === 'failed') {
          this.update({ error: 'The live connection was lost.' });
          void this.end();
        } else if (peer.connectionState === 'disconnected') {
          this.update({ statusText: 'Connection interrupted' });
          if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
          this.disconnectTimer = setTimeout(() => {
            if (generation === this.generation && peer.connectionState === 'disconnected')
              void this.end();
          }, 10000);
        } else if (peer.connectionState === 'connected') {
          if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
        }
      });
      const channel = peer.createDataChannel('oai-events');
      this.channel = channel;
      channel.addEventListener('message', (event) => this.receive(event.data, generation));
      channel.addEventListener('close', () => {
        if (
          generation === this.generation &&
          ['connecting', 'connected'].includes(this.value.state)
        ) {
          this.update({ error: 'The voice channel closed unexpectedly.' });
          void this.end();
        }
      });
      await peer.setLocalDescription(await peer.createOffer());
      await this.waitForIce(peer, generation);
      if (!this.current(generation)) return;
      let connection = this.env.connection();
      if (!connection.authorization) {
        const auth = objectValue(await this.env.request('/auth/demo', 'POST', {}));
        if (!this.current(generation)) return;
        if (typeof auth?.token !== 'string' || !/^\S{1,4096}$/.test(auth.token))
          throw invalidLiveResponse();
        const own = { source: this.env.identity(), token: auth.token };
        this.selfAuthorization = own;
        try {
          await this.env.saveToken(auth.token);
          const next = this.env.identity();
          if (
            next.generation !== own.source.generation + 1 ||
            next.url !== own.source.url ||
            next.token !== own.token
          ) {
            this.identityChanged();
            throw new Error('The account changed before voice could connect.');
          }
          this.identity = next;
        } finally {
          if (this.selfAuthorization === own) this.selfAuthorization = null;
        }
        connection = this.env.connection();
        if (!(await this.recover(true))) return;
      }
      if (!this.current(generation)) return;
      if (!connection.authorization)
        throw new Error('The live connection requires owner authorization.');
      const ownedConnection = {
        address: connection.address,
        authorization: connection.authorization,
      };
      const requestId = liveRequestId();
      this.creationReference = { ...ownedConnection, requestId };
      this.creationPending = true;
      // Do not discard a late provider ID when the owner ends during this request.
      const creation = this.env.fetcher(`${ownedConnection.address}/voice/live/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: ownedConnection.authorization,
        },
        body: JSON.stringify({ requestId, sdp: peer.localDescription?.sdp }),
        redirect: 'error',
        signal: AbortSignal.timeout(45000),
      });
      // A synchronous browser invocation failure never dispatched a request.
      // Once fetch returns, a rejected promise can mean the response was lost.
      this.creationAttempted = true;
      const result = await liveJson(await creation),
        id = liveSessionId(result);
      if (id) this.owned = { ...ownedConnection, id };
      this.creationPending = false;
      if (!this.current(generation)) {
        if (this.owned) await this.closeOwned(this.owned);
        return;
      }
      const answer = liveAnswer(result);
      await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
      if (!this.current(generation)) return;
      const limit = answer.maxDurationSeconds;
      this.warningTimer = setTimeout(
        () => {
          if (
            generation === this.generation &&
            ['connecting', 'connected'].includes(this.value.state)
          )
            this.update({
              durationWarning:
                'This conversation ends in one minute. Finish your thought or end when ready.',
            });
        },
        Math.max(0, limit - 60) * 1000,
      );
      this.durationTimer = setTimeout(() => {
        if (
          generation === this.generation &&
          ['connecting', 'connected'].includes(this.value.state)
        ) {
          this.update({ error: 'The bounded live session has reached its time limit.' });
          void this.end();
        }
      }, limit * 1000);
    } catch (error) {
      this.creationPending = false;
      if (generation !== this.generation) return;
      const failure = error as { name?: string; message?: string; status?: number; code?: string };
      if (failure.code === 'voice_session_unresolved' && !this.owned) {
        this.creationAttempted = false;
        this.creationReference = null;
        try {
          if (!(await this.recover(true))) {
            this.cleanup();
            return;
          }
        } catch {}
      }
      if (
        !this.owned &&
        ((failure.status !== undefined &&
          failure.status >= 400 &&
          failure.status < 500 &&
          ![
            'voice_start_unconfirmed',
            'voice_request_exists',
            'voice_session_unresolved',
            'voice_controller_lost',
          ].includes(failure.code ?? '')) ||
          ['openai_not_configured', 'openai_session_failed'].includes(failure.code ?? ''))
      ) {
        this.creationAttempted = false;
        this.creationReference = null;
      }
      if (!this.owned && !this.creationAttempted) this.creationReference = null;
      const message =
        failure.name === 'NotAllowedError'
          ? 'Microphone access is off. Allow it in browser site settings, then try again.'
          : (failure.message ?? 'Live voice could not connect.');
      this.update({ error: message });
      if (this.owned) {
        await this.end();
      } else {
        this.update({
          state: 'error',
          statusText: 'Microphone off',
          closureUnconfirmed: this.creationAttempted || this.value.closureUnconfirmed,
        });
        this.cleanup();
      }
    }
  }
  private waitForIce(peer: RTCPeerConnection, generation: number) {
    if (peer.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => finish(new Error('The browser could not prepare the voice connection.')),
        10000,
      );
      const change = () => {
        if (!this.current(generation)) finish(new Error('Connection cancelled.'));
        else if (peer.iceGatheringState === 'complete') finish();
      };
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        this.iceCancel = null;
        peer.removeEventListener('icegatheringstatechange', change);
        error ? reject(error) : resolve();
      };
      this.iceCancel = () => finish(new Error('Connection cancelled.'));
      peer.addEventListener('icegatheringstatechange', change);
    });
  }
  private receive(data: unknown, generation: number) {
    if (!this.sameIdentity()) this.identityChanged();
    if (generation !== this.generation) return;
    let event: any;
    try {
      event = JSON.parse(String(data));
    } catch {
      return;
    }
    if (event?.type === 'session.started' && this.value.state === 'connecting') {
      if (!this.stream?.getAudioTracks().some((track) => track.readyState !== 'ended')) {
        this.update({
          error: 'The microphone became unavailable before the live session connected.',
        });
        void this.end();
        return;
      }
      if (this.connectionTimer) clearTimeout(this.connectionTimer);
      this.update({ state: 'connected', statusText: 'Connected to klnk' });
    } else if (event?.type === 'session.closed') {
      this.finishClosed();
    } else if (
      event?.type === 'session.input_transcript.delta' ||
      event?.type === 'session.output_transcript.delta'
    ) {
      this.update({
        turns: appendLiveDelta(
          this.value.turns,
          event.type === 'session.input_transcript.delta' ? 'You' : 'klnk',
          event.delta,
          event.start_ms,
          event.end_ms,
        ),
      });
    } else if (
      event?.type === 'session.input_audio.muted' ||
      event?.type === 'session.input_audio.unmuted'
    ) {
      const muted = event.type === 'session.input_audio.muted';
      if (
        this.command &&
        event.client_event_id === this.command.id &&
        muted === this.command.muted
      ) {
        if (this.muteTimer) clearTimeout(this.muteTimer);
        this.command = null;
        this.stream?.getAudioTracks().forEach((track) => {
          track.enabled = !muted;
        });
        this.update({
          muted,
          mutePending: false,
          statusText: muted ? 'Connected · microphone muted' : 'Connected to klnk',
        });
      }
    } else if (event?.type === 'error') {
      this.update({
        error:
          typeof event.error?.message === 'string'
            ? event.error.message
            : 'The live service reported a problem.',
      });
      if (this.command && event.client_event_id === this.command.id) this.failMute();
      if (this.value.state !== 'connected') void this.end();
    }
  }
  enableAudio = async () => {
    if (!this.audio || !['connecting', 'connected'].includes(this.value.state)) return;
    const generation = this.generation;
    try {
      await this.audio.play();
      if (generation === this.generation) this.update({ audioBlocked: false });
    } catch {
      if (generation === this.generation)
        this.update({
          audioBlocked: true,
          error: 'Your browser paused spoken audio. Choose Enable spoken audio.',
        });
    }
  };
  toggleCaptions = () => this.update({ captionsOpen: !this.value.captionsOpen });
  toggleMute = () => {
    if (this.value.state !== 'connected' || this.command || this.channel?.readyState !== 'open')
      return;
    const command = {
      id: `mic-${this.generation}-${++this.commandSequence}`,
      muted: !this.value.muted,
    };
    this.command = command;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    this.update({ muted: true, mutePending: true, statusText: 'Microphone off on this device' });
    try {
      this.channel.send(
        JSON.stringify({
          type: command.muted ? 'session.input_audio.mute' : 'session.input_audio.unmute',
          event_id: command.id,
        }),
      );
      this.muteTimer = setTimeout(() => this.failMute(), 5000);
    } catch {
      this.failMute();
    }
  };
  private failMute() {
    if (this.muteTimer) clearTimeout(this.muteTimer);
    this.command = null;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    this.update({
      muted: true,
      mutePending: false,
      error:
        'Your microphone is off on this device. The service did not confirm the change. Retry unmute or end the call.',
    });
  }
  end = async () => {
    if (this.ending) return this.ending;
    if (
      !this.owned &&
      !this.creationPending &&
      !this.creationAttempted &&
      !this.value.closureUnconfirmed &&
      ['idle', 'error', 'ended'].includes(this.value.state)
    ) {
      this.cleanup();
      return;
    }
    this.ending = this.endSession();
    try {
      await this.ending;
    } finally {
      this.ending = null;
    }
  };
  private async endSession() {
    this.update({ state: 'ending', statusText: 'Microphone off · ending session' });
    this.stopMedia();
    if (this.connectionTimer) clearTimeout(this.connectionTimer);
    if (this.durationTimer) clearTimeout(this.durationTimer);
    if (this.channel?.readyState === 'open')
      try {
        this.channel.send(JSON.stringify({ type: 'session.close' }));
      } catch {}
    if (!this.owned && this.creationAttempted && this.creationReference) {
      const reference = this.creationReference;
      try {
        const receipt = liveReceipt(
          await liveJson(
            await this.env.fetcher(
              `${reference.address}/voice/live/requests/${encodeURIComponent(reference.requestId)}`,
              {
                headers: { Authorization: reference.authorization },
                cache: 'no-store',
                redirect: 'error',
                signal: AbortSignal.timeout(8000),
              },
            ),
          ),
          reference.requestId,
        );
        if (this.creationReference === reference) {
          reference.receiptId = receipt.receiptId;
          if (['closed', 'rejected'].includes(String(receipt.status))) {
            this.finishClosed();
            return;
          }
          if (receipt.sessionId) this.owned = { ...reference, id: receipt.sessionId };
        }
      } catch {}
    }
    const owned = this.owned;
    if (!owned) {
      const uncertain = this.creationAttempted || this.value.closureUnconfirmed;
      this.cleanup();
      if (!this.creationPending) this.generation++;
      this.update({
        state: 'ended',
        statusText: 'Microphone off',
        closureUnconfirmed: uncertain,
        error: uncertain
          ? 'This device disconnected. The service has not confirmed session closure.'
          : '',
      });
      return;
    }
    await this.closeOwned(owned);
  }
  private async closeOwned(owned: OwnedSession) {
    let confirmed = false;
    try {
      const controller = new AbortController(),
        timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const result = await liveJson(
          await this.env.fetcher(
            `${owned.address}/voice/live/session/${encodeURIComponent(owned.id)}/close`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: owned.authorization },
              body: '{}',
              keepalive: true,
              redirect: 'error',
              signal: controller.signal,
            },
          ),
        );
        confirmed = liveClosure(result);
        for (let i = 0; !confirmed && i < 8; i++) {
          const status = await liveJson(
            await this.env.fetcher(
              `${owned.address}/voice/live/session/${encodeURIComponent(owned.id)}`,
              {
                headers: { Authorization: owned.authorization },
                cache: 'no-store',
                redirect: 'error',
                signal: controller.signal,
              },
            ),
          );
          confirmed = liveClosure(status, owned.id);
          if (!confirmed) await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {}
    if (this.owned !== owned) return;
    if (confirmed) this.finishClosed();
    else {
      this.cleanup();
      this.update({
        state: 'ended',
        statusText: 'Disconnected on this device',
        closureUnconfirmed: true,
        error:
          'Your microphone is off. Session closure has not been confirmed. Choose End call again to check the same session.',
      });
    }
  }
  private finishClosed() {
    this.generation++;
    this.owned = null;
    this.creationAttempted = false;
    this.creationReference = null;
    this.update({
      state: 'ended',
      statusText: 'Conversation ended · microphone off',
      closureUnconfirmed: false,
      muted: true,
      mutePending: false,
      audioBlocked: false,
      durationWarning: '',
      error: '',
    });
    this.cleanup();
  }
  private stopMedia() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.srcObject = null;
      this.audio = null;
    }
  }
  private cleanup() {
    this.stopMedia();
    this.iceCancel?.();
    for (const timer of [
      this.connectionTimer,
      this.durationTimer,
      this.disconnectTimer,
      this.muteTimer,
      this.warningTimer,
    ])
      if (timer) clearTimeout(timer);
    this.connectionTimer =
      this.durationTimer =
      this.disconnectTimer =
      this.muteTimer =
      this.warningTimer =
        null;
    this.command = null;
    try {
      this.channel?.close();
    } catch {}
    try {
      this.peer?.close();
    } catch {}
    this.channel = null;
    this.peer = null;
  }
  dispose() {
    this.readiness++;
    this.recovery++;
    void this.end();
  }
}
