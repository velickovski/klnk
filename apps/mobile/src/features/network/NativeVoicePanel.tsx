import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Text, View } from 'react-native';
import * as Speech from 'expo-speech';
import { randomUUID } from 'expo-crypto';
import type { NetworkVoiceTurnInput, NetworkVoiceTurnResult } from '@personal-agent/domain';
import { Button, Card, Disclosure, Notice, useUI } from '../../ui';
import { useVoiceIO } from '../../voice-io';
import type { VoiceInput, VoiceIO } from '../../voice-types';
import { ApiError, getSessionSnapshot } from '../../api';
import { useNetworkClient } from './data-provider';

/** Bounded foreground recording -> server transcription/intent -> actual device
 * speech. This is deliberately separate from unverified native Live WebRTC. */
export function NativeVoicePanel({
  ownerId,
  onClose,
  autoStart = false,
}: {
  ownerId: string;
  onClose: () => void;
  autoStart?: boolean;
}) {
  const { styles } = useUI();
  const networkApi = useNetworkClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [speaking, setSpeaking] = useState(false),
    [muted, setMuted] = useState(false),
    [captions, setCaptions] = useState(true),
    [result, setResult] = useState<NetworkVoiceTurnResult>();
  const alive = useRef(true),
    generation = useRef(0),
    session = useRef(false),
    busyRef = useRef(false),
    mutedRef = useRef(false);
  const voiceRef = useRef<VoiceIO | null>(null),
    pending = useRef<NetworkVoiceTurnInput | null>(null),
    review = useRef<NetworkVoiceTurnInput['review']>(undefined),
    speechGeneration = useRef(0);
  const [uncertain, setUncertain] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const sessionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSessionTimer = () => {
    if (sessionTimer.current) clearTimeout(sessionTimer.current);
    sessionTimer.current = null;
  };
  const current = (ticket: number) =>
    alive.current && ticket === generation.current && AppState.currentState === 'active';
  const silence = async () => {
    speechGeneration.current++;
    await Speech.stop();
    voiceRef.current?.silence();
    if (alive.current) setSpeaking(false);
  };
  const listen = async () => {
    if (
      !alive.current ||
      !session.current ||
      mutedRef.current ||
      busyRef.current ||
      pending.current ||
      AppState.currentState !== 'active'
    )
      return;
    await voiceRef.current?.start();
  };
  const narrate = async (next: NetworkVoiceTurnResult) => {
    await silence();
    const ticket = ++speechGeneration.current;
    if (!alive.current || !session.current || AppState.currentState !== 'active') return;
    setSpeaking(true);
    Speech.speak(next.replyText, {
      useApplicationAudioSession: false,
      onDone: () => {
        if (!alive.current || speechGeneration.current !== ticket) return;
        setSpeaking(false);
        // Speech completion is playback evidence, never proof the owner heard it.
        if (
          next.status === 'completed' &&
          !(
            next.intent?.status === 'submitted' &&
            ['queued', 'processing'].includes(next.intent.conversation.state)
          ) &&
          !['processing', 'uncertain', 'failed'].includes(next.intent?.status ?? '')
        )
          void listen().catch(() =>
            setError('The microphone could not resume. Choose Resume listening.'),
          );
      },
      onStopped: () => {
        if (alive.current && speechGeneration.current === ticket) setSpeaking(false);
      },
      onError: () => {
        if (alive.current && speechGeneration.current === ticket) {
          setSpeaking(false);
          setError('The device could not read this reply aloud. Its text remains available.');
        }
      },
    });
  };
  const adopt = (next: NetworkVoiceTurnResult) => {
    const unresolved = next.status === 'processing' || next.status === 'uncertain';
    if (!unresolved) {
      pending.current = null;
      review.current = next.review;
    }
    setUncertain(unresolved);
    setCanRetry(false);
    setResult(next);
    void narrate(next).catch(() =>
      setError('The spoken reply could not be played. Its text remains available.'),
    );
  };
  const submit = async (input: VoiceInput) => {
    if (busyRef.current || !alive.current || pending.current) return;
    if (!input.audioBase64 || !input.mimeType) {
      setError('No native recording was captured. Nothing was submitted.');
      return;
    }
    const ticket = generation.current;
    const identity = getSessionSnapshot();
    const command: NetworkVoiceTurnInput = {
      turnId: randomUUID(),
      audioBase64: input.audioBase64,
      mimeType: 'audio/mp4',
      ...(review.current ? { review: review.current } : {}),
    };
    pending.current = command;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setUncertain(true);
    try {
      const next = await networkApi.request<NetworkVoiceTurnResult>(
        '/network/voice/turn',
        'POST',
        command,
      );
      if (!current(ticket) || identity.generation !== getSessionSnapshot().generation) return;
      adopt(next);
    } catch (failure) {
      if (current(ticket)) {
        if (
          failure instanceof ApiError &&
          [
            'openai_not_configured',
            'invalid_audio',
            'voice_audio_limit',
            'voice_session_unresolved',
            'voice_daily_limit',
            'voice_turn_processing',
          ].includes(failure.code ?? '')
        ) {
          pending.current = null;
          setUncertain(false);
        }
        setError(
          `${failure instanceof Error ? failure.message : 'The recording result is unconfirmed.'} Check this same instruction before giving another.`,
        );
      }
    } finally {
      busyRef.current = false;
      if (current(ticket)) setBusy(false);
    }
  };
  const voice = useVoiceIO({
    onInput: submit,
    onError: (message) => {
      if (alive.current) setError(message);
    },
  });
  voiceRef.current = voice;
  const start = async () => {
    const ticket = generation.current;
    if (!session.current) {
      clearSessionTimer();
      sessionTimer.current = setTimeout(() => {
        void end(false)
          .then(() => {
            if (alive.current)
              setError(
                'This five-minute recorded voice session ended. Your microphone is off. Check Inbox for any request already delegated.',
              );
          })
          .catch(() => {
            if (alive.current)
              setError('Voice ended. Check microphone permission if capture has not stopped.');
          });
      }, 300000);
    }
    session.current = true;
    mutedRef.current = false;
    setMuted(false);
    setError('');
    try {
      const status = await networkApi.read<{ available: boolean }>('/network/voice/status', true);
      if (!current(ticket) || !session.current) return;
      if (!status.available) {
        session.current = false;
        clearSessionTimer();
        setError(
          'OpenAI transcription is unavailable. Your microphone is off; use your workspace until the service is configured.',
        );
        return;
      }
      await listen();
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error ? failure.message : 'Voice availability could not be checked.',
        );
    }
  };
  const check = async () => {
    const command = pending.current;
    if (!command || busyRef.current) return;
    const ticket = generation.current;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await networkApi.read<NetworkVoiceTurnResult>(
        `/network/voice/turns/${command.turnId}`,
        true,
      );
      if (current(ticket)) adopt(next);
    } catch (failure) {
      if (current(ticket)) {
        setCanRetry(failure instanceof ApiError && failure.status === 404);
        setError(
          failure instanceof Error
            ? failure.message
            : 'The same voice receipt could not be read. No recording was resent.',
        );
      }
    } finally {
      busyRef.current = false;
      if (current(ticket)) setBusy(false);
    }
  };
  const retrySame = async () => {
    const command = pending.current;
    if (!command || !canRetry || busyRef.current) return;
    const ticket = generation.current;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setCanRetry(false);
    try {
      const next = await networkApi.request<NetworkVoiceTurnResult>(
        '/network/voice/turn',
        'POST',
        command,
      );
      if (current(ticket)) adopt(next);
    } catch (failure) {
      if (current(ticket))
        setError(
          failure instanceof Error ? failure.message : 'The same recording remains unconfirmed.',
        );
    } finally {
      busyRef.current = false;
      if (current(ticket)) setBusy(false);
    }
  };
  const end = async (close = true) => {
    clearSessionTimer();
    session.current = false;
    generation.current++;
    pending.current = null;
    review.current = undefined;
    await Promise.all([silence(), voiceRef.current?.cancel()]);
    if (close && alive.current) onClose();
  };
  const toggleMute = () => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
    if (mutedRef.current)
      void voice.cancel().catch(() => setError('Could not stop microphone capture.'));
    else if (!speaking) void listen().catch(() => setError('The microphone could not resume.'));
  };
  useEffect(() => {
    alive.current = true;
    if (autoStart) void start();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        clearSessionTimer();
        session.current = false;
        generation.current++;
        void Promise.all([silence(), voiceRef.current?.cancel()]).catch(() => {});
      }
    });
    return () => {
      alive.current = false;
      clearSessionTimer();
      session.current = false;
      generation.current++;
      speechGeneration.current++;
      pending.current = null;
      review.current = undefined;
      subscription.remove();
      void Promise.all([Speech.stop(), voiceRef.current?.cancel()]).catch(() => {});
    };
  }, [ownerId]);
  useEffect(() => {
    if (
      result?.intent?.status !== 'submitted' ||
      !['queued', 'processing'].includes(result.intent.conversation.state)
    )
      return;
    const turnId = result.turnId,
      ticket = generation.current;
    let running = false,
      stopped = false;
    const timer = setInterval(() => {
      if (
        running ||
        speaking ||
        busyRef.current ||
        !session.current ||
        voiceRef.current?.listening ||
        !current(ticket)
      )
        return;
      running = true;
      // Polling canonical state is a read, never a new transcription/model turn.
      void networkApi
        .read<NetworkVoiceTurnResult>(`/network/voice/turns/${turnId}`, true)
        .then((next) => {
          if (
            !stopped &&
            current(ticket) &&
            next.intent?.status === 'submitted' &&
            !['queued', 'processing'].includes(next.intent.conversation.state)
          )
            adopt(next);
        })
        .catch(() => {
          if (!stopped && current(ticket))
            setError(
              'The latest request result could not be read. Check this request in Inbox; no result is assumed.',
            );
        })
        .finally(() => {
          running = false;
        });
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [
    result?.turnId,
    result?.intent?.status === 'submitted' ? result.intent.conversation.state : '',
    speaking,
  ]);
  return (
    <Card>
      <Text accessibilityRole="header" style={styles.h2}>
        Talk to klnk
      </Text>
      <Text style={styles.text}>
        Speak your instruction. klnk reads back the actual request and result.
      </Text>
      <Text accessibilityLiveRegion="polite" style={styles.small}>
        {busy
          ? 'Your recording is processing.'
          : voice.listening
            ? 'Listening. Pause when you finish.'
            : speaking
              ? 'Reading the reply with this device’s voice.'
              : muted
                ? 'Microphone muted.'
                : 'Microphone off.'}
      </Text>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {uncertain ? (
        <Notice tone="warning">
          This recording keeps the same identifier. Check its receipt before starting another; no
          automatic paid retry occurs.
        </Notice>
      ) : null}
      <View style={{ gap: 12 }}>
        <Button
          label="End call"
          onPress={() => {
            void end().catch(() => setError('Could not finish microphone cleanup.'));
          }}
        />
        <Button
          label={muted ? 'Unmute microphone' : 'Mute microphone'}
          secondary
          onPress={toggleMute}
          disabled={busy}
        />
        <Button
          label={captions ? 'Hide captions' : 'Show captions'}
          secondary
          onPress={() => setCaptions(!captions)}
        />
        {!voice.listening && !speaking && !pending.current ? (
          <Button
            label="Resume listening"
            secondary
            loading={busy}
            onPress={() => {
              void start();
            }}
          />
        ) : null}
        {voice.listening ? (
          <Button
            label="Finish speaking"
            secondary
            onPress={() => {
              void voice.stop();
            }}
          />
        ) : null}
        {voice.pending ? (
          <>
            <Button
              label="Send this recording"
              onPress={() => {
                void voice.send();
              }}
            />
            <Button
              label="Discard recording"
              secondary
              onPress={() => {
                void voice.cancel();
              }}
            />
          </>
        ) : null}
        {pending.current ? (
          <Button
            label="Check this voice instruction"
            secondary
            loading={busy}
            onPress={() => {
              void check();
            }}
          />
        ) : null}
        {pending.current && canRetry ? (
          <Button
            label="Retry this same recording"
            secondary
            loading={busy}
            onPress={() => {
              void retrySame();
            }}
          />
        ) : null}
      </View>
      {captions && result ? (
        <View style={{ gap: 12 }}>
          {result.transcript ? <Text style={styles.text}>You: {result.transcript}</Text> : null}
          <Text style={styles.text}>klnk: {result.replyText}</Text>
        </View>
      ) : null}
      <Disclosure title="How recorded voice works">
        <Text style={styles.small}>
          OpenAI transcribes your bounded recording in the cloud. This device’s text-to-speech reads
          the authoritative reply; it is not native OpenAI Live. A recording stops after 30 seconds
          or on background. Ending voice stops capture and playback; an already delegated request
          may continue in your Inbox.
        </Text>
        <Text style={styles.small}>
          {Platform.OS === 'ios'
            ? 'Turn off iPhone Silent Mode if the device voice is inaudible. Playback completion cannot prove you heard the reply.'
            : 'Device speech availability and voice depend on this platform.'}
        </Text>
      </Disclosure>
    </Card>
  );
}
