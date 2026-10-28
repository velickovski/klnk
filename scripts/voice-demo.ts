import 'dotenv/config';

// Isolated local demo: never change the existing workspace server or telephony gates.
process.env.PORT = process.env.VOICE_DEMO_PORT ?? '4100';
process.env.HOST = '127.0.0.1';
process.env.NODE_ENV = 'development';
process.env.DEMO_ENABLED = 'true';
process.env.CALL_PROVIDER = 'simulator';
process.env.LIVE_CALLS_ENABLED = 'false';
process.env.DATA_DIR = '.data/voice-demo';
process.env.EMBEDDED_WORKER = 'false';
delete process.env.DATABASE_URL;

const { createApp } = await import('../apps/server/src/app.js');
const { app, config } = await createApp();
await app.listen({ host: config.host, port: config.port });
console.log(`klnk voice demo: http://localhost:${config.port}/demo`);
console.log('OpenAI credentials stay on the server. Outbound telephone calls are disabled.');
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
