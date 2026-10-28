import type { Database } from './db.js';
import { HttpError } from './errors.js';

/** Atomic PostgreSQL counters shared by API instances. Keys are HMAC digests, never emails/IPs. */
export async function consumeLimit(
  db: Database,
  key: string,
  max: number,
  windowMs: number,
  lockoutMs = 0,
) {
  const digest = db.keyedDigest('rate-limit', key);
  const [row] = await db.query<{ hits: number; blocked: boolean }>(
    `
    INSERT INTO request_limits(key_hash,hits,reset_at) VALUES($1,1,clock_timestamp()+$3*interval '1 millisecond')
    ON CONFLICT(key_hash) DO UPDATE SET
      hits=CASE WHEN request_limits.reset_at<=clock_timestamp() AND (request_limits.blocked_until IS NULL OR request_limits.blocked_until<=clock_timestamp()) THEN 1 ELSE request_limits.hits+1 END,
      reset_at=CASE WHEN request_limits.reset_at<=clock_timestamp() AND (request_limits.blocked_until IS NULL OR request_limits.blocked_until<=clock_timestamp()) THEN clock_timestamp()+$3*interval '1 millisecond' ELSE request_limits.reset_at END,
      blocked_until=CASE WHEN request_limits.blocked_until>clock_timestamp() THEN request_limits.blocked_until WHEN request_limits.hits>=$2 AND request_limits.reset_at>clock_timestamp() AND $4>0 THEN clock_timestamp()+$4*interval '1 millisecond' ELSE NULL END
    RETURNING hits,(blocked_until>clock_timestamp()) AS blocked`,
    [digest, max, windowMs, lockoutMs],
  );
  if (row.hits > max || row.blocked)
    throw new HttpError(429, 'rate_limited', 'Too many requests. Please try again later.');
}

export function windowMilliseconds(value: number | string | undefined): number {
  if (typeof value === 'number' && value > 0) return value;
  const match = /^(\d+)\s*(second|minute|hour)s?$/.exec(
    typeof value === 'string' ? value : '1 minute',
  );
  if (!match) throw new Error('Unsupported request limit window.');
  return Number(match[1]) * ({ second: 1000, minute: 60000, hour: 3600000 }[match[2]] ?? 60000);
}
