# Browser CI follow-up — 29 October 2026

The first M2/M3 push, `0be2bbd`, passed clean installation, lint, format, TypeScript, unit/components, actual PostgreSQL, compiled three-process smoke, demo, audit and Expo export in GitHub. Its [browser step failed](https://github.com/velickovski/klnk/actions/runs/40799632809):46passed/9failed. The earlier local55/55 result used installed Chrome; it was not evidence for CI's bundled Chromium or Linux timing.

The failures exposed two product focus cases and test-fixture races: six large-text cases measured a later editor at its unscaled17px size (one editor did not mount before its keyboard assertion), the independent virtualized collection detached its last row during rescaling, and two rapid-close cases failed to return focus. None of these initial failures is counted as a pass.

Root and independent Security review identified a concrete focus cause. Inbox.open wrapped a background detail GET in the mutation task, disabling every request row while that read was pending. On a slow response, dismissal tried to focus a disabled row; enabling it later did not restore focus. A bundled Chromium probe confirmed that behavior. Platform owns the source repair and pending-read regressions. Quality owns a persistent large-text fixture that maintains actual2x computed fonts through React mounts/style replacement; Platform owns condition-based reacquisition of virtualized rows. Original focus, keyboard, overflow and font assertions are retained.

Root also enabled failure-only Playwright traces/screenshots and uploads only the explicit fictional `.data/e2e-results` directory alongside browser evidence. It does not upload the rest of local `.data`, credentials or user preview state. Provider credentials are absent from these CI fixtures.

The complete Chromium run also reproduced a second product race: Workspace's delayed heading focus could override a control already chosen by the keyboard user. The frame now respects an active control in the new panel or dialog for both ordinary and arrow navigation, while retaining default heading/tab handoff otherwise. The rapid keyboard activation assertions were not delayed or weakened.

## Final local verification

| Check | Actual result |
| --- | --- |
| Full Vitest |838passed/24PG-only skipped;80files;107.899s complete-process wall time. |
| Actual PostgreSQL |24/24passed, four suites,30.02s. A local repeat initially found the fixture on its default port rather than55432; it was restarted on the dedicated guarded port before the passing run. No application data was used. |
| Rendered components |66/66passed,10suites,9.416s after both product fixes. Includes a held detail-read regression proving the row stays enabled and late completion never reopens the sheet. |
| Bundled Chromium complete suite |**56/56passed**,110.506s, one worker, zero retries/skips/flakes. Includes the persistent-font regression, both actual80-row collections, rapid keyboard transitions and Escape while the detail GET is deliberately held. |
| TypeScript/lint/format |Root/mobile/E2E checks pass; lint has zero errors with existing warnings retained. |
| Local preview export |605modules;1696211-byte bundle; SHA256 `489cb6d166e8675bec9ee1619cf00e53f4111c08f1ef1374bf3719929e43a0c7`. Server secret checked against every exported/served file: zero findings. |
| Actual preview |Current API readiness passes. Preview8081 serves the matching hash; IAB reload confirms `index-0bd23ace8949f52f9889660fb7aeda24.js` and one visible Call klnk action. No microphone started. |

Source and test ownership/details are in [Platform's follow-up](ci-browser-followup.md) and [Quality's font-fixture report](ci-font-fixture.md). Security independently reproduced disabled-button focus behavior and the transition-induced17→34→68→…8704 compounding; the stable test-only rule holds natural17/actual34. Production source, deterministic fixtures, browser execution and physical device verification remain distinct. Remote CI must independently confirm the follow-up commit.
