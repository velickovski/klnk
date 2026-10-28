'use strict';

// The demo has no mock transport. Only the Call klnk gesture starts media or a session.
const ui = Object.fromEntries(
  [
    'app',
    'eyebrow',
    'hero-title',
    'hero-description',
    'connection-label',
    'session-time',
    'opening-copy',
    'conversation-title',
    'conversation-description',
    'message',
    'call-button',
    'call-controls',
    'mute-button',
    'end-button',
    'enable-audio',
    'transcript-button',
    'transcript-panel',
    'transcript-empty',
    'transcript',
    'current-caption',
    'caption-speaker',
    'caption-text',
    'privacy-note',
    'remote-audio',
    'announcer',
    'text-workspace',
    'retry-close',
  ].map((id) => [id, document.getElementById(id)]),
);

let availability = null;
let phase = 'idle';
let generation = 0;
let stream = null;
let peer = null;
let events = null;
let controller = null;
let token = null;
let sessionId = null;
let closing = false;
let muted = false;
let startedAt = 0;
let maximumSeconds = 300;
let durationTimer = null;
let connectionTimer = null;
let disconnectTimer = null;
let closeTimer = null;
let audioContext = null;
let analyser = null;
let animationFrame = null;
let transcriptEntries = [];
let durationWarningGiven = false;
let pendingClosure = null;
let creationAttempted = false;
let creationRequest = null;
let readinessGeneration = 0;
let muteCommand = null;
let muteTimer = null;
let commandSequence = 0;
let meterSource = null;
let outputStream = null;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function announce(message) {
  ui.announcer.textContent = message;
}
function readyForCall() {
  return (
    availability?.configured === true &&
    !availability.startupUnconfirmed &&
    !pendingClosure &&
    !creationRequest
  );
}
function showMessage(message = '') {
  ui.message.textContent = message;
  ui.message.hidden = !message;
}
function showPhase(next, label) {
  phase = next;
  ui.app.dataset.phase = next;
  if (label) ui['connection-label'].textContent = label;
  const running = ['connecting', 'connected', 'closing'].includes(next);
  ui['call-button'].hidden = running;
  ui['call-controls'].hidden = !running;
  ui['end-button'].disabled = next === 'closing';
  ui['end-button'].textContent = next === 'closing' ? 'Ending…' : 'End call';
  ui['mute-button'].disabled = next !== 'connected' || !!muteCommand;
  ui['call-button'].disabled = !readyForCall();
  ui['retry-close'].hidden = running || !pendingClosure;
  ui['session-time'].hidden = !startedAt || !running;
  if (next === 'connecting') {
    ui.eyebrow.textContent = 'A MOMENT TO CONNECT.';
    ui['hero-title'].innerHTML = 'Right here.<br>Almost ready.';
    ui['hero-description'].textContent = 'Allow your microphone to begin.';
    ui['conversation-title'].textContent = 'Making the connection.';
    ui['conversation-description'].textContent = 'Your conversation starts when voice is ready.';
  } else if (next === 'connected') {
    ui.eyebrow.textContent = 'YOUR SPACE TO THINK.';
    ui['hero-title'].innerHTML = 'I’m here.<br>Go ahead.';
    ui['hero-description'].textContent = 'Speak naturally. Take your time.';
    ui['conversation-title'].textContent = 'You’re connected.';
    ui['conversation-description'].textContent = 'A live conversation with klnk.';
    ui['transcript-button'].hidden = false;
  } else if (next === 'closing') {
    ui['hero-description'].textContent = 'Your microphone is off.';
    ui['conversation-title'].textContent = 'Wrapping up.';
    ui['conversation-description'].textContent = 'Ending the live session.';
  } else {
    ui.eyebrow.textContent = 'A LITTLE MORE HUMAN.';
    ui['hero-title'].innerHTML = 'A voice in<br>your corner.';
    ui['hero-description'].innerHTML =
      'Room for your thoughts.<br>Someone to work them through with.';
    ui['conversation-title'].textContent = next === 'ended' ? 'Until next time.' : 'Let’s talk.';
    ui['conversation-description'].textContent =
      next === 'ended' ? 'Your microphone is off.' : 'Start anywhere. At your pace.';
  }
}

async function readJson(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(
        typeof result?.message === 'string'
          ? result.message
          : `Voice service returned ${response.status}. Please try again.`,
      ),
      { status: response.status, code: result?.error },
    );
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('The voice service returned an unreadable response. Please try again.');
  return result;
}

async function checkAvailability() {
  const request = ++readinessGeneration;
  const readinessController = new AbortController();
  const timeout = setTimeout(() => readinessController.abort(), 10000);
  try {
    const response = await fetch('/demo/status', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: readinessController.signal,
    });
    const result = await readJson(response);
    if (request !== readinessGeneration) return;
    availability = {
      configured: result.configured === true,
      startupUnconfirmed: result.startupUnconfirmed === true,
    };
    if (!['connecting', 'connected', 'closing'].includes(phase))
      ui['call-button'].disabled = !readyForCall();
    if (phase === 'idle' || phase === 'setup') {
      showPhase(
        readyForCall() ? 'idle' : 'setup',
        availability.startupUnconfirmed
          ? 'Earlier session unresolved'
          : availability.configured
            ? 'Ready when you are'
            : 'Voice setup needed',
      );
      if (availability.startupUnconfirmed) {
        ui['conversation-description'].textContent =
          'An earlier session needs attention before a new call. The service has not confirmed its closure.';
      } else if (!availability.configured) {
        ui['conversation-description'].textContent =
          'Live voice needs to be configured before your first call.';
      }
    }
  } catch {
    if (request !== readinessGeneration) return;
    availability = { configured: false };
    if (phase === 'idle' || phase === 'setup') {
      showPhase('setup', 'Voice service unavailable');
      ui['conversation-description'].textContent =
        'The voice service is unavailable. Return to this window to check again.';
    } else if (!['connecting', 'connected', 'closing'].includes(phase))
      ui['call-button'].disabled = true;
  } finally {
    clearTimeout(timeout);
  }
}

function waitForIce(connection, signal) {
  if (signal.aborted) return Promise.reject(new DOMException('Connection cancelled', 'AbortError'));
  if (connection.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error('The voice connection could not be prepared. Please try again.')),
      10000,
    );
    const changed = () => {
      if (connection.iceGatheringState === 'complete') finish();
    };
    const aborted = () => finish(new DOMException('Connection cancelled', 'AbortError'));
    function finish(error) {
      clearTimeout(timeout);
      connection.removeEventListener('icegatheringstatechange', changed);
      signal.removeEventListener('abort', aborted);
      error ? reject(error) : resolve();
    }
    connection.addEventListener('icegatheringstatechange', changed);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    else changed();
  });
}

function updateDuration() {
  if (!startedAt) return;
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  ui['session-time'].textContent =
    `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  if (!durationWarningGiven && maximumSeconds >= 60 && seconds >= maximumSeconds - 60) {
    durationWarningGiven = true;
    showMessage('One minute remains in this demo call.');
    announce('One minute remains in this demo call.');
  }
  if (seconds >= maximumSeconds && !closing) void endSession('limit');
}

function addTranscript(speaker, delta, startMs, endMs) {
  if (typeof delta !== 'string' || !delta) return;
  // Live has overlapping speakers and no turn-complete event. Group each speaker
  // independently using an application-owned two-second timeline gap, not arrival order.
  const timed =
    Number.isFinite(startMs) && Number.isFinite(endMs) && startMs >= 0 && endMs >= startMs;
  let entry = transcriptEntries.findLast((item) => item.speaker === speaker);
  if (!entry || (timed && Number.isFinite(entry.endMs) && startMs - entry.endMs >= 2000)) {
    const article = document.createElement('div');
    article.className = 'utterance';
    const label = document.createElement('strong');
    label.textContent = speaker === 'user' ? 'You' : 'klnk';
    const text = document.createElement('p');
    article.append(label, text);
    ui.transcript.append(article);
    entry = {
      speaker,
      value: '',
      element: text,
      fragments: [],
      startMs: timed ? startMs : null,
      endMs: null,
    };
    transcriptEntries.push(entry);
  }
  entry.value += delta; // Live deltas contain meaningful whitespace; never trim them.
  entry.fragments.push({ delta, startMs: timed ? startMs : null, endMs: timed ? endMs : null });
  if (timed) entry.endMs = Math.max(entry.endMs ?? 0, endMs);
  entry.element.textContent = entry.value;
  ui['transcript-empty'].hidden = true;
  ui['transcript-button'].hidden = false;
  ui['opening-copy'].hidden = true;
  ui['current-caption'].hidden = false;
  ui['caption-speaker'].textContent = speaker === 'user' ? 'You' : 'klnk';
  const value = entry.value;
  // Keep the current caption short; the complete text stays in Conversation.
  ui['caption-text'].textContent = value.length > 240 ? `…${value.slice(-237)}` : value;
}

function receiveEvent(event, currentGeneration) {
  if (currentGeneration !== generation) return;
  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    return;
  }
  if (!message || typeof message !== 'object' || Array.isArray(message)) return;
  if (message.type === 'session.started') {
    if (closing) {
      sendClose();
      return;
    }
    if (phase !== 'connecting') return;
    if (!stream?.getAudioTracks().some((track) => track.readyState !== 'ended')) {
      showMessage('Your microphone became unavailable before the call connected.');
      void endSession('microphone');
      return;
    }
    clearTimeout(connectionTimer);
    startedAt = Date.now();
    showPhase('connected', 'Live connection');
    updateDuration();
    durationTimer = setInterval(updateDuration, 1000);
    announce('Connected to klnk. Your microphone is on.');
  } else if (message.type === 'session.input_transcript.delta') {
    addTranscript('user', message.delta, message.start_ms, message.end_ms);
  } else if (message.type === 'session.output_transcript.delta') {
    addTranscript('assistant', message.delta, message.start_ms, message.end_ms);
  } else if (
    message.type === 'session.input_audio.muted' ||
    message.type === 'session.input_audio.unmuted'
  ) {
    const acceptedMuted = message.type === 'session.input_audio.muted';
    if (
      !muteCommand ||
      message.client_event_id !== muteCommand.id ||
      acceptedMuted !== muteCommand.muted
    )
      return;
    clearTimeout(muteTimer);
    muteTimer = null;
    muteCommand = null;
    muted = acceptedMuted;
    stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    updateMuteControl();
    announce(muted ? 'Microphone muted.' : 'Microphone on.');
  } else if (message.type === 'session.closed') {
    finishSession(true, closing ? '' : 'The live session has ended.');
  } else if (message.type === 'error') {
    const details =
      typeof message.error?.message === 'string'
        ? message.error.message
        : 'The voice service reported a problem.';
    showMessage(details);
    announce(details);
    if (muteCommand && message.client_event_id === muteCommand.id) failMute();
    if (phase !== 'connected') void endSession('error');
  }
}

async function playAudio() {
  if (closing || !['connecting', 'connected'].includes(phase)) return;
  const currentGeneration = generation;
  try {
    await ui['remote-audio'].play();
    if (currentGeneration !== generation || closing) return;
    ui['enable-audio'].hidden = true;
  } catch {
    if (currentGeneration !== generation || closing || !['connecting', 'connected'].includes(phase))
      return;
    ui['enable-audio'].hidden = false;
    announce('Your browser paused the audio. Choose Enable spoken audio to hear klnk.');
  }
}

function stopMeter() {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  try {
    meterSource?.disconnect();
    analyser?.disconnect();
  } catch {}
  meterSource = analyser = null;
  ui.app.style.setProperty('--output-level', '0');
}

function meterOutput(remoteStream) {
  outputStream = remoteStream;
  stopMeter();
  if (!audioContext || reducedMotion.matches) return;
  try {
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    meterSource = audioContext.createMediaStreamSource(remoteStream);
    meterSource.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const draw = () => {
      if (!analyser) return;
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) energy += ((sample - 128) / 128) ** 2;
      const level = Math.min(1, Math.sqrt(energy / samples.length) * 6);
      ui.app.style.setProperty('--output-level', String(level));
      animationFrame = requestAnimationFrame(draw);
    };
    draw();
  } catch {
    /* Decorative motion is optional; audio playback does not depend on it. */
  }
}

async function startCall() {
  if (['connecting', 'connected', 'closing'].includes(phase) || !readyForCall()) return;
  const currentGeneration = ++generation;
  closing = false;
  muted = false;
  creationAttempted = false;
  startedAt = 0;
  durationWarningGiven = false;
  transcriptEntries = [];
  ui.transcript.replaceChildren();
  ui['transcript-empty'].hidden = false;
  ui['transcript-button'].hidden = true;
  ui['transcript-panel'].hidden = true;
  ui['transcript-button'].setAttribute('aria-expanded', 'false');
  ui['transcript-button'].textContent = 'Show conversation';
  ui['opening-copy'].hidden = false;
  ui['current-caption'].hidden = true;
  ui['mute-button'].setAttribute('aria-pressed', 'false');
  ui['mute-button'].textContent = 'Mute mic';
  ui['text-workspace'].hidden = true;
  showMessage();
  showPhase('connecting', 'Connecting to live voice');
  ui['end-button'].focus();
  announce('Allow microphone access to start your live conversation.');
  controller = new AbortController();
  const signal = controller.signal;
  let ownedCreation = null;
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error(
        'Microphone access needs a secure browser connection. Open this demo on localhost or HTTPS.',
      );
    if (!window.RTCPeerConnection)
      throw new Error(
        'This browser does not support live voice. Open the demo in a current browser.',
      );
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      try {
        audioContext = new AudioContextClass();
        void audioContext.resume().catch(() => {});
      } catch {
        audioContext = null; /* The optional output meter must not block spoken playback. */
      }
    }
    const captured = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    if (currentGeneration !== generation || closing) {
      captured.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = captured;
    connectionTimer = setTimeout(() => {
      if (currentGeneration === generation && phase === 'connecting') {
        showMessage('The voice connection took too long. Please try again.');
        void endSession('connection');
      }
    }, 50000);
    stream.getAudioTracks().forEach((track) =>
      track.addEventListener('ended', () => {
        if (
          currentGeneration === generation &&
          !closing &&
          ['connecting', 'connected'].includes(phase)
        ) {
          showMessage('Your microphone became unavailable. The call is ending.');
          void endSession('microphone');
        }
      }),
    );
    peer = new RTCPeerConnection();
    const thisPeer = peer;
    stream.getTracks().forEach((track) => thisPeer.addTrack(track, stream));
    thisPeer.addEventListener('track', (event) => {
      if (currentGeneration !== generation || closing) return;
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      ui['remote-audio'].srcObject = remoteStream;
      void playAudio();
      meterOutput(remoteStream);
    });
    thisPeer.addEventListener('connectionstatechange', () => {
      if (currentGeneration !== generation || closing) return;
      if (thisPeer.connectionState === 'failed') {
        showMessage('The live connection was lost. Your microphone is being turned off.');
        void endSession('connection');
      } else if (thisPeer.connectionState === 'disconnected') {
        ui['connection-label'].textContent = 'Connection interrupted';
        clearTimeout(disconnectTimer);
        disconnectTimer = setTimeout(() => {
          if (
            currentGeneration === generation &&
            !closing &&
            thisPeer.connectionState === 'disconnected'
          )
            void endSession('connection');
        }, 10000);
      } else if (thisPeer.connectionState === 'connected') {
        clearTimeout(disconnectTimer);
        if (phase === 'connected') updateMuteControl();
      }
    });
    events = thisPeer.createDataChannel('oai-events');
    events.addEventListener('message', (event) => receiveEvent(event, currentGeneration));
    events.addEventListener('close', () => {
      if (
        currentGeneration === generation &&
        !closing &&
        ['connecting', 'connected'].includes(phase)
      ) {
        showMessage('The voice channel closed unexpectedly.');
        void endSession('connection');
      }
    });
    const offer = await thisPeer.createOffer();
    await thisPeer.setLocalDescription(offer);
    await waitForIce(thisPeer, signal);
    if (currentGeneration !== generation) return;
    const auth = await readJson(
      await fetch('/auth/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
        signal,
      }),
    );
    if (currentGeneration !== generation) return;
    if (typeof auth.token !== 'string' || !auth.token.trim())
      throw new Error('The voice service did not authorize this connection. Please try again.');
    token = auth.token;
    const requestId = crypto.randomUUID();
    ownedCreation = { requestId, token: auth.token };
    creationRequest = ownedCreation;
    const creation = fetch('/voice/live/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ requestId, sdp: thisPeer.localDescription.sdp }),
      signal,
    });
    creationAttempted = true;
    const result = await readJson(await creation);
    if (currentGeneration !== generation) {
      if (typeof result.session?.id === 'string' && result.session.id) {
        const late = { id: result.session.id, token: auth.token };
        pendingClosure = late;
        showPhase(phase, ui['connection-label'].textContent);
        void retryClosure(late);
      }
      return;
    }
    if (typeof result.session?.id === 'string' && result.session.id) sessionId = result.session.id;
    if (
      result.transport?.type !== 'webrtc' ||
      typeof result.transport.sdp !== 'string' ||
      !result.transport.sdp ||
      !sessionId
    )
      throw new Error('The live service did not return a usable voice connection.');
    maximumSeconds = Number.isFinite(result.maxDurationSeconds)
      ? Math.max(1, Math.min(300, result.maxDurationSeconds))
      : 300;
    await thisPeer.setRemoteDescription({ type: 'answer', sdp: result.transport.sdp });
    clearTimeout(connectionTimer);
    connectionTimer = setTimeout(() => {
      if (currentGeneration === generation && phase === 'connecting') {
        showMessage('The voice service did not finish connecting. Please try again.');
        void endSession('connection');
      }
    }, 25000);
  } catch (error) {
    if (currentGeneration !== generation || closing || error.name === 'AbortError') return;
    if (
      !sessionId &&
      ((error.status >= 400 &&
        error.status < 500 &&
        !['voice_request_exists', 'voice_session_unresolved', 'voice_controller_lost'].includes(
          error.code,
        )) ||
        ['openai_not_configured', 'openai_session_failed'].includes(error.code))
    )
      creationAttempted = false;
    const message =
      error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError'
        ? 'Microphone access is off. Allow it in your browser’s site settings, then try Call klnk again. Live voice cannot start without it.'
        : error.name === 'NotFoundError'
          ? 'No microphone was found. Connect one, then try Call klnk again.'
          : error.message || 'Live voice could not connect. No conversation has been started.';
    if (creationAttempted && !sessionId && ownedCreation) pendingClosure = ownedCreation;
    if (sessionId) {
      showMessage(message);
      void endSession('error');
    } else {
      generation++;
      cleanup();
      showPhase('error', 'Couldn’t start live voice');
      showMessage(message);
      ui['text-workspace'].hidden = false;
      announce(message);
      ui['call-button'].focus();
      if (creationAttempted) void checkAvailability();
    }
  } finally {
    if (ownedCreation && creationRequest === ownedCreation) {
      creationRequest = null;
      if (!['connecting', 'connected', 'closing'].includes(phase))
        ui['call-button'].disabled = !readyForCall();
    }
  }
}

function stopMicrophone() {
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  ui['remote-audio'].pause();
}

function sendClose() {
  if (events?.readyState === 'open') {
    try {
      events.send(JSON.stringify({ type: 'session.close' }));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

async function closeThroughServer(keepalive = false, id = sessionId, credential = token) {
  if (!id || !credential) return false;
  const closeController = new AbortController();
  const timeout = keepalive ? null : setTimeout(() => closeController.abort(), 7000);
  try {
    const response = await fetch(`/voice/live/session/${encodeURIComponent(id)}/close`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${credential}`,
      },
      body: '{}',
      keepalive,
      ...(keepalive ? {} : { signal: closeController.signal }),
    });
    const result = await readJson(response);
    if (result.status === 'closed') return true;
    if (keepalive) return false;
    // The server may receive its sideband closure event before this data channel
    // does. Read only this owner's session; a local disconnect is not evidence.
    const status = await readJson(
      await fetch(`/voice/live/session/${encodeURIComponent(id)}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${credential}` },
        cache: 'no-store',
        signal: closeController.signal,
      }),
    );
    return status.sessionId === id && status.status === 'closed';
  } finally {
    clearTimeout(timeout);
  }
}

async function endSession(reason = 'owner') {
  if (closing) return;
  closing = true;
  stopMicrophone();
  ui['enable-audio'].hidden = true;
  clearTimeout(connectionTimer);
  clearInterval(durationTimer);
  showPhase('closing', 'Microphone off · ending session');
  announce('Your microphone is off. Ending the live session.');
  if (!sessionId) {
    controller?.abort();
    finishSession(!creationAttempted);
    return;
  }
  const currentGeneration = generation;
  const ownedId = sessionId;
  sendClose();
  closeTimer = setTimeout(() => {
    if (currentGeneration === generation && closing && sessionId === ownedId) finishSession(false);
  }, 8000);
  try {
    const confirmed = await closeThroughServer();
    if (confirmed && currentGeneration === generation && closing && sessionId === ownedId)
      finishSession(true, reason === 'limit' ? 'The five-minute demo session has ended.' : '');
  } catch {
    /* A session.closed data-channel event can still confirm closure. */
  }
}

function finishSession(confirmed, note = '') {
  const previousError = ui.message.hidden ? '' : ui.message.textContent;
  if (!confirmed && sessionId && token) pendingClosure = { id: sessionId, token };
  else if (!confirmed && creationRequest) pendingClosure = creationRequest;
  if (confirmed) pendingClosure = null;
  generation++;
  cleanup();
  showPhase('ended', confirmed ? 'Conversation ended' : 'Disconnected on this device');
  ui['opening-copy'].hidden = false;
  ui['current-caption'].hidden = true;
  ui['text-workspace'].hidden = false;
  showMessage(
    confirmed
      ? note || previousError
      : 'Your microphone is off and this device is disconnected. The service did not confirm session closure.',
  );
  announce(
    confirmed
      ? 'Conversation ended. Your microphone is off.'
      : 'Microphone off. Session closure could not be confirmed.',
  );
  (pendingClosure ? ui['retry-close'] : ui['call-button']).focus();
}

async function retryClosure(owned = pendingClosure) {
  if (!owned || owned !== pendingClosure || ['connecting', 'connected', 'closing'].includes(phase))
    return;
  ui['retry-close'].disabled = true;
  ui['retry-close'].textContent = 'Checking session closure…';
  try {
    let confirmed = false;
    if (!owned.id && owned.requestId) {
      const receipt = await readJson(
        await fetch('/voice/live/requests/' + encodeURIComponent(owned.requestId), {
          headers: { Accept: 'application/json', Authorization: 'Bearer ' + owned.token },
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        }),
      );
      if (
        receipt.requestId !== owned.requestId ||
        typeof receipt.receiptId !== 'string' ||
        !['creating', 'active', 'closing', 'closed', 'unconfirmed', 'rejected'].includes(
          receipt.status,
        )
      )
        throw new Error('The voice receipt could not be verified.');
      if (receipt.status === 'closed' || receipt.status === 'rejected') confirmed = true;
      else if (typeof receipt.sessionId === 'string' && receipt.sessionId)
        owned.id = receipt.sessionId;
    }
    if (owned.id) confirmed = await closeThroughServer(false, owned.id, owned.token);
    if (owned !== pendingClosure) return;
    if (confirmed)
      finishSession(true, 'The service confirmed session closure. Your microphone is off.');
    else
      showMessage(
        'Your microphone is off. The service has not confirmed session closure yet. Retry ending this session before starting another.',
      );
  } catch {
    if (owned === pendingClosure)
      showMessage(
        'Your microphone is off. The service could not be reached to confirm closure. Retry ending this session when the connection returns.',
      );
  } finally {
    if (owned === pendingClosure) announce(ui.message.textContent);
    ui['retry-close'].disabled = false;
    ui['retry-close'].textContent = 'Retry ending session';
  }
}

function updateMuteControl() {
  ui['mute-button'].disabled = phase !== 'connected' || !!muteCommand;
  ui['mute-button'].setAttribute('aria-pressed', String(muted));
  ui['mute-button'].textContent = muteCommand
    ? muteCommand.muted
      ? 'Muting…'
      : 'Unmuting…'
    : muted
      ? 'Unmute mic'
      : 'Mute mic';
  ui['connection-label'].textContent = muteCommand
    ? 'Live · microphone off on this device'
    : muted
      ? 'Live · microphone muted'
      : 'Live connection';
}

function failMute() {
  clearTimeout(muteTimer);
  muteTimer = null;
  muteCommand = null;
  // Never reopen capture after a rejected or unanswered unmute command.
  muted = true;
  stream?.getAudioTracks().forEach((track) => {
    track.enabled = false;
  });
  updateMuteControl();
  ui['connection-label'].textContent = 'Live · microphone off on this device';
  const message =
    'Your microphone is off on this device. The service did not confirm the microphone change. Try Unmute mic again or end the call.';
  showMessage(message);
  announce(message);
}

function toggleMute() {
  if (phase !== 'connected' || !stream || muteCommand || events?.readyState !== 'open') return;
  const nextMuted = !muted;
  const id = `mic-${generation}-${++commandSequence}`;
  muteCommand = { id, muted: nextMuted };
  muted = true;
  stream.getAudioTracks().forEach((track) => {
    track.enabled = false;
  });
  updateMuteControl();
  try {
    events.send(
      JSON.stringify({
        type: nextMuted ? 'session.input_audio.mute' : 'session.input_audio.unmute',
        event_id: id,
      }),
    );
  } catch {
    failMute();
    return;
  }
  const currentGeneration = generation;
  muteTimer = setTimeout(() => {
    if (currentGeneration === generation && muteCommand?.id === id) failMute();
  }, 5000);
}

function cleanup() {
  clearTimeout(connectionTimer);
  clearTimeout(disconnectTimer);
  clearTimeout(closeTimer);
  clearTimeout(muteTimer);
  clearInterval(durationTimer);
  connectionTimer = disconnectTimer = closeTimer = durationTimer = null;
  controller?.abort();
  controller = null;
  stopMicrophone();
  try {
    events?.close();
  } catch {}
  try {
    peer?.close();
  } catch {}
  events = null;
  peer = null;
  ui['remote-audio'].srcObject = null;
  ui['enable-audio'].hidden = true;
  muteTimer = null;
  muteCommand = null;
  stopMeter();
  outputStream = null;
  if (audioContext) void audioContext.close().catch(() => {});
  audioContext = null;
  ui.app.style.setProperty('--output-level', '0');
  token = null;
  sessionId = null;
  startedAt = 0;
  closing = false;
}

ui['call-button'].addEventListener('click', () => {
  void startCall();
});
ui['end-button'].addEventListener('click', () => {
  void endSession();
});
ui['enable-audio'].addEventListener('click', () => {
  void audioContext?.resume().catch(() => {});
  void playAudio();
});
ui['mute-button'].addEventListener('click', toggleMute);
ui['retry-close'].addEventListener('click', () => {
  void retryClosure();
});
ui['transcript-button'].addEventListener('click', () => {
  const expanded = ui['transcript-button'].getAttribute('aria-expanded') === 'true';
  ui['transcript-button'].setAttribute('aria-expanded', String(!expanded));
  ui['transcript-button'].textContent = expanded ? 'Show conversation' : 'Hide conversation';
  ui['transcript-panel'].hidden = expanded;
});
window.addEventListener('pagehide', () => {
  closing = true;
  sendClose();
  if (sessionId && token) {
    const owned = { id: sessionId, token };
    pendingClosure = owned;
    void closeThroughServer(true, owned.id, owned.token)
      .then((confirmed) => {
        if (confirmed && pendingClosure === owned) {
          pendingClosure = null;
          if (phase === 'ended') showPhase('ended', ui['connection-label'].textContent);
        }
      })
      .catch(() => {});
  }
  generation++;
  cleanup();
});
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  showPhase('ended', 'Disconnected on this device');
  ui['opening-copy'].hidden = false;
  ui['current-caption'].hidden = true;
  showMessage(
    pendingClosure
      ? 'Your microphone is off. Leaving the page disconnected this device. Retry ending the session to confirm service closure.'
      : 'Your microphone is off. Leaving the page disconnected this device. Start a new call when you’re ready.',
  );
  ui['text-workspace'].hidden = false;
  (pendingClosure ? ui['retry-close'] : ui['call-button']).focus();
  if (pendingClosure) void retryClosure();
  void checkAvailability();
});
window.addEventListener('focus', () => {
  void checkAvailability();
});
window.addEventListener('online', () => {
  void checkAvailability();
});
reducedMotion.addEventListener?.('change', () => {
  if (reducedMotion.matches) stopMeter();
  else if (outputStream && phase === 'connected') meterOutput(outputStream);
});
void checkAvailability();
