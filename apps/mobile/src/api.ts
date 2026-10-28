import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { isLoopback, normalizeApiUrl } from './connection';
import { HealthSchema, validateApiPayload } from './api-contracts';

export let API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
let localHttpAllowed = Platform.OS === 'web' || process.env.EXPO_PUBLIC_ALLOW_LOCAL_HTTP === 'true';
let connectionGeneration = 0;
let token: string | null = null;
let storageQueue: Promise<unknown> = Promise.resolve();
let storageFailed = false;
const requests = new Set<AbortController>();
const sessionListeners = new Set<(value: string | null) => void>();

export type SessionSnapshot = Readonly<{ generation: number; url: string; token: string | null }>;
export class SessionChangedError extends ApiError {
  constructor() {
    super(
      'The account or server connection changed. Continue with the current account.',
      0,
      'session_changed',
    );
  }
}
export function getSessionSnapshot(): SessionSnapshot {
  return { generation: connectionGeneration, url: API_URL, token };
}
export function isSessionCurrent(snapshot: SessionSnapshot) {
  return (
    snapshot.generation === connectionGeneration &&
    snapshot.url === API_URL &&
    snapshot.token === token
  );
}
function assertCurrent(snapshot: SessionSnapshot) {
  if (!isSessionCurrent(snapshot)) throw new SessionChangedError();
}
function invalidateSession() {
  connectionGeneration++;
  token = null;
  requests.forEach((controller) => controller.abort());
  sessionListeners.forEach((listener) => listener(null));
}
function storedOperation<T>(operation: () => Promise<T>): Promise<T> {
  const pending = storageQueue.catch(() => undefined).then(operation);
  storageQueue = pending.catch(() => undefined);
  return pending;
}
async function clearStoredSession() {
  // A successful tombstone also prevents restoration when the following delete fails.
  try {
    await SecureStore.setItemAsync(
      'personal-agent-session-v2',
      JSON.stringify({ url: API_URL, token: null }),
    );
  } catch {
    await SecureStore.deleteItemAsync('personal-agent-session-v2');
    return;
  }
  await SecureStore.deleteItemAsync('personal-agent-session-v2');
}
function storageError() {
  return new ApiError(
    'Secure sign-in storage is unavailable. Sign-in is disabled for this app session. Retry when secure storage is available.',
    0,
    'secure_storage_failed',
  );
}

export function onSessionChange(listener: (value: string | null) => void) {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

export function authenticatedAudioHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function isDeviceLoopback() {
  try {
    return Platform.OS !== 'web' && isLoopback(new URL(API_URL).hostname);
  } catch {
    return true;
  }
}
export function getConnectionSettings() {
  return { url: API_URL, allowLocalHttp: localHttpAllowed };
}

export async function changeApiUrl(value: string, allowLocalHttp: boolean) {
  const next = normalizeApiUrl(value, { allowLocalHttp, physicalDevice: Platform.OS !== 'web' });
  if (next === API_URL) {
    localHttpAllowed = allowLocalHttp;
    return;
  }
  invalidateSession();
  API_URL = next;
  localHttpAllowed = allowLocalHttp;
  const snapshot = getSessionSnapshot();
  if (Platform.OS !== 'web')
    await storedOperation(async () => {
      try {
        await clearStoredSession();
        assertCurrent(snapshot);
        await SecureStore.setItemAsync(
          'personal-agent-connection',
          JSON.stringify({ url: next, allowLocalHttp }),
        );
        assertCurrent(snapshot);
        storageFailed = false;
      } catch (error) {
        if (!isSessionCurrent(snapshot)) throw new SessionChangedError();
        if (error instanceof SessionChangedError) throw error;
        storageFailed = true;
        throw storageError();
      }
    });
}

export type LiveReadiness = {
  ready: boolean;
  callGate: string;
  checks: { id: string; label: string; status: 'ready' | 'missing' | 'blocked'; detail: string }[];
};
export type Health = {
  status: string;
  mode: string;
  storage?: string;
  liveCallsEnabled?: boolean;
  liveReadiness?: LiveReadiness;
};
export async function checkConnection(value = API_URL, allowLocalHttp = true): Promise<Health> {
  const address = normalizeApiUrl(value, { allowLocalHttp, physicalDevice: Platform.OS !== 'web' });
  const response = await fetch(`${address}/health`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`The server health check failed (${response.status}).`);
  const health: unknown = await response.json().catch(() => null);
  if (!HealthSchema.safeParse(health).success)
    throw new ApiError(
      'This address did not return a valid Personal Voice Agent health response.',
      502,
      'invalid_response',
    );
  return health as Health;
}

export async function restoreSession() {
  if (Platform.OS === 'web') return token;
  const snapshot = getSessionSnapshot();
  return storedOperation(async () => {
    assertCurrent(snapshot);
    if (storageFailed) throw storageError();
    try {
      const connection = await SecureStore.getItemAsync('personal-agent-connection');
      assertCurrent(snapshot);
      let address = API_URL,
        allowLocalHttp = localHttpAllowed;
      if (connection) {
        const saved = JSON.parse(connection);
        if (typeof saved.url !== 'string' || typeof saved.allowLocalHttp !== 'boolean')
          throw new Error('Invalid connection');
        address = normalizeApiUrl(saved.url, {
          allowLocalHttp: saved.allowLocalHttp,
          physicalDevice: true,
        });
        allowLocalHttp = saved.allowLocalHttp;
      }
      const stored = await SecureStore.getItemAsync('personal-agent-session-v2');
      assertCurrent(snapshot);
      let restored: string | null = null;
      if (stored) {
        const session = JSON.parse(stored);
        if (
          session.url === address &&
          typeof session.token === 'string' &&
          /^\S{1,4096}$/.test(session.token)
        )
          restored = session.token;
      }
      await SecureStore.deleteItemAsync('personal-agent-session');
      assertCurrent(snapshot);
      API_URL = address;
      localHttpAllowed = allowLocalHttp;
      connectionGeneration++;
      token = restored;
      requests.forEach((controller) => controller.abort());
      sessionListeners.forEach((listener) => listener(token));
      return token;
    } catch (error) {
      if (!isSessionCurrent(snapshot)) throw new SessionChangedError();
      if (error instanceof SessionChangedError) throw error;
      invalidateSession();
      storageFailed = true;
      await clearStoredSession().catch(() => undefined);
      throw storageError();
    }
  });
}

export async function setSession(value: string | null) {
  if (value !== null && !/^\S{1,4096}$/.test(value))
    throw new ApiError(
      'The server returned an invalid sign-in credential.',
      502,
      'invalid_response',
    );
  invalidateSession();
  const snapshot = getSessionSnapshot();
  if (Platform.OS !== 'web')
    await storedOperation(async () => {
      assertCurrent(snapshot);
      try {
        if (value)
          await SecureStore.setItemAsync(
            'personal-agent-session-v2',
            JSON.stringify({ url: snapshot.url, token: value }),
          );
        else await clearStoredSession();
        assertCurrent(snapshot);
        storageFailed = false;
      } catch (error) {
        if (!isSessionCurrent(snapshot)) throw new SessionChangedError();
        if (error instanceof SessionChangedError) throw error;
        if (isSessionCurrent(snapshot)) {
          storageFailed = true;
          await clearStoredSession().catch(() => undefined);
        }
        throw storageError();
      }
    });
  assertCurrent(snapshot);
  token = value;
  sessionListeners.forEach((listener) => listener(value));
}

export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid API path.');
  if (isDeviceLoopback())
    throw new Error(
      'Connect this iPhone to your backend first. Localhost points to the iPhone, not your computer.',
    );
  normalizeApiUrl(API_URL, {
    allowLocalHttp: localHttpAllowed,
    physicalDevice: Platform.OS !== 'web',
  });
  const snapshot = getSessionSnapshot(),
    address = snapshot.url,
    requestToken = snapshot.token;
  const controller = new AbortController();
  requests.add(controller);
  const timeout = setTimeout(() => controller.abort(), path.startsWith('/voice/') ? 120000 : 20000);
  try {
    const response = await fetch(`${address}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(requestToken ? { Authorization: `Bearer ${requestToken}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
    });
    assertCurrent(snapshot);
    const result: unknown = await response.json().catch(() => null);
    assertCurrent(snapshot);
    if (!response.ok) {
      if (response.status === 401 && requestToken) await setSession(null);
      const errorBody =
        result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
      const fields = Array.isArray(errorBody.fields)
        ? errorBody.fields
            .slice(0, 3)
            .filter(
              (field): field is { path: string; message: string } =>
                !!field && typeof field.path === 'string' && typeof field.message === 'string',
            )
            .map((field) => `${field.path}: ${field.message}`)
            .join(' ')
        : '';
      const message =
        typeof errorBody.message === 'string'
          ? errorBody.message
          : `Request failed (${response.status}).`;
      throw new ApiError(
        `${message}${fields ? ` ${fields}` : ''}`,
        response.status,
        typeof errorBody.error === 'string' ? errorBody.error : undefined,
      );
    }
    if (!validateApiPayload(path, method.toUpperCase(), result))
      throw new ApiError(
        'The server returned an incomplete or invalid response. No success has been assumed. Your request may still have been accepted; check its existing receipt before retrying.',
        502,
        'invalid_response',
      );
    return result as T;
  } catch (error) {
    if (!isSessionCurrent(snapshot) && !(error instanceof ApiError && error.status === 401))
      throw new SessionChangedError();
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        'The server is taking longer than expected. Your call may still be running. Reconnect to check its actual state.',
      );
    }
    if (error instanceof TypeError)
      throw new Error(
        `Cannot reach your server. Check your connection and API address (${API_URL}).`,
      );
    throw error;
  } finally {
    requests.delete(controller);
    clearTimeout(timeout);
  }
}
