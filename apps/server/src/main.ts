import { createApp } from './app.js';
const { app, config } = await createApp();
await app.listen({ host: config.host, port: config.port });
app.log.info({ event: 'api_started' });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close().then(
      () => process.exit(0),
      () => {
        app.log.error({ event: 'api_shutdown_failed', reasonCode: 'operation_failed' });
        process.exit(1);
      },
    );
  });
