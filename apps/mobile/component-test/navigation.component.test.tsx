import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { api } from '../src/api';
import { ThemeProvider } from '../src/design/ThemeProvider';
import { NetworkSessionProvider } from '../src/features/network/data-provider';
import { NetworkWorkspace } from '../src/features/network/Workspace';
import { ownerId, responses } from './fixtures';

const mockedApi = jest.mocked(api);
beforeEach(() => {
  const values = responses();
  mockedApi.mockImplementation(async <T,>(path: string): Promise<T> => values[path] as T);
});
const workspace = () => (
  <ThemeProvider>
    <NetworkSessionProvider>
      <NetworkWorkspace
        ownerId={ownerId}
        onVoiceHome={() => undefined}
        onSignOut={() => undefined}
      />
    </NetworkSessionProvider>
  </ThemeProvider>
);

describe('actual lazy network navigation', () => {
  it('mounts only the active panel and shares connections across settings consumers', async () => {
    await render(workspace());
    await screen.findByText('No internal requests yet');
    expect(mockedApi.mock.calls.some((call) => call[0] === '/network/memories')).toBe(false);
    expect(mockedApi.mock.calls.some((call) => call[0] === '/network/policy')).toBe(false);
    await fireEvent.press(screen.getByRole('tab', { name: 'Settings' }));
    await screen.findByText('Autonomy off');
    expect(screen.queryByText('No internal requests yet')).not.toBeOnTheScreen();
    expect(mockedApi.mock.calls.filter((call) => call[0] === '/network/connections')).toHaveLength(
      1,
    );
    expect(mockedApi.mock.calls.filter((call) => call[0] === '/network/policy')).toHaveLength(1);
  });
  it('keeps an unsaved form when navigating away and returning through the real router', async () => {
    await render(workspace());
    await screen.findByText('No internal requests yet');
    await fireEvent.press(screen.getByRole('tab', { name: 'Memory' }));
    await screen.findByText('Your context starts with you');
    await fireEvent.press(screen.getByRole('button', { name: 'Add network memory' }));
    await fireEvent.changeText(
      screen.getByLabelText('Memory text'),
      'Keep a draft through real tab navigation',
    );
    await fireEvent.press(screen.getByRole('tab', { name: 'People' }));
    await screen.findByText('No connections yet');
    expect(screen.queryByLabelText('Memory text')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: 'Memory' }));
    expect(screen.getByLabelText('Memory text')).toHaveDisplayValue(
      'Keep a draft through real tab navigation',
    );
  });
  it('offers progressive setup on Inbox without enabling saved delegation', async () => {
    await render(workspace());
    await screen.findByText('Make klnk yours');
    await fireEvent.press(screen.getByRole('button', { name: '1. Connect your first person' }));
    await screen.findByText('No connections yet');
    expect(mockedApi.mock.calls.some((call) => call[1] && call[1] !== 'GET')).toBe(false);
    await fireEvent.press(screen.getByRole('tab', { name: 'Inbox' }));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Keep meetings under my review for now' }),
    );
    expect(screen.queryByText('Make klnk yours')).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: 'Calendar' }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Inbox' }));
    expect(screen.queryByText('Make klnk yours')).not.toBeOnTheScreen();
    expect(mockedApi.mock.calls.some((call) => call[1] && call[1] !== 'GET')).toBe(false);
  });
});
