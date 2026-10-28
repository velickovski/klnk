import { useEffect, useRef, useState } from 'react';
import type { VoiceIO, VoiceIOOptions, VoiceReply } from './voice-types';
import { TURN_LIMITS } from './end-of-turn';

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type VoiceWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
/** Optional workspace speech service. GPT-Live uses its separate authenticated WebRTC adapter. */
export function useVoiceIO(options: VoiceIOOptions): VoiceIO {
  const current = useRef(options);
  current.current = options;
  const recognition = useRef<Recognition | null>(null),
    audio = useRef<HTMLAudioElement | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    held = useRef(''),
    generation = useRef(0),
    playback = useRef(0),
    starting = useRef(false),
    capturing = useRef(false),
    forceHold = useRef(false),
    mounted = useRef(true);
  const [listening, setListening] = useState(false),
    [speaking, setSpeaking] = useState(false),
    [pending, setPending] = useState(false);
  const browser = typeof window !== 'undefined' ? (window as VoiceWindow) : undefined;
  const Constructor = browser?.SpeechRecognition ?? browser?.webkitSpeechRecognition;
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const silence = () => {
    playback.current++;
    browser?.speechSynthesis?.cancel();
    if (audio.current) {
      audio.current.onended = null;
      audio.current.onerror = null;
      audio.current.pause();
      audio.current.src = '';
      audio.current = null;
    }
    if (mounted.current) setSpeaking(false);
  };
  const send = async () => {
    const text = held.current.trim();
    if (!text) return;
    held.current = '';
    setPending(false);
    await current.current.onInput({ text });
  };
  const cancel = async () => {
    generation.current++;
    clearTimer();
    held.current = '';
    capturing.current = false;
    if (recognition.current) {
      recognition.current.onresult = null;
      recognition.current.onerror = null;
      recognition.current.onend = null;
      recognition.current.abort();
      recognition.current = null;
    }
    if (mounted.current) {
      setListening(false);
      setPending(false);
    }
  };
  const start = async () => {
    if (capturing.current || starting.current || held.current) return;
    silence();
    if (!Constructor) {
      current.current.onError(
        'This browser does not provide speech recognition. Choose Type, or use Call klnk for the live browser transport.',
      );
      return;
    }
    starting.current = true;
    const cancelled = cancel();
    const turn = generation.current;
    await cancelled;
    if (turn !== generation.current || !mounted.current || document.visibilityState === 'hidden') {
      starting.current = false;
      return;
    }
    forceHold.current = false;
    try {
      const input = new Constructor();
      recognition.current = input;
      input.continuous = !!current.current.manualSend;
      input.interimResults = false;
      input.lang = 'en-US';
      input.onresult = (event) => {
        if (turn !== generation.current) return;
        held.current = Array.from(event.results as ArrayLike<any>)
          .map((result) => result[0]?.transcript ?? '')
          .join(' ')
          .trim();
        if (!current.current.manualSend && !forceHold.current) {
          input.onend = null;
          capturing.current = false;
          input.stop();
          clearTimer();
          setListening(false);
          void send().catch((error) => current.current.onError(error.message));
        }
      };
      input.onerror = (event) => {
        if (turn !== generation.current) return;
        clearTimer();
        capturing.current = false;
        setListening(false);
        if (held.current) setPending(true);
        current.current.onError(
          event.error === 'not-allowed'
            ? 'Allow microphone access in this browser to speak with your agent.'
            : `Browser speech recognition could not finish (${event.error ?? 'unavailable'}). Your captured text, if any, is available to send.`,
        );
      };
      input.onend = () => {
        if (turn !== generation.current) return;
        clearTimer();
        capturing.current = false;
        setListening(false);
        if (held.current) setPending(true);
      };
      input.start();
      capturing.current = true;
      setListening(true);
      timer.current = setTimeout(() => {
        forceHold.current = true;
        input.stop();
      }, TURN_LIMITS.maximumMs);
    } catch (error) {
      capturing.current = false;
      setListening(false);
      current.current.onError(
        error instanceof Error ? error.message : 'The browser microphone is unavailable.',
      );
    } finally {
      starting.current = false;
    }
  };
  const stop = async () => {
    forceHold.current = !!current.current.manualSend;
    recognition.current?.stop();
  };
  const speak = async (reply: VoiceReply) => {
    silence();
    const generation = playback.current;
    if (reply.audioBase64) {
      const player = new Audio(
        `data:${reply.audioMimeType ?? 'audio/mpeg'};base64,${reply.audioBase64}`,
      );
      audio.current = player;
      player.onended = () => {
        if (mounted.current && generation === playback.current) {
          setSpeaking(false);
          current.current.onPlaybackEnd?.();
        }
      };
      player.onerror = () => {
        if (mounted.current && generation === playback.current) {
          setSpeaking(false);
          current.current.onError('The spoken reply could not be played.');
        }
      };
      try {
        await player.play();
        if (mounted.current && generation === playback.current) setSpeaking(true);
      } catch {
        if (mounted.current && generation === playback.current)
          current.current.onError(
            'Tap Hear that again to allow this browser to play the spoken reply.',
          );
      }
      return;
    }
    if (!browser?.speechSynthesis) {
      current.current.onError(
        'This browser cannot speak the reply aloud. The reply is shown in the conversation.',
      );
      return;
    }
    const utterance = new SpeechSynthesisUtterance(reply.text);
    utterance.lang = 'en-US';
    utterance.rate = 1;
    utterance.onend = () => {
      if (mounted.current && generation === playback.current) {
        setSpeaking(false);
        current.current.onPlaybackEnd?.();
      }
    };
    utterance.onerror = () => {
      if (mounted.current && generation === playback.current) setSpeaking(false);
    };
    browser.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };
  useEffect(() => {
    mounted.current = true;
    const hide = () => {
      if (document.visibilityState !== 'visible') {
        silence();
        void cancel();
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', hide);
      silence();
      void cancel();
    };
  }, []);
  return {
    listening,
    speaking,
    pending,
    available: !!Constructor,
    source: 'Browser speech recognition · device voice when provider speech is unavailable',
    start,
    stop,
    send,
    cancel,
    speak,
    silence,
  };
}
