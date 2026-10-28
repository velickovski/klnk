import pino from 'pino';

/** Structured operational metadata only. Never log bodies, headers, user IDs or provider errors. */
export const logger = pino({
  base: null,
  level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: {
    paths: [
      'authorization',
      'cookie',
      'token',
      'password',
      'email',
      'transcript',
      'apiKey',
      'req.headers',
      'req.body',
      'res.headers',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    req: (request: { id?: string; method?: string }) => ({
      id: request.id,
      method: request.method,
    }),
    res: (response: { statusCode?: number }) => ({ statusCode: response.statusCode }),
    err: () => ({ type: 'OperationalError' }),
  },
});
