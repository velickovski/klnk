import type { Database, SQL } from '../db.js';
import { NetworkStore } from './store.js';
import { HttpError } from '../errors.js';
import { redactOwnerIntentForConversation } from './preferences.js';
import type { NetworkConversation } from '../../../../packages/domain/src/network.js';

/** Lock all peer rows before account tombstoning; new peers force a safe retry. */
export async function lockNetworkDeletion(sql: SQL, owner: string) {
  const peers = await sql.query(
    'SELECT owner_a,owner_b FROM network_records WHERE owner_a=$1 OR owner_b=$1',
    [owner],
  );
  const ids = [
    ...new Set([
      owner,
      ...peers.flatMap((r) => [r.owner_a, r.owner_b].filter(Boolean) as string[]),
    ]),
  ].sort();
  const rows = await sql.query(
    'SELECT id,deleted_at FROM users WHERE id=ANY($1) ORDER BY id FOR UPDATE',
    [ids],
  );
  if (!rows.some((r) => r.id === owner && !r.deleted_at))
    throw new HttpError(401, 'owner_deleted', 'This account is unavailable.');
  const after = await sql.query(
    'SELECT owner_a,owner_b FROM network_records WHERE owner_a=$1 OR owner_b=$1',
    [owner],
  );
  if (after.some((r) => [r.owner_a, r.owner_b].some((id) => id && !ids.includes(id))))
    throw new HttpError(
      409,
      'network_changed',
      'A connection changed. Retry deleting this account.',
    );
}
/** Shared text is removed for both participants. Standalone peer reminders are
 * removed too; backup deletion reconciliation must apply this same closure. */
export async function deleteNetworkAccount(db: Database, sql: SQL, owner: string) {
  await sql.query('DELETE FROM account_mail_outbox WHERE owner_id=$1', [owner]);
  await sql.query('DELETE FROM account_challenges WHERE owner_id=$1', [owner]);
  const store = new NetworkStore(db, sql),
    events = await store.list<any>(owner, 'event');
  for (const c of await store.list<NetworkConversation>(owner, 'conversation'))
    await redactOwnerIntentForConversation(store, c.value);
  const eventIds = events.map((e) => e.id);
  if (eventIds.length) {
    const reminders = await sql.query(
      "SELECT id,payload FROM network_records WHERE kind IN ('reminder','outbox')",
    );
    for (const row of reminders) {
      const value = db.decrypt<any>(row.payload);
      if (eventIds.includes(value.eventId))
        await sql.query('DELETE FROM network_records WHERE id=$1', [row.id]);
    }
  }
  await sql.query('DELETE FROM network_records WHERE owner_a=$1 OR owner_b=$1', [owner]);
}
export async function exportNetworkAccount(db: Database, owner: string, sql: SQL = db) {
  const store = new NetworkStore(db, sql),
    result: Record<string, unknown> = {
      scope: 'Internal klnk records; peer private context excluded',
    };
  for (const kind of [
    'identity',
    'connection',
    'policy',
    'memory',
    'busy',
    'availability',
    'conversation',
    'event',
    'reminder',
    'preferences',
  ] as const)
    result[kind] = (await store.list<any>(owner, kind)).map((r) =>
      kind === 'conversation'
        ? {
            ...r.value,
            policyVersions: { [owner]: r.value.policyVersions[owner] },
            ...(r.value.authorityVersions
              ? { authorityVersions: { [owner]: r.value.authorityVersions[owner] } }
              : {}),
            acceptances: projectAcceptances(r.value.acceptances, owner),
          }
        : kind === 'event'
          ? { ...r.value, acceptances: projectAcceptances(r.value.acceptances, owner) }
          : r.value,
    );
  return result;
}
function projectAcceptances(values: Record<string, unknown>[], owner: string) {
  return values.map((value) => {
    if (value.ownerId === owner) return value;
    const { authorityVersion: omitted, ...shared } = value;
    void omitted;
    return shared;
  });
}
