import React from 'react';
import { expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { LaunchScreen } from '../src/features/launch/LaunchScreen';
import { nativeLiveSnapshot, type LiveConversation } from '../src/features/live/types';

function voice(): LiveConversation {
  return {
    ...nativeLiveSnapshot,
    start: jest.fn(async () => {}),
    end: jest.fn(async () => {}),
    toggleMute: jest.fn(),
    toggleCaptions: jest.fn(),
    enableAudio: jest.fn(async () => {}),
  };
}

it('keeps the native recorded-voice opening to one action and delegates only on intent', async () => {
  const live = voice(),
    onCall = jest.fn();
  await render(
    <LaunchScreen live={live} recordedAvailable onCall={onCall} onWorkspace={jest.fn()} />,
  );
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Open workspace' })).not.toBeOnTheScreen();
  expect(onCall).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Call klnk' }));
  expect(onCall).toHaveBeenCalledTimes(1);
  expect(live.start).not.toHaveBeenCalled();
});

it('offers typed workspace recovery immediately when neither voice transport is available', async () => {
  const open = jest.fn();
  await render(<LaunchScreen live={voice()} onWorkspace={open} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Open workspace' }));
  expect(open).toHaveBeenCalledTimes(1);
});

it('keeps uncertain closure visible and blocks another start', async () => {
  const live = { ...voice(), state: 'error' as const, closureUnconfirmed: true };
  await render(<LaunchScreen live={live} onWorkspace={jest.fn()} />);
  expect(screen.queryByRole('button', { name: 'Call klnk' })).not.toBeOnTheScreen();
  expect(screen.getByText(/Server session closure is still unconfirmed/)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Open workspace' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry ending session' }));
  expect(live.end).toHaveBeenCalledTimes(1);
  expect(live.start).not.toHaveBeenCalled();
});

it('shows actual conversation controls and blocked-playback recovery without feature marketing', async () => {
  const live = { ...voice(), state: 'connected' as const, supported: true, audioBlocked: true };
  await render(<LaunchScreen live={live} onWorkspace={jest.fn()} />);
  expect(screen.queryByText('Meetings')).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Call klnk' })).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Enable spoken audio' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Unmute' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Captions' }));
  await fireEvent.press(screen.getByRole('button', { name: 'End call' }));
  expect(live.enableAudio).toHaveBeenCalledTimes(1);
  expect(live.toggleMute).toHaveBeenCalledTimes(1);
  expect(live.toggleCaptions).toHaveBeenCalledTimes(1);
  expect(live.end).toHaveBeenCalledTimes(1);
});
