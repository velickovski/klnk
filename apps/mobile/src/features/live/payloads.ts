type ObjectValue = Record<string, unknown>;
export function objectValue(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectValue)
    : undefined;
}
export function invalidLiveResponse() {
  return Object.assign(
    new Error(
      'The voice service returned an invalid response. No successful connection or closure is assumed.',
    ),
    { code: 'invalid_response' },
  );
}
export function liveRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues)
    throw new Error(
      'This browser cannot safely identify a voice start. Update your browser and try again.',
    );
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function liveReceipt(value: unknown, requestId: string) {
  const data = objectValue(value);
  if (
    !data ||
    data.requestId !== requestId ||
    typeof data.receiptId !== 'string' ||
    !data.receiptId ||
    !['creating', 'active', 'closing', 'closed', 'unconfirmed', 'rejected'].includes(
      String(data.status),
    ) ||
    typeof data.expiresAt !== 'number' ||
    !Number.isFinite(data.expiresAt) ||
    (data.sessionId !== undefined &&
      (typeof data.sessionId !== 'string' || !data.sessionId || data.sessionId.length > 512))
  )
    throw invalidLiveResponse();
  return {
    requestId,
    receiptId: data.receiptId,
    status: data.status as
      'creating' | 'active' | 'closing' | 'closed' | 'unconfirmed' | 'rejected',
    sessionId: data.sessionId as string | undefined,
    expiresAt: data.expiresAt,
  };
}
export function liveRecovery(value: unknown) {
  const data = objectValue(value);
  if (!data || !Array.isArray(data.requests) || data.requests.length > 1)
    throw invalidLiveResponse();
  return data.requests.map((value) => {
    const request = objectValue(value);
    if (
      typeof request?.requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.requestId)
    )
      throw invalidLiveResponse();
    return liveReceipt(value, request.requestId);
  });
}
export function liveReadiness(value: unknown) {
  const data = objectValue(value);
  if (
    !data ||
    typeof data.configured !== 'boolean' ||
    (data.startupUnconfirmed !== undefined && typeof data.startupUnconfirmed !== 'boolean')
  )
    throw invalidLiveResponse();
  return { configured: data.configured, startupUnconfirmed: data.startupUnconfirmed === true };
}
export function liveSessionId(value: unknown): string | undefined {
  const id = objectValue(objectValue(value)?.session)?.id;
  return typeof id === 'string' && id.trim().length > 0 && id.length <= 512 ? id : undefined;
}
export function liveAnswer(value: unknown) {
  const data = objectValue(value),
    transport = objectValue(data?.transport),
    id = liveSessionId(value);
  const duration = data?.maxDurationSeconds;
  if (
    !id ||
    transport?.type !== 'webrtc' ||
    typeof transport.sdp !== 'string' ||
    !transport.sdp.trim() ||
    transport.sdp.length > 256 * 1024 ||
    (duration !== undefined &&
      (typeof duration !== 'number' ||
        !Number.isInteger(duration) ||
        duration <= 0 ||
        duration > 300))
  )
    throw invalidLiveResponse();
  return {
    id,
    sdp: transport.sdp,
    maxDurationSeconds: duration === undefined ? 300 : (duration as number),
  };
}
export function liveClosure(value: unknown, sessionId?: string) {
  const data = objectValue(value);
  if (
    !data ||
    !['active', 'closing', 'closed', 'unconfirmed'].includes(String(data.status)) ||
    (sessionId !== undefined && data.sessionId !== sessionId)
  )
    throw invalidLiveResponse();
  return data.status === 'closed';
}
export async function liveJson(response: Response): Promise<unknown> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw invalidLiveResponse();
  }
  if (!response.ok) {
    const data = objectValue(value);
    const message =
      typeof data?.message === 'string'
        ? data.message
        : `Voice service returned ${response.status}.`;
    throw Object.assign(new Error(message), {
      status: response.status,
      code: typeof data?.error === 'string' ? data.error : undefined,
    });
  }
  if (!objectValue(value)) throw invalidLiveResponse();
  return value;
}
