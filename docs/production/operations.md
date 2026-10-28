# Runtime operation and recovery

Implemented and rehearsed locally on 27 October 2026. This runbook is a reviewable release artifact. PostgreSQL dump/quarantine/application restore ran against isolated fictional databases. No production deployment, multi-host failover, provider account change or App Store distribution was performed.

## Storage and schema upgrades

`Database.open()` validates a checksummed `schema_migrations` ledger. PostgreSQL obtains a transaction-scoped advisory lock on the same checked-out connection that executes every migration and ledger write. Embedded PGlite uses its serialized connection and executes each SQL script inside the transaction. Existing migrations 001 and 002 are unchanged. Forward migrations add 003 (runtime receipts and worker ownership), 004 (Live controller ownership), 005 (application tool resources) and 006 (durable mission submissions). Preserve all applied bytes.

Existing installations without a ledger run the original idempotent scripts once, then record their checksums. Subsequent starts verify and skip them. Modified applied files or a ledger from a newer application fail closed. Restore the original file and use a new forward migration; do not edit ledger checksums to silence a mismatch. A candidate must support the target schema before taking traffic.

For a separately authorized PostgreSQL environment, first back up and verify restoration into an isolated target, stop incompatible worker versions, run `npm run db:migrate`, then start the compatible API and worker. [Independent local PostgreSQL QA](reports/M3-qa.md) exercised concurrent migration application and worker/controller fencing in separate processes. Staging upgrade still requires execution in the actual environment. A running old worker must never be mixed with a new worker that assumes renewable/fenced ownership.

## Jobs and controller ownership

Worker jobs obtain a random lease token and a worker identity when claimed. A 60-second lease renews every 15 seconds. Completion and failure writes require the current token. Ownership is checked before provider dispatch and between separate provider operations. A fenced worker does not mark its replacement's work done. Abandoned work at five attempts becomes failed with a fixed diagnostic code. Existing durable outbound intent and provider-specific idempotency/readback remain essential: a lease alone cannot undo a provider request already accepted before ownership loss.

Live reservation is atomic across owners, limits concurrent unresolved sessions and daily starts, and deduplicates by owner plus client request UUID. Creating, active, closing and unconfirmed states consume capacity. Expiry never proves a paid provider session ended. A receipt is closed only after provider terminal evidence and an attached provider identity.

Each broker controller has its own renewable 30-second receipt lease. Recovery claims only expired or released controllers; a healthy peer remains untouched. Attach and state transitions are fenced by controller ownership plus receipt version. Late observed provider IDs can be recorded without granting the stale controller authority. Startup/recovery closes known unresolved provider sessions conservatively; unknown creation stays blocked until provider/operator reconciliation. The broker worker owns sideband renewal, command suppression on lost ownership and graceful lease release.

Keep the current local-only Live guard until all production identity, operations, policy and device gates pass. Database receipts and mocked sideband tests do not authorize public exposure.

## Readiness and cleanup

The existing `/health` remains the compatible liveness/configuration response. Parent route integration exposes the new database-backed `runtimeReadiness(db)` as `/ready`. A database outage returns `ready:false` with a sanitized unavailable state. Job failures, expired leases and unconfirmed Live receipts produce a degraded diagnostic state while the database remains serviceable. Cleanup reports pending and failed counts separately; a queued provider deletion never means remote erasure is complete.

Monitor nonzero failed jobs, expired leases, unconfirmed Live receipts and failed cleanup. Investigate using authenticated server records and the same provider identity. Do not log payloads, transcripts, tokens, SDP or provider response bodies. Retry only the existing idempotent/reconcilable work after its failure is understood; never create a replacement paid call to clear an unknown receipt.

Idle standalone-worker heartbeat, provider budget alerts and real host monitoring are still external release work. These local checks do not claim a full monitoring service exists.

## Encrypted backup

The application backup is a repeatable-read database snapshot encrypted with the existing data-encryption key. The key is never included. Protect that key separately and retain the compatible application artifact, migrations and deletion journal. Backups contain encrypted personal data and require protected storage/retention even though their contents are opaque.

```powershell
npx tsx scripts/runtime-backup.ts backup --file C:\protected-backups\candidate.json
```

Configure `DATA_ENCRYPTION_KEY` privately. Production also requires its configured PostgreSQL URL. The command refuses to overwrite an existing backup and prints only status/time/boolean metadata. It never contacts a voice or calendar provider. On Windows, verify the destination ACL: POSIX file mode alone does not establish an appropriate ACL.

Keep an independent deletion journal outside the restore snapshot. Its required field is `{"deletedOwnerIds":["owner-id"]}`. Populate it from approved account-deletion records since the backup's authenticated creation time. Do not fabricate an empty journal after an outage. Maintaining and securing this independent journal and defining backup retention/RPO are deployment prerequisites; a backup cannot infer deletions that happened after it was taken.

An operator can export existing tombstones using the read-only CLI below. Privately set `KLNK_JOURNAL_DATABASE_URL` to the authoritative database; the command does not read provider configuration. Choose a protected new destination and the authenticated backup timestamp, or an earlier time. It refuses to overwrite an existing file and prints only count/time metadata.

```powershell
npx tsx scripts/operations-rehearsal.ts export-deletion-journal --since 2026-10-27T12:00:00.000Z --file C:\protected-backups\deletions.json
```

The timestamp above is illustrative; replace it with the actual protected backup time. The output also records `format`, `since` and `exportedAt`. Export and protect the journal before losing the source, keep it outside the backup/failure domain, preserve tombstones until every retained backup is covered, and replay all later deletions before traffic resumes. A one-time export is not a continuously durable deletion stream. If the source is lost before its later tombstones reached independent storage, recovery cannot prove absence of resurrection; leave the target offline pending reconciliation. Restrict ACLs because owner identifiers remain personal data. This host rehearsal does not establish Windows ACLs, journal continuity, backup retention or RPO.

## Offline restore

Stop the target API and workers. Select an empty isolated target through private `RESTORE_DATABASE_URL` or `RESTORE_DATA_DIR`; the command never defaults a restore into the application's current database. Use the matching separately held `DATA_ENCRYPTION_KEY` and the artifact whose migration ledger matches the backup. Then:

```powershell
npx tsx scripts/runtime-backup.ts restore --file C:\protected-backups\candidate.json --deletion-journal C:\protected-backups\deletions.json --offline-confirmed
```

Restore refuses nonempty application state, wrong keys, modified backup timestamps or mismatched migration ledgers. It restores no authentication sessions. Deletion-journal owners are tombstoned, their content and ordinary jobs excluded, and queued provider cleanup retained. Running jobs lose stale leases and queue for reconciliation. Unresolved Live sessions retain provider identity but become unconfirmed with no controller authority. They must be reconciled before new paid starts. Provider events and receipts remain deduplicated.

Do not route traffic immediately after restore. Verify retained/deleted fixture records, require fresh sign-in, inspect cleanup and unresolved receipts, and reconcile actual provider state. A restored queued job may refer to an already accepted provider operation; use its durable intent/provider identity and existing idempotency rules. Restoring a backup is never evidence that a third-party effect was reversed.

## Candidate rollback and forward repair

Before rollout, preserve the candidate and last compatible artifact, their checksums, the protected backup and current deletion journal. If readiness or smoke checks fail, stop traffic and workers. A code rollback is safe only if the prior artifact explicitly supports the current schema. Unknown/newer ledger detection blocks an incompatible artifact. Prefer a reviewed forward repair when state or external effects already advanced.

When a restore is required, create a separate empty target using the matching artifact and procedure above, replay deletion policy and reconcile providers before switching traffic. Preserve the failed database for investigation; do not run destructive down migrations or overwrite it in place. No provider call, calendar change or account deletion is undone merely by switching code or restoring a database.

Staging deployment/traffic switch, a prior-version artifact rollback and real host alarms remain **not run**. The local rehearsal below verifies the current artifact against migrations 001–006 and rejects unknown/checksum-drifted ledgers. It does not establish a prior candidate's schema compatibility, apply a real repair migration, perform a down migration or switch traffic. Keep the prior artifact and independently verify its supported migration hashes before selecting it. Root owns the final candidate manifest; use its hashes together with the restore evidence rather than treating this runbook as a release signature.

## PostgreSQL dump quarantine and recovery rehearsal

Run from the repository root against the already authorized portable local fixture:

```powershell
npx tsx scripts/operations-rehearsal.ts rehearse
npx vitest run tests/operations-rehearsal.test.ts
```

The script privately reads only `.data/production-pg/connection.json` and its download provenance. It verifies `127.0.0.1:55432`, the administrator connection's `klnk_qa` database and PostgreSQL CLI 18.6. It creates three new `klnk_qa_ops_<UUID>` databases, and creates/drops only names both matching that strict pattern and allocated in the current run. It does not alter shared `klnk_qa` tables, roles, the cluster data directory or OS services. Cleanup closes its connections, rechecks the endpoint, drops only those databases, verifies zero remain and removes its resolved temporary directory. If interrupted, verify the run's generated names independently before any operator cleanup; never use a wildcard database drop.

The portable download provenance is `.data/production-pg/download.json`; sanitized evidence retains its SHA-256 and tool versions. Subprocesses use an OS environment allowlist, private `PGPASSWORD`, hidden Windows execution, no command-line credentials, no provider configuration and suppressed raw diagnostics. PostgreSQL documents that password environment variables can be visible to other privileged processes; use the authorized isolated host and private credential lifecycle. Production operators should select a protected password file/service configuration and least-privilege roles under their own environment policy. This rehearsal does not test a production role/ACL design.

The archive is a **logical `pg_dump --format=custom` database dump**, not a physical base backup/PITR exercise. `pg_restore --single-transaction --exit-on-error --no-owner --no-acl` restores only that trusted fictional archive to an empty offline quarantine database. It never starts an API/worker or routes traffic to quarantine. The test demonstrates that a direct dump restore revives the old bearer session, worker/controller authority and content deleted after the dump. Such a target must never be made live directly.

Recovery then exports a fresh encrypted application backup from quarantine and restores it to a separately migrated empty database using the independently exported post-dump deletion journal. **The journal starts at or before the original dump's start time**, not the later encrypted export's creation time: the later timestamp cannot erase the original snapshot's history. The clean target rejects the old token, has no authentication sessions, resets running jobs to queued/unowned, preserves uncertain provider identity without controller authority, tombstones the later-deleted owner, omits their content/ordinary work and keeps their queued Google revocation. No worker or provider cleanup executes during the exercise.

All 17 assertions passed in the latest run; three temporary databases were removed and zero remained. The operator journal CLI itself ran against the fictional source, exported the post-dump deletion and refused overwrite. [Sanitized evidence](evidence/operations-rehearsal.json) records all assertions, tool versions, migration checksums, elapsed time and cleanup. The dump, journal, fixture data and credentials are absent from that report. This small local elapsed time is not a production RTO/RPO measurement. [M6 report](reports/M6-operations.md) records the exact commands and remaining gates.

The utility options and trust model follow PostgreSQL 18's [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html) and [connection environment](https://www.postgresql.org/docs/18/libpq-envars.html) documentation. Only archives from a trusted source may enter this workflow: restore executes source-supplied database commands. Protect real dumps as personal data even when application resource payloads are encrypted; authentication/password hashes and other database metadata remain sensitive. The fictional archive was deleted after this exercise.

## Executed isolated exercise

```powershell
npx tsx scripts/platform-runtime-smoke.ts
```

This generates only fictional local accounts/data, uses an ephemeral key, writes and reads an encrypted backup, restores to another empty PGlite directory, checks deletion suppression, session revocation, unknown-session preservation, wrong-key/refill rejection, and closes/reopens the restored database. It never reads application credentials or contacts a provider. Temporary databases are removed after the exercise. Sanitized output is [platform-runtime.json](../../.data/production-audit/platform-runtime.json).

Latest local run: **all nine assertions passed**; migrations 001–004 applied; two owner records, one retained resource and one unresolved Live receipt restored. This is embedded/storage evidence, not a real PostgreSQL multi-process or deployment rehearsal.
