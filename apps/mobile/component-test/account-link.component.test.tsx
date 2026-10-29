import React from 'react';
import { beforeEach, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import App from '../App';
import { api } from '../src/api';
jest.mock(
  'react-native-safe-area-context',
  () =>
    jest.requireActual<{ default: Record<string, unknown> }>(
      'react-native-safe-area-context/jest/mock',
    ).default,
);
jest.mock('../src/features/network/data-provider', () => ({
  NetworkSessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../src/api', () => ({
  api: jest.fn(),
  getSessionSnapshot: () => ({ generation: 1, url: 'https://fictional.example', token: null }),
  isSessionCurrent: () => true,
  restoreSession: jest.fn(async () => null),
  onSessionChange: () => () => undefined,
  setSession: jest.fn(async () => undefined),
}));
jest.mock('../src/features/live/useLiveConversation', () => ({
  useLiveConversation: () => ({
    end: async () => undefined,
    closureUnconfirmed: false,
    state: 'idle',
  }),
}));
jest.mock('../src/features/launch/LaunchScreen', () => ({ LaunchScreen: () => null }));
jest.mock('../src/legacy/LegacyWorkspace', () => ({ LegacyAgentWorkspace: () => null }));
jest.mock('../src/features/network/NetworkAgent', () => ({ NetworkAgentWorkspace: () => null }));

let incoming: ((event: { url: string }) => void) | undefined;
const mockedApi = jest.mocked(api);
beforeEach(() => {
  incoming = undefined;
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
  jest.spyOn(Linking, 'addEventListener').mockImplementation((_type, handler) => {
    incoming = handler;
    return { remove: jest.fn() };
  });
  mockedApi.mockImplementation(async <T,>(): Promise<T> => ({ ok: true }) as T);
});
const link = (kind: 'verify' | 'reset' | 'email-change', letter: string) =>
  `klnk://account/#account=${kind}&token=${letter.repeat(43)}`;
async function receive(url: string) {
  await act(() => incoming?.({ url }));
}

it('replaces an incoming account-proof form, clears the prior password and selects the correct endpoint', async () => {
  await render(<App />);
  await receive(link('verify', 'a'));
  await fireEvent.changeText(screen.getByLabelText('Password'), 'Fictional first password');
  await receive(link('reset', 'b'));
  expect(screen.getByRole('header', { name: 'Choose a new password' })).toBeOnTheScreen();
  expect(screen.getByLabelText('New password')).toHaveDisplayValue('');
  expect(screen.queryByRole('button', { name: 'Verify email' })).not.toBeOnTheScreen();
  await fireEvent.changeText(
    screen.getByLabelText('New password'),
    'Fictional replacement password',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Set new password' }));
  expect(mockedApi).toHaveBeenCalledWith('/auth/reset', 'POST', {
    token: 'b'.repeat(43),
    newPassword: 'Fictional replacement password',
  });
});

it('does not let an old proof completion dismiss a newer incoming proof', async () => {
  let finish: ((value: unknown) => void) | undefined;
  mockedApi.mockImplementation(async <T,>(path: string): Promise<T> =>
    path === '/auth/verify-email'
      ? new Promise<T>((resolve) => {
          finish = (value) => resolve(value as T);
        })
      : ({ ok: true } as T),
  );
  await render(<App />);
  await receive(link('verify', 'c'));
  await fireEvent.changeText(screen.getByLabelText('Password'), 'Fictional current password');
  await fireEvent.press(screen.getByRole('button', { name: 'Verify email' }));
  await receive(link('reset', 'd'));
  await act(() => finish?.({ ok: true, sessionsRevoked: true }));
  expect(screen.getByRole('header', { name: 'Choose a new password' })).toBeOnTheScreen();
  expect(screen.getByLabelText('New password')).toHaveDisplayValue('');
});
