import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hashToken } from '../auth.js';
import { HttpError } from '../errors.js';
import { networkRequestActor } from './store.js';
import type { RecordedNetworkVoice } from './recorded-voice.js';
import type { Config } from '../config.js';
import { ownerVoiceAllowed } from '../openai-live.js';

export function registerRecordedVoiceRoutes(
  app: FastifyInstance,
  service: RecordedNetworkVoice,
  config: Config,
) {
  function run<T>(request: FastifyRequest, operation: (owner: string) => Promise<T>) {
    ownerVoiceAllowed(config, request, request.method !== 'GET');
    const owner = request.ownerId;
    const header = request.headers.authorization;
    if (!owner || !header?.startsWith('Bearer '))
      throw new HttpError(401, 'unauthorized', 'Sign in before talking to your agent.');
    return networkRequestActor.run(
      { ownerId: owner, sessionHash: hashToken(header.slice(7)) },
      () => operation(owner),
    );
  }
  app.get('/network/voice/status', async (request, reply) => {
    ownerVoiceAllowed(config, request);
    return reply.header('Cache-Control', 'no-store').send(service.status());
  });
  app.post(
    '/network/voice/turn',
    { bodyLimit: 3 * 1024 * 1024, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (request, reply) =>
      reply
        .header('Cache-Control', 'no-store')
        .send(await run(request, (owner) => service.execute(owner, request.body))),
  );
  app.get('/network/voice/turns/:turnId', async (request, reply) =>
    reply
      .header('Cache-Control', 'no-store')
      .send(
        await run(request, (owner) =>
          service.read(owner, z.uuid().parse((request.params as { turnId: string }).turnId)),
        ),
      ),
  );
}
