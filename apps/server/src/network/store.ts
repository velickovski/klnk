import { randomUUID } from 'node:crypto';
import { Database, type SQL } from '../db.js';
import { HttpError } from '../errors.js';
import { AsyncLocalStorage } from 'node:async_hooks';

/** Trusted HTTP principal is propagated by routes, never by model/body fields.
 * Background execution deliberately has no browser bearer context. */
export const networkRequestActor = new AsyncLocalStorage<{
  ownerId: string;
  sessionHash: string;
  guard?: (sql: SQL) => Promise<void>;
}>();

export type NetworkKind =
  | 'identity'
  | 'connection'
  | 'policy'
  | 'memory'
  | 'conversation'
  | 'task'
  | 'event'
  | 'reminder'
  | 'outbox'
  | 'receipt'
  | 'preferences';
export interface NetworkRecord<T = unknown> {
  id: string;
  kind: NetworkKind;
  ownerA: string;
  ownerB?: string;
  status: string;
  version: number;
  value: T;
}
/** Call inside one Database.transaction. Lock owners before any record in stable order. */
export async function lockNetworkOwners(sql: SQL, owners: readonly string[]) {
  for (const owner of [...new Set(owners)].sort()) {
    const [row] = await sql.query('SELECT id,deleted_at FROM users WHERE id=$1 FOR UPDATE', [
      owner,
    ]);
    if (!row || row.deleted_at)
      throw new HttpError(409, 'member_unavailable', 'A participating account is unavailable.');
  }
  const actor = networkRequestActor.getStore();
  if (actor) {
    if (!owners.includes(actor.ownerId))
      throw new HttpError(403, 'actor_mismatch', 'The authenticated owner is not a participant.');
    const rows = await sql.query(
      'SELECT token_hash FROM sessions WHERE owner_id=$1 AND token_hash=$2 AND expires_at>clock_timestamp()',
      [actor.ownerId, actor.sessionHash],
    );
    if (!rows.length)
      throw new HttpError(401, 'session_expired', 'Sign in again. No internal change was made.');
    await actor.guard?.(sql);
  }
}
export class NetworkStore {
  constructor(
    public db: Database,
    public sql: SQL = db,
  ) {}
  in(sql: SQL) {
    return new NetworkStore(this.db, sql);
  }
  async get<T>(kind: NetworkKind, id: string): Promise<NetworkRecord<T> | undefined> {
    const [r] = await this.sql.query('SELECT * FROM network_records WHERE id=$1 AND kind=$2', [
      id,
      kind,
    ]);
    return r ? this.decode<T>(r) : undefined;
  }
  async list<T>(owner: string, kind: NetworkKind): Promise<NetworkRecord<T>[]> {
    return (
      await this.sql.query(
        'SELECT * FROM network_records WHERE (owner_a=$1 OR owner_b=$1) AND kind=$2 ORDER BY created_at,id',
        [owner, kind],
      )
    ).map((r) => this.decode<T>(r));
  }
  async put<T>(record: NetworkRecord<T>) {
    const rows = await this.sql.query(
      `INSERT INTO network_records(id,kind,owner_a,owner_b,status,version,payload) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status,version=excluded.version,payload=excluded.payload,updated_at=clock_timestamp()
      WHERE network_records.kind=excluded.kind AND network_records.owner_a=excluded.owner_a AND network_records.owner_b IS NOT DISTINCT FROM excluded.owner_b RETURNING id`,
      [
        record.id,
        record.kind,
        record.ownerA,
        record.ownerB ?? null,
        record.status,
        record.version,
        this.db.encrypt(record.value),
      ],
    );
    if (!rows.length)
      throw new HttpError(
        409,
        'network_identity_conflict',
        'This internal record has a different identity.',
      );
    return record.value;
  }
  async remove(kind: NetworkKind, id: string) {
    await this.sql.query('DELETE FROM network_records WHERE kind=$1 AND id=$2', [kind, id]);
  }
  private decode<T>(r: Record<string, any>): NetworkRecord<T> {
    return {
      id: r.id,
      kind: r.kind,
      ownerA: r.owner_a,
      ...(r.owner_b ? { ownerB: r.owner_b } : {}),
      status: r.status,
      version: r.version,
      value: this.db.decrypt<T>(r.payload),
    };
  }
}
export function networkId() {
  return randomUUID();
}
