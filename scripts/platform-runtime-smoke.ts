import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database, Repository, type EncryptedBackup } from '../apps/server/src/db.js';
import { createSession, newUser, ownerFromToken } from '../apps/server/src/auth.js';
import { LiveSessionStore } from '../apps/server/src/live-session-store.js';

// This exercise ignores application credentials and uses isolated fictional data.
const started = Date.now();
const directory = await mkdtemp(join(tmpdir(), 'klnk-runtime-smoke-'));
const key = randomBytes(32).toString('hex');
let source: Database | undefined, target: Database | undefined, wrongKey: Database | undefined;
try {
  source = await new Database({ dataDir: join(directory, 'source'), key }).open();
  const owner = await newUser(
    source,
    'restore-owner@example.invalid',
    'A fictional restore exercise password',
  );
  const removed = await newUser(
    source,
    'removed-owner@example.invalid',
    'A fictional restore exercise password',
  );
  const repo = new Repository(source);
  await repo.put(owner.id, 'memory', {
    id: 'fictional-retained-memory',
    text: 'Fictional restore exercise note',
  });
  await repo.put(removed.id, 'memory', {
    id: 'fictional-deleted-memory',
    text: 'Fictional deleted account note',
  });
  const token = await createSession(source, owner.id);
  const live = new LiveSessionStore(source);
  let { receipt } = await live.reserve(owner.id, randomUUID());
  receipt = await live.attachProvider(
    owner.id,
    receipt.id,
    receipt.version,
    'fictional-restore-session',
  );
  await repo.enqueue(owner.id, null, 'provider_delete', { conversationId: 'fictional-cleanup' });
  const backup = await source.createBackup();
  const backupFile = join(directory, 'fixture-backup.json');
  await writeFile(backupFile, JSON.stringify(backup), { mode: 0o600, flag: 'wx' });
  const fromDisk = JSON.parse(await readFile(backupFile, 'utf8')) as EncryptedBackup;
  const results: Record<string, boolean> = {
    backupEncrypted:
      !JSON.stringify(fromDisk).includes('restore-owner@example.invalid') &&
      !JSON.stringify(fromDisk).includes('Fictional restore exercise note'),
  };
  target = await new Database({ dataDir: join(directory, 'target'), key }).open();
  const restored = await target.restoreBackup(fromDisk, { deletedOwnerIds: [removed.id] });
  results.restoredMemory = !!(await new Repository(target).get(
    owner.id,
    'memory',
    'fictional-retained-memory',
  ));
  results.oldTokenRejected = (await ownerFromToken(target, `Bearer ${token}`)) === undefined;
  results.deletedOwnerSuppressed =
    (await new Repository(target).get(removed.id, 'memory', 'fictional-deleted-memory')) ===
    undefined;
  const recovered = await new LiveSessionStore(target).get(owner.id, receipt.id);
  results.unresolvedRetained =
    recovered?.status === 'unconfirmed' &&
    recovered.providerSessionId === 'fictional-restore-session';
  results.controllerUnowned = recovered?.controllerId === undefined;
  results.repeatRestoreRejected = await target
    .restoreBackup(fromDisk, { deletedOwnerIds: [] })
    .then(
      () => false,
      () => true,
    );
  wrongKey = await new Database({
    dataDir: 'memory://',
    key: randomBytes(32).toString('hex'),
  }).open();
  results.wrongKeyRejected = await wrongKey.restoreBackup(fromDisk, { deletedOwnerIds: [] }).then(
    () => false,
    () => true,
  );
  await target.close();
  target = await new Database({ dataDir: join(directory, 'target'), key }).open();
  results.stateSurvivesReopen = !!(await new Repository(target).get(
    owner.id,
    'memory',
    'fictional-retained-memory',
  ));
  const migrations = (await target.query('SELECT name FROM schema_migrations ORDER BY name')).map(
    (row) => row.name,
  );
  assert(Object.values(results).every(Boolean), 'A runtime restore exercise assertion failed.');
  const report = {
    at: new Date().toISOString(),
    environment: 'Windows / isolated PGlite / fictional fixtures',
    realPostgresql: false,
    providersContacted: false,
    migrations,
    restored,
    results,
    elapsedMs: Date.now() - started,
  };
  const evidenceDirectory = resolve('.data/production-audit');
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    join(evidenceDirectory, 'platform-runtime.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await wrongKey?.close();
  await target?.close();
  await source?.close();
  const absoluteDirectory = resolve(directory),
    expectedPrefix = resolve(tmpdir(), 'klnk-runtime-smoke-');
  if (!absoluteDirectory.startsWith(expectedPrefix))
    throw new Error('Unexpected temporary restore directory.');
  await rm(absoluteDirectory, { recursive: true, force: true });
}
