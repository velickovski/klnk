# Independent M0 verification

Reviewer: `/root/platform`, verifying Quality/root M0 work. This reviewer implemented M1 Platform changes and **does not self-certify M1**. Security separately reviews M1. No application source was changed during this M0 review.

## Final local checks

| Command | Observed result |
| --- | --- |
| `npm test -- --reporter=json --outputFile=.data/m0-final-tests.json` | **711 passed, 0 failed, 22 skipped**, 66 test files; **90.464 seconds**. The skipped tests are the four explicitly opt-in real-PostgreSQL suites and are not counted as passed. |
| `npm run lint -- --format json --output-file .data/m0-final-lint.json` | **0 errors, 255 explicit-any warnings**. Floating/misused promise rules are errors; explicit-any is a warning as required for M0. |
| `npm run format:check` | Passed for the configured source scope. Historical `docs/**` evidence and the lockfile are explicitly excluded. |
| `npm run typecheck` | Passed root and mobile TypeScript. |
| `npm run typecheck:e2e` | Passed. |
| `npm audit --json` with independent high/critical gate, then exact `npm audit --audit-level=high` | **0 high, 0 critical, 7 low**, exact command exit **0**. The existing Expo version was preserved. |
| `npm run e2e:build` | Passed: actual Expo web export, 432 modules, bundle `index-389ef79486d6d19ea3ec1bdf87dc3639.js`. |
| `NODE_ENV=test LEGACY_ENABLED=true KLNK_E2E_CHANNEL=chrome npm run e2e` (PowerShell environment assignments) | **45 passed, 0 failed, 0 skipped, 0 flaky**, retries 0, **70.300 seconds**. Journeys include actual loaded/exported bundle identity checking. |
| Existing portable fixture start, then `KLNK_POSTGRES_TEST_CONNECTION_FILE` privately set and `npm run test:pg` | Independently reran the original three real-PostgreSQL suites: **20 passed, 0 skipped**, **15.62 seconds**, including independent child processes and actual database locks. |
| Extended four-suite `test:pg` after Security's new concurrency checks | Security independently reports **22/22 passed**, **15.99 seconds**. This reviewer did not rerun that new four-suite command; the result is attributed to Security. |
| Portable fixture stop | Passed after Security finished; helper confirmed no remaining QA namespaces or active fixture operations. No database service was installed or initialized. |

The pre-behavior baseline independently archived and measured by Quality was **198.091 seconds, 662 passed/20 skipped**. The final integrated suite includes additional tests and completes in **90.464 seconds**, meeting the under-two-minute target on this host. Do not generalize this timing to every CI machine.

## Formatting and CI inspection

- The separate formatting commit is `dd9e4a7`, before feature changes.
- Independently compared emitted syntax trees for all **182 modified TS/TSX/JS files** in that commit and parsed values for **6 JSON files**. No semantic mismatch remained after ignoring parentheses and coalescing adjacent React `children` string segments, which Prettier splits to preserve explicit whitespace. This comparison excludes the two newly added formatter configuration files.
- Node is aligned to 24 in `.nvmrc`, `engines`, CI and documentation.
- The dependency override is scoped to `@expo/cli`'s `zod` copy, pinned to 4.6.7. No Expo downgrade occurred. Expo web export passed with that dependency tree.
- Typed ESLint includes `no-floating-promises` and `no-misused-promises` as errors and `no-explicit-any` as a warning.
- CI now declares a PostgreSQL service, a dedicated `KLNK_TEST_POSTGRES_URL`, and `test:pg`. The runner does not use production `DATABASE_URL` and restricts cleanup to fresh `qa_*` schemas.
- CI runs lint, format, both typechecks, unit tests, real PostgreSQL, legacy deterministic demonstration, audit, actual web export, browser provisioning and e2e in sequence.
- Playwright supports an explicit executable path as well as installed Chrome. README documents browser provisioning/export/rebuild/run and the private disposable PostgreSQL endpoint.
- Snapshot fixtures restore an independent migrated database and independent encryption key. Tests still validate migration checksums and reject persistent template targets. The fixed-sleep replacements wait for an actual lease-clock condition and actual intercepted-response completion.

## Failures found and resolved during independent review

1. The initial optimized full-suite run had **689 passed, 1 failed, 20 skipped**, 71.452 seconds. The historical network API test expected private `/ready` detail from a public response. Root corrected the test to the new content-free readiness contract; actual export was already working. The final full-suite run above passed.
2. The first browser run repeatedly failed with "Cannot reach your server". A separate Chrome diagnostic showed credentialed-fetch CORS preflights were missing `Access-Control-Allow-Credentials: true` in the E2E proxy. The real API already had credentialed CORS enabled. Root fixed the test proxy. The repeat-failure run was deliberately stopped after diagnosis; it is not counted as a completed run. The subsequent complete browser run passed all 45 journeys.
3. The first format check found ten unformatted source/support files. Root formatted them. The final format check passed.

## Acceptance limits

The local M0 checks above pass. **Remote GitHub CI reaching e2e and a clean `npm ci` from the pushed lockfile still require actual post-push workflow evidence; they cannot be inferred from this local run.** Keep that remote gate pending until observed.

The browser fixture explicitly enables the isolated legacy compatibility tests. This is not evidence that the production app exposes legacy features. No physical iPhone, iOS simulator, live microphone, real provider audio, signing, deployment, telephone call, external message or real calendar operation was exercised. Seven low-severity dependency findings and the intentionally nonblocking explicit-any warnings remain.

Raw reports and helper diagnostics are in ignored `.data/`; only this concise evidence summary is tracked. The old candidate manifests remain historical and were not rewritten.
