import { describe, expect, it, vi } from 'vitest';
import { NetworkDataClient, NetworkDraftStore } from '../src/features/network/data-client';
import { deviceTimezone, formatDateTime } from '../src/features/network/format';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('session-owned keyed network data', () => {
  it('shares one connections request and cached value across simultaneous panel subscribers', async () => {
    const response = deferred<unknown>(),
      transport = vi.fn(() => response.promise),
      client = new NetworkDataClient(transport);
    const first = vi.fn(),
      second = vi.fn();
    const stopFirst = client.subscribe('/network/connections', first),
      stopSecond = client.subscribe('/network/connections', second);
    const read = client.read('/network/connections');
    response.resolve({ connections: [{ id: 'fictional' }] });
    await read;
    expect(transport).toHaveBeenCalledTimes(1);
    expect(client.snapshot('/network/connections').data).toEqual({
      connections: [{ id: 'fictional' }],
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    await client.read('/network/connections');
    expect(transport).toHaveBeenCalledTimes(1);
    stopFirst();
    stopSecond();
    client.dispose();
  });
  it('does not rerender subscribers for unchanged poll results', async () => {
    const transport = vi.fn(async () => ({ conversations: [], unread: 0 })),
      client = new NetworkDataClient(transport);
    const notified = vi.fn(),
      stop = client.subscribe('/network/conversations', notified);
    await client.read('/network/conversations');
    const snapshot = client.snapshot('/network/conversations');
    await client.read('/network/conversations', true);
    expect(client.snapshot('/network/conversations')).toBe(snapshot);
    expect(notified).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(2);
    stop();
    client.dispose();
  });
  it('invalidates readbacks after an unknown mutation without ever retrying the mutation', async () => {
    let value = 0;
    const transport = vi.fn(async (_path: string, method?: string) => {
      if (method === 'POST') {
        value++;
        throw new Error('Response lost after fictional commit');
      }
      return { value };
    });
    const client = new NetworkDataClient(transport),
      stop = client.subscribe('/network/calendar', () => undefined);
    await client.read('/network/calendar');
    await expect(
      client.request('/network/conversations', 'POST', { requestId: 'same-id' }),
    ).rejects.toThrow('Response lost');
    await vi.waitFor(() => expect(client.snapshot('/network/calendar').data).toEqual({ value: 1 }));
    expect(transport.mock.calls.filter((call) => call[1] === 'POST')).toHaveLength(1);
    stop();
    client.dispose();
  });
  it('fences an old GET when a mutation invalidates it and reads the current result afterward', async () => {
    const old = deferred<unknown>();
    let gets = 0;
    const client = new NetworkDataClient(async (_path, method) =>
      method === 'POST' ? { ok: true } : ++gets === 1 ? old.promise : { version: 2 },
    );
    const stop = client.subscribe('/network/conversations', () => undefined),
      before = client.read('/network/conversations');
    await client.request('/network/conversations/new', 'POST', {});
    old.resolve({ version: 1 });
    await before;
    await vi.waitFor(() =>
      expect(client.snapshot('/network/conversations').data).toEqual({ version: 2 }),
    );
    expect(gets).toBe(2);
    stop();
    client.dispose();
  });
  it('pauses background reads and revalidates subscribed resources on foreground', async () => {
    const transport = vi.fn(async () => ({ version: 1 })),
      client = new NetworkDataClient(transport);
    client.setActive(false);
    const stop = client.subscribe('/network/connections', () => undefined);
    client.refresh();
    expect(transport).not.toHaveBeenCalled();
    client.setActive(true);
    await client.read('/network/connections');
    expect(transport).toHaveBeenCalledTimes(1);
    client.setActive(false);
    client.invalidate();
    client.refresh();
    expect(transport).toHaveBeenCalledTimes(1);
    client.setActive(true);
    await client.read('/network/connections');
    expect(transport).toHaveBeenCalledTimes(2);
    stop();
    client.dispose();
  });
  it('retains confirmed data with a refresh error and clears the error after a successful retry', async () => {
    let fail = false;
    const client = new NetworkDataClient(async () => {
      if (fail) throw new Error('Offline fixture');
      return { events: [] };
    });
    await client.read('/network/calendar');
    fail = true;
    await expect(client.read('/network/calendar', true)).rejects.toThrow('Offline fixture');
    expect(client.snapshot('/network/calendar')).toMatchObject({
      data: { events: [] },
      error: 'Offline fixture',
      loading: false,
    });
    fail = false;
    await client.read('/network/calendar', true);
    expect(client.snapshot('/network/calendar').error).toBe('');
    client.dispose();
  });
  it('isolates account scopes and ignores a late result after disposal', async () => {
    const late = deferred<unknown>(),
      first = new NetworkDataClient(() => late.promise),
      second = new NetworkDataClient(async () => ({ owner: 'second' }));
    const pending = first.read('/network/memories');
    first.dispose();
    late.resolve({ owner: 'first' });
    await pending;
    expect(first.snapshot('/network/memories').data).toBeUndefined();
    await second.read('/network/memories');
    expect(second.snapshot('/network/memories').data).toEqual({ owner: 'second' });
    await expect(first.read('/network/memories')).rejects.toThrow('session ended');
    second.dispose();
  });
  it('only fetches resources with active subscribers during a poll', async () => {
    const transport = vi.fn(async (_path: string) => ({})),
      client = new NetworkDataClient(transport);
    await client.read('/network/memories');
    const stop = client.subscribe('/network/connections', () => undefined);
    await client.read('/network/connections');
    transport.mockClear();
    client.refresh();
    await client.read('/network/connections');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toBe('/network/connections');
    stop();
    client.dispose();
  });
});

describe('RAM-only panel draft ownership', () => {
  it('retains form values and a pending immutable operation across panel remounts', () => {
    const store = new NetworkDraftStore();
    store.ensure('owner:inbox:draft', () => ({ message: '' }));
    store.set('owner:inbox:draft', { message: 'Keep my unfinished instruction' });
    const pending = store.ensure('owner:intent:pending', () => ({
      current: { commandId: 'same-id', text: 'Exact original text' },
    }));
    expect(store.ensure('owner:inbox:draft', () => ({ message: 'replacement' }))).toEqual({
      message: 'Keep my unfinished instruction',
    });
    expect(store.ensure('owner:intent:pending', () => ({ current: undefined }))).toBe(pending);
    const other = new NetworkDraftStore();
    expect(other.get('owner:inbox:draft')).toBeUndefined();
    store.clear();
    expect(store.get('owner:intent:pending')).toBeUndefined();
  });
});

describe('shared visible date formatting', () => {
  it('formats the requested meeting timezone and reports invalid dates honestly', () => {
    expect(formatDateTime('2026-10-28T14:00:00Z', 'Europe/Skopje', 'en-GB')).toContain('15:00');
    expect(formatDateTime('not-a-date')).toBe('Time unavailable');
    expect(formatDateTime('2026-10-28T14:00:00Z', 'Invalid/Timezone')).toBe('Time unavailable');
    expect(deviceTimezone()).toBeTruthy();
  });
});
