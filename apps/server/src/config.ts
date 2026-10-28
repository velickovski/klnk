import 'dotenv/config';
export type Config = Omit<
  ReturnType<typeof getConfig>,
  'googleClientId' | 'googleClientSecret' | 'googleRedirectUri'
> & { googleClientId?: string; googleClientSecret?: string; googleRedirectUri?: string };
export function getConfig() {
  const production = process.env.NODE_ENV === 'production';
  return {
    production,
    port: Number(process.env.PORT ?? 4000),
    host: process.env.HOST ?? '127.0.0.1',
    databaseUrl: process.env.DATABASE_URL,
    dataDir: process.env.DATA_DIR ?? '.data',
    key: process.env.DATA_ENCRYPTION_KEY,
    demoEnabled: !production && process.env.DEMO_ENABLED !== 'false',
    openaiKey: process.env.OPENAI_API_KEY,
    provider:
      process.env.CALL_PROVIDER === 'elevenlabs' ? ('elevenlabs' as const) : ('simulator' as const),
    liveEnabled: process.env.LIVE_CALLS_ENABLED === 'true',
    liveOwnerId: process.env.LIVE_OWNER_ID,
    publicBaseUrl: process.env.PUBLIC_API_URL,
    recipients: (process.env.LIVE_TEST_RECIPIENTS ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    origins: (process.env.APP_ORIGINS ?? 'http://localhost:8081,http://localhost:8082').split(','),
    embeddedWorker: process.env.EMBEDDED_WORKER !== 'false',
    elevenKey: process.env.ELEVENLABS_API_KEY,
    agentId: process.env.ELEVENLABS_AGENT_ID,
    phoneId: process.env.ELEVENLABS_PHONE_NUMBER_ID,
    webhookSecret: process.env.ELEVENLABS_WEBHOOK_SECRET,
    twilioSid: process.env.TWILIO_ACCOUNT_SID,
    twilioToken: process.env.TWILIO_AUTH_TOKEN,
    standardVoice: process.env.ELEVENLABS_STANDARD_VOICE_ID,
    retentionVerified: process.env.PROVIDER_RETENTION_VERIFIED === 'true',
    llmProvider: process.env.ELEVENLABS_LLM_PROVIDER,
    retentionDisclosure: process.env.PROVIDER_RETENTION_DISCLOSURE,
    ownerAgentId: process.env.ELEVENLABS_OWNER_AGENT_ID,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI,
  };
}
