import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import * as Speech from 'expo-speech';
import { api, ApiError } from '../src/api';
import { useVoiceIO } from '../src/voice-io';
import type { VoiceIO, VoiceIOOptions } from '../src/voice-types';
import { ThemeProvider } from '../src/design/ThemeProvider';
import { NetworkSessionProvider } from '../src/features/network/data-provider';
import { NativeVoicePanel } from '../src/features/network/NativeVoicePanel';
import { ownerId } from './fixtures';

jest.mock('../src/voice-io', () => ({ useVoiceIO: jest.fn() }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(async () => {}) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000077' }));
jest.mock('../src/api', () => ({
  api: jest.fn(),
  ApiError: class extends Error {
    status: number;
    code?: string;
    constructor(message: string, statusCode: number, errorCode?: string) {
      super(message);
      this.status = statusCode;
      this.code = errorCode;
    }
  },
  getSessionSnapshot: () => ({ generation: 1, url: 'http://localhost:4000', token: 'fictional' }),
  isSessionCurrent: () => true,
  onSessionChange: () => () => undefined,
}));

const mockedApi = jest.mocked(api),
  mockedVoice = jest.mocked(useVoiceIO);
let voice: VoiceIO;
const recording = { audioBase64: 'ZmljdGlvbmFs', mimeType: 'audio/mp4' };
const review = { commandId: '00000000-0000-4000-8000-000000000088', planHash: 'aa'.repeat(32) };
const reply = {
  schemaVersion: 1,
  turnId: '00000000-0000-4000-8000-000000000077',
  status: 'completed',
  replyText: 'Fictional exact readback. Nothing has been sent.',
  speechSource: 'device',
  audioStored: false,
  review,
};
beforeEach(() => {
  jest.restoreAllMocks();
  (AppState as { currentState: AppStateStatus }).currentState = 'active';
  voice = {
    available: true,
    listening: false,
    speaking: false,
    pending: false,
    source: 'recorded',
    start: jest.fn(async () => {}),
    stop: jest.fn(async () => {}),
    send: jest.fn(async () => {}),
    cancel: jest.fn(async () => {}),
    speak: jest.fn(async () => {}),
    silence: jest.fn(),
  };
  mockedVoice.mockReturnValue(voice);
  mockedApi.mockImplementation(async <T,>(path: string): Promise<T> => {
    if (path === '/network/voice/status') return { available: true } as T;
    if (path === '/network/voice/turn') return reply as T;
    throw new Error('Unexpected component fixture endpoint');
  });
});
const wrap = (onClose = jest.fn()) => (
  <ThemeProvider>
    <NetworkSessionProvider>
      <NativeVoicePanel ownerId={ownerId} autoStart onClose={onClose} />
    </NetworkSessionProvider>
  </ThemeProvider>
);
const options = () => mockedVoice.mock.calls.at(-1)![0] as VoiceIOOptions;

describe('independent rendered recorded voice controls with injected capture and speech', () => {
  it('does not capture when server availability is off', async () => {
    mockedApi.mockImplementation(async <T,>(): Promise<T> => ({ available: false }) as T);
    await render(wrap());
    expect(await screen.findByText(/OpenAI transcription is unavailable/)).toBeOnTheScreen();
    expect(voice.start).not.toHaveBeenCalled();
    expect(Speech.speak).not.toHaveBeenCalled();
  });

  it('reads the actual server reply, then resumes capture and carries exact review into the next spoken turn', async () => {
    await render(wrap());
    expect(voice.start).toHaveBeenCalledTimes(1);
    await act(async () => {
      await options().onInput(recording);
    });
    expect(Speech.speak).toHaveBeenCalledWith(
      reply.replyText,
      expect.objectContaining({ onDone: expect.any(Function) }),
    );
    expect(mockedApi.mock.calls.filter(([path]) => path === '/network/voice/turn')).toHaveLength(1);
    await act(async () => {
      jest.mocked(Speech.speak).mock.calls.at(-1)![1]!.onDone?.();
    });
    expect(voice.start).toHaveBeenCalledTimes(2);
    await act(async () => {
      await options().onInput(recording);
    });
    expect(
      mockedApi.mock.calls.filter(([path]) => path === '/network/voice/turn').at(-1)![2],
    ).toMatchObject({ review });
  });

  it('keeps an uncertain submission identifier and resends only after explicit same-recording review', async () => {
    mockedApi.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === '/network/voice/status') return { available: true } as T;
      if (path === '/network/voice/turn') throw new Error('Fictional network interruption');
      if (path.startsWith('/network/voice/turns/'))
        throw new ApiError('No receipt yet.', 404, 'not_found');
      throw new Error('Unexpected fixture endpoint');
    });
    await render(wrap());
    await act(async () => {
      await options().onInput(recording);
    });
    const first = mockedApi.mock.calls.find(([path]) => path === '/network/voice/turn')![2];
    expect(
      screen.queryByRole('button', { name: 'Retry this same recording' }),
    ).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Check this voice instruction' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Retry this same recording' }));
    const submissions = mockedApi.mock.calls.filter(([path]) => path === '/network/voice/turn');
    expect(submissions).toHaveLength(2);
    expect(submissions[1][2]).toEqual(first);
    expect(Speech.speak).not.toHaveBeenCalled();
  });

  it('stops capture on background and suppresses a late result rather than speaking it to a departed owner', async () => {
    let done!: (value: unknown) => void;
    const callbacks: Array<(state: AppStateStatus) => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
      callbacks.push(callback);
      return { remove: jest.fn() };
    });
    mockedApi.mockImplementation(async <T,>(path: string): Promise<T> =>
      path === '/network/voice/status'
        ? ({ available: true } as T)
        : new Promise((resolve) => {
            done = resolve as (value: unknown) => void;
          }),
    );
    const rendered = await render(wrap());
    let submission!: Promise<void>;
    await act(async () => {
      submission = options().onInput(recording);
    });
    await act(async () => {
      (AppState as { currentState: AppStateStatus }).currentState = 'background';
      callbacks.forEach((callback) => callback('background'));
      done(reply);
      await submission;
    });
    expect(voice.cancel).toHaveBeenCalled();
    expect(Speech.stop).toHaveBeenCalled();
    expect(Speech.speak).not.toHaveBeenCalled();
    await rendered.unmount();
  });
});
