import { createHash, createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from '../errors.js';

const DISCOVERY = 'https://accounts.google.com/.well-known/openid-configuration';
const KEYS = 'https://www.googleapis.com/oauth2/v3/certs';
const headerSchema = z
  .object({
    alg: z.literal('RS256'),
    kid: z.string().min(1).max(128),
    typ: z.literal('JWT').optional(),
  })
  .strict();
const claimsSchema = z.object({
  iss: z.enum(['accounts.google.com', 'https://accounts.google.com']),
  aud: z.union([z.string(), z.array(z.string()).min(1)]),
  azp: z.string().optional(),
  sub: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[\x21-\x7e]+$/),
  exp: z.number().int(),
  iat: z.number().int(),
  nonce: z.string().optional(),
  at_hash: z.string().optional(),
});
const keySchema = z.object({
  kty: z.literal('RSA'),
  use: z.literal('sig').optional(),
  alg: z.literal('RS256').optional(),
  kid: z.string().min(1).max(128),
  n: z
    .string()
    .min(64)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/),
  e: z
    .string()
    .min(1)
    .max(16)
    .regex(/^[A-Za-z0-9_-]+$/),
});
const invalidIdentity = () =>
  new HttpError(
    502,
    'google_identity_invalid',
    'Google account identity could not be verified. Reconnect before using Calendar.',
  );

/** Only trusted Google discovery/keys URLs are fetched; JWT headers cannot add URLs. */
export class GoogleIdentityVerifier {
  private keys: z.infer<typeof keySchema>[] = [];
  private keysExpireAt = 0;
  private loading?: Promise<void>;
  constructor(
    private clientId: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async loadKeys(force = false) {
    if (!force && this.keys.length && this.keysExpireAt > Date.now()) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const discovery = await this.fetcher(DISCOVERY, {
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: { Accept: 'application/json' },
      });
      if (!discovery.ok) throw invalidIdentity();
      const configuration = z
        .object({ issuer: z.literal('https://accounts.google.com'), jwks_uri: z.literal(KEYS) })
        .safeParse(await discovery.json().catch(() => null));
      if (!configuration.success) throw invalidIdentity();
      const response = await this.fetcher(KEYS, {
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw invalidIdentity();
      const payload = z
        .object({ keys: z.array(keySchema).min(1).max(10) })
        .safeParse(await response.json().catch(() => null));
      if (!payload.success) throw invalidIdentity();
      const maxAge = Number(
        /(?:^|,)\s*max-age=(\d+)/i.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 300,
      );
      this.keys = payload.data.keys;
      this.keysExpireAt = Date.now() + Math.min(3600, Math.max(0, maxAge)) * 1000;
    })().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }
  async subject(
    idToken: string,
    accessToken: string,
    options: { nonce?: string; expectedSubject?: string } = {},
  ): Promise<string> {
    try {
      if (
        idToken.length > 20000 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(idToken)
      )
        throw invalidIdentity();
      const parts = idToken.split('.');
      const header = headerSchema.parse(
        JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')),
      );
      const claims = claimsSchema.parse(
        JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')),
      );
      await this.loadKeys();
      let key = this.keys.find((value) => value.kid === header.kid);
      if (!key) {
        await this.loadKeys(true);
        key = this.keys.find((value) => value.kid === header.kid);
      }
      if (
        !key ||
        !verify(
          'RSA-SHA256',
          Buffer.from(`${parts[0]}.${parts[1]}`),
          createPublicKey({ key: key as JsonWebKey, format: 'jwk' }),
          Buffer.from(parts[2], 'base64url'),
        )
      )
        throw invalidIdentity();
      const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (
        !audience.includes(this.clientId) ||
        (claims.azp !== undefined && claims.azp !== this.clientId) ||
        (audience.length > 1 && claims.azp !== this.clientId)
      )
        throw invalidIdentity();
      const now = Math.floor(Date.now() / 1000);
      if (
        claims.exp <= now ||
        claims.iat > now + 60 ||
        claims.exp <= claims.iat ||
        (options.nonce !== undefined && claims.nonce !== options.nonce) ||
        (options.expectedSubject !== undefined && claims.sub !== options.expectedSubject)
      )
        throw invalidIdentity();
      if (
        claims.at_hash &&
        claims.at_hash !==
          createHash('sha256').update(accessToken).digest().subarray(0, 16).toString('base64url')
      )
        throw invalidIdentity();
      return claims.sub;
    } catch {
      throw invalidIdentity();
    }
  }
}
