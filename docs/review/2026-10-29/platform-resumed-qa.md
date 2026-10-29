# Resumed platform verification

Reviewer: `/root/platform`. Date: 29 October 2026. This review covers the assigned failing test fixtures, root's export correction and the compiled artifact/container preparation owned by other workers. It does not independently certify this reviewer's account/network implementation.

## Unit failures and export correction

The prior full-suite JSON showed registration fixtures expecting a token from normal registration, a stale migration count, and a missing export field. Updated only `tests/account-lifetime.test.ts`, `tests/qa-runtime-account.test.ts` and `tests/production-security.test.ts`:

- Registration must return generic pending 202 without a token; fictional development accounts then sign in through the actual password-login endpoint. No hidden verification or authentication bypass was introduced.
- Delayed profile/contact writes still race real account deletion after authentication, and remain rejected without resurrecting resources.
- Deletion still rechecks a no-provider-ID Live receipt inserted after preflight. Unknown paid starts remain unresolved through logout, sign-in and broker reconstruction without a new dispatch; another owner still cannot read the receipt.
- Operator readiness expects the current eleven applied migrations; public probes remain minimal.

`tests/review-context-races.test.ts` found an actual export regression: `recipientSuppression` was omitted during route refactoring. Root restored the field inside the owner-lock/recent-reauthentication transaction and added optional SQL delegation to `RecipientSuppression.list` to avoid a nested embedded transaction. Its existing assertions were preserved: suppression survives contact deletion/recreation, exports only account-scoped metadata, omits the raw telephone number and retains the `account_lifetime` label.

Observed commands:

| Command | Result |
| --- | --- |
| `npx vitest run tests/account-lifetime.test.ts tests/qa-runtime-account.test.ts tests/production-security.test.ts tests/review-context-races.test.ts --reporter=json --outputFile=.data/resumed-platform-unit.json` | **14/14 passed**, four files, 13.854 seconds. |
| `npx tsc --noEmit --pretty false` | Passed. |
| Scoped ESLint on the four test files | Passed. |

## Independent compiled-artifact review

Inspected `scripts/build-server.ts`, `scripts/compiled-smoke.ts`, `Dockerfile`, `.dockerignore`, runtime entrypoints, CI integration and `docs/OPERATIONS.md`.

- Three bundled ESM JavaScript entrypoints run with plain Node. Shared domain code is bundled; escaped workspace/TypeScript runtime imports are rejected. Eleven original migration files and SHA-256 hashes are packaged at the path used by the runtime. Dependencies remain external and are explicitly documented.
- Build output replacement checks the exact workspace target and refuses linked output parents. The image context excludes `.env*`, local data, test output, Git history and client/native build outputs. The final image runs as the unprivileged `node` user, with demo, legacy, mail and telephone execution disabled by default.
- The smoke requires an explicit dedicated loopback PostgreSQL test fixture and uses a new random schema. Runtime children receive a strict environment allowlist and an empty temporary working directory, excluding inherited provider credentials, dotenv-bearing cwd and Node loader options. Occupied smoke ports cause refusal rather than replacement.
- Production application traffic requires the explicitly trusted HTTPS proxy boundary. Private unauthenticated health/readiness probes can use HTTP. Operator diagnostics remain separately authenticated. The runbook accurately requires protecting direct backend access and replacing forwarded headers at the trusted proxy.
- No blocking discrepancy was found in the documented upgrade/rollback process: preserve artifact, ledger, protected key and backup/deletion journal; require current-ledger-compatible code or forward repair/separate-target restoration; reconcile sessions, leases and external uncertainty before traffic. This is a reviewable procedure, not an observed production rollback.

Observed commands, run once independently after the export fix:

| Command | Result |
| --- | --- |
| `npm run build:server` | Passed: three compiled JavaScript entrypoints, eleven migrations. |
| `npm run test:compiled` with the private `KLNK_POSTGRES_TEST_CONNECTION_FILE` path | Passed on actual PostgreSQL: two compiled APIs, one standalone compiled worker, shared internal inbox/calendar, poison-job isolation, shared owner limits/idle-session rejection and unresolved Live readback. |

The compiled runner confirmed the internal message remained queued until the separate worker started, exactly one internal calendar agreement was shared, a local no-op job completed once, poison ciphertext failed on attempt five, and both APIs shared 100 accepted/10 denied requests plus expired-session rejection. All children, its schema and its temporary directory were removed. Sanitized output is `.data/compiled-smoke.json`; the private connection file was not printed or copied into evidence.

## Explicit limits

Docker was unavailable: no container build, Linux dependency installation, image scanning or file-permission test occurred. The base image still requires a reviewed digest before release. Windows process termination does not establish Unix SIGTERM or orchestrator drain. Actual production-role/database TLS, cross-host failover, traffic switching and RTO/RPO remain unverified. The compiled smoke does not exercise paid Live creation caps, sideband takeover or audio hardware. No provider, email, telephone, external calendar, deployment or physical iPhone action occurred.

## Final independent browser verification

Fresh `npm run e2e:build` passed, including root's native opening fallback correction and Quality's final focus/navigation fixes: 604 modules, `index-a5dda7b45b0d40a7b6300b310ffa74e6.js`, 1,696,457 bytes, SHA-256 `1165d3791c54347a08eee4f89889831d66b4392f557ab8baf19ddacda73c57a7`.

`KLNK_E2E_CHANNEL=chrome npx playwright test --max-failures=2` passed **55/55** in **99.762 seconds**, one worker, zero retries/skips/flakes. Exact run metadata is `.data/resumed-browser-final.json`. The unchanged fast Calendar→Inbox Close→immediate row reopen→Escape regression passed both its focused run and the full suite. No timeout increase or intermediate settling delay was added.

The review exposed two distinct focus problems before passing: a late canonical GET could reselect/reopen a closed detail, and a virtualized row's old ref was insufficient for final focus restoration. Quality changed the refresh to update cache without selecting, used the actual Modal dismissal lifecycle, and resolved the current owner-scoped row by stable native ID. Failure-only DOM diagnostics remain in the regression; the temporary focus-method tracing wrapper was removed before final verification.

The final suite also covers the single opening action and real pending account registration, explicit authenticated microphone denial with typed fallback, canonical authorization/recovery, both internal accounts, no automatic invitation on join/history, owner-cache isolation, eighty actual API-created memories, large-text layouts, dialogs and keyboard checked-state semantics. At 320×740 with 200% text and spacing, visual inspection confirmed compact navigation now leaves roughly 415 px for content rather than the prior approximately 84 px. The final row is reachable. Screenshots are `docs/review/2026-10-28/evidence/qa-independent-*.png`; this does not establish complete accessibility conformance.

Final evidence correction: screenshot review noticed that row 80 could mount after the scaling helper's last poll, leaving that newly mounted text at normal size. Strengthened both long-list tests to reapply enlargement after the final batch appears, re-scroll, and assert its actual computed font equals twice its stored base size, while retaining the viewport assertion. Reran only those two affected cases against the unchanged `a5dda7` bundle: **2/2 passed in 12.440 seconds**, zero skips/flakes. Screenshots were refreshed and visually inspected with row 80 actually enlarged. E2E TypeScript and scoped ESLint passed. Metadata is `.data/resumed-browser-final-row-font.json`. This was test/evidence-only; no production source or export changed.

Independently reran Quality's actual App incoming-account-link component regressions: **2/2 passed**, 2.212 seconds. They verify prior password clearing/correct proof endpoint and that an old asynchronous completion cannot dismiss a newer proof. HTTP is injected; no verification email or real mailbox proof was used.

User preview ports 4000/8081 were untouched. Compiled smoke used 4105/4106; browser QA used 4102/8083 and its fixture servers stopped automatically. The previous day's unresolved frontend gate is superseded by these observed results. Physical iPhone, real notification/audio/provider and container verification remain outside this evidence.
