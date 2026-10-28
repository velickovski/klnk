import {
  NetworkPreferencesInputSchema,
  type NetworkConversation,
  type NetworkEvent,
  type NetworkPreferences,
} from '../../../../packages/domain/src/network.js';
import { createHash } from 'node:crypto';
import { Database, type SQL } from '../db.js';
import { HttpError } from '../errors.js';
import { lockNetworkOwners, NetworkStore } from './store.js';
import { removedOwnerIntent } from './redaction.js';

export function notificationId(value: string) {
  const h = createHash('sha256').update(`network-notification:${value}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export async function networkPreferences(
  store: NetworkStore,
  owner: string,
): Promise<NetworkPreferences> {
  return (
    (await store.get<NetworkPreferences>('preferences', notificationId(`preferences:${owner}`)))
      ?.value ?? {
      ownerId: owner,
      version: 1,
      retentionDays: 30,
      notificationMode: 'decisions_results',
      updatedAt: new Date().toISOString(),
    }
  );
}
export async function saveNetworkPreferences(
  db: Database,
  owner: string,
  input: unknown,
  expectedVersion: number,
) {
  const parsed = NetworkPreferencesInputSchema.parse(input);
  return db.transaction(async (sql) => {
    await lockNetworkOwners(sql, [owner]);
    const store = new NetworkStore(db, sql),
      old = await networkPreferences(store, owner);
    if (old.version !== expectedVersion)
      throw new HttpError(
        409,
        'network_preferences_changed',
        'Preferences changed. Refresh before saving.',
      );
    const value = {
      ...parsed,
      ownerId: owner,
      version: old.version + 1,
      updatedAt: new Date().toISOString(),
    };
    await store.put({
      id: notificationId(`preferences:${owner}`),
      kind: 'preferences',
      ownerA: owner,
      status: 'active',
      version: value.version,
      value,
    });
    return value;
  });
}
/** Content-free in-app notifications point to canonical shared records. */
export async function publishNetworkNotification(
  store: NetworkStore,
  owner: string,
  c: NetworkConversation,
  kind: 'decision' | 'result',
) {
  const prefs = await networkPreferences(store, owner),
    id = notificationId(`${c.id}:${owner}:${c.version}:${kind}`);
  const silent =
    prefs.notificationMode === 'quiet' ||
    (prefs.notificationMode === 'decisions_only' && kind !== 'decision');
  await store.put({
    id,
    kind: 'outbox',
    ownerA: owner,
    status: silent ? 'silent' : 'pending',
    version: 1,
    value: {
      id,
      ownerId: owner,
      conversationId: c.id,
      ...(c.eventId ? { eventId: c.eventId } : {}),
      kind,
      revision: c.version,
      at: c.updatedAt,
    },
  });
}
export async function networkNotifications(db: Database, owner: string) {
  return db.transaction(async (sql) => {
    await lockNetworkOwners(sql, [owner]);
    const store = new NetworkStore(db, sql),
      prefs = await networkPreferences(store, owner),
      records = await store.list<any>(owner, 'outbox');
    return {
      items: records
        .filter(
          (r) =>
            r.ownerA === owner &&
            !r.ownerB &&
            r.status === 'pending' &&
            prefs.notificationMode !== 'quiet' &&
            (prefs.notificationMode !== 'decisions_only' || r.value.kind === 'decision'),
        )
        .slice(-20)
        .map((r) => ({
          id: r.id,
          conversationId: r.value.conversationId,
          kind: r.value.kind,
          at: r.value.at,
        })),
      delivery: 'in_app' as const,
    };
  });
}
export async function dismissNetworkNotification(db: Database, owner: string, id: string) {
  return db.transaction(async (sql) => {
    await lockNetworkOwners(sql, [owner]);
    const store = new NetworkStore(db, sql),
      r = await store.get('outbox', id);
    if (!r || r.ownerA !== owner || r.ownerB)
      throw new HttpError(404, 'not_found', 'Notification not found.');
    await store.put({ ...r, status: 'read' });
    return { ok: true as const };
  });
}

export async function redactOwnerIntentForConversation(
  store: NetworkStore,
  c: NetworkConversation,
  at = new Date().toISOString(),
) {
  for (const r of await store.list<any>(c.initiatorId, 'receipt'))
    if (
      r.ownerA === c.initiatorId &&
      !r.ownerB &&
      r.value.kind === 'owner_intent_v1' &&
      r.value.commandId === c.request.requestId
    ) {
      await store.put({
        ...r,
        status: 'removed',
        version: r.version + 1,
        value: removedOwnerIntent(r.value, at),
      });
    }
}

/** Retention is evaluated against both owners; future meetings are preserved.
 * Terminal shared content uses the shorter current preference. */
export async function sweepNetworkRetention(db: Database, now = Date.now()) {
  const rows = await db.query(
    "SELECT id,owner_a,owner_b FROM network_records WHERE kind='conversation'",
  );
  for (const row of rows)
    await db
      .transaction(async (sql) => {
        await lockNetworkOwners(sql, [row.owner_a, row.owner_b]);
        const store = new NetworkStore(db, sql),
          record = await store.get<NetworkConversation>('conversation', row.id);
        if (!record) return;
        const c = record.value;
        if (
          ![
            'agreed',
            'answered',
            'delivered',
            'declined',
            'unresolved',
            'expired',
            'cancelled',
          ].includes(c.state)
        )
          return;
        const prefs = await Promise.all([
            networkPreferences(store, c.initiatorId),
            networkPreferences(store, c.recipientId),
          ]),
          days = Math.min(...prefs.map((p) => p.retentionDays));
        const event = c.eventId
          ? (await store.get<NetworkEvent>('event', c.eventId))?.value
          : undefined;
        const end = Math.max(
          Date.parse(c.updatedAt),
          event ? Date.parse(event.terms.slot.endAt) : 0,
        );
        if (end + days * 86400000 > now) return;
        await redactOwnerIntentForConversation(store, c, new Date(now).toISOString());
        for (const owner of [c.initiatorId, c.recipientId])
          for (const kind of ['task', 'event', 'reminder', 'outbox', 'receipt'] as const)
            for (const r of await store.list<any>(owner, kind)) {
              if (
                r.value.conversationId === c.id ||
                (r.value.eventId && r.value.eventId === c.eventId)
              )
                await store.remove(kind, r.id);
            }
        await store.remove('conversation', c.id);
        // Non-content tombstone prevents an expired client retry recreating this ID.
        await store.put({
          id: c.id,
          kind: 'receipt',
          ownerA: c.initiatorId,
          ownerB: c.recipientId,
          status: 'retained_tombstone',
          version: 1,
          value: {
            id: c.id,
            requestId: c.request.requestId,
            removedAt: new Date(now).toISOString(),
            reason: 'retention_expired',
          },
        });
      })
      .catch((error) => {
        if (!(error instanceof HttpError && error.code === 'member_unavailable')) throw error;
      });
}
