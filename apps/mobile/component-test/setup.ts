import { jest } from '@jest/globals';

// Native views use the official Expo/RN preset. HTTP, decorative font glyphs
// and explicit OS notification boundaries use fictional fixtures.
jest.mock('../src/api', () => ({
  api: jest.fn(),
  getSessionSnapshot: () => ({
    generation: 1,
    url: 'http://localhost:4000',
    token: 'fictional-component-session',
  }),
  isSessionCurrent: () => true,
  onSessionChange: jest.fn(() => () => undefined),
}));
jest.mock('../src/components/Icon', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  return {
    Icon: ({ name }: { name: string }) =>
      React.createElement(Text, { accessibilityElementsHidden: true }, name),
  };
});
globalThis.fetch = jest.fn(async () => {
  throw new Error('Component-test network access is disabled.');
}) as typeof fetch;

// OS scheduling and permission prompts are injected, never performed in Jest.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({
    granted: false,
    status: 'undetermined',
    canAskAgain: true,
  })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  getPresentedNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  dismissNotificationAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(
    async (request: { identifier?: string }) => request.identifier ?? 'fictional-reminder-id',
  ),
  requestPermissionsAsync: jest.fn(async () => {
    throw new Error('Permission prompts require an explicit component-test fixture.');
  }),
  IosAuthorizationStatus: {
    NOT_DETERMINED: 0,
    DENIED: 1,
    AUTHORIZED: 2,
    PROVISIONAL: 3,
    EPHEMERAL: 4,
  },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { DEFAULT: 3 },
}));
