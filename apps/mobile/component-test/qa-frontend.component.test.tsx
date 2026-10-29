import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { api } from '../src/api';
import { ThemeProvider } from '../src/design/ThemeProvider';
import { NetworkSessionProvider, useNetworkQuery } from '../src/features/network/data-provider';
import { NetworkWorkspace } from '../src/features/network/Workspace';
import { MemoryPanel } from '../src/features/network/MemoryPanel';
import { PeoplePanel } from '../src/features/network/PeoplePanel';
import { AutonomyPanel } from '../src/features/network/AutonomyPanel';
import { InboxPanel } from '../src/features/network/InboxPanel';
import {
  connection,
  conversation,
  event,
  memory,
  ownerId,
  peerId,
  policy,
  responses,
} from './fixtures';

const mockedApi = jest.mocked(api);
let values: Record<string, unknown>;
beforeEach(() => {
  values = responses();
  mockedApi.mockImplementation(async <T,>(path: string): Promise<T> => values[path] as T);
});
const wrap = (children: React.ReactNode, scope = 'owner-one:origin-one') => (
  <ThemeProvider>
    <NetworkSessionProvider key={scope}>{children}</NetworkSessionProvider>
  </ThemeProvider>
);
function PolicyReadback() {
  const query = useNetworkQuery<{ version: number }>('/network/policy');
  return <Text>{`Observed policy revision ${query.data?.version ?? 'loading'}`}</Text>;
}

describe('independent rendered workspace state and cache boundaries', () => {
  it('keeps the originating row focusable while a detail refresh is pending and never reopens on its late completion', async () => {
    values['/network/connections'] = { connections: [connection] };
    values['/network/conversations'] = { conversations: [conversation], unread: 1 };
    let complete!: (value: unknown) => void;
    mockedApi.mockImplementation(async <T,>(path: string): Promise<T> =>
      path === `/network/conversations/${conversation.id}`
        ? new Promise((resolve) => {
            complete = resolve as (value: unknown) => void;
          })
        : (values[path] as T),
    );
    await render(wrap(<InboxPanel ownerId={ownerId} />));
    const trigger = await screen.findByRole('button', {
      name: `Open request: ${conversation.request.purpose}`,
    });
    await fireEvent.press(trigger);
    expect(trigger).not.toBeDisabled();
    const close = screen.getByRole('button', { name: `Close ${conversation.request.purpose}` });
    await fireEvent.press(close);
    expect(
      screen.queryByRole('button', { name: `Close ${conversation.request.purpose}` }),
    ).not.toBeOnTheScreen();
    await act(async () => complete(conversation));
    expect(
      screen.queryByRole('button', { name: `Close ${conversation.request.purpose}` }),
    ).not.toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: `Open request: ${conversation.request.purpose}` }),
    ).not.toBeDisabled();
  });
  it.each(['different-owner:same-origin', 'same-owner:different-origin'])(
    'clears cached private content and drafts when session scope changes to %s',
    async (scope) => {
      values['/network/memories'] = { memories: [memory] };
      const rendered = await render(wrap(<MemoryPanel ownerId={ownerId} />));
      await screen.findByText(memory.text);
      await fireEvent.press(screen.getByRole('button', { name: 'Add network memory' }));
      await fireEvent.changeText(
        screen.getByLabelText('Memory text'),
        'Private draft from the departed session',
      );
      values['/network/memories'] = { memories: [] };
      await rendered.rerender(
        wrap(
          <MemoryPanel ownerId={scope.startsWith('different-owner') ? peerId : ownerId} />,
          scope,
        ),
      );
      await screen.findByText('Your context starts with you');
      expect(screen.queryByText(memory.text)).not.toBeOnTheScreen();
      expect(screen.queryByLabelText('Memory text')).not.toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Add network memory' }));
      expect(screen.getByLabelText('Memory text')).toHaveDisplayValue('');
      expect(mockedApi.mock.calls.filter(([path]) => path === '/network/memories')).toHaveLength(2);
    },
  );

  it('invalidates another mounted consumer after one explicit connection mutation', async () => {
    values['/network/connections'] = { connections: [connection] };
    mockedApi.mockImplementation(async <T,>(path: string, method?: string): Promise<T> => {
      if (method === 'PATCH') {
        values['/network/policy'] = { ...policy, version: 2 };
        const next = { ...connection, mutedBy: [ownerId], version: connection.version + 1 };
        values['/network/connections'] = { connections: [next] };
        return next as T;
      }
      return values[path] as T;
    });
    await render(
      wrap(
        <>
          <PeoplePanel ownerId={ownerId} />
          <PolicyReadback />
        </>,
      ),
    );
    await screen.findByText('Observed policy revision 1');
    await fireEvent.press(await screen.findByRole('button', { name: 'Mute Fictional Jordan' }));
    await screen.findByText('Observed policy revision 2');
    expect(mockedApi.mock.calls.filter(([, method]) => method === 'PATCH')).toHaveLength(1);
    expect(mockedApi.mock.calls.filter(([path]) => path === '/network/policy')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Unmute Fictional Jordan' })).toBeOnTheScreen();
  });

  it('exposes current checked semantics while unsaved delegation changes do not mutate authority', async () => {
    values['/network/connections'] = { connections: [connection] };
    await render(wrap(<AutonomyPanel ownerId={ownerId} />));
    const enabled = await screen.findByRole('switch', { name: 'Enable background delegation' });
    expect(enabled).not.toBeChecked();
    await fireEvent(enabled, 'valueChange', true);
    expect(screen.getByRole('switch', { name: 'Enable background delegation' })).toBeChecked();
    await fireEvent.press(screen.getByRole('button', { name: 'Advanced delegation settings' }));
    const trust = screen.getByRole('checkbox', { name: 'Trust Fictional Jordan for delegation' });
    expect(trust).not.toBeChecked();
    await fireEvent.press(trust);
    expect(
      screen.getByRole('checkbox', { name: 'Trust Fictional Jordan for delegation' }),
    ).toBeChecked();
    expect(mockedApi.mock.calls.some(([, method]) => method && method !== 'GET')).toBe(false);
  });

  it('takes an actual Calendar event into the matching Inbox conversation through the router', async () => {
    values['/network/calendar'] = {
      events: [event],
      reminders: [],
      scope: 'klnk_only',
      busyBlocks: [],
      availability: null,
    };
    values['/network/connections'] = { connections: [connection] };
    values['/network/conversations'] = { conversations: [conversation], unread: 1 };
    values[`/network/conversations/${conversation.id}`] = conversation;
    await render(
      wrap(
        <NetworkWorkspace
          ownerId={ownerId}
          onVoiceHome={() => undefined}
          onSignOut={() => undefined}
        />,
      ),
    );
    await screen.findByRole('button', { name: `Open request: ${conversation.request.purpose}` });
    await fireEvent.press(screen.getByRole('tab', { name: 'Calendar' }));
    await fireEvent.press(
      await screen.findByRole('button', { name: `Open conversation: ${event.terms.purpose}` }),
    );
    expect(await screen.findByRole('header', { name: 'Inbox' })).toBeOnTheScreen();
    expect(
      (await screen.findAllByRole('header', { name: conversation.request.purpose })).length,
    ).toBeGreaterThan(0);
    expect(
      mockedApi.mock.calls.some(([path]) => path === `/network/conversations/${conversation.id}`),
    ).toBe(true);
  });
});
