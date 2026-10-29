import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { api } from '../src/api';
import { ThemeProvider } from '../src/design/ThemeProvider';
import { NetworkSessionProvider } from '../src/features/network/data-provider';
import { ConversationActions } from '../src/features/network/ConversationActions';
import { AvailabilityPanel } from '../src/features/network/AvailabilityPanel';
import { AutonomyPanel } from '../src/features/network/AutonomyPanel';
import { NetworkBusySchema, type NetworkConversation } from '@personal-agent/domain';
import { ownerId, peerId, conversation, event, responses, policy } from './fixtures';

const mockedApi = jest.mocked(api);
let values: Record<string, unknown>;
beforeEach(() => {
  values = responses();
  mockedApi.mockImplementation(async <T,>(path: string): Promise<T> => values[path] as T);
});
const wrap = (children: React.ReactNode) => (
  <ThemeProvider>
    <NetworkSessionProvider>{children}</NetworkSessionProvider>
  </ThemeProvider>
);
const question: NetworkConversation = {
  ...conversation,
  initiatorId: peerId,
  recipientId: ownerId,
  state: 'awaiting_approval',
  request: { ...conversation.request, kind: 'ask', message: 'Which entrance should we use?' },
  decisionOwnerIds: [ownerId],
};
const meeting: NetworkConversation = {
  ...conversation,
  state: 'awaiting_approval',
  request: { ...conversation.request, kind: 'meeting', candidateSlots: [event.terms.slot] },
  proposal: {
    id: event.id,
    version: 1,
    hash: event.proposalHash,
    terms: event.terms,
    expiresAt: conversation.request.expiresAt,
  },
  decisionOwnerIds: [ownerId],
};

describe('recipient answers and counterproposals', () => {
  it('sends only the exact human reply and never treats another owner as the recipient', async () => {
    const answer = jest.fn(),
      counter = jest.fn();
    await render(
      wrap(
        <ConversationActions
          conversation={question}
          ownerId={ownerId}
          busy={false}
          onAnswer={answer}
          onCounter={counter}
        />,
      ),
    );
    expect(screen.getByText(question.request.message)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Your exact reply'), 'Use the west entrance.');
    await fireEvent.press(screen.getByRole('button', { name: 'Send this exact reply' }));
    expect(answer).toHaveBeenCalledWith('Use the west entrance.');
    expect(counter).not.toHaveBeenCalled();
  });
  it('does not show answer or counter controls to an owner who is not a decision maker', async () => {
    await render(
      wrap(
        <ConversationActions
          conversation={question}
          ownerId={peerId}
          busy={false}
          onAnswer={() => undefined}
          onCounter={() => undefined}
        />,
      ),
    );
    expect(screen.queryByLabelText('Your exact reply')).not.toBeOnTheScreen();
  });
  it('keeps counterproposal terms version-bound and refuses to submit a stale draft', async () => {
    const counter = jest.fn();
    const tree = (value: NetworkConversation) =>
      wrap(
        <ConversationActions
          conversation={value}
          ownerId={ownerId}
          busy={false}
          onAnswer={() => undefined}
          onCounter={counter}
        />,
      );
    const view = await render(tree(meeting));
    await fireEvent.press(screen.getByRole('button', { name: 'Suggest another meeting time' }));
    expect(counter).not.toHaveBeenCalled();
    await view.rerender(tree({ ...meeting, version: meeting.version + 1 }));
    expect(screen.getByRole('button', { name: 'Send this counterproposal' })).toBeDisabled();
    expect(screen.getByText(/request changed while you edited/)).toBeOnTheScreen();
  });
});

describe('explicit private availability maintenance', () => {
  it('confirms a bounded manual source without turning on delegation', async () => {
    const normal = mockedApi.getMockImplementation()!;
    mockedApi.mockImplementation(
      async <T,>(path: string, method?: string, body?: unknown): Promise<T> => {
        if (path === '/network/calendar/availability' && method === 'PUT')
          return {
            ownerId,
            source: 'manual',
            ...(body as object),
            updatedAt: new Date().toISOString(),
          } as T;
        return normal<T>(path, method, body);
      },
    );
    await render(wrap(<AvailabilityPanel ownerId={ownerId} />));
    await screen.findByText('Manual availability needs your review');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Confirm my manual calendar for 7 days' }),
    );
    const request = mockedApi.mock.calls.find(
      (call) => call[0] === '/network/calendar/availability',
    );
    const through = Date.parse((request?.[2] as { confirmedThrough: string }).confirmedThrough);
    expect(through).toBeGreaterThan(Date.now() + 6 * 86400000);
    expect(through).toBeLessThanOrEqual(Date.now() + 7 * 86400000);
    expect(
      mockedApi.mock.calls.some((call) => call[0] === '/network/policy' && call[1] === 'PUT'),
    ).toBe(false);
  });
  it('reads back a lost busy-block result instead of creating a duplicate on retry', async () => {
    const normal = mockedApi.getMockImplementation()!;
    mockedApi.mockImplementation(
      async <T,>(path: string, method?: string, body?: unknown): Promise<T> => {
        if (path === '/network/calendar/busy' && method === 'POST') {
          const saved = NetworkBusySchema.parse({
            ...(body as object),
            id: peerId,
            ownerId,
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          values['/network/calendar'] = {
            events: [],
            reminders: [],
            scope: 'klnk_only',
            busyBlocks: [saved],
            availability: null,
          };
          throw new Error('Busy response lost after fictional commit');
        }
        return normal<T>(path, method, body);
      },
    );
    await render(wrap(<AvailabilityPanel ownerId={ownerId} />));
    await screen.findByText('Manual availability needs your review');
    await fireEvent.press(screen.getByRole('button', { name: 'Add a private busy block' }));
    await fireEvent.changeText(
      screen.getByLabelText('Busy block label'),
      'Fictional private appointment',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Save private busy block' }));
    await screen.findByText(/Busy response lost after fictional commit/);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Check and retry this same busy block' }),
    );
    await screen.findByText(
      'Busy time saved privately. Other members do not receive its label or details.',
    );
    expect(
      mockedApi.mock.calls.filter(
        (call) => call[0] === '/network/calendar/busy' && call[1] === 'POST',
      ),
    ).toHaveLength(1);
  });
});

describe('a rule draft never silently adopts a newer server revision', () => {
  it('keeps the edited fields and original expected revision after refresh', async () => {
    values['/network/policy'] = { ...policy, authorityVersions: { ask: 1, meeting: 1 } };
    mockedApi.mockImplementation(async <T,>(path: string, method?: string): Promise<T> => {
      if (path === '/network/policy' && method === 'PUT')
        throw new Error('Fictional stale policy revision');
      return values[path] as T;
    });
    await render(wrap(<AutonomyPanel ownerId={ownerId} />));
    await screen.findByText('Autonomy off');
    await fireEvent.press(screen.getByRole('button', { name: 'Advanced delegation settings' }));
    await fireEvent.changeText(screen.getByLabelText('Permitted topics'), 'unsaved owner topic');
    values['/network/policy'] = {
      ...policy,
      version: 2,
      topics: ['changed elsewhere'],
      authorityVersions: { ask: 1, meeting: 1 },
    };
    await fireEvent.press(screen.getByRole('button', { name: 'Refresh saved autonomy' }));
    expect(await screen.findByText(/Saved rules changed while you were editing/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Permitted topics')).toHaveDisplayValue('unsaved owner topic');
    await fireEvent.press(screen.getByRole('button', { name: 'Save delegation settings' }));
    const call = mockedApi.mock.calls.find(
      (entry) => entry[0] === '/network/policy' && entry[1] === 'PUT',
    );
    expect(call?.[2]).toMatchObject({ expectedVersion: 1 });
    expect((call?.[2] as { policy: object }).policy).not.toHaveProperty('authorityVersions');
    await screen.findByText(/Fictional stale policy revision/);
    expect(screen.getByLabelText('Permitted topics')).toHaveDisplayValue('unsaved owner topic');
  });
});
