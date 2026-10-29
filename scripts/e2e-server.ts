import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../apps/server/src/app.js';
import { Database } from '../apps/server/src/db.js';
import { getConfig } from '../apps/server/src/config.js';

// Deterministic, disposable fixture: never inherits provider credentials or a real database.
const db = await new Database({ dataDir: 'memory://' }).open();
const service = await createApp({
  db,
  worker: true,
  rateLimitKey: (r) => String(r.headers['x-klnk-test-client'] ?? r.ip),
  config: {
    ...getConfig({ NODE_ENV: 'test' }),
    production: false,
    demoEnabled: true,
    legacyEnabled: true,
    port: 4102,
    host: '127.0.0.1',
    provider: 'simulator',
    liveEnabled: false,
    liveOwnerId: undefined,
    databaseUrl: undefined,
    origins: ['http://127.0.0.1:8083'],
    openaiKey: undefined,
    googleClientId: undefined,
    googleClientSecret: undefined,
    googleRedirectUri: undefined,
    elevenKey: undefined,
    agentId: undefined,
    phoneId: undefined,
    ownerAgentId: undefined,
    standardVoice: undefined,
    twilioSid: undefined,
    twilioToken: undefined,
    webhookSecret: undefined,
    publicBaseUrl: undefined,
  },
});
await service.app.ready();
const api = createAsyncServer(async (req, res) => {
  // Test-only proxy splits abuse-limit buckets by scenario. Production handlers
  // and their rate limits are unchanged; Live routes retain the loopback guard.
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:8083');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-klnk-test-client',
    });
    res.end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const testId = String(req.headers['x-klnk-test-client'] ?? 'default'),
    bucket = createHash('sha256').update(testId).digest();
  const headers: IncomingHttpHeaders = { ...req.headers, host: '127.0.0.1:4102' };
  delete headers['content-length'];
  try {
    const result = await service.app.inject({
      method: req.method as 'GET',
      url: req.url ?? '/',
      headers,
      payload: chunks.length ? Buffer.concat(chunks) : undefined,
      remoteAddress: /^\/(demo|voice\/live)/.test(req.url ?? '')
        ? '127.0.0.1'
        : `10.${bucket[0]}.${bucket[1]}.${bucket[2]}`,
    });
    for (const [name, value] of Object.entries(result.headers))
      if (value !== undefined) res.setHeader(name, value);
    res.writeHead(result.statusCode);
    res.end(result.rawPayload);
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end('{"error":"fixture_failed"}');
  }
});
const root = fileURLToPath(new URL('../apps/mobile/dist-e2e/', import.meta.url));
const mime: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};
const web = createAsyncServer(async (req, res) => {
  if (req.url === '/__e2e/ready') {
    res.writeHead(200);
    res.end('isolated-simulator-fixture');
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1:8083').pathname);
    const target = resolve(
      root,
      pathname === '/' || /^\/(workspace|join|account)(\/|$)/.test(pathname)
        ? 'index.html'
        : '.' + pathname,
    );
    if (!target.startsWith(root.endsWith(sep) ? root : root + sep)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const data = await readFile(target);
    res.writeHead(200, {
      'Content-Type': mime[extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
api.listen(4102, '127.0.0.1');
web.listen(8083, '127.0.0.1');
console.log('Isolated Expo E2E fixture ready; simulator only, provider credentials absent.');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await Promise.all([
    new Promise<void>((done) => api.close(() => done())),
    new Promise<void>((done) => web.close(() => done())),
  ]);
  await service.app.close();
  await db.close();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void close().finally(() => process.exit(0));
  });

function createAsyncServer(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
) {
  return createServer((request, response) => {
    void handler(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
}
