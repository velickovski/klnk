# klnk local candidate handoff

27 October 2026. Work was implemented directly in the requested project by the root engineer and real GPT-6.1 Sol workers, with separate QA. This workspace has no Git repository; source manifests identify the candidate. **The local candidate is verified within the scopes below. Production/iPhone release remains blocked.**

## Running preview

- [iPhone browser preview](http://localhost:8081/?preview=iphone): exactly one initial Call klnk action. This is the Expo web app, not a native iPhone build.
- API listens on `127.0.0.1:4000`, Metro on loopback `::1:8081`. Read-only checks returned HTTP200 for the preview, API health, database readiness and OpenAI configuration. Telephone mode is simulation and real calling is disabled.
- The existing local application database/key were backed up inside ignored `.data/local-preview-backup/` before startup/migration. No user data was reset.
- Normal restart: `npm run dev`; in a second terminal, `npm exec --workspace @personal-agent/mobile -- expo start --web --port 8081 --localhost`. The current Metro process uses CI mode; restart without that environment flag for file watching.

## Implemented behavior

All panels now share the selected navy/lavender/coral system, artwork and accessible primitives. Settings drafts, People/Memory search and bounded list rendering, provenance/disclosure/expiry, request limits/review/results, guidance and Save/Discard/Stay recovery were implemented and exercised. Narrow/large-text navigation adapts without clipping labels; ordinary launch remains one action. Unconfirmed recovery now says closure is unconfirmed throughout, while preserving typed workspace access.

Identity responses are fenced across owner/origin changes and validated before acceptance. Secure storage failures fail closed. Durable Live receipts deduplicate creation, retain ambiguous starts across restart, enforce quotas, fence controller ownership and require provider terminal evidence. Owner restoration reads the same unresolved receipt before a new start. Worker ownership renews and fences stale effects. Account deletion rechecks active work atomically; delayed writes cannot resurrect a deleted owner.

Contact/context edits invalidate draft reviews. Approved requests freeze recipient/number and permitted context; later source edits cannot change that authority. Opt-out suppression survives contact deletion/recreation. Draft creation has stable idempotency receipts and cannot recreate a removed draft from an old save.

The optional local Live gateway uses strict schemas, server-bound identity/session/controller checks, explicit per-account permissions, immutable mission authority, durable receipts and sanitized activity. Default permission is off. The Settings grant allows People lookup, allowed Memory lookup, draft preparation and status. A key never grants those permissions. External effects remain disabled. Google OAuth/PKCE/OIDC, encrypted refresh/revoke, cleanup and existing-event readback are implemented with deterministic provider evidence; no real Google account or Calendar change was tested.

## Final checks actually run

| Check | Actual result |
| --- | --- |
| `npm test` | **557 passed / 48 files**; 11 PostgreSQL tests in two files skipped by default, not counted as passes. Windows run506.41s under concurrent local load; not a product performance score. |
| Opt-in PostgreSQL suites | **11/11 passed**, PostgreSQL18.6, separate processes/locks/fencing/deletion/restore and credential expiry during owner-lock waits. Exact command below. |
| Independent Playwright browser suite | **32/32 passed**, no retries/flaky/skips; final loaded bytes match exported bundle hash. Includes actual local API grants, isolation, permission failure/revocation, unknown-session recovery, persisted simulated results, input retention and enlarged layouts. |
| Root/mobile and E2E TypeScript | Passed |
| Standard Expo web export | Passed,418 modules; entry/hash in [final checks](../evidence/final-local-checks.json) |
| `npm run demo` | Eight fictional scenarios passed; one simulated existing event updated once despite action retry |
| Fixed owner corpus | **20/20 text/API/domain samples passed**, no safety failure or network attempt. Not ASR, human voice, native or latency evidence. |
| Local operations rehearsal | **17/17 assertions passed**: logical dump to offline quarantine, independent deletion journal and safe encrypted application restore; temporary databases removed |
| `npm audit --json` | **Failed release gate: three high, zero critical**. Compatible node-forge patch applied; Expo CLI's nested Zod still needs a compatible upstream fix or independently tested mitigation. |
| Offline readiness | Correctly reports missing ElevenLabs/Twilio setup and disabled calling; not a provider-connection pass |

PostgreSQL command (private local connection file is never printed):

```powershell
npx tsx scripts/local-postgres-fixture.ts start
$env:KLNK_POSTGRES_TEST_CONNECTION_FILE='.data/production-pg/connection.json'
npx vitest run tests/qa-postgres-runtime.test.ts tests/credential-clock.test.ts --maxWorkers=1 --no-file-parallelism
npx tsx scripts/local-postgres-fixture.ts stop
```

The isolated fixture is now stopped with zero remaining QA namespaces. One earlier Windows test worker crashed; its narrowly identified orphan namespace was cleaned after confirming no active ownership. The final serial11-case run passed. Do not count the failed combined run as a pass. Start the local fixture deliberately before rerunning; the portable binaries were obtained from the official PostgreSQL-linked EDB archive and no Windows service was installed.

## Real OpenAI evidence

[The successful read-only browser run](../evidence/voice-application-tools-smoke.json) created one session, observed one delegation and `contacts_lookup`, recorded a successful local result, locally accepted one result send and continuation, then observed subsequent captions/audio and terminal closure. It used fictional synthesized speech, no physical microphone, and created no outbound request.

Two earlier diagnostic attempts failed their tool/response criteria and are preserved separately; both had verified terminal closure before a manual recheck. The successful run took25,311ms. A later caption is temporal evidence, not semantic matching or proof a person heard the answer. `semanticSpokenResultVerified:false` is preserved. This does not verify telephone calling, Calendar, naturalness or native audio. [Exact source identity](../evidence/voice-application-tools-sources.json) applies to that run; subsequent Google credential-clock hardening passed its separate PostgreSQL regression.

## Review artifacts and remaining gates

- [Current milestone board](STATUS.md), [independent browser review](m5-qa.md), [runtime QA](M3-qa.md), [gateway QA](M4-qa.md), [20-case corpus](M5-corpus.md).
- [Release/security/device/setup gates](M6-release-review.md) and [tested operations runbook](../operations.md).
- [Candidate source manifest](../../../.data/release-candidate/klnk-local-review-2026-10-27.json) and [source archive](../../../.data/release-candidate/klnk-local-review-2026-10-27.zip). These exclude `.env`, databases, credentials, dependency folders and generated web bundles. The manifest scans exact configured private values without printing them; this is not a complete secret-detection/security certification.

Still blocked: a documented compatible native Live transport, Apple/Expo signing and physical iPhone; manual assistive technology/complete accessibility and human voice/usability/performance checks; actual Google sandbox and separately scoped US telephone pilot; public account recovery; dependency audit; production monitoring/key custody/journals/rollback and exact archive privacy/review evidence. The independent visual rubric is partial and does not meet its full release gate.

No third-party call, message, real Calendar mutation, new billable infrastructure, public deployment, App Store submission or marketing communication occurred. M6 is not certified and M7 was not performed.
