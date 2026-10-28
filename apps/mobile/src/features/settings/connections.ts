export type ConnectionPresentation = { label: string; tone: 'green' | 'amber' | 'neutral'; detail: string };

/** Only explicit server state can establish a connection; an adapter is not OAuth. */
export function connectionPresentation(status?: string): ConnectionPresentation {
  switch (status) {
    case 'connected': return { label: 'Connected', tone: 'green', detail: 'The backend reports this service connected. Each action still checks account access and required scope.' };
    case 'connecting': case 'pending': return { label: 'Connecting', tone: 'amber', detail: 'Authorization is not complete. No service action is available from this state.' };
    case 'expired': return { label: 'Access expired', tone: 'amber', detail: 'Reconnect through a supported provider flow before using this service.' };
    case 'revoked': return { label: 'Access revoked', tone: 'amber', detail: 'The provider no longer grants access. No connection is implied by a saved record.' };
    case 'revoke_pending': return { label: 'Revocation pending', tone: 'amber', detail: 'App access is blocked. Remote revocation is not yet confirmed; retry disconnect or refresh the status.' };
    case 'error': return { label: 'Connection needs attention', tone: 'amber', detail: 'Access is not verified. Refresh the status before using or reconnecting this service.' };
    case 'denied': return { label: 'Access denied', tone: 'amber', detail: 'Authorization was denied. No provider access was granted.' };
    case 'insufficient_scope': return { label: 'More permission required', tone: 'amber', detail: 'Current permissions do not authorize the requested service action.' };
    case 'disconnected': return { label: 'Disconnected', tone: 'neutral', detail: 'No active service connection is reported.' };
    case 'unavailable': return { label: 'Unavailable', tone: 'neutral', detail: 'This connection is not available on the current backend.' };
    case 'manual_entry': return { label: 'Manual entry', tone: 'neutral', detail: 'Native contact selection is not implemented. Add only the people you choose.' };
    case 'demo_or_server_token': return { label: 'OAuth setup unavailable', tone: 'neutral', detail: 'Simulation uses fictional events. A server adapter does not establish a connected provider account.' };
    default: return { label: 'Connection status unknown', tone: 'amber', detail: 'The backend has not supplied a recognized authorization state. Verify access before using this service.' };
  }
}

export type CalendarConnection = {
  id: string; kind: 'google_calendar'; name: 'Google Calendar';
  status: 'unavailable' | 'disconnected' | 'connecting' | 'connected' | 'expired' | 'insufficient_scope' | 'revoked' | 'revoke_pending' | 'error';
  available: boolean; detail: string; reasonCode: string;
  capabilities: { readExisting: boolean; updateExisting: boolean };
  tokenExpiresAt?: string; verifiedAt?: string;
};
type Request = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Authorization = { authorizationUrl: string; expiresAt: number };
type ConnectionState = Readonly<{
  connections: CalendarConnection[]; loading: boolean; operation: 'connect' | 'cancel' | 'disconnect' | null;
  error: string; message: string; uncertain: boolean; authorization: Authorization | null;
}>;

export function canConnectCalendar(connection: CalendarConnection) {
  // `available` describes usable access, not whether OAuth is configured.
  return ['disconnected', 'expired', 'insufficient_scope', 'revoked', 'error'].includes(connection.status) && connection.reasonCode !== 'oauth_not_configured';
}
export function canDisconnectCalendar(connection: CalendarConnection) {
  return ['connected', 'expired', 'insufficient_scope', 'error', 'revoke_pending'].includes(connection.status);
}
export function pendingGoogleAuthorization(connection: CalendarConnection) {
  return connection.status === 'connecting' && connection.reasonCode === 'oauth_pending';
}
export function safeGoogleAuthorization(value: Authorization, now = Date.now()) {
  try {
    const url = new URL(value.authorizationUrl);
    return url.origin === 'https://accounts.google.com' && url.pathname === '/o/oauth2/v2/auth' && !url.username && !url.password && !url.hash && Number.isFinite(value.expiresAt) && value.expiresAt > now;
  } catch { return false; }
}

/** Account-lifetime state; credentials and OAuth callbacks remain on the server. */
export class CalendarConnectionsController {
  private state: ConnectionState = { connections: [], loading: false, operation: null, error: '', message: '', uncertain: false, authorization: null };
  private listeners = new Set<() => void>();
  private disposed = false;
  constructor(private request: Request, private openBrowser: (url: string) => Promise<unknown>, private current: () => boolean = () => true) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  dispose() { this.disposed = true; this.listeners.clear(); }
  private active() { return !this.disposed && this.current(); }
  private publish(next: Partial<ConnectionState>) { if (!this.active()) return; this.state = { ...this.state, ...next }; this.listeners.forEach(listener => listener()); }
  private locked() { return !this.active() || this.state.loading || this.state.operation !== null; }
  private accept(connection: CalendarConnection) {
    const rows = this.state.connections.filter(row => row.id !== connection.id);
    this.publish({ connections: [...rows, connection], uncertain: false });
  }
  async refresh() {
    if (this.locked()) return false;
    this.publish({ loading: true, error: '', message: '' });
    try {
      const connections = await this.request<CalendarConnection[]>('/integrations');
      this.publish({ connections, uncertain: false, ...(connections.some(row => row.status === 'connected') || this.state.authorization && !safeGoogleAuthorization(this.state.authorization) ? { authorization: null } : {}) });
      return this.active();
    } catch (error) { this.publish({ uncertain: true, error: error instanceof Error ? error.message : 'Connection status could not be checked. Refresh before using Calendar.' }); return false; }
    finally { this.publish({ loading: false }); }
  }
  async connect(connection: CalendarConnection) {
    if (this.locked() || this.state.uncertain || !canConnectCalendar(connection) || this.state.authorization) return false;
    this.publish({ operation: 'connect', error: '', message: '' });
    let openingBrowser = false;
    try {
      const authorization = await this.request<Authorization>('/integrations/google-calendar/connect', 'POST', {});
      if (!this.active()) return false;
      if (!safeGoogleAuthorization(authorization)) throw new Error('The server returned an invalid or expired Google authorization link. Refresh status before starting again.');
      this.publish({ authorization });
      this.accept(await this.request<CalendarConnection>('/integrations/google-calendar'));
      if (!this.active()) return false;
      openingBrowser = true;
      await this.openBrowser(authorization.authorizationUrl);
      this.publish({ message: 'Google authorization was requested in your browser. Finish there, return here and choose Refresh connection status. Opening the browser does not confirm a connection.' });
      return true;
    } catch (error) {
      this.publish({ uncertain: true, error: openingBrowser ? 'The browser could not open. Retry opening the authorization link or cancel it.' : error instanceof Error ? error.message : 'Authorization could not be confirmed. Refresh status before starting again.', message: this.state.authorization ? 'Authorization may still be pending. You can retry opening its link or cancel this authorization.' : '' });
      return false;
    } finally { this.publish({ operation: null }); }
  }
  async openAuthorization() {
    if (this.locked() || !this.state.authorization) return false;
    const authorization = this.state.authorization;
    if (!safeGoogleAuthorization(authorization)) { this.publish({ error: 'This authorization link has expired. Cancel it or refresh status before starting again.' }); return false; }
    this.publish({ operation: 'connect', error: '' });
    try { await this.openBrowser(authorization.authorizationUrl); this.publish({ message: 'Authorization link requested. Finish in the browser, then refresh connection status here.' }); return this.active(); }
    catch { this.publish({ error: 'The browser could not open. Your authorization has not been confirmed. Retry opening the link or cancel it.' }); return false; }
    finally { this.publish({ operation: null }); }
  }
  async cancelAuthorization() {
    if (this.locked()) return false;
    this.publish({ operation: 'cancel', error: '', message: '' });
    try {
      const result = await this.request<{ ok: true; connection: CalendarConnection }>('/integrations/google-calendar/connect', 'DELETE');
      this.accept(result.connection);
      this.publish({ authorization: null, message: 'Pending browser authorization cancelled. Any existing verified connection is shown below; cancellation is not a remote disconnect.' });
      return this.active();
    } catch (error) { this.publish({ uncertain: true, error: error instanceof Error ? error.message : 'Cancellation was not confirmed. Refresh connection status.' }); return false; }
    finally { this.publish({ operation: null }); }
  }
  async disconnect(connection: CalendarConnection) {
    if (this.locked() || !canDisconnectCalendar(connection)) return false;
    this.publish({ operation: 'disconnect', error: '', message: '' });
    try {
      const result = await this.request<{ ok: true; connection: CalendarConnection }>('/integrations/google-calendar', 'DELETE');
      this.accept(result.connection);
      this.publish({ authorization: null });
      const message = result.connection.status === 'revoke_pending' ? 'App access is blocked. Google revocation is not confirmed yet; refresh or retry disconnect.'
        : result.connection.status === 'revoked' && result.connection.reasonCode === 'provider_revoked' ? 'Google confirmed revocation. This Calendar connection is no longer usable.'
        : result.connection.status === 'revoked' ? 'Calendar access is revoked in this app. No remaining provider grant was reported by the backend.'
        : 'Disconnect returned a status update. Review it below; remote revocation is not assumed.';
      this.publish({ message }); return this.active();
    } catch (error) { this.publish({ uncertain: true, error: error instanceof Error ? error.message : 'Disconnect was not confirmed. Refresh status before assuming app access or provider access has ended.' }); return false; }
    finally { this.publish({ operation: null }); }
  }
}
