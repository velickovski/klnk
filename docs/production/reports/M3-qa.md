# Independent runtime QA / M3 and M4 / local gates verified, release gates open

Date: 27 October 2026. QA reviewed actual database, worker, Live receipt/controller, identity/deletion, OAuth and gateway code. This is an independent local runtime review, not production, native, service-sandbox or release certification.

QA changes: `tests/qa-runtime-account.test.ts`, `qa-runtime-cleanup.test.ts`, `qa-runtime-gateway.test.ts`, `qa-tool-gateway.test.ts`, opt-in `qa-postgres-runtime.test.ts`, `scripts/qa-postgres-child.ts`, this report and sanitized evidence. Product fixes belong to Root/Platform/Voice; QA did not edit product source or enable tools/providers.

## Confirmed findings and repair checks

1. **P1 / DATA-01 deletion race.** Early Live/attempt checks did not protect the final tombstone transaction against new reservations/writes. Root added owner-first locking plus final atomic rechecks, cleanup queueing and job fencing. Independent local API regression inserts a real no-ID Live reservation after preflight and requires 409 with owner/session/profile retained. The real PostgreSQL suite repeats this with reservation in another process. A separate real-PG transaction commits a personal write while deletion waits for the owner lock; deletion subsequently removes that write. All pass.
2. **P2 / PostgreSQL lock ordering.** Voice transactions formerly locked a resource before acquiring the owner lock through Repository.put, opposite deletion/Engine order. Root made five voice transactions owner-first. An independent real-PG test holds the owner, starts voice clear, waits for its lock wait, and obtains the session row `FOR UPDATE NOWAIT` through another connection. It succeeds, demonstrating that voice clear does not hold the resource while waiting for owner. PGlite alone could not establish this.
3. **P2 / cleanup truthfulness.** Readiness originally counted only `provider_delete`, reporting cleanup current while Google revocation was queued. Independent regression failed with pending 0/current instead of pending 1. Root added `google_revoke` to pending/failed cleanup counts; the test now passes through both queued and five-failure states without exposing token/provider error text.

## Checks actually run

| Command | Result / classification |
| --- | --- |
| `npx vitest run tests/qa-runtime-account.test.ts` | 2 passed; real local API/PGlite, mocked 5xx provider |
| Runtime selection: QA account + account lifetime/live-delete + Live store + platform runtime + storage + authorization boundaries + Google OAuth + Live broker | 83 passed in 9 files; deterministic provider boundaries and real embedded storage |
| `npx vitest run tests/qa-runtime-cleanup.test.ts` before repair | 1 failed, confirming cleanup omission |
| `npx vitest run tests/qa-runtime-gateway.test.ts tests/qa-runtime-cleanup.test.ts` after repair | 2 passed |
| `$env:KLNK_POSTGRES_TEST_CONNECTION_FILE='.data/production-pg/connection.json'; npx vitest run tests/qa-postgres-runtime.test.ts` | Initial 7 and then 8 cases passed; final strengthened **9 passed**, 6.09 seconds, PostgreSQL **18.6** |
| `npx vitest run tests/qa-tool-gateway.test.ts tests/qa-runtime-gateway.test.ts tests/qa-runtime-account.test.ts tests/qa-runtime-cleanup.test.ts` | **9 passed in 4 files**; independent M4/local runtime cases |
| `npx tsc --noEmit` | Passed after initial PostgreSQL suite and again after the independent gateway tests |

Exact broad selection: `npx vitest run tests/qa-runtime-account.test.ts tests/account-lifetime.test.ts tests/account-live-delete.test.ts tests/live-session-store.test.ts tests/platform-runtime.test.ts tests/storage.test.ts tests/authorization-boundaries.test.ts tests/google-oauth.test.ts tests/openai-live.test.ts`.

## Real PostgreSQL evidence

[Sanitized version/scenario/source-hash record](../evidence/qa/m3-postgres.json). Root supplied a portable local PostgreSQL 18.6 fixture on loopback; QA created random `qa_<UUID>` schemas in the explicitly guarded `klnk_qa` database. Children read connection/key privately from a file and inherit only an OS environment allowlist. No credentials cross IPC, no provider configuration is inherited, and only fixed status/counter/fixture-ID messages are returned. No public tables or whole database were deleted. After teardown, **zero QA schemas remain**; the server remains running for Root's candidate recheck.

Nine passing scenarios establish local multi-connection/process behavior for: concurrent migration ledger application; duplicate request reservation; global capacity across owners; stale broker terminal/renewal fencing after takeover; stale worker next-effect/finalization fencing; reservation/deletion interleaving; personal-write/deletion interleaving; voice owner/resource lock order; encrypted restore with deletion reconciliation and no restored auth/controller authority.

The restore uses two isolated schemas with the same separately held key; it preserves one retained fictional resource and one uncertain Live receipt, excludes the deleted owner's content, restores no authentication session and clears controller authority. It does not undo or verify a real remote operation.

## M4 adversarial scope

Independent tests verify: hostile contact text remains explicitly untrusted data and does not cross tenants; model-supplied owner arguments and arbitrary HTTP tool names are rejected; missing tool grants prevent dispatch; raw fixture secret-shaped text/tokens do not enter structural traces; revoked sessions are denied; same call with changed arguments cannot create/edit a second draft; the 24-hour keyed argument binding can be redacted while its receipt prevents replay; seven-day traces expire; grant revocation between reservation and execution is rechecked; external effects disabled blocks an otherwise bound frozen external request; grant routes derive the owner from authentication, reject supplied tenant fields and report `runtimeAvailable:false` regardless of a saved opt-in.

These tests create no actual provider session or calendar/telephone effect. Root's Live runtime was tool-free at this earlier review point; the subsequent local opt-in callback integration is independently reviewed in [M4-qa](M4-qa.md). A successful local draft/queue commit is not evidence of an external effect; status, verification and `externalEffectConfirmed` must continue to make that distinction. Any real provider tool round trip, authorized Calendar sandbox write/revoke and the complete provider/UI/spoken trace need their own evidence.

## Remaining gates and limits

The PostgreSQL results close the specifically exercised local process/SQL gaps, not multi-host failover, deployment, traffic rollback, monitoring, provider cost budgets or real operator recovery. Source files are still being integrated for M4; rerun the exact opt-in command against the frozen candidate and record its hashes. No real service account was connected, no third-party call/message/calendar was changed, and no paid session or public deployment was initiated by QA.

Native signed build, real iPhone audio/Keychain/accessibility/performance, naturalness/human usability, full browser integration/reflow and final privacy/release review remain open. Installed security, networking, authentication and accessibility guidance was applied; Swift samples were not treated as a reason to rewrite RN/server code. The security reference reviewed was [common anti-patterns](C:/Users/andre/.codex/skills/swift-security/references/common-anti-patterns.md); networking guidance requires status/schema/cancellation/retry checks, which were translated into local fixtures rather than native certification.

Next: finish frozen gateway integration/tests and the complete browser suite, then independent review of remaining failed/blocked matrix entries. Root owns final milestone and release decisions.
