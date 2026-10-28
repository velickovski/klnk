import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import type { VoiceInput, VoiceIO, VoiceIOOptions, VoiceReply } from './voice-types';
import { advanceTurnMeter, TURN_LIMITS, type TurnMeter } from './end-of-turn';

/** Bounded recorded turns, distinct from the browser-only GPT-Live transport. */
export function useVoiceIO(options: VoiceIOOptions): VoiceIO {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 100);
  const player = useAudioPlayer(null);
  const [listening, setListening] = useState(false),
    [speaking, setSpeaking] = useState(false),
    [pending, setPending] = useState(false);
  const current = useRef(options);
  current.current = options;
  const active = useRef(false),
    starting = useRef(false),
    mounted = useRef(true),
    generation = useRef(0),
    playback = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    cache = useRef<File | null>(null),
    held = useRef<VoiceInput | null>(null),
    meter = useRef<TurnMeter | null>(null);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const silence = () => {
    playback.current++;
    player.pause();
    if (mounted.current) setSpeaking(false);
  };
  const send = async () => {
    const input = held.current;
    if (!input) return;
    held.current = null;
    setPending(false);
    await current.current.onInput(input);
  };
  const finish = async (hold: boolean) => {
    if (!active.current) return;
    const turn = generation.current;
    active.current = false;
    meter.current = null;
    clearTimer();
    if (mounted.current) setListening(false);
    let file: File | null = null;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!recorder.uri) throw new Error('No recording was captured. Please try again.');
      file = new File(recorder.uri);
      const audioBase64 = await file.base64();
      if (turn !== generation.current || !mounted.current || AppState.currentState !== 'active')
        return;
      const input = { audioBase64, mimeType: 'audio/mp4' };
      if (hold) {
        held.current = input;
        setPending(true);
      } else await current.current.onInput(input);
    } catch (error) {
      if (turn === generation.current && mounted.current)
        current.current.onError(
          error instanceof Error ? error.message : 'Could not finish this voice message.',
        );
    } finally {
      if (file?.exists) file.delete();
    }
  };
  const cancel = async () => {
    generation.current++;
    clearTimer();
    meter.current = null;
    held.current = null;
    if (mounted.current) {
      setPending(false);
      setListening(false);
    }
    const wasActive = active.current;
    active.current = false;
    if (wasActive) {
      try {
        await recorder.stop();
      } finally {
        await setAudioModeAsync({ allowsRecording: false });
        if (recorder.uri) {
          const file = new File(recorder.uri);
          if (file.exists) file.delete();
        }
      }
    }
  };
  const start = async () => {
    if (active.current || starting.current || held.current || AppState.currentState !== 'active')
      return;
    const turn = ++generation.current;
    starting.current = true;
    silence();
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (turn !== generation.current || !mounted.current || AppState.currentState !== 'active')
        return;
      if (!permission.granted)
        throw new Error(
          'Microphone access is off. Enable it in iPhone Settings to speak, or choose Type.',
        );
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (turn !== generation.current || !mounted.current || AppState.currentState !== 'active') {
        await setAudioModeAsync({ allowsRecording: false });
        if (recorder.uri) {
          const file = new File(recorder.uri);
          if (file.exists) file.delete();
        }
        return;
      }
      recorder.record();
      active.current = true;
      meter.current = { startedAtMs: 0 };
      setListening(true);
      timer.current = setTimeout(() => {
        void finish(true);
      }, TURN_LIMITS.maximumMs);
    } catch (error) {
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      if (recorder.uri) {
        const file = new File(recorder.uri);
        if (file.exists) file.delete();
      }
      if (turn === generation.current && mounted.current)
        current.current.onError(
          error instanceof Error ? error.message : 'Could not start the microphone.',
        );
    } finally {
      starting.current = false;
    }
  };
  const speak = async (reply: VoiceReply) => {
    silence();
    const generation = playback.current;
    if (!reply.audioBase64) return;
    try {
      if (cache.current?.exists) cache.current.delete();
      const extension = reply.audioMimeType?.includes('wav') ? 'wav' : 'mp3';
      const file = new File(Paths.cache, `agent-reply-${Date.now()}.${extension}`);
      await file.write(reply.audioBase64, { encoding: 'base64' });
      cache.current = file;
      if (!mounted.current || generation !== playback.current) {
        if (file.exists) file.delete();
        return;
      }
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!mounted.current || generation !== playback.current) {
        if (file.exists) file.delete();
        return;
      }
      player.replace(file.uri);
      player.play();
      setSpeaking(true);
    } catch (error) {
      if (mounted.current)
        current.current.onError(
          error instanceof Error ? error.message : 'The spoken reply could not be played.',
        );
    }
  };
  useEffect(() => {
    if (!active.current || !recorderState.isRecording || !meter.current) return;
    const decision = advanceTurnMeter(
      meter.current,
      recorderState.durationMillis,
      recorderState.metering,
      current.current.manualSend,
    );
    meter.current = decision.state;
    if (decision.action === 'submit') void finish(false);
    else if (decision.action === 'hold') void finish(true);
    else if (decision.action === 'cancel_silence')
      void cancel()
        .then(() =>
          current.current.onError(
            'No speech was detected. The recording was discarded. Choose manual send if you need longer pauses.',
          ),
        )
        .catch(() => current.current.onError('Could not close the recording.'));
  }, [recorderState.isRecording, recorderState.durationMillis, recorderState.metering]);
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        silence();
        void cancel().catch(() => {});
      }
    });
    return () => {
      mounted.current = false;
      subscription.remove();
      silence();
      void cancel().catch(() => {});
    };
  }, [recorder]);
  useEffect(() => {
    const subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish && mounted.current) {
        setSpeaking(false);
        current.current.onPlaybackEnd?.();
      }
    });
    return () => {
      subscription.remove();
      if (cache.current?.exists) cache.current.delete();
    };
  }, [player]);
  return {
    listening,
    speaking,
    pending,
    available: true,
    source:
      'iPhone recorded turns · 30-second capture limit · native live transport is not implemented',
    start,
    stop: () => finish(!!current.current.manualSend),
    send,
    cancel,
    speak,
    silence,
  };
}
