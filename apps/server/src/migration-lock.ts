/** Coordinates migrations and controlled schema maintenance in the same database. */
export const MIGRATION_LOCK_SQL = 'SELECT pg_advisory_xact_lock(1263291981)';
