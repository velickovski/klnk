import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { guardedPostgresFixture } from '../tests/support/postgres-fixture.js';

// Never use DATABASE_URL: the opt-in suites create and drop only their own
// random qa_* namespaces in a separately provisioned, dedicated test database.
const suppliedFile = process.env.KLNK_POSTGRES_TEST_CONNECTION_FILE;
const suppliedUrl = process.env.KLNK_TEST_POSTGRES_URL;
if (!suppliedFile && !suppliedUrl) {
  throw new Error(
    'Set KLNK_TEST_POSTGRES_URL to an isolated loopback PostgreSQL /klnk_qa database, or KLNK_POSTGRES_TEST_CONNECTION_FILE to its private fixture file.',
  );
}
const fixture = guardedPostgresFixture(
  suppliedFile
    ? (JSON.parse(await readFile(resolve(suppliedFile), 'utf8')) as unknown)
    : { url: suppliedUrl, key: randomBytes(32).toString('hex') },
);
const directory = await mkdtemp(join(tmpdir(), 'klnk-test-pg-'));
try {
  const file = join(directory, 'connection.json');
  await writeFile(file, JSON.stringify({ url: fixture.url.href, key: fixture.key }), {
    mode: 0o600,
    flag: 'wx',
  });
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    KLNK_POSTGRES_TEST_CONNECTION_FILE: file,
    KLNK_TEST_POSTGRES_URL: fixture.url.href,
  };
  for (const key of ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'CI']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const result = await new Promise<number>((done, fail) => {
    const child = spawn(
      process.execPath,
      [
        resolve('node_modules/vitest/vitest.mjs'),
        'run',
        'tests/qa-postgres-runtime.test.ts',
        'tests/qa-network-postgres.test.ts',
        'tests/credential-clock.test.ts',
        'tests/qa-rate-postgres.test.ts',
      ],
      { env, stdio: 'inherit', windowsHide: true },
    );
    child.once('error', () => fail(new Error('Could not start PostgreSQL test runner.')));
    child.once('exit', (code) => done(code ?? 1));
  });
  process.exitCode = result;
} finally {
  await rm(directory, { recursive: true, force: true });
}
