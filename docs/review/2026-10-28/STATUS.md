# Production improvement status

Started 28 October 2026 against source `845b104`. The five reviews were located on `origin/claude/awesome-bohr-uivxw4` and fast-forwarded at `40053a2`; their original line citations are historical. The separate formatting-only commit `dd9e4a7` precedes behavioral changes. An independent AST comparison checked 182 code files and six parsed JSON files with no semantic violations after normalizing formatting of adjacent JSX text.

| Card | Owner | Files | State | Actual checks/evidence |
| --- | --- | --- | --- | --- |
| M0 tooling, audit, Node and CI | Root | manifests, CI, formatter/linter, README | Local gate passed; remote CI pending | TypeScript/root/mobile/E2E pass; lint 0 errors, 255 existing any warnings; format pass; audit 0 high/critical, 7 low |
| M0 test speed and real Postgres fixtures | Quality worker; independently checked by Platform | test support, PG runner, fixtures, condition waits; shared db template API by root | Local gate passed | Original baseline 662 passed/20 skipped in 198.091s; final 711 passed/22 skipped in 90.464s. Skips are tested separately against real PostgreSQL |
| M1 worker composition and isolation | Platform worker; independently checked by Security | composition root, engine, coordinator, worker entry points and regression tests | Local gate passed | Child-process worker executes injected revocation and retention; corrupt payload/backoff/dead-letter/rollback/overlap checks pass |
| M1 OAuth and model safety | Security worker; independently checked by Quality | Google service, owner-intent, voice tools and safety tests | Local gate passed with explicit safe interim voice gate | HTTP browser-binding/replay/profile/recipient checks; 66-test independent group passes. Voice inform/ask is blocked pending trusted exact-text confirmation in M2; no model boolean grants authority |
| M1 config, rates, logging and legacy isolation | Root; independently checked by Security and Quality | config, app, domain, migration009, logging, request limits and build flag | Local gate passed | Independent 26-test group passes; shared Postgres concurrent rate cap and two actual API pools pass; anonymous/invalid bearer/proxy/account lockout covered |
| Independent final M0 integration | Platform worker | read-only verification and independent report | Local gate passed | 45/45 browser journeys, 0 retries/flakes/skips; exact export actually loaded. Standard Expo export also passes (432 modules) |
| Real PostgreSQL gate | Quality and Security implementations; separate independent executions | 4 opt-in suites, test:pg | Passed locally | Expanded runner 22/22 passed, 15.99s; original 20 independently rechecked. Disposable server stopped, no qa namespaces remain |
| M2 voice, onboarding, lifecycle and network usability | Next wave; research started read-only | Ownership assigned after M1 snapshot | Not implemented by this checkpoint | Native hero fallback, production Live, trusted readback, email lifecycle, default delivery, busy blocks and human answers remain |
| M3 frontend architecture/design | Quality worker, research only until M1 snapshot | Proposed cache/router/panel ownership | Not implemented by this checkpoint | Navigation, freshness, readable dates, controls and default-workspace device/accessibility evidence remain |
| M4 multi-instance architecture/deploy and M5 cleanup | Later gated stages | See repository improvement brief | Not implemented | No Docker/public deployment, cloud build, signing or external delivery performed |

## Independent reports

- [M0 independent verification](independent-m0-qa.md), [Quality implementation](quality-worker.md).
- [Platform implementation](platform-worker.md), [independent platform/production QA](qa-platform-production.md).
- [Security implementation](security-worker.md), [independent security HTTP QA](security-independent-qa.md).
- [M2 network contract proposal](network-contract-proposal.md) is a proposal, not implemented behavior.

The full suite's 22 skipped tests are not counted as passed; the separate actual PostgreSQL run covers all 22. Initial failed runs (a stale public readiness assertion and missing credentialed-CORS response in the E2E proxy) were corrected and rerun; they are not reported as successful evidence. npm run demo passes all eight explicitly simulated legacy scenarios; fixture configuration now explicitly opts into legacy and does not inherit provider credentials.

## Remaining release blockers and constraints

This checkpoint is not a deployable or physical-iPhone release. M2/M3 remain active implementation stages, rather than claimed fixes for the reviews' product/usability findings. Current native Live remains unimplemented; no iPhone, microphone, live model or audio verification was performed in this improvement run. The owner-to-agent GPT-Live broker still requires a subsequent production transport/budget stage; existing browser success is deterministic fixture evidence only.

Legacy routes/build navigation default off, with core /voice/live and /demo/status explicitly preserved. Cleanup for persisted legacy records remains available; deleting that stack waits for replacement account/recorded-voice screens. Exact voice inform/ask review is currently a safe capability block and must gain an authenticated confirmation path before claiming usable voice messaging. Email verification/reset need a configured, approved delivery provider; no real messages were sent. Signing, cloud builds, public deployment, third-party calling/calendar writes, APNs and real assistive-technology device testing remain gated. No key, local account database or demo credentials are in source. Old archives and evidence hashes are historical and intentionally not refreshed.
