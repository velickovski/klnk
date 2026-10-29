import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import type { Database } from './db.js';
import { HttpError } from './errors.js';
const scrypt = promisify(scryptCallback);
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${((await scrypt(password, salt, 64)) as Buffer).toString('hex')}`;
}
export async function checkPassword(password: string, stored: string) {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const reference = Buffer.from(expected, 'hex');
  return reference.length === actual.length && timingSafeEqual(actual, reference);
}
export async function createSession(db: Database, owner: string) {
  const token = randomBytes(32).toString('base64url');
  const inserted = await db.query(
    "INSERT INTO sessions(token_hash,owner_id,expires_at,reauth_until) SELECT $1,id,$3,clock_timestamp()+interval '5 minutes' FROM users WHERE id=$2 AND deleted_at IS NULL RETURNING token_hash",
    [hashToken(token), owner, new Date(Date.now() + 7 * 86400000).toISOString()],
  );
  if (!inserted.length)
    throw new HttpError(401, 'unauthorized', 'This account is no longer available.');
  return token;
}
export async function ownerFromToken(db: Database, header?: string) {
  if (!header?.startsWith('Bearer ')) return undefined;
  const [row] = await db.query(
    "UPDATE sessions s SET last_used_at=clock_timestamp() FROM users u WHERE u.id=s.owner_id AND s.token_hash=$1 AND s.expires_at>clock_timestamp() AND s.last_used_at>clock_timestamp()-interval '30 minutes' AND u.deleted_at IS NULL RETURNING s.owner_id",
    [hashToken(header.slice(7))],
  );
  return row?.owner_id as string | undefined;
}
export async function newUser(db: Database, email: string, password: string) {
  const id = randomUUID();
  await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [
    id,
    email,
    await hashPassword(password),
  ]);
  return { id, email };
}
