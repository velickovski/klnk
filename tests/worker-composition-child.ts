import './network-egress-guard.js';
import { Database } from '../apps/server/src/db.js';
import { getConfig } from '../apps/server/src/config.js';
import { createRuntime } from '../apps/server/src/composition-root.js';

let db: Database | undefined;
try {
  const dataDir = process.env.KLNK_WORKER_FIXTURE_DIR;
  if (!dataDir || !/[\\/]klnk-worker-[^\\/]+$/.test(dataDir))
    throw new Error('unsafe_worker_fixture');
  db = await new Database({ dataDir }).open();
  let revocations = 0;
  const config = {
    ...getConfig(),
    production: false,
    dataDir,
    openaiKey: undefined,
    elevenKey: undefined,
    agentId: undefined,
    phoneId: undefined,
    twilioSid: undefined,
    twilioToken: undefined,
    provider: 'simulator' as const,
    liveEnabled: false,
  };
  const runtime = createRuntime(db, config, {
    googleDependencies: {
      fetch: async (input) => {
        if (String(input) !== 'https://oauth2.googleapis.com/revoke')
          throw new Error('unexpected_fixture_endpoint');
        revocations++;
        return new Response('', { status: 200 });
      },
    },
  });
  const completed = await runtime.engine.tick(true);
  process.send?.({ ok: true, revocations, completed });
} catch {
  process.send?.({ ok: false, code: 'worker_fixture_failed' });
  process.exitCode = 1;
} finally {
  await db?.close();
  process.disconnect?.();
}
