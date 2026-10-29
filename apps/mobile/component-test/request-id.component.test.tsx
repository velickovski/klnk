import { expect, it, jest } from '@jest/globals';
import * as Crypto from 'expo-crypto';
import { requestId } from '../src/features/network/request-id';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000001'),
}));
it('resolves the native identifier transport without depending on Hermes global Web Crypto', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  try {
    expect(requestId()).toBe('00000000-0000-4000-8000-000000000001');
    expect(Crypto.randomUUID).toHaveBeenCalledTimes(1);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
});
