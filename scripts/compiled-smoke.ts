import { spawn, type ChildProcess } from 'node:child_process';
import { createCipheriv, createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { guardedPostgresFixture } from '../tests/support/postgres-fixture.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifact = join(root, 'dist/server');
const suppliedFile = process.env.KLNK_POSTGRES_TEST_CONNECTION_FILE;
const suppliedUrl = process.env.KLNK_TEST_POSTGRES_URL;
if (!suppliedFile && !suppliedUrl)
  throw new Error(
    'Compiled smoke requires an explicit isolated PostgreSQL fixture file or QA URL.',
  );
let privateFixture: unknown;
try {
  privateFixture = suppliedFile
    ? JSON.parse(await readFile(resolve(suppliedFile), 'utf8'))
    : { url: suppliedUrl, key: randomBytes(32).toString('hex') };
} catch {
  throw new Error('The private compiled-smoke fixture could not be read.');
}
const fixture = guardedPostgresFixture(privateFixture);
const schema = 'qa_compiled_' + randomUUID().replaceAll('-', '');
const scoped = new URL(fixture.url);
scoped.searchParams.set('options', `-c search_path=${schema}`);
const directory = await mkdtemp(join(tmpdir(), 'klnk-compiled-'));
const children: ChildProcess[] = [];
const captured = new Map<ChildProcess, string>();
const admin = new pg.Pool({ connectionString: fixture.url.href, max: 2 });
let database: pg.Pool | undefined;
let schemaCreated = false;
const evidence: Record<string, unknown> = {
  format: 'klnk-compiled-smoke-v1',
  providersConfigured: false,
};
class SmokeFailure extends Error {}
function check(value: unknown, label: string): asserts value {
  if (!value) throw new SmokeFailure(label);
}
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(checker: () => Promise<boolean>, label: string, milliseconds = 15000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (await checker()) return;
    await delay(100);
  }
  throw new SmokeFailure(label);
}
async function requireFreePort(port: number) {
  await new Promise<void>((done, fail) => {
    const server = createServer();
    server.once('error', () => fail(new SmokeFailure('A compiled smoke port is already in use.')));
    server.listen(port, '127.0.0.1', () => server.close((error) => (error ? fail(error) : done())));
  });
}
function launch(entry: string, extra: NodeJS.ProcessEnv = {}) {
  // Deliberately no inherited provider keys, NODE_OPTIONS or dotenv-bearing cwd.
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: scoped.href,
    DATA_ENCRYPTION_KEY: fixture.key,
    HOST: '127.0.0.1',
    EMBEDDED_WORKER: 'false',
    DEMO_ENABLED: 'false',
    LEGACY_ENABLED: 'false',
    EMAIL_DELIVERY_ENABLED: 'false',
    LIVE_CALLS_ENABLED: 'false',
    CALL_PROVIDER: 'simulator',
    APP_ORIGINS: 'https://compiled.example.invalid',
    PUBLIC_APP_URL: 'https://compiled.example.invalid/',
    TRUST_PROXY: '127.0.0.1,::1',
    DATA_DIR: join(directory, 'data'),
    ...extra,
  };
  for (const key of ['PATH', 'SystemRoot', 'TEMP', 'TMP'])
    if (process.env[key]) env[key] = process.env[key];
  const child = spawn(process.execPath, [join(artifact, 'src', `${entry}.js`)], {
    cwd: directory,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.push(child);
  captured.set(child, '');
  child.once('error', () => captured.set(child, 'compiled_process_start_failed'));
  for (const stream of [child.stdout, child.stderr])
    stream?.on('data', (chunk: Buffer) =>
      captured.set(child, ((captured.get(child) ?? '') + chunk.toString()).slice(-65536)),
    );
  return child;
}
async function completed(child: ChildProcess) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise<number>((done, fail) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      fail(new SmokeFailure('A compiled process did not exit within twenty seconds.'));
    }, 20000);
    child.once('error', () => {
      clearTimeout(timer);
      fail(new SmokeFailure('A compiled process could not start.'));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      done(code ?? 1);
    });
  });
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = completed(child);
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
function encrypt(value: unknown) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', Buffer.from(fixture.key, 'hex'), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64')).join('.');
}
type Account = { id: string; token: string };
type SmokeData = Record<string, unknown> & {
  id: string;
  version: number;
  state: string;
  error: string;
  member: { memberCode: string };
  messages: { text: string }[];
  events: { id: string; terms: { slot: { startAt: string } } }[];
  requests: { requestId: string; status: string }[];
};
async function owner(name: string): Promise<Account> {
  const id = randomUUID(),
    token = randomBytes(32).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const password = `${salt}:${scryptSync('Fictional compiled password 42', salt, 64).toString('hex')}`;
  await database!.query(
    'INSERT INTO users(id,email,password_hash,email_verified_at) VALUES($1,$2,$3,clock_timestamp())',
    [id, `${id}@example.invalid`, password],
  );
  await database!.query(
    "INSERT INTO sessions(token_hash,owner_id,expires_at,reauth_until) VALUES($1,$2,clock_timestamp()+interval '1 day',clock_timestamp()+interval '5 minutes')",
    [createHash('sha256').update(token).digest('hex'), id],
  );
  await database!.query(
    "INSERT INTO resources(id,owner_id,kind,payload) VALUES($1,$1,'profile',$2)",
    [id, encrypt({ id, name, timezone: 'UTC' })],
  );
  return { id, token };
}
async function request(
  port: number,
  account: Account,
  path: string,
  method = 'GET',
  body?: unknown,
) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: {
      authorization: `Bearer ${account.token}`,
      'x-forwarded-proto': 'https',
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await response.json()) as SmokeData;
  return { status: response.status, data };
}

try {
  const manifest = JSON.parse(await readFile(join(artifact, 'build.json'), 'utf8')) as {
    entryPoints: string[];
    migrations: { name: string; sha256: string }[];
    externalImports: string[];
  };
  check(
    manifest.entryPoints.length === 3 && manifest.migrations.length >= 11,
    'Compiled manifest is incomplete.',
  );
  check(
    !manifest.externalImports.some((path) => path.startsWith('@personal-agent/')),
    'Workspace imports escaped the compiled artifact.',
  );
  for (const migration of manifest.migrations)
    check(
      createHash('sha256')
        .update(await readFile(join(artifact, 'migrations', migration.name)))
        .digest('hex') === migration.sha256,
      'Packaged migration checksum differs.',
    );
  await Promise.all([requireFreePort(4105), requireFreePort(4106)]);
  await admin.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  database = new pg.Pool({ connectionString: scoped.href, max: 4 });
  check((await completed(launch('migrate'))) === 0, 'Compiled migration entrypoint failed.');
  const migrated = await database.query('SELECT name FROM schema_migrations ORDER BY name');
  check(
    migrated.rowCount === manifest.migrations.length,
    'Compiled migrations were not applied in the isolated schema.',
  );
  evidence.migrations = migrated.rowCount;
  const alice = await owner('Compiled Alice'),
    jordan = await owner('Compiled Jordan');
  launch('main', { PORT: '4105' });
  launch('main', { PORT: '4106' });
  for (const port of [4105, 4106])
    await until(async () => {
      try {
        return (
          await fetch(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(1000) })
        ).ok;
      } catch {
        return false;
      }
    }, 'A compiled API did not become ready.');
  const identity = await request(4106, jordan, '/network/identity');
  check(identity.status === 200, 'Compiled identity failed.');
  const invited = await request(4105, alice, '/network/connections', 'POST', {
    memberCode: identity.data.member.memberCode,
  });
  check(invited.status === 200, 'Compiled invitation failed.');
  const accepted = await request(4106, jordan, `/network/connections/${invited.data.id}`, 'PATCH', {
    action: 'accept',
    version: invited.data.version,
  });
  check(accepted.status === 200, 'Compiled connection acceptance failed.');
  const base = {
    connectionId: accepted.data.id,
    purpose: 'Fictional compiled smoke request',
    topic: 'routine',
    message: 'A fictional internal-only compiled message.',
    candidateSlots: [],
    location: 'Fictional fountain',
    expiresAt: new Date(Date.now() + 2 * 86400000).toISOString(),
  };
  const queued = await request(4105, alice, '/network/conversations', 'POST', {
    ...base,
    kind: 'inform',
    requestId: randomUUID(),
  });
  check(
    queued.status === 200 && queued.data.state === 'queued',
    'Compiled message was not queued.',
  );
  await delay(250);
  check(
    (await request(4106, jordan, `/network/conversations/${queued.data.id}`)).data.state ===
      'queued',
    'An API unexpectedly embedded its worker.',
  );
  const job = randomUUID(),
    poison = randomUUID();
  await database.query(
    "INSERT INTO jobs(id,owner_id,kind,payload) VALUES($1,$2,'provider_delete',$3)",
    [job, alice.id, encrypt({})],
  );
  await database.query(
    "INSERT INTO jobs(id,owner_id,kind,payload,attempts) VALUES($1,$2,'provider_delete','invalid-ciphertext',4)",
    [poison, alice.id],
  );
  const worker = launch('worker-main');
  await until(
    async () => (captured.get(worker) ?? '').includes('worker_started'),
    'Compiled worker did not start.',
  );
  await until(
    async () =>
      (await request(4106, jordan, `/network/conversations/${queued.data.id}`)).data.state ===
      'delivered',
    'Compiled worker did not deliver the internal inbox message.',
  );
  const delivered = await request(4105, alice, `/network/conversations/${queued.data.id}`);
  check(
    delivered.data.messages.some((message: { text: string }) => message.text === base.message),
    'Shared message readback differs.',
  );
  evidence.internalMessage = 'delivered_to_internal_inbox';
  for (const [account, peer, port] of [
    [alice, jordan, 4105],
    [jordan, alice, 4106],
  ] as const) {
    const current = await request(port, account, '/network/policy');
    const { ownerId, version, updatedAt, authorityVersions, ...policy } = current.data;
    const saved = await request(port, account, '/network/policy', 'PUT', {
      expectedVersion: version,
      policy: {
        ...policy,
        enabled: true,
        trustedMemberIds: [peer.id],
        topics: ['routine'],
        allowMeetings: true,
        autoAcceptMeetings: true,
        minNoticeMinutes: 0,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        workStartMinute: 0,
        workEndMinute: 1440,
      },
    });
    check(saved.status === 200, 'Compiled scheduling policy failed.');
    check(
      (
        await request(port, account, '/network/calendar/availability', 'PUT', {
          confirmedThrough: new Date(Date.now() + 7 * 86400000).toISOString(),
        })
      ).status === 200,
      'Compiled manual availability failed.',
    );
  }
  const start = Date.now() + 86400000;
  const slot = {
    startAt: new Date(start).toISOString(),
    endAt: new Date(start + 1800000).toISOString(),
    timezone: 'UTC',
  };
  const meeting = await request(4105, alice, '/network/conversations', 'POST', {
    ...base,
    requestId: randomUUID(),
    kind: 'meeting',
    candidateSlots: [slot],
  });
  check(meeting.status === 200, 'Compiled meeting submission failed.');
  await until(
    async () =>
      (await request(4106, jordan, `/network/conversations/${meeting.data.id}`)).data.state ===
      'agreed',
    'Compiled worker did not complete the authorized internal agreement.',
  );
  const firstCalendar = (await request(4105, alice, '/network/calendar')).data;
  const secondCalendar = (await request(4106, jordan, '/network/calendar')).data;
  check(
    firstCalendar.events.length === 1 &&
      secondCalendar.events[0]?.id === firstCalendar.events[0].id,
    'Compiled calendars do not share exactly one agreement.',
  );
  check(
    firstCalendar.events[0].terms.slot.startAt === slot.startAt,
    'Compiled calendar terms differ.',
  );
  evidence.internalCalendarEvents = 1;
  await until(async () => {
    const result = await database!.query(
      'SELECT id,status,attempts,lease_token FROM jobs WHERE id=ANY($1)',
      [[job, poison]],
    );
    return (
      result.rows.some(
        (row) =>
          row.id === job && row.status === 'done' && row.attempts === 1 && row.lease_token === null,
      ) &&
      result.rows.some(
        (row) =>
          row.id === poison &&
          row.status === 'failed' &&
          row.attempts === 5 &&
          row.lease_token === null,
      )
    );
  }, 'Compiled worker job completion or poison fencing failed.');
  evidence.jobs = { localNoOpCleanup: 'done_once', poison: 'failed_at_attempt_five' };
  const rateOwner = await owner('Compiled rate owner');
  const statuses = await Promise.all(
    Array.from({ length: 110 }, (_, index) =>
      request(index % 2 ? 4105 : 4106, rateOwner, '/account/status').then(
        (result) => result.status,
      ),
    ),
  );
  check(
    statuses.filter((status) => status === 200).length === 100 &&
      statuses.filter((status) => status === 429).length === 10,
    'Compiled APIs did not share one durable owner limit.',
  );
  evidence.sharedOwnerLimit = { accepted: 100, rejected: 10 };
  await database.query(
    "UPDATE sessions SET last_used_at=clock_timestamp()-interval '31 minutes' WHERE owner_id=$1",
    [rateOwner.id],
  );
  check(
    (await request(4105, rateOwner, '/account/status')).status === 401 &&
      (await request(4106, rateOwner, '/account/status')).status === 401,
    'Compiled APIs accepted an idle-expired session.',
  );
  evidence.sharedIdleSessionExpiry = 'denied_by_both';
  const requestId = randomUUID();
  await database.query(
    "INSERT INTO live_sessions(id,owner_id,request_id,status,expires_at) VALUES($1,$2,$3,'unconfirmed',clock_timestamp()+interval '5 minutes')",
    [randomUUID(), alice.id, requestId],
  );
  for (const port of [4105, 4106]) {
    const recovery = await request(port, alice, '/voice/live/recovery');
    check(
      recovery.status === 200 &&
        recovery.data.requests.some(
          (item: { requestId: string; status: string }) =>
            item.requestId === requestId && item.status === 'unconfirmed',
        ),
      'Compiled Live recovery lost an unresolved receipt.',
    );
  }
  const noProvider = await request(4105, alice, '/voice/live/session', 'POST', {
    requestId: randomUUID(),
    sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',
  });
  check(
    noProvider.status === 503 && noProvider.data.error === 'openai_not_configured',
    'Compiled missing-provider path invented a session.',
  );
  evidence.live = {
    sharedUnconfirmedReadback: true,
    configured: false,
    creation: 'denied_without_provider',
    paidConcurrencyPath: 'not_tested',
  };
  evidence.processes = { compiledApis: 2, compiledStandaloneWorkers: 1, tsxRuntimeChildren: 0 };
  evidence.shutdown =
    process.platform === 'win32'
      ? 'Windows termination only; Unix SIGTERM not verified'
      : 'SIGTERM exit observed; deployment drain still requires environment validation';
  evidence.result = 'passed';
  console.log(
    'Compiled smoke passed: two APIs, standalone worker, internal inbox/calendar, jobs, shared owner/session state. No providers configured.',
  );
} catch (error) {
  evidence.result = 'failed';
  evidence.reason = error instanceof SmokeFailure ? error.message : 'compiled_runtime_failure';
  console.error('Compiled smoke failed: ' + evidence.reason);
  process.exitCode = 1;
} finally {
  await Promise.all(children.map(stop));
  await database?.end();
  if (!/^qa_compiled_[a-f0-9]{32}$/.test(schema))
    throw new Error('Unsafe compiled fixture namespace.');
  if (schemaCreated) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
  if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith('klnk-compiled-'))
    throw new Error('Unsafe compiled temporary directory.');
  await rm(directory, { recursive: true, force: true });
  await mkdir(join(root, '.data'), { recursive: true });
  await writeFile(
    join(root, '.data/compiled-smoke.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  );
}
