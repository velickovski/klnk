import { readFile } from 'node:fs/promises';
import { inject } from 'vitest';
import { Database } from '../../apps/server/src/db.js';

declare module 'vitest' {
  export interface ProvidedContext {
    pgliteTemplate: string;
  }
}

let snapshot: Promise<Blob> | undefined;

export async function openTestDatabase(
  options: ConstructorParameters<typeof Database>[0] = { dataDir: 'memory://' },
): Promise<Database> {
  if (options?.url || options?.dataDir !== 'memory://') {
    throw new Error('The migrated test template is only for isolated in-memory fixtures.');
  }
  snapshot ??= readFile(inject('pgliteTemplate')).then(
    (bytes) => new Blob([new Uint8Array(bytes)]),
  );
  return new Database({ ...options, embeddedTemplate: await snapshot }).open();
}
