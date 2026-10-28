# Independent QA / M0 / baseline reproduced, defects open

Task: independent baseline, rendered-browser harness design and native/accessibility strategy. Initial inspection was read-only. After the orchestrator granted a lease, added only `e2e/browser/**`, `e2e/native/**` and this report. Root owns runner configuration, package manifests, server fixture and CI. No application behavior, credential, provider gate or external resource was changed by QA.

## Baseline evidence actually observed

Environment: Windows, Node v24.15.0; installed bundled Playwright 1.62.1 with headless installed Chrome. Rendered the existing `apps/mobile/dist` artifact (`index.html` last-write 27 October 2026 14:56:40 local), rather than claiming a fresh source build. Served it on isolated loopback port 4418 and routed its API requests into the real Fastify application with a new in-memory PGlite database, fictional demo owners, simulator provider, worker off and all external provider credentials explicitly removed. Browser and server/database were closed afterward. No microphone was requested or paid provider session created.

Actual inline invocation: PowerShell here-string piped to `node --import tsx --input-type=module -`. The inline script used `createApp`, `Database({dataDir:'memory://'})`, `createServer`, and bundled `playwright.chromium.launch({channel:'chrome',headless:true})`. The checked-in replacement is the root-owned `playwright.config.ts`/`scripts/e2e-server.ts` harness plus the independent specs below; its execution is recorded separately when available.

| Scenario | Result | Actual observation |
| --- | --- | --- |
| VOICE-01 sole opening action | Passed for existing export | `buttons: [Call klnk]`, one readiness request, no page errors at 390×844 |
| SETTINGS-01 unsaved navigation | **Failed** | Settings → Profile → edit Your name → People → Settings → Profile returned the saved name; `draftRetained:false`, `persistedNameRestored:true` |
| PEOPLE-02 Escape/Stay dismissal | Inconclusive / failed test step | Expected Stay and edit did not appear within 30 seconds after a fill immediately followed by Escape. Export/source freshness and effect timing were not isolated; do not infer a confirmed product defect from this timeout |
| AUTH/API races | Source risk confirmed, browser retest pending | Initial `api.ts` accepted successful JSON by cast, tracked origin generation only and allowed old 401 to clear the session; M1 worker repairs require independent retest |
| Native audio/accessibility/archive | Blocked / not run | No signed native artifact, macOS/Xcode host or physical iPhone evidence |
| Sandbox service write/revoke | Blocked / not run | No dedicated authorized service account/calendar/recipient scope |

Console metadata retained from the baseline: launch `errors:[]`; no contact or memory mutation was completed. Screenshots/log files were not created during this first read-only run.

## Independent suite supplied after lease

- [Whole-product journeys](../../../e2e/browser/journeys.spec.ts): typed exact-message simulated request, owner-bound voice draft, settings navigation, contact/memory failed saves and guard/focus recovery.
- [Boundary regressions](../../../e2e/browser/boundaries.spec.ts): malformed successful auth/bootstrap/Live readiness, microphone-denial recovery to the separate typed workspace and an old owner's delayed 401 after a new owner signs in.
- [Rendered accessibility checks](../../../e2e/browser/accessibility.spec.ts): 320/390/430 widths in both appearances, Reduce Motion, combined text spacing/text enlargement, keyboard clean-sheet dismissal and focus restoration.
- [Native strategy and blocked matrix](../../../e2e/native/README.md): exact artifact identity, simulator XCTest strategy, common tasks across assistive inputs, physical iPhone audio/lifecycle and release archive gates.

These tests assert the intended contract and may initially fail existing behavior. Their existence is not a passing result. The root-owned runner must pin `@playwright/test`, use the exported Expo app against an isolated real local API, and avoid provider credentials. Traces/HAR/video are disabled by default because they can contain bearer headers/authentication payloads. Optional screenshots contain only disposable fictional fixtures.

Discovery check actually run: `npx playwright test --list --config e2e/browser` passed for the initial 17 scenarios using newly installed `@playwright/test` 1.64.1; two subsequent Live recovery cases bring the current specification to 19. The first `npx playwright test --list --config playwright.config.ts` failed because root had not yet created that config. These are discovery results, not execution passes. The shared fixture must account for per-IP demo/overall rate limits without weakening production policy.

## Source findings for owners

1. SETTINGS-01 is a confirmed rendered data-loss defect. Retain profile drafts or protect tab navigation; reset them at owner change.
2. Request composer originally exposes retry 0/1/2 and duration 120/180/300 despite authoritative bootstrap limits. REQ-03 needs panel regression and rendered fixture coverage.
3. Source lists use unbounded maps. PEOPLE-02/Memory large-list behavior needs realistic fixtures and measurement; this audit does not claim a performance result.
4. Native Live is gated; browser playback does not establish microphone/speaker/Bluetooth, backgrounding, safe areas, VoiceOver or full AA process equivalence.
5. `supportsTablet:true` is a release-scope decision needing actual iPad evidence or an explicit owner-approved configuration change. QA did not alter it.

Required skills read: ios-accessibility, ios-simulator, app-store-review, ios-networking, authentication and swift-security. Current Apple review/requirements/screenshot/reason-API pages were fetched on 27 October 2026; links and archive limits are in the native strategy. No App Store compliance or accessibility conformance claim is made.

Next dependency: root M1 API/session/App integration and repeatable runner/export. Run the independent suite against that exact artifact, classify every failure, then return confirmed defects to the feature owner. Independent reviewer of these QA changes: orchestrator pending.

Subsequent execution and root-repair verification are recorded in [the interim M5 QA report](m5-qa.md). That later record supersedes harness-pending statements above without changing this historical M0 baseline.
