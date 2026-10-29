import React from 'react';
import { expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { api } from '../src/api';
import { ThemeProvider } from '../src/design/ThemeProvider';
import { NetworkSessionProvider } from '../src/features/network/data-provider';
import { InboxPanel } from '../src/features/network/InboxPanel';
import { conversation, ownerId, responses } from './fixtures';

it.each(['success', 'failure'] as const)(
  'a late detail %s cannot reopen a sheet closed while its refresh was pending',
  async (outcome) => {
    const values = responses();
    values['/network/conversations'] = { conversations: [conversation], unread: 1 };
    let resolve: ((value: unknown) => void) | undefined,
      reject: ((reason: Error) => void) | undefined;
    const pending = new Promise<unknown>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const mockedApi = jest.mocked(api);
    mockedApi.mockImplementation(async <T,>(path: string): Promise<T> =>
      path === `/network/conversations/${conversation.id}`
        ? (pending as Promise<T>)
        : (values[path] as T),
    );
    await render(
      <ThemeProvider>
        <NetworkSessionProvider>
          <InboxPanel ownerId={ownerId} />
        </NetworkSessionProvider>
      </ThemeProvider>,
    );
    await fireEvent.press(
      await screen.findByRole('button', { name: `Open request: ${conversation.request.purpose}` }),
    );
    // Existing recorded content is immediately available while its GET is pending.
    const close = screen.getByRole('button', { name: `Close ${conversation.request.purpose}` });
    await fireEvent.press(close);
    expect(
      screen.queryByRole('button', { name: `Close ${conversation.request.purpose}` }),
    ).not.toBeOnTheScreen();
    await act(() => {
      if (outcome === 'success') resolve?.(conversation);
      else reject?.(new Error('Fictional late read failure'));
    });
    expect(
      screen.queryByRole('button', { name: `Close ${conversation.request.purpose}` }),
    ).not.toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: `Open request: ${conversation.request.purpose}` }),
    ).toBeOnTheScreen();
    expect(
      mockedApi.mock.calls.filter(([path]) => path === `/network/conversations/${conversation.id}`),
    ).toHaveLength(1);
  },
);
