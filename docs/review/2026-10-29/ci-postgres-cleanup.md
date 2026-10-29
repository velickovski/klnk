# PostgreSQL fixture cleanup repair

Remote run 40803792246 passed 23 of 24 PostgreSQL cases before failing during a fresh network fixture migration. Its retained container error context identifies the `002_voice_sessions.sql` global `pg_constraint` lookup and `pg_get_constraintdef(oid)`, with `could not open relation with OID 16420`. The failing application test had not reached its process-death assertions.

## Cause and repair

Each suite used a separate generated `qa_*` schema, but migration 002 inspects matching constraint names across schemas. `Database.migrate()` already held a transaction advisory lock; teardown in the four concurrent PostgreSQL suites dropped schemas without that lock. A teardown could invalidate a foreign constraint's relation while another migration deparsed its catalog snapshot.

The production migration files remain unchanged. The existing migration lock SQL is extracted into `apps/server/src/migration-lock.ts` without changing its value or transaction behavior. `tests/support/postgres-schema.ts` imports that fence, rejects anything outside the strict generated namespace format, and uses one checked-out client for BEGIN, advisory lock, DROP and COMMIT, with rollback and release on failure.

All four suite teardown paths now use the helper after closing their existing databases, apps and child-process work: `qa-network-postgres`, `qa-postgres-runtime`, `credential-clock` and `qa-rate-postgres`. The repair does not serialize test files, add automatic retries, change migrations, or remove the existing concurrency and rollback assertions.

## Deterministic evidence

The added real-PostgreSQL regression holds the shared fence and concurrently starts both fixture cleanup and an actual `Database.open()`. It requires both named connections to appear in `pg_stat_activity` waiting specifically for an advisory lock, then successfully deparses the still-present constraint. After releasing the fence, it verifies cleanup removed its namespace and the real migration completed. This exercises the production lock wiring as well as the helper; merely duplicating an unused constant cannot satisfy the observed two-connection barrier. Cleanup releases its blocker on assertion failure.

Security independently audited the helper's connection/transaction scope and all four callers. In an exclusive diagnostic window, Security also reproduced the unsafe catalog interleave using only its own disposable namespaces: capture a constraint in a repeatable-read snapshot, drop that schema from a separate connection, then attempt `pg_get_constraintdef` using the captured OID. Local PostgreSQL 18.6 reported `XX000: cache lookup failed for relation` at `get_relation_name`; CI PostgreSQL 17.11 reported the later relation-open error above. These are distinct observed messages supporting the same catalog-deparse/drop hazard, not a claim that the local probe reproduced the exact CI wording.

## Checks

Using the existing private loopback fixture via `KLNK_POSTGRES_TEST_CONNECTION_FILE`, without printing its credentials:

- `npx vitest run tests/qa-network-postgres.test.ts -t 'serializes schema cleanup'`: **1 passed**, 11 unrelated cases filtered, **3.89 seconds**.
- Security independently reran the coupled-lock case: **1/1 passed**, 11 unrelated cases filtered, **5.84 seconds**, exit 0; metadata `.data/independent-pg-cleanup.json`. Its separate source audit confirmed the shared transaction/client, namespace guard, all four teardown callers and unchanged migration bytes.
- `npm run test:pg`: **25/25 passed**, four concurrent suites, **17.20 seconds**. This includes all prior 24 cases and the new lock barrier, including the originally failing process-death/restart case with its assertions retained.
- `npx tsc --noEmit`: passed.
- Scoped ESLint on the helper and four changed suites: passed without diagnostics.

The shared PostgreSQL fixture remains running under root ownership. No provider traffic, preview-server change, user-data change or migration checksum rewrite was performed. This is local PostgreSQL evidence; a successful new remote CI run remains a separate gate.
