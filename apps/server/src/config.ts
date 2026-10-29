import 'dotenv/config';
import { z } from 'zod';
import { isIP } from 'node:net';
const optional = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .optional();
const boolean = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((value) => value === 'true');
const environment = z.object({
  NODE_ENV: z.enum(['production', 'development', 'test']).default('production'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_URL: optional,
  DATA_DIR: z.string().min(1).default('.data'),
  DATA_ENCRYPTION_KEY: optional,
  DEMO_ENABLED: boolean('true'),
  LEGACY_ENABLED: boolean('false'),
  OPENAI_API_KEY: optional,
  CALL_PROVIDER: z.enum(['simulator', 'elevenlabs']).default('simulator'),
  LIVE_CALLS_ENABLED: boolean('false'),
  LIVE_OWNER_ID: optional,
  PUBLIC_API_URL: optional,
  LIVE_TEST_RECIPIENTS: z.string().default(''),
  APP_ORIGINS: z.string().default('http://localhost:8081,http://localhost:8082'),
  EMBEDDED_WORKER: boolean('true'),
  ELEVENLABS_API_KEY: optional,
  ELEVENLABS_AGENT_ID: optional,
  ELEVENLABS_PHONE_NUMBER_ID: optional,
  ELEVENLABS_WEBHOOK_SECRET: optional,
  TWILIO_ACCOUNT_SID: optional,
  TWILIO_AUTH_TOKEN: optional,
  ELEVENLABS_STANDARD_VOICE_ID: optional,
  PROVIDER_RETENTION_VERIFIED: boolean('false'),
  ELEVENLABS_LLM_PROVIDER: optional,
  PROVIDER_RETENTION_DISCLOSURE: optional,
  ELEVENLABS_OWNER_AGENT_ID: optional,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  GOOGLE_REDIRECT_URI: optional,
  TRUST_PROXY: z.string().default('false'),
  OPERATOR_TOKEN: optional,
  PUBLIC_APP_URL: optional,
  EMAIL_DELIVERY_ENABLED: boolean('false'),
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: boolean('false'),
  SMTP_USER: optional,
  SMTP_PASSWORD: optional,
  SMTP_FROM: optional,
});
function proxy(value: string): false | string[] {
  if (value === 'false') return false;
  const ranges = value.split(',').map((part) => part.trim());
  if (
    !ranges.length ||
    ranges.some((part) => {
      const [address, prefix, ...extra] = part.split('/');
      const version = isIP(address);
      return (
        !version ||
        extra.length > 0 ||
        (prefix !== undefined &&
          (!/^\d+$/.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128)))
      );
    })
  )
    throw new Error('TRUST_PROXY must be false or explicit trusted proxy IP/CIDR addresses.');
  return ranges;
}
/** Missing NODE_ENV deliberately means production. Never print environment values. */
export function getConfig(raw: NodeJS.ProcessEnv = process.env) {
  const parsed = environment.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      `Invalid configuration fields: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  const e = parsed.data,
    production = e.NODE_ENV === 'production';
  if (!isIP(e.HOST) && !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(e.HOST))
    throw new Error('HOST must be an IP address or hostname.');
  for (const [field, value, originOnly] of [
    ['PUBLIC_API_URL', e.PUBLIC_API_URL, true],
    ['GOOGLE_REDIRECT_URI', e.GOOGLE_REDIRECT_URI, false],
    ['PUBLIC_APP_URL', e.PUBLIC_APP_URL, true],
  ] as const) {
    if (!value) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${field} must be a valid URL.`);
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      (production && url.protocol !== 'https:') ||
      (originOnly && (url.pathname !== '/' || url.search))
    )
      throw new Error(`${field} must be a valid HTTP URL and use HTTPS in production.`);
  }
  if (production && (!e.DATABASE_URL || !/^[a-f0-9]{64}$/i.test(e.DATA_ENCRYPTION_KEY ?? '')))
    throw new Error('Production requires DATABASE_URL and a valid DATA_ENCRYPTION_KEY.');
  if (e.DATABASE_URL && !/^postgres(?:ql)?:\/\//.test(e.DATABASE_URL))
    throw new Error('DATABASE_URL must use PostgreSQL.');
  if (e.DATA_ENCRYPTION_KEY && !/^[a-f0-9]{64}$/i.test(e.DATA_ENCRYPTION_KEY))
    throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes in hex.');
  const origins = e.APP_ORIGINS.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('APP_ORIGINS must contain valid origins.');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== origin ||
      (production && url.protocol !== 'https:')
    )
      throw new Error('APP_ORIGINS must contain exact HTTPS origins in production.');
  }
  if (production && e.OPERATOR_TOKEN && e.OPERATOR_TOKEN.length < 32)
    throw new Error('OPERATOR_TOKEN must contain at least 32 characters.');
  if (
    e.SMTP_HOST &&
    !isIP(e.SMTP_HOST) &&
    !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(e.SMTP_HOST)
  )
    throw new Error('SMTP_HOST must be an IP address or hostname.');
  if (e.SMTP_FROM && !z.email().max(254).safeParse(e.SMTP_FROM).success)
    throw new Error('SMTP_FROM must be a valid sender email address.');
  if (!!e.SMTP_USER !== !!e.SMTP_PASSWORD)
    throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together.');
  if (
    e.EMAIL_DELIVERY_ENABLED &&
    (!e.PUBLIC_APP_URL ||
      !e.SMTP_HOST ||
      !e.SMTP_FROM ||
      (production && (!e.SMTP_USER || !e.SMTP_PASSWORD)))
  )
    throw new Error(
      'Enabled email delivery requires PUBLIC_APP_URL, SMTP_HOST, SMTP_FROM and production SMTP credentials.',
    );
  return {
    production,
    port: e.PORT,
    host: e.HOST,
    databaseUrl: e.DATABASE_URL,
    dataDir: e.DATA_DIR,
    key: e.DATA_ENCRYPTION_KEY,
    demoEnabled: !production && e.DEMO_ENABLED,
    legacyEnabled: e.LEGACY_ENABLED,
    trustProxy: proxy(e.TRUST_PROXY),
    operatorToken: e.OPERATOR_TOKEN,
    publicAppUrl: e.PUBLIC_APP_URL,
    mailEnabled: e.EMAIL_DELIVERY_ENABLED,
    smtpHost: e.SMTP_HOST,
    smtpPort: e.SMTP_PORT,
    smtpSecure: e.SMTP_SECURE,
    smtpUser: e.SMTP_USER,
    smtpPassword: e.SMTP_PASSWORD,
    mailFrom: e.SMTP_FROM,
    openaiKey: e.OPENAI_API_KEY,
    provider: e.CALL_PROVIDER,
    liveEnabled: e.LIVE_CALLS_ENABLED,
    liveOwnerId: e.LIVE_OWNER_ID,
    publicBaseUrl: e.PUBLIC_API_URL,
    recipients: e.LIVE_TEST_RECIPIENTS.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    origins,
    embeddedWorker: e.EMBEDDED_WORKER,
    elevenKey: e.ELEVENLABS_API_KEY,
    agentId: e.ELEVENLABS_AGENT_ID,
    phoneId: e.ELEVENLABS_PHONE_NUMBER_ID,
    webhookSecret: e.ELEVENLABS_WEBHOOK_SECRET,
    twilioSid: e.TWILIO_ACCOUNT_SID,
    twilioToken: e.TWILIO_AUTH_TOKEN,
    standardVoice: e.ELEVENLABS_STANDARD_VOICE_ID,
    retentionVerified: e.PROVIDER_RETENTION_VERIFIED,
    llmProvider: e.ELEVENLABS_LLM_PROVIDER,
    retentionDisclosure: e.PROVIDER_RETENTION_DISCLOSURE,
    ownerAgentId: e.ELEVENLABS_OWNER_AGENT_ID,
    googleClientId: e.GOOGLE_CLIENT_ID,
    googleClientSecret: e.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: e.GOOGLE_REDIRECT_URI,
  };
}
type OptionalConfig =
  | 'googleClientId'
  | 'googleClientSecret'
  | 'googleRedirectUri'
  | 'trustProxy'
  | 'operatorToken'
  | 'legacyEnabled'
  | 'publicAppUrl'
  | 'mailEnabled'
  | 'smtpHost'
  | 'smtpPort'
  | 'smtpSecure'
  | 'smtpUser'
  | 'smtpPassword'
  | 'mailFrom';
export type Config = Omit<ReturnType<typeof getConfig>, OptionalConfig> &
  Partial<Pick<ReturnType<typeof getConfig>, OptionalConfig>>;
