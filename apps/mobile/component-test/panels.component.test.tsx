import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { api } from '../src/api';
import { ThemeProvider } from '../src/design/ThemeProvider';
import { NetworkSessionProvider } from '../src/features/network/data-provider';
import { PeoplePanel } from '../src/features/network/PeoplePanel';

const ownerId = '00000000-0000-4000-8000-000000000001';
const mockedApi = jest.mocked(api);
beforeEach(() => {
  mockedApi.mockImplementation(async <T,>(path: string): Promise<T> => {
    const value =
      path === '/network/identity'
        ? {
            member: {
              id: ownerId,
              name: 'Fictional Owner',
              memberCode: 'klnk_fictionalComponentCode',
            },
          }
        : { connections: [] };
    return value as T;
  });
});
describe('rendered network panels', () => {
  it('renders the actual People empty state after its local response', async () => {
    await render(
      <ThemeProvider>
        <NetworkSessionProvider>
          <PeoplePanel ownerId={ownerId} />
        </NetworkSessionProvider>
      </ThemeProvider>,
    );
    expect(await screen.findByText('No connections yet')).toBeOnTheScreen();
    expect(screen.getByLabelText('Member code')).toBeOnTheScreen();
  });
});
