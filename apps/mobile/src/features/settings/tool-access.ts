import type { ApplicationToolName, ApplicationToolStatus, ToolTrace } from '@personal-agent/domain';

export type ToolAccess = {
  grant: { id: string; ownerId: string; version: 1; enabled: boolean; tools: ApplicationToolName[]; updatedAt: string };
  runtimeAvailable: boolean; externalEffectsEnabled: false;
};
export const IN_APP_VOICE_TOOLS: readonly ApplicationToolName[] = Object.freeze(['contacts_lookup', 'memory_lookup', 'request_prepare', 'request_status']);
export const toolPermissionName: Record<ApplicationToolName, string> = {
  contacts_lookup: 'Look up your people', memory_lookup: 'Read confirmed memories allowed for this request',
  request_prepare: 'Prepare a request draft for review', request_status: 'Check request status',
  request_dispatch: 'Continue an already authorized request', request_cancel: 'Request cancellation',
  calendar_update_existing: 'Check an existing Calendar follow-up',
  network_connections_lookup: 'Find accepted klnk member connections',
  network_request_submit: 'Submit your scoped internal klnk request',
  network_request_status: 'Read your internal conversation status',
};
const decisionEvents = new Set<ToolTrace['event']>(['tool_blocked', 'tool_succeeded', 'tool_failed', 'tool_reconciliation_required', 'tool_result_reported']);
const statusLabels: Record<ApplicationToolStatus, string> = {
  proposed: 'Proposed · review needed', blocked: 'Blocked', authorized: 'Authorized · not started', queued: 'Queued',
  running: 'In progress', succeeded: 'Operation completed', failed: 'Operation failed', unknown: 'Outcome unconfirmed',
  cancel_requested: 'Cancellation requested', cancelled: 'Cancelled',
};
export function recentToolDecisions(events: ToolTrace[], now = Date.now()) {
  return events.filter(event => decisionEvents.has(event.event) && Date.parse(event.occurredAt) >= now - 7 * 86_400_000)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.eventId.localeCompare(a.eventId)).slice(0, 12);
}
export function toolDecisionPresentation(event: ToolTrace) {
  const unconfirmed = event.status === 'unknown' || event.verification === 'unconfirmed';
  return {
    title: toolPermissionName[event.toolName],
    label: unconfirmed ? 'Outcome unconfirmed' : event.status === 'succeeded' && event.toolName === 'request_prepare' ? 'Draft prepared · review needed' : statusLabels[event.status],
    tone: unconfirmed || ['blocked', 'failed', 'cancel_requested'].includes(event.status) ? 'amber' as const : 'neutral' as const,
    detail: event.toolName === 'request_prepare' ? 'A draft still needs your review and authorization before execution.'
      : ['request_dispatch', 'request_cancel', 'calendar_update_existing'].includes(event.toolName) ? 'Check the request details for the actual execution, cancellation or provider outcome.'
      : 'This records an in-app operation, not a completed telephone call or external action.',
  };
}

type Request = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type State = Readonly<{
  access: ToolAccess | null; accessLoading: boolean; accessError: string; uncertain: boolean; saving: boolean; message: string;
  events: ToolTrace[]; activityLoading: boolean; activityError: string;
}>;
export function canEnableInAppTools(access: ToolAccess | null, platform: string, uncertain = false) {
  return platform === 'web' && access?.runtimeAvailable === true && !access.grant.enabled && !uncertain;
}

/** Owner/session-bound requests; only accepted server responses change permission state. */
export class ToolAccessController {
  private state: State = { access: null, accessLoading: false, accessError: '', uncertain: false, saving: false, message: '', events: [], activityLoading: false, activityError: '' };
  private listeners = new Set<() => void>();
  constructor(private request: Request, private ownerId: string, private platform: string, private current: () => boolean = () => true) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: Partial<State>) { if (!this.current()) return; this.state = { ...this.state, ...next }; this.listeners.forEach(listener => listener()); }
  private accept(access: ToolAccess) {
    if (access.grant.ownerId !== this.ownerId || access.externalEffectsEnabled !== false) throw new Error('Unverified permission response');
    this.publish({ access, uncertain: false });
  }
  async refreshAccess() {
    if (!this.current() || this.state.accessLoading || this.state.saving) return false;
    this.publish({ accessLoading: true, accessError: '', message: '' });
    try { const access = await this.request<ToolAccess>('/tools/access'); if (!this.current()) return false; this.accept(access); return true; }
    catch { this.publish({ uncertain: true, accessError: 'Voice permissions could not be verified. Reconnect and refresh before assuming a change.' }); return false; }
    finally { this.publish({ accessLoading: false }); }
  }
  async refreshActivity() {
    if (!this.current() || this.state.activityLoading) return false;
    this.publish({ activityLoading: true, activityError: '' });
    try {
      const result = await this.request<{ events: ToolTrace[] }>('/tools/traces');
      if (!this.current()) return false;
      if (result.events.some(event => event.ownerRef !== this.ownerId)) throw new Error('Unverified activity owner');
      this.publish({ events: result.events }); return true;
    } catch { this.publish({ activityError: 'Recent voice activity could not be loaded. Refresh to check the latest decisions.' }); return false; }
    finally { this.publish({ activityLoading: false }); }
  }
  async setEnabled(enabled: boolean) {
    const current = this.state.access;
    if (!this.current() || !current || this.state.accessLoading || this.state.saving) return false;
    if (enabled ? !canEnableInAppTools(current, this.platform, this.state.uncertain) : !current.grant.enabled) return false;
    this.publish({ saving: true, accessError: '', message: '' });
    try {
      const access = await this.request<ToolAccess>('/tools/access', 'PUT', { enabled, tools: enabled ? [...IN_APP_VOICE_TOOLS] : [...current.grant.tools] });
      if (!this.current()) return false;
      this.accept(access);
      this.publish({ message: access.grant.enabled ? 'In-app voice permissions saved. Each request still needs its required review and authorization.' : 'Voice tools are turned off for this account.' });
      return true;
    } catch { this.publish({ uncertain: true, accessError: 'The permission change was not confirmed. The last confirmed setting is still shown; refresh to verify it.' }); return false; }
    finally { this.publish({ saving: false }); }
  }
}
