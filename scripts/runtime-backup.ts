import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Database, type EncryptedBackup } from '../apps/server/src/db.js';
import { getConfig } from '../apps/server/src/config.js';

const args = process.argv.slice(2),
  command = args[0];
const flag = (name: string) => {
  const position = args.indexOf(name);
  return position < 0 ? undefined : args[position + 1];
};
const file = flag('--file');
if (!['backup', 'restore'].includes(command) || !file)
  throw new Error(
    'Use backup|restore --file <encrypted-backup.json>; restore additionally needs --deletion-journal <json> --offline-confirmed.',
  );
const config = getConfig();
if (!config.key)
  throw new Error(
    'Provide DATA_ENCRYPTION_KEY privately; this command never prints or embeds the key in a backup.',
  );
if (command === 'restore' && (!args.includes('--offline-confirmed') || !flag('--deletion-journal')))
  throw new Error(
    'Restore needs an explicit deletion journal and --offline-confirmed for an empty, stopped target.',
  );
const url = command === 'restore' ? process.env.RESTORE_DATABASE_URL : config.databaseUrl;
const dataDir = command === 'restore' ? process.env.RESTORE_DATA_DIR : config.dataDir;
if (command === 'restore' && !url && !dataDir)
  throw new Error(
    'Set RESTORE_DATABASE_URL or RESTORE_DATA_DIR privately to an isolated empty target.',
  );
const db = await new Database({
  url,
  dataDir,
  key: config.key,
  production: command === 'backup' ? config.production : !!url,
}).open();
try {
  if (command === 'backup') {
    const backup = await db.createBackup();
    await writeFile(resolve(file), JSON.stringify(backup), { mode: 0o600, flag: 'wx' });
    console.log(
      JSON.stringify({
        status: 'backup_created',
        createdAt: backup.createdAt,
        encrypted: true,
        sessionsIncluded: false,
      }),
    );
  } else {
    const backup = JSON.parse(await readFile(resolve(file), 'utf8')) as EncryptedBackup;
    const journal = JSON.parse(await readFile(resolve(flag('--deletion-journal')!), 'utf8')) as {
      deletedOwnerIds?: unknown;
    };
    if (
      !Array.isArray(journal.deletedOwnerIds) ||
      journal.deletedOwnerIds.some((id) => typeof id !== 'string')
    )
      throw new Error(
        'Deletion journal must contain deletedOwnerIds as an array of owner identifiers.',
      );
    const restored = await db.restoreBackup(backup, {
      deletedOwnerIds: journal.deletedOwnerIds as string[],
    });
    console.log(
      JSON.stringify({
        status: 'restored_pending_reconciliation',
        ...restored,
        sessionsRestored: false,
      }),
    );
  }
} finally {
  await db.close();
}
