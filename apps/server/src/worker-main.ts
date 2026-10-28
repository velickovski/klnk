import { Database } from './db.js';
import { getConfig } from './config.js';
import { createRuntime } from './composition-root.js';
import { workerLogger } from './worker-logging.js';
import { logger } from './logging.js';
const config = getConfig();
if (!config.databaseUrl)
  throw new Error(
    'A separate worker needs DATABASE_URL. Local PGlite uses the embedded worker via npm run dev.',
  );
const db = await new Database({
  url: config.databaseUrl,
  key: config.key,
  production: config.production,
}).open();
const { engine, network } = createRuntime(db, config);
engine.start();
network.start();
logger.info({ event: 'worker_started' });
// Keep standalone process alive (the embedded interval intentionally unrefs).
const keepAlive = setInterval(() => {}, 60000);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void Promise.all([engine.stop(), network.stop()])
      .then(() => db.close())
      .then(() => {
        clearInterval(keepAlive);
        process.exit(0);
      })
      .catch(() => {
        workerLogger.error({ event: 'worker_shutdown_failed', reasonCode: 'operation_failed' });
        clearInterval(keepAlive);
        process.exit(1);
      });
  });
