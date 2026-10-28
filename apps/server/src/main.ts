import { createApp } from './app.js';
const { app, config } = await createApp();
await app.listen({ host: config.host, port: config.port });
console.log(
  `Personal Voice Agent API: http://${config.host}:${config.port} (${config.provider}). No provider credentials are logged.`,
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
