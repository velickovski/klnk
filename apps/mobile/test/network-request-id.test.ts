import { afterEach, expect, it, vi } from 'vitest';
import { requestId } from '../src/features/network/request-id';

afterEach(() => vi.unstubAllGlobals());
it('uses the browser cryptographic UUID method with its required receiver', () => {
  const receiver = {
    randomUUID() {
      expect(this).toBe(receiver);
      return '00000000-0000-4000-8000-000000000001';
    },
  };
  vi.stubGlobal('crypto', receiver);
  expect(requestId()).toBe('00000000-0000-4000-8000-000000000001');
});
it('uses secure random bytes when randomUUID is unavailable', () => {
  const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(0));
  vi.stubGlobal('crypto', { getRandomValues });
  expect(requestId()).toBe('00000000-0000-4000-8000-000000000000');
  expect(getRandomValues).toHaveBeenCalledOnce();
});
it('refuses to fabricate an insecure request identity in an unsupported browser', () => {
  vi.stubGlobal('crypto', undefined);
  expect(() => requestId()).toThrow(
    /Secure request identifiers are unavailable.*draft is retained/,
  );
});
