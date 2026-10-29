import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { api } from '../src/api';
import { ThemeProvider } from '../src/design/ThemeProvider';
import { NetworkSessionProvider } from '../src/features/network/data-provider';
import { InboxPanel } from '../src/features/network/InboxPanel';
import { CalendarPanel } from '../src/features/network/CalendarPanel';
import { PeoplePanel } from '../src/features/network/PeoplePanel';
import { MemoryPanel } from '../src/features/network/MemoryPanel';
import { AutonomyPanel } from '../src/features/network/AutonomyPanel';
import { NotificationsPanel } from '../src/features/network/NotificationsPanel';
import { PreferencesPanel } from '../src/features/network/PreferencesPanel';
import { VoiceAccessPanel } from '../src/features/network/VoiceAccessPanel';
import { OwnerIntentPanel } from '../src/features/network/OwnerIntentPanel';
import {
  ownerId,
  peerId,
  conversationId,
  responses,
  connection,
  conversation,
  event,
  memory,
  enabledPolicy,
  populatedVoice,
} from './fixtures';

const mockedApi = jest.mocked(api);
let values: Record<string, unknown>;
beforeEach(() => {
  values = responses();
  mockedApi.mockImplementation(async <T,>(path: string): Promise<T> => {
    if (path in values) return values[path] as T;
    if (path.startsWith('/network/owner-intents/'))
      return { commandId: path.split('/').pop(), status: 'processing' } as T;
    throw new Error('No local component fixture for this endpoint.');
  });
});
const wrap = (children: React.ReactNode) => (
  <ThemeProvider>
    <NetworkSessionProvider>{children}</NetworkSessionProvider>
  </ThemeProvider>
);
type PanelCase = {
  name: string;
  element: React.ReactNode;
  path: string;
  loading: string;
  empty: string;
  populated: string;
  populate: () => void;
};
const cases: PanelCase[] = [
  {
    name: 'Inbox',
    element: <InboxPanel ownerId={ownerId} />,
    path: '/network/conversations',
    loading: 'Loading your Inbox…',
    empty: 'No internal requests yet',
    populated: 'Fictional launch update',
    populate: () => {
      values['/network/conversations'] = { conversations: [conversation], unread: 1 };
    },
  },
  {
    name: 'Calendar',
    element: <CalendarPanel ownerId={ownerId} />,
    path: '/network/calendar',
    loading: 'Loading calendar',
    empty: 'No shared meetings yet',
    populated: 'Fictional launch meeting',
    populate: () => {
      values['/network/calendar'] = { events: [event], reminders: [], scope: 'klnk_only' };
    },
  },
  {
    name: 'People',
    element: <PeoplePanel ownerId={ownerId} />,
    path: '/network/connections',
    loading: 'Loading your connections…',
    empty: 'No connections yet',
    populated: 'Fictional Jordan',
    populate: () => {
      values['/network/connections'] = { connections: [connection] };
    },
  },
  {
    name: 'Memory',
    element: <MemoryPanel ownerId={ownerId} />,
    path: '/network/memories',
    loading: 'Loading your memory…',
    empty: 'Your context starts with you',
    populated: 'Fictional private context',
    populate: () => {
      values['/network/memories'] = { memories: [memory] };
    },
  },
  {
    name: 'Autonomy',
    element: <AutonomyPanel ownerId={ownerId} />,
    path: '/network/policy',
    loading: 'Loading your saved delegation…',
    empty: 'Autonomy off',
    populated: 'Scoped autonomy enabled',
    populate: () => {
      values['/network/policy'] = enabledPolicy;
      values['/network/connections'] = { connections: [connection] };
    },
  },
  {
    name: 'Notices',
    element: <NotificationsPanel ownerId={ownerId} />,
    path: '/network/notifications',
    loading: 'Loading in-app notices…',
    empty: 'No unread notices.',
    populated: 'Your decision is needed',
    populate: () => {
      values['/network/notifications'] = {
        items: [
          { id: conversationId, conversationId, kind: 'decision', at: new Date().toISOString() },
        ],
        delivery: 'in_app',
      };
    },
  },
  {
    name: 'Preferences',
    element: <PreferencesPanel ownerId={ownerId} />,
    path: '/network/preferences',
    loading: 'Loading saved preferences…',
    empty: '30 days',
    populated: '7 days',
    populate: () => {
      values['/network/preferences'] = {
        ownerId,
        version: 2,
        updatedAt: new Date().toISOString(),
        retentionDays: 7,
        notificationMode: 'quiet',
      };
    },
  },
  {
    name: 'Voice access',
    element: <VoiceAccessPanel ownerId={ownerId} />,
    path: '/tools/access',
    loading: 'Checking your voice grant…',
    empty: 'Internal voice permissions off',
    populated: 'Internal voice permissions on',
    populate: () => {
      values['/tools/access'] = populatedVoice();
      values['/network/policy'] = enabledPolicy;
    },
  },
];

describe.each(cases)('$name rendered states', (panel) => {
  it('shows loading while the selected resource is unresolved', async () => {
    const normal = mockedApi.getMockImplementation()!;
    mockedApi.mockImplementation(<T,>(path: string, method?: string, body?: unknown) =>
      path === panel.path ? new Promise<T>(() => undefined) : normal<T>(path, method, body),
    );
    await render(wrap(panel.element));
    expect(screen.getByText(panel.loading)).toBeOnTheScreen();
  });
  it('shows an empty or safe default state after a successful read', async () => {
    await render(wrap(panel.element));
    expect(await screen.findByText(panel.empty)).toBeOnTheScreen();
  });
  it('shows a recoverable read error instead of an invented result', async () => {
    const normal = mockedApi.getMockImplementation()!;
    mockedApi.mockImplementation(<T,>(path: string, method?: string, body?: unknown) =>
      path === panel.path
        ? Promise.reject(new Error('Local fixture is offline'))
        : normal<T>(path, method, body),
    );
    await render(wrap(panel.element));
    expect(await screen.findByText(/Local fixture is offline/)).toBeOnTheScreen();
  });
  it('renders populated data from the confirmed local response', async () => {
    panel.populate();
    await render(wrap(panel.element));
    expect(await screen.findByText(panel.populated)).toBeOnTheScreen();
    if (panel.name === 'Preferences')
      expect(screen.getByRole('radio', { name: '7 days' })).toBeChecked();
  });
});

describe('owner instruction states', () => {
  async function prepare() {
    await render(wrap(<OwnerIntentPanel ownerId={ownerId} />));
    await fireEvent.changeText(
      screen.getByLabelText('Instruction to your agent'),
      'Tell Fictional Jordan that this is an exact message.',
    );
  }
  it('starts empty with sending disabled', async () => {
    await render(wrap(<OwnerIntentPanel ownerId={ownerId} />));
    expect(screen.getByRole('button', { name: 'Send to my agent' })).toBeDisabled();
  });
  it('retains the instruction while its submission is unresolved', async () => {
    const normal = mockedApi.getMockImplementation()!;
    mockedApi.mockImplementation(<T,>(path: string, method?: string, body?: unknown) =>
      path === '/network/owner-intents' && method === 'POST'
        ? new Promise<T>(() => undefined)
        : normal<T>(path, method, body),
    );
    await prepare();
    await fireEvent.press(screen.getByRole('button', { name: 'Send to my agent' }));
    expect(screen.getByRole('button', { name: 'Check this instruction' })).toBeDisabled();
    expect(screen.getByLabelText('Instruction to your agent')).toHaveDisplayValue(
      'Tell Fictional Jordan that this is an exact message.',
    );
  });
  it('reports a submission failure and retains the same instruction for readback', async () => {
    const normal = mockedApi.getMockImplementation()!;
    mockedApi.mockImplementation(<T,>(path: string, method?: string, body?: unknown) =>
      path.startsWith('/network/owner-intents')
        ? Promise.reject(new Error('Instruction fixture is offline'))
        : normal<T>(path, method, body),
    );
    await prepare();
    await fireEvent.press(screen.getByRole('button', { name: 'Send to my agent' }));
    expect(await screen.findByText(/Instruction fixture is offline/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Retry this same instruction' })).toBeOnTheScreen();
  });
  it('shows the actual recorded result and never substitutes an audio claim', async () => {
    const normal = mockedApi.getMockImplementation()!;
    mockedApi.mockImplementation(
      async <T,>(path: string, method?: string, body?: unknown): Promise<T> => {
        if (path.startsWith('/network/owner-intents'))
          return { commandId: conversationId, status: 'submitted', conversation } as T;
        return normal<T>(path, method, body);
      },
    );
    await prepare();
    await fireEvent.press(screen.getByRole('button', { name: 'Send to my agent' }));
    expect(await screen.findByText(conversation.summary)).toBeOnTheScreen();
    expect(screen.queryByText(/spoken delivery confirmed/i)).not.toBeOnTheScreen();
  });
});

describe('lazy panel draft and link behavior', () => {
  it('retains a memory draft across panel unmounts within the same signed-in provider', async () => {
    const tree = (show: boolean) => wrap(show ? <MemoryPanel ownerId={ownerId} /> : null);
    const view = await render(tree(true));
    await screen.findByText('Your context starts with you');
    await fireEvent.press(screen.getByRole('button', { name: 'Add network memory' }));
    await fireEvent.changeText(
      screen.getByLabelText('Memory text'),
      'Keep this unsaved private draft',
    );
    await view.rerender(tree(false));
    await view.rerender(tree(true));
    expect(screen.getByLabelText('Memory text')).toHaveDisplayValue(
      'Keep this unsaved private draft',
    );
  });
  it('links a notice to its exact conversation without treating opening as approval', async () => {
    const open = jest.fn();
    values['/network/notifications'] = {
      items: [{ id: peerId, conversationId, kind: 'decision', at: new Date().toISOString() }],
      delivery: 'in_app',
    };
    await render(wrap(<NotificationsPanel ownerId={ownerId} onConversation={open} />));
    await screen.findByText('Your decision is needed');
    await fireEvent.press(screen.getByRole('button', { name: 'Open notice conversation' }));
    expect(open).toHaveBeenCalledWith(conversationId);
    expect(mockedApi.mock.calls.every((call) => call[1] !== 'POST')).toBe(true);
  });
  it('preserves an uncertain command nonce and late completion while its panel is absent', async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise<unknown>((done) => {
      finish = done;
    });
    const normal = mockedApi.getMockImplementation()!;
    mockedApi.mockImplementation(<T,>(path: string, method?: string, body?: unknown) =>
      path === '/network/owner-intents' && method === 'POST'
        ? (pending as Promise<T>)
        : normal<T>(path, method, body),
    );
    const tree = (show: boolean) => wrap(show ? <OwnerIntentPanel ownerId={ownerId} /> : null);
    const view = await render(tree(true));
    await fireEvent.changeText(
      screen.getByLabelText('Instruction to your agent'),
      'Tell Fictional Jordan that keep this exact text.',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Send to my agent' }));
    const submitted = mockedApi.mock.calls.find(
      (call) => call[0] === '/network/owner-intents' && call[1] === 'POST',
    )?.[2] as { commandId: string; text: string };
    await view.rerender(tree(false));
    const result = { commandId: submitted.commandId, status: 'submitted', conversation };
    values[`/network/owner-intents/${submitted.commandId}`] = result;
    await act(async () => {
      finish(result);
      await pending;
    });
    await view.rerender(tree(true));
    expect(await screen.findByText(conversation.summary)).toBeOnTheScreen();
    expect(
      mockedApi.mock.calls.filter(
        (call) => call[0] === '/network/owner-intents' && call[1] === 'POST',
      ),
    ).toHaveLength(1);
  });
});
