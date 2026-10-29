import { Database, Repository } from './db.js';
import type { Config } from './config.js';
import { Engine } from './engine.js';
import { HttpError } from './errors.js';
import { VoiceService } from './voice.js';
import { LiveSessionStore } from './live-session-store.js';
import { ApplicationToolGateway } from './integrations/gateway.js';
import { GoogleCalendarConnections } from './integrations/google-calendar.js';
import { RecipientSuppression } from './integrations/recipient-suppression.js';
import { InternalCalendar } from './network/calendar.js';
import { NetworkCoordinator } from './network/coordination.js';
import { workerLogger, type WorkerLogger } from './worker-logging.js';
import { OwnerIntentService } from './network/owner-intent.js';
import { RecordedNetworkVoice } from './network/recorded-voice.js';
import { AccountService } from './account/service.js';
import { AccountMailWorker, createSmtpMailer, type AccountMailer } from './account/mail.js';

/** API and standalone workers must receive the same cleanup and retention hooks.
 * Construction does not start timers, contact providers, or grant tool authority. */
export function createRuntime(
  db: Database,
  config: Config,
  options: {
    googleDependencies?: { fetch?: typeof fetch };
    liveSessions?: LiveSessionStore;
    logger?: WorkerLogger;
    networkIntentDependencies?: { fetch?: typeof fetch };
    recordedVoiceDependencies?: { fetch?: typeof fetch };
    accountDependencies?: {
      mailer?: AccountMailer;
      onSessionsRevoked?: (owner: string) => Promise<void>;
    };
  } = {},
) {
  const logger = options.logger ?? workerLogger;
  const repo = new Repository(db);
  const engine = new Engine(db, config, { logger });
  const voice = new VoiceService(engine);
  const google = new GoogleCalendarConnections(
    db,
    {
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
      redirectUri: config.googleRedirectUri,
      production: config.production,
    },
    options.googleDependencies,
  );
  const suppression = new RecipientSuppression(db);
  const liveSessions = options.liveSessions ?? new LiveSessionStore(db);
  const gateway = new ApplicationToolGateway(engine, liveSessions, {
    externalEffectsEnabled: false,
  });
  const internalCalendar = new InternalCalendar(db);
  const network = new NetworkCoordinator(db, internalCalendar, { logger });
  const ownerIntents = new OwnerIntentService(db, network, {
    apiKey: config.openaiKey,
    ...options.networkIntentDependencies,
  });
  const recordedVoice = new RecordedNetworkVoice(db, ownerIntents, {
    apiKey: config.openaiKey,
    ...options.recordedVoiceDependencies,
  });
  const accounts = new AccountService(db, {
    production: config.production,
    publicAppUrl: config.publicAppUrl,
    mailEnabled: config.mailEnabled === true,
    onSessionsRevoked: options.accountDependencies?.onSessionsRevoked,
  });
  const mailWorker = new AccountMailWorker(db, {
    enabled: config.mailEnabled === true,
    logger,
    transport:
      options.accountDependencies?.mailer ??
      createSmtpMailer({
        enabled: config.mailEnabled === true,
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpSecure,
        user: config.smtpUser,
        password: config.smtpPassword,
        from: config.mailFrom,
      }),
  });
  engine.googleRevoke = (token) => google.cleanupToken(token);
  engine.googleCalendarAccess = async (owner, integrationId) => {
    const access = await google.access(owner);
    if (access.integrationId !== integrationId)
      throw new HttpError(
        409,
        'integration_mismatch',
        'This action belongs to a different Calendar connection.',
      );
    return access;
  };
  engine.toolMaintenance = async (now) => {
    await gateway.sweepRetention(now);
    await recordedVoice.sweepRetention();
    await accounts.sweep(new Date(now));
    await db.query(
      "DELETE FROM request_limits WHERE reset_at<clock_timestamp()-interval '1 day' AND (blocked_until IS NULL OR blocked_until<clock_timestamp())",
    );
  };
  return {
    repo,
    engine,
    voice,
    google,
    suppression,
    liveSessions,
    gateway,
    internalCalendar,
    network,
    ownerIntents,
    recordedVoice,
    accounts,
    mailWorker,
  };
}
