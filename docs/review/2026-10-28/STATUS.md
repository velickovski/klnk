# Production improvement status

Updated 29 October 2026. Reviews were located on `origin/claude/awesome-bohr-uivxw4` and fast-forwarded at `40053a2`. Their original citations are historical. Mechanical formatting commit `dd9e4a7` precedes behavioral work; an independent AST check found no semantic differences in 182 code/six JSON files after JSX text normalization.

**Latest follow-up:** the first M2/M3 push `0be2bbd` passed every GitHub gate except browser tests (46passed/9failed). [The CI repair](../2026-10-29/browser-ci-repair.md) fixes disabled-row focus and delayed heading focus, and corrects persistent text-size/virtualized-scroll fixtures. Its latest local gates are **838unit +66component +24actualPG +56bundled-Chromium passes**, with TypeScript/lint/format and a repaired phone export. These supersede the initial Chrome55/55/65component checkpoint below. The preview has been reloaded to bundle `0bd23ace8949f52f9889660fb7aeda24`, SHA256 `489cb6d166e8675bec9ee1619cf00e53f4111c08f1ef1374bf3719929e43a0c7`; no real audio/device evidence is claimed. Check GitHub for the follow-up commit's remote result.

## Milestone board

| Card | Owner and files | Current state / actual evidence |
| --- | --- | --- |
| M0 tooling, CI, test speed | Root manifests/CI; Quality fixtures, independently checked by Platform | Committed. M1 checkpoint had 711 unit passes/22 explicit PG skips in 90.464s, 22/22 real PG and 45/45 browser. Missing-env E2E and Docker-NAT test preflight repaired at `65377e3`. [GitHub CI passed](https://github.com/velickovski/klnk/actions/runs/40777059638). Current candidate requires a fresh full gate below. |
| M1 worker isolation/composition | Platform engine/coordinator/composition, independent Security | Shared maintenance hooks, overlap guards, poison isolation, backoff/dead-letter and unchanged-task suppression implemented; actual PG/worker checks recorded in earlier reports. |
| M1 auth/config/rates/model boundaries | Root/Security, independently reviewed by Quality | Validated production defaults, shared SQL request/account rate limits, OAuth browser nonce, bounded safe profile strings, exact recipient clarification and metadata-only logging implemented. No public provider diagnostic leak. |
| M2 account lifecycle | Platform account service/routes/mail/client, root auth/migration/wiring; independent Security | Generic 202 registration, one-use password-bound proof/reset, email/password change, session revocation/idle timeout and recent export/delete reauthentication. Combined 39 account/security cases passed. SMTP outbox tested with injected transport; delivery remains OFF, no real email. |
| M2 network completeness | Platform coordinator/policy/calendar/preferences; root schemas/routes/migration; independent Security | Default accepted-member inform, human answer, counterproposal, connection controls, operation epochs, private busy blocks and maintained availability implemented. 82 affected tests, independent 21-test group and expanded 24/24 actual PG passed. |
| M2 native recorded voice / production Live | Security voice service/panel/broker; root wiring; independent Platform | Authenticated recorded turns, real transcription adapter/device speech, exact owner plan readback, receipt reconciliation, byte/day caps and capture/session cleanup implemented. 124 targeted tests and independent HTTP/controller/native-panel cases passed; corrected contract fixtures add 58/58 group. No actual audio or physical device test. Native Live remains gated. |
| M2 native reminder alerts | Security new local reminder coordinator/native adapter/provider, root manifest/plugin; independent Platform | Local source gate passed: 16 implementation plus six independent injected regressions, permission/session/quiet races covered. No actual device permission or alert invoked. APNs remains off. |
| M3 shared cache/router/virtualized screens | Quality network panels/router/cache, root shell/primitives/auth, independent Platform | Local source gate passed: five lazy destinations, session-owned drafts/cache, explicit link acceptance, pickers/Intl, forms and semantic controls. Modal late-read reopen and current-row focus bugs fixed. Independent complete browser group 55/55 and rendered group 65/65 passed. Physical accessibility remains open. |
| Compiled deployment preparation | Security build/Docker/smoke/runbook; root scripts/CI; independent Platform | Three plain-Node entrypoints and 11 migration files built. Actual disposable PG smoke passed with two APIs plus worker, internal message/calendar, poison job, owner rates and idle/Live state. Independent rerun passed on 29 October. Docker CLI absent: no image build/Linux install/Unix signal test/public deployment claim. |
| M4 broader architecture | Deferred after stabilization | Whole-table lookup scans, unified network/job leases/leader maintenance, per-module layering, comprehensive row validation, encryption AAD/key rotation, production metrics and security automation remain. See rationale below. |
| M5 complete legacy removal | Deferred after replacement/device gates | Default flags disable earlier routes/navigation. Replacement account/native recorded screens now exist, but full source/dependency/data cleanup and legacy tag/migration remain undone. Earlier docs are archived under `docs/legacy`; old evidence is not relabelled as current. |

## Resumed fixes and verification

The initial combined M2/M3 run failed: **763 passed, 51 failed, 24 pending**, 150.454s. Most failures were stale fixtures expecting register-created sessions, anonymous capture or obsolete reauthentication/migration contracts; they were corrected without disabling production guards. A real regression also dropped opt-out suppression records from export. Root restored them within the owner/reauth transaction and added optional transaction reuse to avoid a PGlite nested-transaction deadlock. The original privacy/race assertion now passes.

Platform's resumed four-suite group passed **14/14**, earlier five HTTP fixture suites **41/41**, retained browser group **32/32**. Security's corrected voice group passed **58/58**. Quality's OAuth/storage group passed **8/8**, and actual root-App incoming proof regressions **2/2** cover clearing an old password and rejecting late completions. Two caption regressions verify bounded history/turn size and immutable prior snapshots.

## Initial M2/M3 local gate — 29 October

| Command/check | Actual result |
| --- | --- |
| `npm run typecheck`, `npm run typecheck:e2e` | Passed root, mobile/native source and browser-test TypeScript. |
| `npm run lint` | Exit0; zero errors, 251 existing explicit-any warnings. |
| `npm run format:check` | Passed. |
| Full Vitest | **838 passed, 24 PG-only skipped**, 80 files, **92.871s** complete-process wall time. The earlier passing832 run took123.475s during other checks; only this final frozen run meets the120s target. |
| `npm run test:pg` | **24/24 passed**, four actual PostgreSQL suites,16.99s. Initial22/24 run failed on two obsolete register-created-session fixtures; explicit login/re-auth fixed them without weakening multiprocess deletion race assertions. |
| `npm run test:components -- --runInBand` | **65/65**,10 suites,9.305s. Includes real root-App proof replacement, delayed detail success/failure and the native one-action opening. OS/audio/HTTP calls are injected. |
| `npm run e2e:build` + complete Playwright | **55/55**,99.762s, one Chrome worker, zero retries/skips/flakes. Tests use separate fictional API4102/web8083 and no real providers. |
| `npm run build:server` + `npm run test:compiled` | Passed three plain-Node entrypoints/11 packaged migrations; fresh two-API/standalone-worker actual PG smoke passed after integration. |
| `npm run demo` | Passed eight explicitly simulated legacy scenarios; no external effects. |
| `npm audit --audit-level=high` | Exit0; zero high/critical,15 low. |
| Standard Expo web export | Passed605 modules, current local API4000, dev phone preview on, legacy client off. Bundle1696065bytes; SHA256 `c205b64ef0a55129cc2bf0525babdbef20f6b8668b7b929b60d5d268af2a29c1`. |
| Browser artifact secret check | All five exported files checked against the actual configured server secret; zero findings. Staged-source scan runs separately before push. |
| Latest user preview | Offline database/key backup made before upgrade; current API4000 health/readiness pass. Preview8081 serves the exact verified bundle hash, no-store. Actual IAB tab reloaded and visually inspected with one Call klnk action, no capture started. |

The ordinary suite's 24 skipped cases are not counted as passes; all24 were run against actual PostgreSQL separately. Detailed local JSON/logs are ignored under `.data`; CI uploads fictional browser output as a short-lived artifact instead of committing regenerated images. Remote CI must be checked for the pushed commit; these local results alone do not assert its outcome.

## Independent and implementation reports

- Earlier gates: [M0](independent-m0-qa.md), [platform](qa-platform-production.md), [security HTTP](security-independent-qa.md), [CI repair](ci-repair.md).
- M2 implementation: [network](network-worker-m2.md), [accounts](account-worker-m2.md), [voice](voice-worker.md), [frontend](frontend-worker.md), [native reminders](native-reminders-worker.md), [focus/auth/navigation follow-up](focus-auth-navigation-followup.md), [compiled build](build-worker.md).
- Independent QA: [network](qa-network-completeness.md), [account security](qa-account-security.md), [voice](qa-voice-production.md), [frontend](qa-frontend.md), [integration](final-integration-qa.md), [29 October resumed/compiled](../2026-10-29/platform-resumed-qa.md), [reminders](../2026-10-29/qa-native-reminders.md).

Reports distinguish authorship from independent review. New bulky screenshots/JSON stay in local ignored evidence or CI artifacts; historical committed archives are not silently rewritten or rehashed to claim new execution.

## Release blockers and explicit deferrals

- **Physical iPhone and accessibility:** Windows cannot establish native build, microphone routing/interruption, speech, notification, Dynamic Type, VoiceOver or switch/keyboard behavior. Local/browser success is not that evidence. No full WCAG conformance claim is made.
- **Native continuous Live:** no compatible documented and device-verified Expo58 transport is established. The hero instead uses recorded turns. GPT-Live has no documented ephemeral-secret endpoint; the different Realtime protocol is not substituted.
- **Browser Live message review:** inform/ask tools remain safely blocked with review-required; a model boolean cannot authorize disclosure. The typed Inbox and native recorded exact-plan path provide authenticated review. Fully spoken browser-Live message confirmation remains unfinished.
- **Email onboarding:** production verification/reset requires approved SMTP sender/credentials, public HTTPS app URL and actual mailbox proof/delivery tests. Nothing is sent while delivery is disabled; development-only unverified sign-in is not a production shortcut.
- **Native local reminders:** require explicit device permission and physical validation. Only canonical reminders already synchronized while foregrounded can alert while closed; no closed-app arrival/update push is claimed. APNs remains a separate stage.
- **Multi-instance production architecture:** compiled same-host PG smoke proves the listed operations, not multi-host failover or complete network-task leasing. Indexed lookups, unified fenced tasks, leader sweeps, AAD/key versioning and rotation need dedicated migrations/backfill/recovery tests before deployment; broad changes during final regression repair would invalidate the checkpoint evidence.
- **Legacy retention/security cleanup:** old voice/mission data and provider dependencies remain behind flags. Complete deletion needs a reviewed data migration/tag and replacement evidence; old voice lifecycle/large upload/encryption findings are not all closed by new network receipts.
- **Deployment/operations:** Docker build/scan, Linux production install, Unix graceful drain, security headers/CodeQL/Dependabot/secret scanning, spend/queue metrics and a real staging rollback remain unverified or unimplemented. Public HTTPS, billable infrastructure, signing/cloud builds, external calls/messages/calendar writes and marketing contact were not performed.

This is a locally tested candidate, not a deployable physical-iPhone release. No keys, local account database or demo credentials belong in source or browser bundles.
