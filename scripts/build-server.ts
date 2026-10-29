import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distribution = join(root, 'dist');
const artifact = join(distribution, 'server');
// The output is generated, but refuse linked parents before recursively replacing it.
for (const path of [distribution, artifact]) {
  const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (stat?.isSymbolicLink()) throw new Error('Build output must not use symbolic links.');
}
if (artifact !== resolve(root, 'dist/server')) throw new Error('Unexpected build target.');
await mkdir(distribution, { recursive: true });
await rm(artifact, { recursive: true, force: true });
await mkdir(artifact, { recursive: true });

const result = await build({
  absWorkingDir: root,
  entryPoints: {
    main: 'apps/server/src/main.ts',
    'worker-main': 'apps/server/src/worker-main.ts',
    migrate: 'apps/server/src/migrate.ts',
  },
  outdir: join(artifact, 'src'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  packages: 'external',
  alias: { '@personal-agent/domain': join(root, 'packages/domain/src/index.ts') },
  sourcemap: 'external',
  metafile: true,
  logLevel: 'warning',
});
const dependencies = new Set<string>();
for (const output of Object.values(result.metafile.outputs))
  for (const imported of output.imports) {
    if (imported.path.startsWith('@personal-agent/'))
      throw new Error('A workspace source dependency escaped the server bundle.');
    if (imported.path.endsWith('.ts')) throw new Error('A TypeScript runtime import escaped.');
    if (imported.external && !imported.path.startsWith('node:')) dependencies.add(imported.path);
  }

const sourceMigrations = join(root, 'apps/server/migrations');
await cp(sourceMigrations, join(artifact, 'migrations'), { recursive: true });
const migrationNames = (await readdir(sourceMigrations))
  .filter((name) => /^\d+.*\.sql$/.test(name))
  .sort();
if (!migrationNames.length) throw new Error('No server migrations were packaged.');
const migrations = await Promise.all(
  migrationNames.map(async (name) => ({
    name,
    sha256: createHash('sha256')
      .update(await readFile(join(sourceMigrations, name)))
      .digest('hex'),
  })),
);
await writeFile(
  join(artifact, 'package.json'),
  JSON.stringify({ private: true, type: 'module' }) + '\n',
);
await writeFile(
  join(artifact, 'build.json'),
  JSON.stringify(
    {
      format: 'klnk-server-build-v1',
      node: '>=24',
      entryPoints: ['src/main.js', 'src/worker-main.js', 'src/migrate.js'],
      externalImports: [...dependencies].sort(),
      migrations,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Server JavaScript built: 3 entrypoints; ${migrations.length} migrations packaged.`);
