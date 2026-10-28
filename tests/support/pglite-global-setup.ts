import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { Database } from '../../apps/server/src/db.js';

/** One real migration pass per test invocation. Every fixture restores a new,
 * independent embedded database and still validates migration checksums. */
export default async function setup(project: TestProject) {
  const directory = await mkdtemp(join(tmpdir(), 'klnk-pglite-template-'));
  const db = new Database({ dataDir: 'memory://' });
  try {
    await db.open();
    const template = await db.dumpEmbeddedTemplate();
    const path = join(directory, 'migrated.tar.gz');
    await writeFile(path, Buffer.from(await template.arrayBuffer()), { mode: 0o600 });
    project.provide('pgliteTemplate', path);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    await db.close();
  }
  return async () => {
    await rm(directory, { recursive: true, force: true });
  };
}
