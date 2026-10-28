import { guardedPostgresFixture } from './support/postgres-fixture.js';
import './network-egress-guard.js';
import { readFile } from 'node:fs/promises';
import { Database } from '../apps/server/src/db.js';
import { InternalCalendar } from '../apps/server/src/network/calendar.js';
import { NetworkCoordinator } from '../apps/server/src/network/coordination.js';

// UUID/schema-only arguments and status-only IPC. No credential or raw record
// is copied into logs or IPC. The only socket target is guarded loopback PG.
let db: Database | undefined;
const send = (value: Record<string, unknown>) => process.send?.(value);
const continued = () =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fixture_timeout')), 25000);
    process.once('message', (message) => {
      clearTimeout(timer);
      if ((message as { type?: string })?.type === 'continue') resolve();
      else reject(new Error('fixture_protocol'));
    });
  });
try {
  const input = JSON.parse(process.argv[2] ?? '{}') as {
    schema: string;
    operation: 'tick' | 'crash_after_event';
  };
  if (!/^qa_[a-f0-9]{32}$/.test(input.schema)) throw new Error('unsafe_namespace');
  const path = process.env.KLNK_POSTGRES_TEST_CONNECTION_FILE;
  if (!path) throw new Error('missing_fixture');
  const privateConnection = JSON.parse(await readFile(path, 'utf8')) as {
    url: string;
    key: string;
  };
  const { url } = guardedPostgresFixture(privateConnection);
  url.searchParams.set('options', `-c search_path=${input.schema}`);
  url.searchParams.set('application_name', `network_child_${input.schema}`);
  db = await new Database({
    url: url.toString(),
    key: privateConnection.key,
    production: true,
  }).open();
  const calendar = new InternalCalendar(db),
    coordinator = new NetworkCoordinator(db, calendar);
  if (input.operation === 'crash_after_event') {
    const commit = calendar.commit.bind(calendar);
    calendar.commit = async (...args: Parameters<typeof commit>) => {
      const event = await commit(...args);
      const wait = continued();
      send({ type: 'uncommitted_event' });
      await wait;
      return event;
    };
  } else if (input.operation !== 'tick') throw new Error('invalid_operation');
  const wait = continued();
  send({ type: 'ready' });
  await wait;
  await coordinator.tick();
  send({ type: 'result', ok: true });
} catch (error) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'qa_network_child_failed';
  send({
    type: 'result',
    ok: false,
    code: /^[a-zA-Z0-9_]{1,64}$/.test(code) ? code : 'qa_network_child_failed',
  });
} finally {
  await db?.close().catch(() => undefined);
  process.disconnect?.();
}
