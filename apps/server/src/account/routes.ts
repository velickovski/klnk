import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hashToken } from '../auth.js';
import { HttpError } from '../errors.js';
import {
  AccountService,
  AccountEmailSchema,
  AccountPasswordSchema,
  AccountLinkTokenSchema,
} from './service.js';

export function registerAccountRoutes(app: FastifyInstance, accounts: AccountService) {
  const principal = (req: FastifyRequest) => {
    if (!req.ownerId || !req.headers.authorization?.startsWith('Bearer '))
      throw new HttpError(401, 'unauthorized', 'Sign in to manage your account.');
    return { owner: req.ownerId, sessionHash: hashToken(req.headers.authorization.slice(7)) };
  };
  const publicLimit = { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } };
  app.post('/auth/verify-email', publicLimit, (req) =>
    accounts.verify(
      z
        .object({ token: AccountLinkTokenSchema, password: AccountPasswordSchema })
        .strict()
        .parse(req.body),
    ),
  );
  app.post('/auth/reset-request', publicLimit, async (req, reply) =>
    reply
      .code(202)
      .send(
        await accounts.requestReset(
          z.object({ email: AccountEmailSchema }).strict().parse(req.body).email,
        ),
      ),
  );
  app.post('/auth/reset', publicLimit, (req) =>
    accounts.reset(
      z
        .object({ token: AccountLinkTokenSchema, newPassword: AccountPasswordSchema })
        .strict()
        .parse(req.body),
    ),
  );
  app.get('/account/status', (req) => {
    const p = principal(req);
    return accounts.status(p.owner, p.sessionHash);
  });
  app.post('/account/reauth', publicLimit, (req) => {
    const p = principal(req);
    return accounts.reauthenticate(
      p.owner,
      p.sessionHash,
      z.object({ password: AccountPasswordSchema }).strict().parse(req.body).password,
    );
  });
  app.post('/account/password', publicLimit, (req) => {
    const p = principal(req);
    return accounts.changePassword(
      p.owner,
      p.sessionHash,
      z
        .object({ currentPassword: AccountPasswordSchema, newPassword: AccountPasswordSchema })
        .strict()
        .parse(req.body),
    );
  });
  app.post('/account/email', publicLimit, async (req, reply) => {
    const p = principal(req);
    return reply
      .code(202)
      .send(
        await accounts.requestEmailChange(
          p.owner,
          p.sessionHash,
          z
            .object({ email: AccountEmailSchema, password: AccountPasswordSchema })
            .strict()
            .parse(req.body),
        ),
      );
  });
  app.post('/account/resend-verification', publicLimit, async (req, reply) => {
    const p = principal(req);
    return reply
      .code(202)
      .send(
        await accounts.requestVerification(
          p.owner,
          p.sessionHash,
          z.object({ password: AccountPasswordSchema }).strict().parse(req.body).password,
        ),
      );
  });
  app.post('/account/sign-out-all', (req) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    const p = principal(req);
    return accounts.signOutAll(p.owner, p.sessionHash);
  });
}
