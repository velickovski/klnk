import { describe, expect, it, vi } from 'vitest';
import {
  CalendarConnectionsController,
  canConnectCalendar,
  canDisconnectCalendar,
  connectionPresentation,
  pendingGoogleAuthorization,
  safeGoogleAuthorization,
  type CalendarConnection,
} from '../src/features/settings/connections';

function connection(
  status: CalendarConnection['status'],
  overrides: Partial<CalendarConnection> = {},
): CalendarConnection {
  return {
    id: 'fictional-owner:google-calendar',
    kind: 'google_calendar',
    name: 'Google Calendar',
    status,
    available: status === 'connected',
    reasonCode:
      status === 'unavailable'
        ? 'oauth_not_configured'
        : status === 'connecting'
          ? 'oauth_pending'
          : status === 'connected'
            ? 'authorized'
            : 'not_connected',
    detail: 'Fictional status fixture',
    capabilities: { readExisting: status === 'connected', updateExisting: status === 'connected' },
    ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
function harness(initial = connection('disconnected')) {
  const server = {
    row: initial,
    failure: '',
    begin: undefined as (() => Promise<unknown>) | undefined,
    disconnect: undefined as (() => Promise<unknown>) | undefined,
  };
  const receipt = {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=fictional-state',
    expiresAt: Date.now() + 600_000,
  };
  const requests = vi.fn(
    async (path: string, method = 'GET', _body?: unknown): Promise<unknown> => {
      if (server.failure) throw new Error(server.failure);
      if (path === '/integrations') return [server.row];
      if (path === '/integrations/google-calendar' && method === 'GET') return server.row;
      if (path === '/integrations/google-calendar/connect' && method === 'POST') {
        if (server.begin) return server.begin();
        server.row = connection('connecting');
        return receipt;
      }
      if (path === '/integrations/google-calendar/connect' && method === 'DELETE') {
        server.row = connection('disconnected');
        return { ok: true, connection: server.row };
      }
      if (path === '/integrations/google-calendar' && method === 'DELETE') {
        if (server.disconnect) return server.disconnect();
        server.row = connection('revoked', { reasonCode: 'provider_revoked' });
        return { ok: true, connection: server.row };
      }
      throw new Error('Unexpected fixture request');
    },
  );
  const request = async <T>(path: string, method?: string, body?: unknown): Promise<T> =>
    (await requests(path, method, body)) as T;
  const open = vi.fn(async (_url: string) => undefined);
  let current = true;
  const controller = new CalendarConnectionsController(request, open, () => current);
  return {
    server,
    receipt,
    requests,
    open,
    controller,
    changeOwner: () => {
      current = false;
    },
  };
}

describe('SETTINGS-03 Google Calendar state and action boundaries', () => {
  it('keeps configured disconnected access connectable despite available:false and blocks missing configuration', () => {
    expect(canConnectCalendar(connection('disconnected', { available: false }))).toBe(true);
    expect(canConnectCalendar(connection('unavailable'))).toBe(false);
    expect(canConnectCalendar(connection('connected'))).toBe(false);
    expect(canConnectCalendar(connection('revoke_pending'))).toBe(false);
  });
  it.each(['expired', 'revoked', 'insufficient_scope', 'error'] as const)(
    'offers explicit reconnect for %s',
    (status) => {
      expect(canConnectCalendar(connection(status))).toBe(true);
    },
  );
  it('distinguishes pending browser authorization from a backend token refresh', () => {
    expect(pendingGoogleAuthorization(connection('connecting'))).toBe(true);
    expect(
      pendingGoogleAuthorization(connection('connecting', { reasonCode: 'token_refreshing' })),
    ).toBe(false);
    expect(canConnectCalendar(connection('connecting'))).toBe(false);
  });
  it('reports pending revocation and connection errors without success labels', () => {
    expect(connectionPresentation('revoke_pending')).toMatchObject({
      label: 'Revocation pending',
      tone: 'amber',
    });
    expect(connectionPresentation('error').tone).toBe('amber');
    expect(canDisconnectCalendar(connection('revoke_pending'))).toBe(true);
    expect(canDisconnectCalendar(connection('disconnected'))).toBe(false);
  });
  it.each([
    'http://accounts.google.com/o/oauth2/v2/auth',
    'https://evil.example/o/oauth2/v2/auth',
    'https://accounts.google.com/other',
    'https://user:password@accounts.google.com/o/oauth2/v2/auth',
    'https://accounts.google.com/o/oauth2/v2/auth#fragment',
  ])('rejects unsafe authorization URL %s', (authorizationUrl) => {
    expect(safeGoogleAuthorization({ authorizationUrl, expiresAt: Date.now() + 60_000 })).toBe(
      false,
    );
  });
  it('rejects expired/invalid authorization receipts and permits only the fixed Google endpoint', () => {
    const authorizationUrl = 'https://accounts.google.com/o/oauth2/v2/auth?state=fictional';
    expect(safeGoogleAuthorization({ authorizationUrl, expiresAt: Date.now() - 1 })).toBe(false);
    expect(safeGoogleAuthorization({ authorizationUrl, expiresAt: Number.NaN })).toBe(false);
    expect(safeGoogleAuthorization({ authorizationUrl, expiresAt: Date.now() + 60_000 })).toBe(
      true,
    );
  });
});

describe('SETTINGS-03 owner-bound Calendar connection controller', () => {
  it('loads authoritative missing configuration without offering or starting authorization', async () => {
    const f = harness(connection('unavailable'));
    expect(await f.controller.refresh()).toBe(true);
    expect(await f.controller.connect(f.server.row)).toBe(false);
    expect(f.requests).toHaveBeenCalledTimes(1);
    expect(f.open).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().connections[0]?.status).toBe('unavailable');
  });
  it('opens a validated browser link but stays connecting until an explicit status refresh reports connected', async () => {
    const f = harness();
    await f.controller.refresh();
    expect(await f.controller.connect(f.server.row)).toBe(true);
    expect(f.open).toHaveBeenCalledWith(f.receipt.authorizationUrl);
    expect(f.controller.getSnapshot().connections[0]?.status).toBe('connecting');
    expect(f.controller.getSnapshot().message).toContain('does not confirm a connection');
    f.server.row = connection('connected');
    expect(f.controller.getSnapshot().connections[0]?.status).toBe('connecting');
    await f.controller.refresh();
    expect(f.controller.getSnapshot().connections[0]?.status).toBe('connected');
    expect(f.controller.getSnapshot().authorization).toBeNull();
  });
  it('does not duplicate pending connect requests or run a concurrent refresh', async () => {
    const f = harness(),
      pending = deferred<unknown>();
    await f.controller.refresh();
    f.server.begin = () => pending.promise;
    const first = f.controller.connect(f.server.row);
    expect(await f.controller.connect(f.server.row)).toBe(false);
    expect(await f.controller.refresh()).toBe(false);
    pending.resolve(f.receipt);
    expect(await first).toBe(true);
    expect(
      f.requests.mock.calls.filter(
        ([path, method]) => path.endsWith('/connect') && method === 'POST',
      ),
    ).toHaveLength(1);
  });
  it('requires status refresh before retrying an unconfirmed authorization start', async () => {
    const f = harness();
    await f.controller.refresh();
    f.server.failure = 'Fictional connection lost';
    expect(await f.controller.connect(f.server.row)).toBe(false);
    const count = f.requests.mock.calls.length;
    f.server.failure = '';
    expect(await f.controller.connect(f.server.row)).toBe(false);
    expect(f.requests).toHaveBeenCalledTimes(count);
    await f.controller.refresh();
    expect(await f.controller.connect(f.server.row)).toBe(true);
  });
  it('keeps pending authorization recoverable after browser failure without exposing URL details in errors', async () => {
    const f = harness();
    await f.controller.refresh();
    f.open.mockRejectedValueOnce(new Error('Private URL query should not become an error'));
    expect(await f.controller.connect(f.server.row)).toBe(false);
    expect(f.controller.getSnapshot().authorization).not.toBeNull();
    expect(f.controller.getSnapshot().error).not.toContain('Private URL');
    expect(await f.controller.openAuthorization()).toBe(true);
    expect(f.controller.getSnapshot().connections[0]?.status).toBe('connecting');
  });
  it('cancels pending browser authorization through its separate server route', async () => {
    const f = harness();
    await f.controller.refresh();
    await f.controller.connect(f.server.row);
    expect(await f.controller.cancelAuthorization()).toBe(true);
    expect(f.requests).toHaveBeenCalledWith(
      '/integrations/google-calendar/connect',
      'DELETE',
      undefined,
    );
    expect(f.controller.getSnapshot()).toMatchObject({
      authorization: null,
      connections: [expect.objectContaining({ status: 'disconnected' })],
    });
    expect(f.controller.getSnapshot().message).toContain('not a remote disconnect');
  });
  it('retains pending-revocation rows and only reports provider confirmation after the actual returned state', async () => {
    const f = harness(connection('connected'));
    await f.controller.refresh();
    f.server.disconnect = async () => {
      f.server.row = connection('revoke_pending', { reasonCode: 'revocation_pending' });
      return { ok: true, connection: f.server.row };
    };
    expect(await f.controller.disconnect(f.server.row)).toBe(true);
    expect(f.controller.getSnapshot().connections).toHaveLength(1);
    expect(f.controller.getSnapshot().connections[0]?.status).toBe('revoke_pending');
    expect(f.controller.getSnapshot().message).toContain('not confirmed');
    f.server.disconnect = undefined;
    await f.controller.disconnect(f.server.row);
    expect(f.controller.getSnapshot().connections[0]?.status).toBe('revoked');
    expect(f.controller.getSnapshot().message).toContain('Google confirmed revocation');
  });
  it('keeps the last reported row uncertain after a failed disconnect and allows explicit refresh recovery', async () => {
    const f = harness(connection('connected'));
    await f.controller.refresh();
    f.server.failure = 'Fictional revoke timeout';
    expect(await f.controller.disconnect(f.server.row)).toBe(false);
    expect(f.controller.getSnapshot()).toMatchObject({
      uncertain: true,
      connections: [expect.objectContaining({ status: 'connected' })],
      message: '',
    });
    f.server.failure = '';
    f.server.row = connection('revoke_pending');
    await f.controller.refresh();
    expect(f.controller.getSnapshot()).toMatchObject({
      uncertain: false,
      connections: [expect.objectContaining({ status: 'revoke_pending' })],
    });
  });
  it('does not open or apply a delayed owner-A authorization response after the account changes', async () => {
    const f = harness(),
      pending = deferred<unknown>();
    await f.controller.refresh();
    f.server.begin = () => pending.promise;
    const connecting = f.controller.connect(f.server.row);
    f.changeOwner();
    pending.resolve(f.receipt);
    expect(await connecting).toBe(false);
    expect(f.open).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().authorization).toBeNull();
    const ownerB = harness();
    expect(ownerB.controller.getSnapshot().connections).toEqual([]);
  });
  it('ignores late status responses after panel disposal', async () => {
    const pending = deferred<CalendarConnection[]>();
    const controller = new CalendarConnectionsController(
      async <T>() => (await pending.promise) as T,
      async () => undefined,
    );
    const refresh = controller.refresh();
    controller.dispose();
    pending.resolve([connection('connected')]);
    expect(await refresh).toBe(false);
    expect(controller.getSnapshot().connections).toEqual([]);
  });
});
