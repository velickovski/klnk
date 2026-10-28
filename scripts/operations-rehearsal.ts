import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { Database, Repository, type SQL } from '../apps/server/src/db.js';
import { createSession, ownerFromToken } from '../apps/server/src/auth.js';
import { LiveSessionStore } from '../apps/server/src/live-session-store.js';

const databasePattern = /^klnk_qa_ops_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
let stage = 'initialization'; // Fixed operator diagnostics; never derived from SQL or private input.
export function guardedDatabaseName(name: string, allocated: ReadonlySet<string>): string {
  if (!databasePattern.test(name) || !allocated.has(name)) throw new Error('Unsafe rehearsal database reference.');
  return `"${name}"`;
}
export function guardedLocalConnection(value: unknown): { url: URL; key: string } {
  const input = value as { url?: unknown; key?: unknown };
  if (!input || typeof input.url !== 'string' || typeof input.key !== 'string') throw new Error('Missing private local fixture.');
  let url: URL; try { url = new URL(input.url); } catch { throw new Error('Invalid private local fixture.'); }
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/klnk_qa' || url.search || url.hash || !/^[a-f0-9]{64}$/i.test(input.key)) throw new Error('Unsafe local fixture endpoint.');
  return { url, key: input.key };
}
export async function deletionJournal(sql: SQL, since: string) {
  if (typeof since !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(since) || !Number.isFinite(Date.parse(since)) || new Date(since).toISOString() !== since) throw new Error('An explicit valid backup timestamp is required.');
  const rows = await sql.query('SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at >= $1 ORDER BY id', [new Date(since).toISOString()]);
  if (rows.some(row => typeof row.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(row.id))) throw new Error('Invalid deletion identifier.');
  return { format: 'klnk-deletion-journal-v1', since: new Date(since).toISOString(), exportedAt: new Date().toISOString(), deletedOwnerIds: rows.map(row => row.id as string) };
}

function privateToolEnv(url: URL, database: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ['PATH', 'SystemRoot', 'TEMP', 'TMP']) if (process.env[name]) env[name] = process.env[name];
  return { ...env, PGHOST: '127.0.0.1', PGPORT: '55432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: database, PGCONNECT_TIMEOUT: '5', PGSSLMODE: 'disable', PGAPPNAME: 'klnk_ops_rehearsal' };
}
async function tool(executable: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn(executable, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', warnings = false;
    child.stdout.on('data', chunk => { if (output.length < 2048) output += chunk.toString(); });
    // Never propagate utility diagnostics: they can contain identifiers or credentials.
    child.stderr.on('data', chunk => { if (String(chunk).trim()) warnings = true; });
    const timer = setTimeout(() => { child.kill(); fail(new Error('Local database utility timed out.')); }, 60000);
    child.once('error', () => { clearTimeout(timer); fail(new Error('Local database utility could not start.')); });
    child.once('exit', code => { clearTimeout(timer); if (code !== 0 || warnings) fail(new Error('Local database utility failed or reported warnings; diagnostics withheld.')); else done(output.trim()); });
  });
}

export async function rehearse() {
  const started = Date.now(), allocated = new Set<string>(), created = new Set<string>();
  const connection = guardedLocalConnection(JSON.parse(await readFile(resolve('.data/production-pg/connection.json'), 'utf8')));
  const provenance = JSON.parse(await readFile(resolve('.data/production-pg/download.json'), 'utf8'));
  const admin = new pg.Pool({ connectionString: connection.url.toString(), max: 1, connectionTimeoutMillis: 5000 });
  const databases: Database[] = [];
  const directory = await mkdtemp(join(tmpdir(), 'klnk-ops-'));
  const results: Record<string, boolean> = {};
  let report: Record<string, unknown> | undefined;
  const address = (name: string) => { guardedDatabaseName(name, allocated); const url = new URL(connection.url); url.pathname = `/${name}`; return url.toString(); };
  const open = async (name: string) => { const db = await new Database({ url: address(name), key: connection.key, production: true }).open(); databases.push(db); return db; };
  const close = async (db: Database) => { await db.close(); databases.splice(databases.indexOf(db), 1); };
  try {
    stage = 'verify_local_server';
    const server = (await admin.query('SELECT host(inet_server_addr()) AS host,inet_server_port() AS port,current_database() AS database,version() AS version')).rows[0];
    assert(server.host === '127.0.0.1' && server.port === 55432 && server.database === 'klnk_qa', 'Local server identity mismatch.');
    const bin = resolve('.data/production-pg/pgsql/bin');
    stage = 'verify_utilities';
    const dumpVersion = await tool(join(bin, 'pg_dump.exe'), ['--version'], privateToolEnv(connection.url, 'klnk_qa'));
    const restoreVersion = await tool(join(bin, 'pg_restore.exe'), ['--version'], privateToolEnv(connection.url, 'klnk_qa'));
    assert(/^pg_dump \(PostgreSQL\) 18\.6/.test(dumpVersion) && /^pg_restore \(PostgreSQL\) 18\.6/.test(restoreVersion), 'Unexpected local tooling version.');
    const names = Array.from({ length: 3 }, () => `klnk_qa_ops_${randomUUID()}`);
    stage = 'create_isolated_databases';
    for (const name of names) { allocated.add(name); await admin.query(`CREATE DATABASE ${guardedDatabaseName(name, allocated)} TEMPLATE template0`); created.add(name); }
    const [sourceName, quarantineName, cleanName] = names as [string, string, string];
    const source = await open(sourceName), repo = new Repository(source);
    stage = 'seed_fictional_source';
    const owner = randomUUID(), removed = randomUUID();
    for (const id of [owner, removed]) await source.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [id, `${id}@example.invalid`, 'fictional-unused-hash']);
    await repo.put(owner, 'memory', { id: randomUUID(), text: 'Fictional retained operations note' });
    await repo.put(removed, 'memory', { id: randomUUID(), text: 'Fictional removed operations note' });
    const oldToken = await createSession(source, owner);
    const liveStore = new LiveSessionStore(source);
    let { receipt } = await liveStore.reserve(owner, randomUUID());
    receipt = await liveStore.attachProvider(owner, receipt.id, receipt.version, 'fictional-ops-provider-session');
    const job = await repo.enqueue(owner, null, 'retention_sweep', {});
    await source.query("UPDATE jobs SET status='running',lease_token=$2,worker_id=$3,heartbeat_at=now(),lease_until=now()+interval '1 hour' WHERE id=$1", [job, randomUUID(), randomUUID()]);
    const cleanup = await repo.enqueue(removed, null, 'google_revoke', { token: 'fictional-ops-cleanup-token' });
    await repo.enqueue(removed, null, 'start', { fictional: true });
    const beforeDump = (await source.query('SELECT clock_timestamp() AS at'))[0].at.toISOString();
    const archive = join(directory, 'fictional.dump');
    stage = 'dump_source';
    await tool(join(bin, 'pg_dump.exe'), ['--format=custom', '--no-owner', '--no-acl', '--no-password', '--file', archive], privateToolEnv(connection.url, sourceName));
    // Fictional deletion occurs AFTER the dump. Its independent journal must survive the restore.
    await source.transaction(async sql => {
      await sql.query("UPDATE users SET deleted_at=clock_timestamp(),email=$2,password_hash='deleted' WHERE id=$1", [removed, `deleted-${removed}@example.invalid`]);
      await sql.query('DELETE FROM resources WHERE owner_id=$1', [removed]);
      await sql.query('DELETE FROM sessions WHERE owner_id=$1', [removed]);
    });
    stage = 'export_independent_journal';
    const journalFile = join(directory, 'deletions.json');
    const journalEnv = { ...privateToolEnv(connection.url, sourceName), KLNK_JOURNAL_DATABASE_URL: address(sourceName) };
    const journalArgs = ['--import', 'tsx', resolve('scripts/operations-rehearsal.ts'), 'export-deletion-journal', '--since', beforeDump, '--file', journalFile];
    await tool(process.execPath, journalArgs, journalEnv);
    const journalText = await readFile(journalFile, 'utf8'), journal = JSON.parse(journalText);
    results.operatorJournalExportsPostDumpDeletion = journal.deletedOwnerIds.length === 1 && journal.deletedOwnerIds[0] === removed;
    results.operatorJournalNeverOverwrites = await tool(process.execPath, journalArgs, journalEnv).then(() => false, () => true) && await readFile(journalFile, 'utf8') === journalText;
    stage = 'restore_quarantine';
    await tool(join(bin, 'pg_restore.exe'), ['--dbname', quarantineName, '--no-owner', '--no-acl', '--no-password', '--exit-on-error', '--single-transaction', archive], privateToolEnv(connection.url, quarantineName));
    const quarantine = await open(quarantineName);
    results.dumpRestoredOldSession = await ownerFromToken(quarantine, `Bearer ${oldToken}`) === owner;
    results.dumpRestoredOldController = (await new LiveSessionStore(quarantine).get(owner, receipt.id))?.controllerId === liveStore.controllerId;
    results.dumpRestoredOldWorkerLease = (await quarantine.query('SELECT lease_token FROM jobs WHERE id=$1', [job]))[0].lease_token !== null;
    results.dumpWouldResurrectDeletedContent = (await new Repository(quarantine).list(removed, 'memory')).length === 1;
    const encrypted = await quarantine.createBackup();
    stage = 'application_restore';
    results.applicationBackupEncrypted = !JSON.stringify(encrypted).includes('Fictional') && !JSON.stringify(encrypted).includes('fictional-ops-cleanup-token');
    const clean = await open(cleanName);
    const policy = JSON.parse(await readFile(journalFile, 'utf8'));
    await clean.restoreBackup(encrypted, { deletedOwnerIds: policy.deletedOwnerIds });
    results.cleanRetainsAllowedContent = (await new Repository(clean).list(owner, 'memory')).length === 1;
    results.cleanRejectsOldAuthentication = await ownerFromToken(clean, `Bearer ${oldToken}`) === undefined && Number((await clean.query('SELECT count(*) AS n FROM sessions'))[0].n) === 0;
    results.cleanSuppressesDeletedContent = (await new Repository(clean).list(removed, 'memory')).length === 0 && !!(await clean.query('SELECT deleted_at FROM users WHERE id=$1', [removed]))[0].deleted_at;
    const recovered = await new LiveSessionStore(clean).get(owner, receipt.id);
    results.cleanFencesController = recovered?.status === 'unconfirmed' && recovered.controllerId === undefined && recovered.providerSessionId === 'fictional-ops-provider-session';
    const resetJob = (await clean.query('SELECT status,lease_token,worker_id,lease_until FROM jobs WHERE id=$1', [job]))[0];
    results.cleanFencesWorker = resetJob.status === 'queued' && resetJob.lease_token === null && resetJob.worker_id === null && resetJob.lease_until === null;
    const deletedJobs = await clean.query('SELECT id,kind FROM jobs WHERE owner_id=$1', [removed]);
    results.cleanupSurvivesDeletion = deletedJobs.length === 1 && deletedJobs[0].id === cleanup && deletedJobs[0].kind === 'google_revoke';
    const migrations = (await clean.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).map(row => ({ name: row.name as string, checksum: row.checksum as string }));
    stage = 'ledger_compatibility';
    const expectedMigrations=(await readdir(new URL('../apps/server/migrations/',import.meta.url))).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
    assert.deepEqual(migrations.map(value=>value.name),expectedMigrations);
    await close(clean);
    const compatible = await open(cleanName);
    results.currentArtifactReopensCurrentLedger = Number((await compatible.query('SELECT count(*) AS n FROM schema_migrations'))[0].n) === expectedMigrations.length;
    await compatible.query("INSERT INTO schema_migrations(name,checksum) VALUES('999_incompatible_fixture.sql','fictional')");
    await close(compatible);
    results.unknownLedgerRejected = await open(cleanName).then(() => false, () => true);
    const raw = new pg.Pool({ connectionString: address(cleanName), max: 1 });
    try {
      await raw.query("DELETE FROM schema_migrations WHERE name='999_incompatible_fixture.sql'");
      await raw.query("UPDATE schema_migrations SET checksum='fictional-drift' WHERE name='001_initial.sql'");
      results.checksumDriftRejected = await open(cleanName).then(() => false, () => true);
      await raw.query('UPDATE schema_migrations SET checksum=$1 WHERE name=$2', [migrations[0]!.checksum, migrations[0]!.name]);
    } finally { await raw.end(); }
    const repaired = await open(cleanName);
    results.forwardArtifactUnchanged = JSON.stringify(await repaired.query('SELECT name,checksum FROM schema_migrations ORDER BY name')) === JSON.stringify(migrations);
    stage = 'verify_assertions';
    assert(Object.values(results).every(Boolean), 'An operations assertion failed.');
    report = { at: new Date().toISOString(), environment: 'isolated local PostgreSQL', serverVersion: String(server.version).split(' on ')[0], dumpVersion, restoreVersion, portableArchiveSha256: provenance.sha256, dumpSha256: createHash('sha256').update(await readFile(archive)).digest('hex'), migrationArtifacts: migrations, providersContacted: false, trafficSwitched: false, priorCandidateRollback: 'not_run_no_prior_artifact', assertions: results, elapsedMs: Date.now() - started };
  } finally {
    await Promise.all(databases.map(db => db.close()));
    for (const name of created) {
      const quoted = guardedDatabaseName(name, allocated);
      const identity = (await admin.query('SELECT host(inet_server_addr()) AS host,inet_server_port() AS port,current_database() AS database')).rows[0];
      assert(identity.host === '127.0.0.1' && identity.port === 55432 && identity.database === 'klnk_qa', 'Cleanup endpoint mismatch.');
      await admin.query(`DROP DATABASE ${quoted}`);
    }
    const remaining = await admin.query('SELECT datname FROM pg_database WHERE datname=ANY($1::text[])', [[...created]]);
    await admin.end();
    const absolute = resolve(directory), expectedRoot = resolve(tmpdir()) + sep;
    if (!absolute.startsWith(expectedRoot) || !absolute.slice(expectedRoot.length).startsWith('klnk-ops-')) throw new Error('Unsafe local temporary directory.');
    await rm(absolute, { recursive: true, force: true });
    assert.equal(remaining.rows.length, 0, 'Rehearsal database cleanup incomplete.');
    if (report) report.cleanup = { createdDatabases: created.size, remainingDatabases: 0, temporaryArtifactsRemoved: true };
  }
  await mkdir(resolve('docs/production/evidence'), { recursive: true });
  await writeFile(resolve('docs/production/evidence/operations-rehearsal.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: 'passed', assertions: Object.keys(results).length, cleanup: report!.cleanup, providersContacted: false }));
}

async function main() {
  if (process.argv[2] === 'export-deletion-journal') {
    const args = process.argv.slice(3), flag = (name: string) => args[args.indexOf(name) + 1];
    if (!args.includes('--since') || !args.includes('--file') || !process.env.KLNK_JOURNAL_DATABASE_URL) throw new Error('Use export-deletion-journal --since <backup-time> --file <protected-new-file>; provide KLNK_JOURNAL_DATABASE_URL privately.');
    // This mode performs only a read-only transaction; never imports provider configuration.
    const pool = new pg.Pool({ connectionString: process.env.KLNK_JOURNAL_DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
    let client: pg.PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query('BEGIN READ ONLY');
      const connection = client;
      const journal = await deletionJournal({ query: async (sql, params) => (await connection.query(sql, params)).rows }, flag('--since')!);
      await client.query('COMMIT');
      await writeFile(resolve(flag('--file')!), JSON.stringify(journal, null, 2), { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ status: 'deletion_journal_exported', count: journal.deletedOwnerIds.length, since: journal.since }));
    } finally { client?.release(); await pool.end(); }
  } else if (process.argv.length === 2 || process.argv[2] === 'rehearse') await rehearse();
  else throw new Error('Use rehearse or export-deletion-journal.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error(JSON.stringify({status:'failed',stage,privateDiagnosticsWithheld:true})); process.exitCode = 1; });

