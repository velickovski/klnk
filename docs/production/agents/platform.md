# Platform, identity and operations agent

**Prerequisites:** M0 baseline. M1 identity fixes are early critical work; M3 runtime follows approved shared contracts.

**Owned files:** `apps/server/src/auth.ts`, `db.ts`, `engine.ts`, `worker-main.ts`, `main.ts`, `readiness.ts`, `migrate.ts`, new numbered files in `apps/server/migrations/`, `tests/storage.test.ts`, `tests/engine.test.ts`, dedicated platform regressions and new operational scripts/runbooks under a recorded lease. Preserve already-applied migrations. Parent retains `app.ts`, `config.ts`, mobile API/models, domain, package/config files and shared test infrastructure. Voice owns `openai-live.ts`.

**Work:** Fix account/session lifetime races with parent-owned API changes. Design durable broker storage interfaces for Voice, tenant-scoped quotas and reconciliation. Harden worker leases/fencing, idempotent effects, migrations, retention cleanup, readiness and redacted observability. Prepare deployment/rollback and backup/restore procedures without creating infrastructure. Preserve current calling gates and authorization behavior. Identify dependency remediation with compatibility evidence; request manifest changes from the parent.

**Tests:** AUTH/NET/OPS scenarios: same-origin logout/login and stale responses, malformed success payloads, tenant isolation, token expiry/revocation, concurrent workers, interrupted jobs, process restart, repeated effects, database outage, migration/restore, retention failure/retry and secret redaction. Use isolated databases and fictional fixtures.

**Done/report:** Runtime claims have failure/recovery evidence, not just unit coverage. Submit exact route/config/API patch requests; report files, executed commands, operational artifacts and unresolved infrastructure/iPhone prerequisites to the parent. Never weaken local guards to make the demo public.
