import { describe, expect, it, vi } from 'vitest';
import type { ApplicationToolStatus, ToolTrace } from '@personal-agent/domain';
import { canEnableInAppTools, IN_APP_VOICE_TOOLS, recentToolDecisions, ToolAccessController, toolDecisionPresentation, toolPermissionName, type ToolAccess } from '../src/features/settings/tool-access';

const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
function access(enabled = false, runtimeAvailable = true, changes: Partial<ToolAccess['grant']> = {}): ToolAccess {
  return { grant: { id: `tool-access:${owner}`, ownerId: owner, version: 1, enabled, tools: [], updatedAt: '2026-10-27T12:00:00Z', ...changes }, runtimeAvailable, externalEffectsEnabled: false };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function trace(index: number, status: ApplicationToolStatus = 'succeeded'): ToolTrace {
  return { schemaVersion: 1, eventId: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`, occurredAt: `2026-10-27T12:${String(index).padStart(2, '0')}:00Z`, event: 'tool_result_reported', traceId: owner, requestId: owner, sessionRef: owner, ownerRef: owner, toolName: 'contacts_lookup', toolVersion: 1, adapter: 'application', status, reasonCode: 'lookup_complete', verification: 'local_commit', argumentSummary: { operation: 'lookup', resourceCount: 1 }, durationMs: 5 };
}
function harness(initial = access(), platform = 'web') {
  const server = { access: initial, events: [] as ToolTrace[], failRead: false, failWrite: false, failActivity: false, write: undefined as (() => Promise<ToolAccess>) | undefined };
  const calls = vi.fn(async (path: string, method = 'GET', body?: unknown): Promise<unknown> => {
    if (path === '/tools/traces') { if (server.failActivity) throw new Error('private_raw_reason_code'); return { events: server.events }; }
    if (path === '/tools/access' && method === 'GET') { if (server.failRead) throw new Error('private_raw_reason_code'); return server.access; }
    if (path === '/tools/access' && method === 'PUT') {
      if (server.failWrite) throw new Error('private_raw_reason_code');
      if (server.write) return server.write();
      const value = body as { enabled: boolean; tools: ToolAccess['grant']['tools'] };
      server.access = { ...server.access, grant: { ...server.access.grant, ...value } }; return server.access;
    }
    throw new Error('Unexpected fixture request');
  });
  const request = async <T>(path: string, method?: string, body?: unknown): Promise<T> => await calls(path, method, body) as T;
  let current = true;
  const controller = new ToolAccessController(request, owner, platform, () => current);
  return { controller, server, calls, changeOwner: () => { current = false; } };
}

describe('SETTINGS-03 in-app voice tool permission boundaries', () => {
  it('allows enable only on web with an available runtime and a verified off grant', () => {
    expect(canEnableInAppTools(access(), 'web')).toBe(true);
    expect(canEnableInAppTools(access(false, false), 'web')).toBe(false);
    expect(canEnableInAppTools(access(), 'ios')).toBe(false);
    expect(canEnableInAppTools(access(), 'android')).toBe(false);
    expect(canEnableInAppTools(access(true), 'web')).toBe(false);
    expect(canEnableInAppTools(access(), 'web', true)).toBe(false);
    expect(canEnableInAppTools(null, 'web')).toBe(false);
  });
  it('enables exactly the four in-app abilities without adding saved external-action tools', async () => {
    const f = harness(access(false, true, { tools: ['calendar_update_existing', 'request_dispatch'] }));
    await f.controller.refreshAccess(); expect(await f.controller.setEnabled(true)).toBe(true);
    expect(f.calls).toHaveBeenCalledWith('/tools/access', 'PUT', { enabled: true, tools: ['contacts_lookup', 'memory_lookup', 'request_prepare', 'request_status'] });
    expect(f.controller.getSnapshot().access?.grant.tools).toEqual(IN_APP_VOICE_TOOLS);
  });
  it.each(['web', 'ios', 'android'])('can turn off a known on grant on %s even when runtime is unavailable', async platform => {
    const f = harness(access(true, false, { tools: ['contacts_lookup', 'request_cancel'] }), platform);
    await f.controller.refreshAccess(); expect(await f.controller.setEnabled(false)).toBe(true);
    expect(f.calls).toHaveBeenCalledWith('/tools/access', 'PUT', { enabled: false, tools: ['contacts_lookup', 'request_cancel'] });
    expect(f.controller.getSnapshot().access?.grant.enabled).toBe(false);
  });
  it('makes no optimistic state change and suppresses duplicate writes while pending', async () => {
    const f = harness(), pending = deferred<ToolAccess>(); await f.controller.refreshAccess(); f.server.write = () => pending.promise;
    const saving = f.controller.setEnabled(true);
    expect(f.controller.getSnapshot().access?.grant.enabled).toBe(false);
    expect(await f.controller.setEnabled(true)).toBe(false); expect(await f.controller.refreshAccess()).toBe(false);
    expect(f.calls.mock.calls.filter(([, method]) => method === 'PUT')).toHaveLength(1);
    pending.resolve(access(true)); expect(await saving).toBe(true); expect(f.controller.getSnapshot().access?.grant.enabled).toBe(true);
  });
  it('keeps the last confirmed on state after an unknown turn-off response and recovers by refresh', async () => {
    const f = harness(access(true)); await f.controller.refreshAccess(); f.server.failWrite = true;
    expect(await f.controller.setEnabled(false)).toBe(false);
    expect(f.controller.getSnapshot()).toMatchObject({ uncertain: true, access: { grant: { enabled: true } }, message: '' });
    expect(f.controller.getSnapshot().accessError).not.toContain('private_raw_reason_code');
    f.server.failWrite = false; f.server.access = access(false); await f.controller.refreshAccess();
    expect(f.controller.getSnapshot()).toMatchObject({ uncertain: false, access: { grant: { enabled: false } } });
  });
  it('blocks a second enable after an unconfirmed write until refreshed', async () => {
    const f = harness(); await f.controller.refreshAccess(); f.server.failWrite = true;
    await f.controller.setEnabled(true); f.server.failWrite = false;
    expect(await f.controller.setEnabled(true)).toBe(false);
    await f.controller.refreshAccess(); expect(await f.controller.setEnabled(true)).toBe(true);
  });
  it('retains known permissions after a failed read without exposing raw errors', async () => {
    const f = harness(access(true)); await f.controller.refreshAccess(); f.server.failRead = true;
    expect(await f.controller.refreshAccess()).toBe(false);
    expect(f.controller.getSnapshot().access?.grant.enabled).toBe(true);
    expect(f.controller.getSnapshot().accessError).not.toContain('private_raw_reason_code');
  });
  it('rejects another owner grant and ignores late permission writes after account change', async () => {
    const f = harness(access(false, true, { ownerId: other }));
    expect(await f.controller.refreshAccess()).toBe(false); expect(f.controller.getSnapshot().access).toBeNull();
    const own = harness(), pending = deferred<ToolAccess>(); await own.controller.refreshAccess(); own.server.write = () => pending.promise;
    const saving = own.controller.setEnabled(true); own.changeOwner(); pending.resolve(access(true));
    expect(await saving).toBe(false); expect(own.controller.getSnapshot().access?.grant.enabled).toBe(false);
    expect(harness().controller.getSnapshot().access).toBeNull();
  });
});

describe('SETTINGS-03 structural voice activity', () => {
  it.each([
    ['proposed', 'Proposed · review needed'], ['blocked', 'Blocked'], ['authorized', 'Authorized · not started'],
    ['queued', 'Queued'], ['running', 'In progress'], ['succeeded', 'Operation completed'],
    ['failed', 'Operation failed'], ['unknown', 'Outcome unconfirmed'], ['cancel_requested', 'Cancellation requested'], ['cancelled', 'Cancelled'],
  ] as const)('preserves %s status independently of a success-shaped event name', (status, label) => {
    const presentation = toolDecisionPresentation({ ...trace(1, status), event: 'tool_succeeded' });
    expect(presentation.label).toBe(label); expect(presentation.detail).not.toContain('call completed');
  });
  it('does not report completion from an unconfirmed verification or imply draft authorization', () => {
    expect(toolDecisionPresentation({ ...trace(1), verification: 'unconfirmed' }).label).toBe('Outcome unconfirmed');
    expect(toolDecisionPresentation({ ...trace(1), toolName: 'request_prepare' })).toMatchObject({ label: 'Draft prepared · review needed' });
  });
  it('selects the latest12 final decision events, excludes old/intermediate events, and does not mutate the source', () => {
    const events = Array.from({ length: 20 }, (_, index) => trace(index));
    events.push({ ...trace(21), event: 'tool_requested' }); events.push({ ...trace(22), occurredAt: '2026-10-01T12:00:00Z' });
    const result = recentToolDecisions(events, Date.parse('2026-10-27T13:00:00Z'));
    expect(result).toHaveLength(12); expect(result[0]?.eventId).toBe(trace(19).eventId); expect(result[11]?.eventId).toBe(trace(8).eventId);
    expect(events[0]?.eventId).toBe(trace(0).eventId);
  });
  it('presents saved tools as human names and never renders structural identifiers or raw reason codes', () => {
    const event = { ...trace(1), toolName: 'calendar_update_existing' as const, reasonCode: 'authorization_invalid' };
    const presentation = JSON.stringify(toolDecisionPresentation(event));
    expect(presentation).not.toContain(event.toolName); expect(presentation).not.toContain(event.reasonCode); expect(presentation).not.toContain(event.requestId);
    expect(Object.values(toolPermissionName).every(label => !label.includes('_'))).toBe(true);
  });
  it('loads activity separately, retains it on failure, and rejects another owner traces', async () => {
    const f = harness(); f.server.events = [trace(1)]; expect(await f.controller.refreshActivity()).toBe(true);
    f.server.failActivity = true; expect(await f.controller.refreshActivity()).toBe(false);
    expect(f.controller.getSnapshot().events).toEqual([trace(1)]);
    expect(f.controller.getSnapshot().activityError).not.toContain('private_raw_reason_code');
    const foreign = harness(); foreign.server.events = [{ ...trace(1), ownerRef: other }];
    expect(await foreign.controller.refreshActivity()).toBe(false); expect(foreign.controller.getSnapshot().events).toEqual([]);
  });
  it('ignores delayed activity after the current panel/account changes', async () => {
    const pending = deferred<{ events: ToolTrace[] }>(); let current = true;
    const controller = new ToolAccessController(async <T>() => await pending.promise as T, owner, 'web', () => current);
    const reading = controller.refreshActivity(); current = false; pending.resolve({ events: [trace(1)] });
    expect(await reading).toBe(false); expect(controller.getSnapshot().events).toEqual([]);
  });
});
