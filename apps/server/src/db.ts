import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HttpError } from './errors.js';
import { removedOwnerIntent } from './network/redaction.js';

export type Row = Record<string, any>;
export interface SQL {
  query<T extends Row = Row>(sql: string, params?: any[]): Promise<T[]>;
}
export type EncryptedBackup = { format: 'klnk-backup-v1'; createdAt: string; payload: string };
const backupColumns = {
  users: ['id', 'email', 'password_hash', 'created_at', 'deleted_at', 'email_verified_at'],
  resources: [
    'id',
    'owner_id',
    'kind',
    'parent_id',
    'payload',
    'revision',
    'created_at',
    'updated_at',
  ],
  jobs: [
    'id',
    'owner_id',
    'mission_id',
    'kind',
    'payload',
    'status',
    'attempts',
    'run_at',
    'lease_until',
    'last_error',
    'created_at',
    'lease_token',
    'worker_id',
    'heartbeat_at',
  ],
  provider_events: ['event_key', 'conversation_id', 'received_at'],
  audit: ['id', 'owner_id', 'resource_id', 'event', 'created_at'],
  live_sessions: [
    'id',
    'owner_id',
    'request_id',
    'status',
    'provider_session_id',
    'version',
    'created_at',
    'updated_at',
    'expires_at',
    'reason_code',
    'terminal_evidence',
    'controller_id',
    'controller_lease_until',
  ],
  network_records: [
    'id',
    'kind',
    'owner_a',
    'owner_b',
    'status',
    'version',
    'payload',
    'created_at',
    'updated_at',
    'failure_attempts',
    'next_attempt_at',
    'dead_lettered_at',
  ],
} as const;
export class Database implements SQL {
  private embedded?: PGlite;
  private pool?: pg.Pool;
  private key!: Buffer;
  private queue = Promise.resolve();
  constructor(
    private options: {
      url?: string;
      dataDir?: string;
      key?: string;
      production?: boolean;
      embeddedTemplate?: Blob;
    } = {},
  ) {}
  async open() {
    const dir = this.options.dataDir ?? resolve('.data');
    if (this.options.production && (!this.options.url || !this.options.key))
      throw new Error('Production requires DATABASE_URL and DATA_ENCRYPTION_KEY');
    if (this.options.key) {
      if (!/^[a-f0-9]{64}$/i.test(this.options.key))
        throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes in hex');
      this.key = Buffer.from(this.options.key, 'hex');
    } else if (dir === 'memory://') this.key = randomBytes(32);
    else {
      await mkdir(dir, { recursive: true });
      const keyPath = resolve(dir, 'local-encryption-key');
      try {
        this.key = Buffer.from((await readFile(keyPath, 'utf8')).trim(), 'hex');
      } catch (error: any) {
        if (error.code !== 'ENOENT') throw error;
        this.key = randomBytes(32);
        await writeFile(keyPath, this.key.toString('hex'), { mode: 0o600, flag: 'wx' });
      }
    }
    if (this.key.length !== 32)
      throw new Error(
        'The local data encryption key is invalid. Restore the protected key; existing data was not changed.',
      );
    if (!this.options.url && dir !== 'memory://') await mkdir(dir, { recursive: true });
    if (this.options.url) this.pool = new pg.Pool({ connectionString: this.options.url, max: 8 });
    else {
      if (this.options.embeddedTemplate && dir !== 'memory://')
        throw new Error('Embedded templates require an isolated memory database.');
      this.embedded = this.options.embeddedTemplate
        ? new PGlite({ loadDataDir: this.options.embeddedTemplate })
        : new PGlite(dir === 'memory://' ? undefined : resolve(dir, 'postgres'));
    }
    try {
      await this.migrate();
    } catch (error) {
      await this.close();
      throw error;
    }
    return this;
  }
  /** Explicit test fixture snapshot; never exports server-Postgres or on-disk user data. */
  async dumpEmbeddedTemplate() {
    if (!this.embedded || this.options.dataDir !== 'memory://')
      throw new Error('Only isolated in-memory databases can be used as templates.');
    return this.embedded.dumpDataDir();
  }
  private async migrate() {
    const migrationDir = new URL('../migrations/', import.meta.url);
    const files = (await readdir(migrationDir)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
    const migrations = await Promise.all(
      files.map(async (name) => {
        const source = await readFile(new URL(name, migrationDir), 'utf8');
        return { name, source, checksum: createHash('sha256').update(source).digest('hex') };
      }),
    );
    const apply = async (sql: SQL, execute: (source: string) => Promise<unknown>) => {
      await sql.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
      );
      const applied = await sql.query('SELECT name,checksum FROM schema_migrations ORDER BY name');
      if (applied.some((row) => !migrations.some((migration) => migration.name === row.name)))
        throw new Error(
          'Database schema is newer than this application. Use a compatible application version.',
        );
      for (const migration of migrations) {
        const previous = applied.find((row) => row.name === migration.name);
        if (previous) {
          if (previous.checksum !== migration.checksum)
            throw new Error(
              `Migration checksum mismatch: ${migration.name}. Restore the original migration and use a forward repair.`,
            );
          continue;
        }
        await execute(migration.source);
        await sql.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
          migration.name,
          migration.checksum,
        ]);
      }
    };
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        // All migration statements and this transaction-level lock use one connection.
        await client.query('SELECT pg_advisory_xact_lock(1263291981)');
        await apply(
          { query: async (source, params = []) => (await client.query(source, params)).rows },
          (source) => client.query(source),
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } else {
      await this.exclusive(async (sql) => {
        await sql.query('BEGIN');
        try {
          await apply(sql, (source) => this.embedded!.exec(source));
          await sql.query('COMMIT');
        } catch (error) {
          await sql.query('ROLLBACK');
          throw error;
        }
      });
    }
  }
  private async exclusive<T>(fn: (db: SQL) => Promise<T>): Promise<T> {
    if (this.pool) return fn(this);
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((r) => {
      release = r;
    });
    await previous;
    try {
      return await fn({
        query: async <R extends Row>(sql: string, params: any[] = []) =>
          (await this.embedded!.query<R>(sql, params)).rows,
      });
    } finally {
      release();
    }
  }
  async query<T extends Row = Row>(sql: string, params: any[] = []): Promise<T[]> {
    if (this.pool) return (await this.pool.query(sql, params)).rows;
    return this.exclusive((db) => db.query<T>(sql, params));
  }
  async transaction<T>(fn: (db: SQL) => Promise<T>): Promise<T> {
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const value = await fn({
          query: async (sql, params = []) => (await client.query(sql, params)).rows,
        });
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    return this.exclusive(async (db) => {
      await db.query('BEGIN');
      try {
        const value = await fn(db);
        await db.query('COMMIT');
        return value;
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    });
  }
  encrypt(value: unknown): string {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), body].map((x) => x.toString('base64')).join('.');
  }
  /** Domain-separated internal identifiers; never expose the encryption key. */
  keyedDigest(
    purpose: 'recipient-suppression' | 'tool-arguments' | 'mission-submission' | 'rate-limit',
    value: string,
  ): string {
    if (
      !['recipient-suppression', 'tool-arguments', 'mission-submission', 'rate-limit'].includes(
        purpose,
      )
    )
      throw new Error('Unknown keyed identifier purpose.');
    return createHmac('sha256', this.key).update(`${purpose}\0${value}`).digest('hex');
  }
  decrypt<T = any>(payload: string): T {
    const [iv, tag, body] = payload.split('.').map((x) => Buffer.from(x, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag!);
    return JSON.parse(
      Buffer.concat([decipher.update(body!), decipher.final()]).toString('utf8'),
    ) as T;
  }
  async createBackup(): Promise<EncryptedBackup> {
    const createdAt = new Date().toISOString();
    const snapshot = await this.transaction(async (sql) => {
      await sql.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const migrations = await sql.query(
        'SELECT name,checksum FROM schema_migrations ORDER BY name',
      );
      const tables: Record<string, Row[]> = {};
      for (const table of Object.keys(backupColumns))
        tables[table] = await sql.query(`SELECT * FROM ${table}`);
      return { createdAt, migrations, tables };
    });
    return { format: 'klnk-backup-v1', createdAt, payload: this.encrypt(snapshot) };
  }
  /** Restore only into an empty, offline database with the same separately held key.
   * The operator must supply the deletion ledger since backup creation, even if empty.
   * Authentication tokens are intentionally never restored. */
  async restoreBackup(
    backup: EncryptedBackup,
    policy: { deletedOwnerIds: readonly string[] },
  ): Promise<{ owners: number; resources: number; unresolvedLive: number }> {
    if (
      backup?.format !== 'klnk-backup-v1' ||
      typeof backup.payload !== 'string' ||
      !Number.isFinite(Date.parse(backup.createdAt)) ||
      !policy ||
      !Array.isArray(policy.deletedOwnerIds) ||
      policy.deletedOwnerIds.some((id) => typeof id !== 'string')
    )
      throw new Error('Invalid backup or missing deletion reconciliation policy.');
    let snapshot: { createdAt: string; migrations: Row[]; tables: Record<string, Row[]> };
    try {
      snapshot = this.decrypt(backup.payload);
    } catch {
      throw new Error(
        'Backup decryption failed. Use the matching protected key and intact backup.',
      );
    }
    if (
      !snapshot ||
      snapshot.createdAt !== backup.createdAt ||
      !Array.isArray(snapshot.migrations) ||
      !snapshot.tables ||
      Object.keys(backupColumns).some((table) => !Array.isArray(snapshot.tables[table]))
    )
      throw new Error('Invalid backup schema.');
    const deleted = new Set(policy.deletedOwnerIds);
    // Peer-owned reminders/outbox entries refer to a shared event. Deleting a
    // participant must not revive those entries during a historical restore.
    const removedNetworkEvents = new Set(
      snapshot.tables.network_records
        .filter((r) => r.kind === 'event' && (deleted.has(r.owner_a) || deleted.has(r.owner_b)))
        .map((r) => r.id),
    );
    const removedNetworkConversations = snapshot.tables.network_records
      .filter(
        (r) => r.kind === 'conversation' && (deleted.has(r.owner_a) || deleted.has(r.owner_b)),
      )
      .map((r) => ({ id: r.id, value: this.decrypt<any>(r.payload) }));
    const removedConversationIds = new Set(removedNetworkConversations.map((r) => r.id));
    const removedIntentIds = new Set(
      removedNetworkConversations.map((r) => `${r.value.initiatorId}:${r.value.request.requestId}`),
    );
    return this.transaction(async (sql) => {
      await sql.query(
        'LOCK TABLE users,resources,jobs,provider_events,audit,live_sessions,network_records IN ACCESS EXCLUSIVE MODE',
      );
      const [current] = await sql.query(
        'SELECT (SELECT count(*) FROM users)+(SELECT count(*) FROM resources)+(SELECT count(*) FROM jobs)+(SELECT count(*) FROM live_sessions)+(SELECT count(*) FROM network_records) AS total',
      );
      if (Number(current.total))
        throw new Error(
          'Restore requires an empty offline database. Existing application data was not changed.',
        );
      const migrations = await sql.query(
        'SELECT name,checksum FROM schema_migrations ORDER BY name',
      );
      if (JSON.stringify(migrations) !== JSON.stringify(snapshot.migrations))
        throw new Error(
          'Backup migration version does not match this application. Restore using the compatible artifact before a forward upgrade.',
        );
      let owners = 0,
        resources = 0,
        unresolvedLive = 0;
      for (const table of Object.keys(backupColumns) as (keyof typeof backupColumns)[]) {
        const columns = backupColumns[table];
        for (const source of snapshot.tables[table]) {
          const row = { ...source };
          const excluded =
            table === 'network_records'
              ? deleted.has(row.owner_a) || deleted.has(row.owner_b)
              : deleted.has(table === 'users' ? row.id : row.owner_id);
          if (excluded && !['users', 'jobs', 'live_sessions'].includes(table)) continue;
          if (table === 'network_records') {
            const value = this.decrypt<any>(row.payload);
            if (
              ['reminder', 'outbox', 'receipt'].includes(row.kind) &&
              (removedNetworkEvents.has(value.eventId) ||
                removedConversationIds.has(value.conversationId))
            )
              continue;
            if (
              row.kind === 'receipt' &&
              value.kind === 'owner_intent_v1' &&
              removedIntentIds.has(`${row.owner_a}:${value.commandId}`)
            ) {
              row.payload = this.encrypt(removedOwnerIntent(value, new Date().toISOString()));
              row.status = 'removed';
              row.version++;
            }
          }
          if (table === 'users') {
            if (excluded) {
              row.deleted_at = new Date().toISOString();
              row.email = `deleted-${row.id}@example.invalid`;
              row.password_hash = 'deleted';
            }
            owners++;
          }
          if (table === 'resources') resources++;
          if (table === 'jobs') {
            if (excluded && !['provider_delete', 'google_revoke'].includes(row.kind)) continue;
            if (row.status === 'running') {
              row.status = 'queued';
              row.last_error = 'restored_pending_reconciliation';
            }
            row.lease_until = null;
            row.lease_token = null;
            row.worker_id = null;
            row.heartbeat_at = null;
          }
          if (
            table === 'live_sessions' &&
            ['creating', 'active', 'closing', 'unconfirmed'].includes(row.status)
          ) {
            row.status = 'unconfirmed';
            row.version++;
            row.reason_code = 'restored_pending_reconciliation';
            row.updated_at = new Date().toISOString();
            unresolvedLive++;
          }
          if (table === 'live_sessions') {
            row.controller_id = null;
            row.controller_lease_until = null;
          }
          await sql.query(
            `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map((_, index) => `$${index + 1}`).join(',')})`,
            columns.map((column) => row[column] ?? null),
          );
        }
      }
      return { owners, resources, unresolvedLive };
    });
  }
  async close() {
    if (this.pool) await this.pool.end();
    if (this.embedded) await this.embedded.close();
  }
}

export class Repository {
  constructor(
    public db: Database,
    private sql: SQL = db,
  ) {}
  in(sql: SQL) {
    return new Repository(this.db, sql);
  }
  async list<T = any>(owner: string, kind: string, parent?: string): Promise<T[]> {
    const rows = await this.sql.query(
      'SELECT payload FROM resources WHERE owner_id=$1 AND kind=$2' +
        (parent ? ' AND parent_id=$3' : '') +
        ' ORDER BY created_at,id',
      parent ? [owner, kind, parent] : [owner, kind],
    );
    return rows.map((r) => this.db.decrypt<T>(r.payload));
  }
  async get<T = any>(owner: string, kind: string, id: string): Promise<T | undefined> {
    const [row] = await this.sql.query(
      'SELECT payload FROM resources WHERE owner_id=$1 AND kind=$2 AND id=$3',
      [owner, kind, id],
    );
    return row ? this.db.decrypt<T>(row.payload) : undefined;
  }
  async put(owner: string, kind: string, value: any, parent?: string): Promise<any> {
    if (this.sql === this.db)
      return this.db.transaction((sql) => this.in(sql).put(owner, kind, value, parent));
    const [user] = await this.sql.query('SELECT id,deleted_at FROM users WHERE id=$1 FOR UPDATE', [
      owner,
    ]);
    if (!user || user.deleted_at)
      throw new HttpError(
        401,
        'owner_deleted',
        'This account is no longer available. No personal data was saved.',
      );
    const stored = await this.sql.query(
      `INSERT INTO resources(id,owner_id,kind,parent_id,payload) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=resources.revision+1,updated_at=now()
      WHERE resources.owner_id=excluded.owner_id AND resources.kind=excluded.kind RETURNING id`,
      [value.id, owner, kind, parent ?? null, this.db.encrypt(value)],
    );
    if (!stored.length)
      throw new HttpError(
        409,
        'resource_identity_conflict',
        'This resource identifier is already in use. No change was saved.',
      );
    return value;
  }
  async remove(owner: string, kind: string, id: string) {
    await this.sql.query('DELETE FROM resources WHERE owner_id=$1 AND kind=$2 AND id=$3', [
      owner,
      kind,
      id,
    ]);
  }
  async audit(owner: string, id: string, event: string) {
    await this.sql.query('INSERT INTO audit(id,owner_id,resource_id,event) VALUES($1,$2,$3,$4)', [
      randomUUID(),
      owner,
      id,
      event,
    ]);
  }
  async enqueue(
    owner: string,
    mission: string | null,
    kind: string,
    payload: any,
    delayMs = 0,
    id: string = randomUUID(),
  ) {
    await this.sql.query(
      'INSERT INTO jobs(id,owner_id,mission_id,kind,payload,run_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',
      [
        id,
        owner,
        mission,
        kind,
        this.db.encrypt(payload),
        new Date(Date.now() + delayMs).toISOString(),
      ],
    );
    return id;
  }
}
