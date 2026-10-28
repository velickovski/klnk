import { z } from 'zod';
import { Database, Repository, type SQL } from '../db.js';

type ContactIdentity = { phone: string; optedOut?: boolean };
type SuppressionReason = 'recipient_opt_out' | 'owner_marked_opt_out' | 'legacy_opt_out';
type Suppression = {
  id: string;
  ownerId: string;
  reason: SuppressionReason;
  createdAt: string;
  purpose: 'recipient_contact_suppression';
  retention: 'account_lifetime';
};
const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/);

/** A contact row is editable/deletable; a recipient's opt-out survives both.
 * Only a keyed owner+number digest is retained, until account deletion. */
export class RecipientSuppression {
  constructor(private db: Database) {}
  private id(owner: string, phone: string) {
    return `suppression:${this.db.keyedDigest('recipient-suppression', `${owner}\0${phoneSchema.parse(phone)}`)}`;
  }
  async suppress(
    owner: string,
    phone: string,
    reason: SuppressionReason,
    sql: SQL = this.db,
  ): Promise<Suppression> {
    const repo = new Repository(this.db, sql),
      id = this.id(owner, phone),
      existing = await repo.get<Suppression>(owner, 'optout', id);
    if (existing) return existing;
    const value: Suppression = {
      id,
      ownerId: owner,
      reason,
      createdAt: new Date().toISOString(),
      purpose: 'recipient_contact_suppression',
      retention: 'account_lifetime',
    };
    await repo.put(owner, 'optout', value);
    return value;
  }
  private async migrateLegacy(owner: string, sql: SQL) {
    const repo = new Repository(this.db, sql);
    for (const entry of await repo.list<any>(owner, 'optout')) {
      if (typeof entry.phone !== 'string' || !phoneSchema.safeParse(entry.phone).success) continue;
      await this.suppress(owner, entry.phone, 'legacy_opt_out', sql);
      await repo.remove(owner, 'optout', entry.id);
    }
  }
  async isSuppressed(owner: string, phone: string, sql: SQL = this.db): Promise<boolean> {
    await this.migrateLegacy(owner, sql);
    return !!(await new Repository(this.db, sql).get(owner, 'optout', this.id(owner, phone)));
  }
  async contactChanged(
    owner: string,
    before?: ContactIdentity,
    after?: ContactIdentity,
    sql: SQL = this.db,
  ): Promise<boolean> {
    if (before?.optedOut) await this.suppress(owner, before.phone, 'owner_marked_opt_out', sql);
    if (after?.optedOut) await this.suppress(owner, after.phone, 'owner_marked_opt_out', sql);
    return after ? this.isSuppressed(owner, after.phone, sql) : false;
  }
  async list(owner: string): Promise<Suppression[]> {
    return this.db.transaction(async (sql) => {
      await this.migrateLegacy(owner, sql);
      return new Repository(this.db, sql).list<Suppression>(owner, 'optout');
    });
  }
}
