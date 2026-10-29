import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { Database } from '../db.js';
import { logger as operationalLogger } from '../logging.js';

const messageSchema = z
  .object({
    to: z.email().max(254),
    subject: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[^\r\n]+$/),
    text: z.string().min(1).max(4000),
  })
  .strict();
export type AccountMessage = z.infer<typeof messageSchema>;
export interface AccountMailer {
  send(message: AccountMessage): Promise<{ accepted: boolean }>;
}
export class AccountMailError extends Error {
  constructor(readonly disposition: 'retryable' | 'rejected' | 'unknown') {
    super('Account email delivery was not confirmed.');
  }
}
type MailLogger = { error(fields: { event: string; reasonCode: string }): void };
export type SmtpAccountConfiguration = {
  enabled: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  password?: string;
  from?: string;
};

/** Creating a disabled adapter performs no DNS, connection or provider probe.
 * SMTP acceptance is never presented as recipient delivery or email proof. */
export function createSmtpMailer(config: SmtpAccountConfiguration): AccountMailer | undefined {
  if (!config.enabled) return undefined;
  if (!config.host || !config.user || !config.password || !config.from)
    throw new Error('Enabled account email requires complete SMTP configuration.');
  const from = z.email().max(254).parse(config.from);
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port ?? 587,
    secure: config.secure ?? false,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.password },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    dnsTimeout: 10000,
    disableFileAccess: true,
    disableUrlAccess: true,
    maxRecipients: 1,
    logger: false,
    debug: false,
  });
  return {
    async send(input) {
      const message = messageSchema.parse(input);
      try {
        const info = await transport.sendMail({
          from,
          ...message,
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        return { accepted: info.accepted.length === 1 && info.rejected.length === 0 };
      } catch (error) {
        const metadata =
          error && typeof error === 'object'
            ? (error as { code?: unknown; command?: unknown; responseCode?: unknown })
            : {};
        // Only failures before an SMTP connection can safely retry. A timeout
        // during/after DATA might already have delivered the verification link.
        if (
          metadata.command === 'CONN' &&
          ['ECONNECTION', 'EDNS', 'ETIMEDOUT'].includes(String(metadata.code))
        )
          throw new AccountMailError('retryable');
        if (typeof metadata.responseCode === 'number' && metadata.responseCode >= 500)
          throw new AccountMailError('rejected');
        throw new AccountMailError('unknown');
      }
    },
  };
}

type MailRow = {
  id: string;
  owner_id: string;
  challenge_id: string;
  payload: string;
  attempts: number;
  lease_token: string;
};
/** Separate bounded outbox. Calls are off by default; tests inject the transport.
 * No raw message, email, token, password or provider exception enters logs. */
export class AccountMailWorker {
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<boolean>;
  private stopping = false;
  private readonly logger: MailLogger;
  constructor(
    private db: Database,
    private options: { enabled: boolean; transport?: AccountMailer; logger?: MailLogger },
  ) {
    this.logger = options.logger ?? operationalLogger;
  }
  start() {
    this.stopping = false;
    if (!this.options.enabled || !this.options.transport || this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => {
        this.logger.error({ event: 'account_mail_tick_failed', reasonCode: 'operation_failed' });
      });
    }, 1000);
    this.timer.unref();
  }
  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.active;
  }
  async tick() {
    if (this.stopping || this.active || !this.options.enabled || !this.options.transport)
      return false;
    const active = this.runTick();
    this.active = active;
    try {
      return await active;
    } finally {
      if (this.active === active) this.active = undefined;
    }
  }
  private async runTick() {
    const redacted = this.db.encrypt({});
    // An expired lease is uncertain, never an instruction to send twice.
    await this.db.query(
      "UPDATE account_mail_outbox SET status='unknown',payload=$1,lease_until=NULL,lease_token=NULL,last_error='lease_expired',updated_at=clock_timestamp() WHERE status='running' AND lease_until<=clock_timestamp()",
      [redacted],
    );
    const token = randomUUID();
    const mail = await this.db.transaction(async (sql) => {
      const [row] = await sql.query<MailRow>(
        "SELECT id,owner_id,challenge_id,payload,attempts FROM account_mail_outbox WHERE status='queued' AND run_at<=clock_timestamp() AND attempts<5 ORDER BY run_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
      );
      if (!row) return undefined;
      await sql.query(
        "UPDATE account_mail_outbox SET status='running',attempts=attempts+1,lease_token=$2,lease_until=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp() WHERE id=$1",
        [row.id, token],
      );
      return { ...row, attempts: row.attempts + 1, lease_token: token };
    });
    if (!mail) return false;
    try {
      const [current] = await this.db.query(
        `SELECT m.id FROM account_mail_outbox m JOIN account_challenges c ON c.id=m.challenge_id JOIN users u ON u.id=m.owner_id WHERE m.id=$1 AND m.status='running' AND m.lease_token=$2 AND m.lease_until>clock_timestamp() AND c.owner_id=m.owner_id AND c.consumed_at IS NULL AND c.expires_at>clock_timestamp() AND u.deleted_at IS NULL`,
        [mail.id, token],
      );
      if (!current) {
        await this.db.query(
          "UPDATE account_mail_outbox SET status='cancelled',payload=$3,lease_until=NULL,lease_token=NULL,updated_at=clock_timestamp() WHERE id=$1 AND status='running' AND lease_token=$2",
          [mail.id, token, redacted],
        );
        return false;
      }
      const message = messageSchema.parse(this.db.decrypt(mail.payload));
      const result = await this.options.transport!.send(message);
      const rows = await this.db.query(
        "UPDATE account_mail_outbox SET status=$3,payload=$4,lease_until=NULL,lease_token=NULL,last_error=$5,updated_at=clock_timestamp() WHERE id=$1 AND status='running' AND lease_token=$2 AND lease_until>clock_timestamp() RETURNING id",
        [
          mail.id,
          token,
          result.accepted ? 'accepted' : 'failed',
          redacted,
          result.accepted ? null : 'recipient_rejected',
        ],
      );
      return rows.length > 0 && result.accepted;
    } catch (error) {
      const disposition = error instanceof AccountMailError ? error.disposition : 'unknown';
      const retry = disposition === 'retryable' && mail.attempts < 5;
      const status = retry ? 'queued' : disposition === 'unknown' ? 'unknown' : 'failed';
      await this.db.query(
        "UPDATE account_mail_outbox SET status=$3,payload=CASE WHEN $3='queued' THEN payload ELSE $4 END,run_at=clock_timestamp()+$5::int*interval '1 millisecond',lease_until=NULL,lease_token=NULL,last_error=$6,updated_at=clock_timestamp() WHERE id=$1 AND status='running' AND lease_token=$2 AND lease_until>clock_timestamp()",
        [
          mail.id,
          token,
          status,
          redacted,
          Math.min(60000, 1000 * 2 ** mail.attempts),
          retry
            ? 'connection_retry'
            : status === 'unknown'
              ? 'delivery_unconfirmed'
              : 'delivery_failed',
        ],
      );
      this.logger.error({
        event: retry ? 'account_mail_retry_scheduled' : 'account_mail_stopped',
        reasonCode: retry
          ? 'connection_retry'
          : status === 'unknown'
            ? 'delivery_unconfirmed'
            : 'delivery_failed',
      });
      return false;
    }
  }
}
