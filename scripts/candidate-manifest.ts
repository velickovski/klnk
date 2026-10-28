import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { parse } from 'dotenv';

// A source candidate is reviewable evidence, never an automatic release gate.
const workspace = resolve('.'),
  rootFiles = [
    'AGENTS.md',
    'README.md',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'vitest.config.ts',
    'playwright.config.ts',
    '.env.example',
    '.gitignore',
  ];
const roots = ['apps', 'packages', 'scripts', 'tests', 'e2e', 'docs', '.github'];
const excluded = new Set([
  'node_modules',
  '.expo',
  'dist',
  'dist-e2e',
  '.data',
  '.git',
  'build',
  'Pods',
]);
const paths: string[] = [];
async function walk(folder: string) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (
      excluded.has(entry.name) ||
      /^dist(?:-|$)/.test(entry.name) ||
      entry.name === '.env' ||
      (entry.name.startsWith('.env.') && entry.name !== '.env.example')
    )
      continue;
    const file = resolve(folder, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.isFile()) paths.push(file);
  }
}
for (const name of rootFiles) {
  const file = resolve(name);
  if (
    await stat(file)
      .then((s) => s.isFile())
      .catch(() => false)
  )
    paths.push(file);
}
for (const root of roots) await walk(resolve(root));
paths.sort();
const environment = await readFile('.env', 'utf8')
  .then(parse)
  .catch(() => ({}) as Record<string, string>);
const privateValues = [
  'OPENAI_API_KEY',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_WEBHOOK_SECRET',
  'TWILIO_AUTH_TOKEN',
  'GOOGLE_CLIENT_SECRET',
  'DATA_ENCRYPTION_KEY',
]
  .map((name) => environment[name])
  .filter((value): value is string => typeof value === 'string' && value.length >= 12);
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const source = [];
for (const path of paths) {
  const bytes = await readFile(path);
  if (privateValues.some((value) => bytes.includes(Buffer.from(value))))
    throw new Error(
      `Private environment value found in candidate: ${relative(workspace, path)}. No value was printed.`,
    );
  source.push({
    path: relative(workspace, path).replaceAll('\\', '/'),
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
}
let bundleFiles = 0;
for (const folder of ['apps/mobile/dist', 'apps/mobile/dist-e2e']) {
  if (
    !(await stat(folder)
      .then((s) => s.isDirectory())
      .catch(() => false))
  )
    continue;
  const pending = [resolve(folder)];
  while (pending.length) {
    const directory = pending.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile()) {
        const bytes = await readFile(file);
        if (privateValues.some((value) => bytes.includes(Buffer.from(value))))
          throw new Error('Private environment value found in a web export. No value was printed.');
        bundleFiles++;
      }
    }
  }
}
const outIndex = process.argv.indexOf('--out'),
  out = resolve(
    outIndex >= 0
      ? process.argv[outIndex + 1]
      : `.data/release-candidate/candidate-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.json`,
  );
if (!out.endsWith('.json')) throw new Error('Use a new .json candidate manifest path.');
const project = JSON.parse(await readFile('package.json', 'utf8'));
const nameIndex = process.argv.indexOf('--name'),
  gateIndex = process.argv.indexOf('--gate');
const manifest = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  candidate: nameIndex >= 0 ? process.argv[nameIndex + 1] : 'klnk-local-review',
  applicationVersion: project.version,
  node: process.version,
  gitRepositoryPresent: await stat('.git')
    .then(() => true)
    .catch(() => false),
  releaseEligible: false,
  releaseGateReport:
    gateIndex >= 0 ? process.argv[gateIndex + 1] : 'docs/production/reports/STATUS.md',
  scope: 'Local source candidate; no signed native artifact or deployment',
  knownSecretScan: {
    sourceFiles: source.length,
    bundleFiles,
    passed: true,
    rule: 'Exact configured secret values checked without emitting their values; not an independent security certification',
  },
  sourceIdentity: sha256(JSON.stringify(source)),
  source,
};
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(
  JSON.stringify({
    prepared: true,
    releaseEligible: false,
    manifest: relative(workspace, out).replaceAll('\\', '/'),
    files: source.length,
    bundleFiles,
    sourceIdentity: manifest.sourceIdentity,
  }),
);
