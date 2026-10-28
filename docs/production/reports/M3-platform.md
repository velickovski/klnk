# Platform / M3 / local runtime implemented; release gates open

Task and owned files: `apps/server/src/db.ts`, `engine.ts`, `auth.ts`, `readiness.ts`, new `live-session-store.ts`, new migrations `003_runtime.sql` and `004_live_controller.sql`, `tests/storage.test.ts`, new `tests/live-session-store.test.ts` and `tests/platform-runtime.test.ts`, new `scripts/runtime-backup.ts` and `scripts/platform-runtime-smoke.ts`, [operations runbook](../operations.md), this report. Migrations 001/002 are unchanged. Parent retains `app.ts`, `config.ts` and manifests; Voice owns broker implementation. No provider configuration, credentials, outbound calling gates or external resources were changed.

Implemented behavior:

- Checksummed migration ledger; PostgreSQL migration advisory lock and script/ledger transaction use one checked-out connection. Embedded PGlite executes complete SQL scripts under its serialized transaction. Unknown future schema and changed applied migration checksums fail startup. Startup errors close their database connection.
- Durable owner/request UUID Live reservation, unresolved-owner uniqueness, bounded global/day quotas and version CAS. Unknown creation consumes capacity after expiry/restart. Closure needs a known provider identity and encrypted terminal evidence. Data contains no SDP, transcripts, audio or credentials.
- Forward migration 004 adds broker-controller leases. Healthy peer receipts cannot be claimed, expired/released ownership can fail over, stale attach/transition calls are fenced, and renewing cannot resurrect expired ownership. Late provider identity can be recorded as observation without restoring a stale controller's authority. Voice integrates sideband renewal and ownership-loss command suppression separately.
- Worker leases renew. Claim, renew, finalization and failure use random ownership tokens; provider dispatch is checked before each distinct operation. Stale/canceled workers cannot run the next effect or finish their replacement's work. Exhausted expired work becomes failed instead of receiving an extra provider dispatch. Raw provider errors are replaced by fixed persisted codes.
- Database-backed readiness distinguishes database availability from degraded jobs/cleanup/unconfirmed sessions. Cleanup pending and failed are explicit; configuration alone no longer supplies all operational evidence. Parent exposes the route.
- Encrypted repeatable-read backup and empty-target restore. Authentication tokens are excluded. Restore applies an explicit independent deletion journal, retains remote cleanup, removes stale job/controller authority, and keeps unresolved provider identity for reconciliation. Wrong keys, nonempty targets and incompatible schemas are rejected. The snapshot timestamp is authenticated inside the encrypted body.
- Session issuance rejects already-deleted accounts. Repository ID collisions fail honestly instead of returning an unsaved input as success.

Shared contracts supplied: `LiveSessionStore` API and controller ownership methods were frozen with Voice. `runtimeReadiness(db)` supplied to parent for `/ready`; parent must retain local-only Live guards and account-deletion checks for unresolved Live receipts. No shared route or configuration was edited by Platform.

Scenario IDs: AUTH-02, OPS-01, OPS-02, OPS-03, DATA-01; local portions of VOICE-03/04 and TOOL-03 storage/idempotency prerequisites.

Commands actually executed on Windows / Node v24.15.0, 27 October 2026:

```powershell
npm exec -- vitest run tests/live-session-store.test.ts tests/storage.test.ts
npm exec -- vitest run tests/platform-runtime.test.ts tests/engine.test.ts
npm exec -- vitest run tests/storage.test.ts tests/platform-runtime.test.ts tests/live-session-store.test.ts
npm exec -- vitest run tests/api.test.ts tests/engine.test.ts tests/live-gates.test.ts tests/storage.test.ts tests/platform-runtime.test.ts tests/live-session-store.test.ts
npx tsx scripts/platform-runtime-smoke.ts
npm run typecheck
Get-Command psql,postgres,pg_dump,pg_restore -ErrorAction SilentlyContinue
```

Results: final broad runtime/server regression selection **54 tests passed in 6 files**; final root/mobile typecheck **passed**. The isolated filesystem restore exercise passed all **nine assertions** with migrations 001–004, including close/reopen after restore. [Sanitized exercise output](../../../.data/production-audit/platform-runtime.json). The first physical restore-script iteration exposed a missing directory when a persistent PGlite database used an explicit key; startup now creates its directory in that path, and the exercise passed after repair. Earlier store test expectations were adapted to require controller ownership rather than bypass the new fence.

Evidence classification: deterministic fake provider boundaries, real local PostgreSQL-compatible PGlite storage and actual encrypted file backup/reopen. No real provider, real PostgreSQL server, browser, simulator or physical iPhone evidence was produced by this workstream. PostgreSQL CLI/server commands were absent from this host inventory.

Known limitations / blocked or not run:

- Actual PostgreSQL multi-connection/process migration, worker failover and broker-controller concurrency must run in an isolated PostgreSQL environment. Local serialized PGlite tests do not prove that platform gate.
- Lease fencing cannot reverse a request already accepted remotely. Existing durable intent/provider idempotency and authoritative reconciliation remain necessary. Unknown creation never clears solely because its timer expired.
- Production backup storage, independently durable deletion-journal maintenance, key custody/rotation, backup retention/RPO, host alarms, idle-worker heartbeat and provider budget alerts need the authorized deployment environment and operator policy.
- Prior-version candidate deployment/traffic rollback and real `pg_dump`/`pg_restore` rehearsal are not run. The runbook prohibits incompatible rollback and in-place destructive restore; it does not claim deployment occurred.
- Native signed build, real device audio/Keychain, service OAuth and authorized sandbox effects remain their separate release gates.
- Parent route integration, Voice controller/broker tests and an independent full-suite review are required before M3's local portions are accepted. M3 as a whole is **not complete** while its actual PostgreSQL/native required gates remain unrun.

Independent reviewer: parent and QA pending. Worker does not certify release.
