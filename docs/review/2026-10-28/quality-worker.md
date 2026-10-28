# M0 Quality worker report

Owner: `/root/quality`. Implementation report, not independent milestone certification.

## Changes

- `tests/support/pglite-global-setup.ts` migrates one empty in-memory PGlite database per Vitest invocation and saves an ephemeral template in the OS temporary directory. Teardown removes the template.
- `tests/support/test-database.ts` restores a separate database from that template for each fixture. Each clone has its own encryption key, validates the current migration checksums and cannot target persistent storage or server PostgreSQL.
- Existing in-memory fixture construction adopts the helper in 31 test files: account-lifetime, account-live-delete, api-lifecycle-server, api, authorization-boundaries, engine, integration-routes, live-gates, live-session-store, live-tool-application, memory-panel-context, mission-submission, network-api, network-calendar, network-coordination, openai-live-tools, openai-live, operations-rehearsal, platform-runtime, qa-live-tools, qa-network-api, qa-runtime-account, qa-runtime-cleanup, qa-runtime-gateway, qa-tool-gateway, review-context-races, storage, tool-access-routes, tool-gateway, voice-planning and voice-retention. Persistent-storage and real-PostgreSQL fixtures still run their real migrations.
- `tests/support/postgres-fixture.ts` accepts an explicitly configured loopback `/klnk_qa` endpoint, including a CI-provided port, and rejects remote hosts, alternate database names, connection-option injection and malformed keys before opening a socket.
- `scripts/test-postgres.ts` runs all three real-PostgreSQL suites against an explicitly supplied disposable fixture. It never uses `DATABASE_URL`, creates no infrastructure, passes no production/provider credentials to children and removes its temporary private connection file afterward.
- `tests/qa-postgres-runtime.test.ts`, `tests/qa-network-postgres.test.ts`, `tests/credential-clock.test.ts`, `tests/qa-network-child.ts` and `scripts/qa-postgres-child.ts` use the shared endpoint guard. Parent processes forward the approved test endpoint to children. Server-port assertions use the configured URL rather than port 55432.
- `tests/platform-runtime.test.ts` waits for the database clock to cross the original worker lease instead of sleeping 320 ms. It still checks that another worker cannot reclaim the renewed lease.
- `e2e/browser/boundaries.spec.ts` waits for the intercepted old-owner response handler to finish, including cancellation, instead of racing the response against a 300 ms sleep.
- `tests/test-fixtures.test.ts` adds five regressions covering snapshot isolation, independent keys, retained migration-checksum validation, persistent-target rejection and explicit PostgreSQL endpoint boundaries.

## Shared changes requested and integrated by root

- `Database` constructor option `embeddedTemplate?: Blob` and `dumpEmbeddedTemplate()` for isolated memory databases only.
- Vitest `globalSetup: ['./tests/support/pglite-global-setup.ts']`.
- `test:pg` manifest command and a PostgreSQL CI service with explicit `KLNK_TEST_POSTGRES_URL`.
- Root owns dependency patches, Node alignment, CI, Playwright executable override and final integration.

Security-owned fixture files were left for the Security worker to adopt using the same helper.

## Commands actually run

| Command / source | Result |
| --- | --- |
| Original source archived from `845b104`, then `npm test -- --reporter=json --outputFile=.data/baseline.json` in the ignored isolated source copy with the installed dependencies linked | **662 passed, 20 skipped, 0 failed; 58 files; 198.091 s**. Valid pre-behavior baseline. |
| Initial working-tree baseline attempt | Invalid measurement: fixture adoption overlapped late suite loading, before global setup was configured. The resulting missing-template errors are not attributed to product behavior. Superseded by the isolated run above. |
| `npx vitest run tests/test-fixtures.test.ts tests/platform-runtime.test.ts` | **12 passed / 2 files**, 10.89 s. |
| `npx tsx scripts/local-postgres-fixture.ts start` | Existing portable local PostgreSQL 18 fixture started. No service installation or database initialization. |
| With `KLNK_POSTGRES_TEST_CONNECTION_FILE` pointing to the private existing local fixture: `npx tsx scripts/test-postgres.ts` | **20 passed / 3 files, 0 skipped**, 25.19 s; real PostgreSQL and independent child processes. |
| `npx tsx scripts/local-postgres-fixture.ts stop` | Stopped cleanly; the helper verified no QA namespaces or active fixture work remained. |
| `npx tsc --noEmit --pretty false` during concurrent integration | Initially failed only at root-owned `request-limits.ts:29` (`string | number` argument), reported to root; no Quality-file type errors. Final integrated type check remains root/QA's responsibility. |
| `npx prettier --write` on adopted fixture files and owned helper/runner/condition-wait files | Passed. |
| `npx prettier --check tests/support scripts/test-postgres.ts scripts/qa-postgres-child.ts tests/test-fixtures.test.ts tests/platform-runtime.test.ts e2e/browser/boundaries.spec.ts tests/qa-network-postgres.test.ts tests/qa-postgres-runtime.test.ts tests/credential-clock.test.ts tests/qa-network-child.ts` | Passed. |

## Remaining gates

- The optimized full suite must be measured after concurrent integration stabilizes. **The under-two-minute target has not yet been verified by this worker.** Root/independent QA should report the actual final duration, not infer it from fixture design.
- The modified browser race test needs the final exported web build and independent Playwright run.
- PostgreSQL endpoint flexibility was regression-tested at the guard level and the entire suite ran on the local disposable instance. The new GitHub service/container run remains CI evidence, not local proof.
- The legacy operations-rehearsal and portable fixture lifecycle scripts keep their original workstation-specific guard; CI `test:pg` does not depend on those scripts.
- No real OpenAI request, microphone capture, telephone call, external message, calendar write, deployment, signing or physical-iPhone test was performed by this worker.
