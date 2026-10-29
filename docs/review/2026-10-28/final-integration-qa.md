# Final integration QA — M2/M3

Reviewer: `/root/quality`. This gate exercises the root-owned account/authentication/API/composition integration and runs the combined checks. This reviewer also implemented the frontend panels, cache and test fixtures, so **this report does not independently certify those modules**. Platform's separate frontend review and Security's account review supply that separation. No production data, actual SMTP, paid provider, user preview port4000/8081, browser fixture4102/8083 or native device was operated by this gate.

## Initial frozen integration run

Command: `npx vitest run --maxWorkers=4 --reporter=json --outputFile=.data/m2-final-tests.json`, with a PowerShell Stopwatch around the complete process. Vitest configuration already uses four workers, migrated PGlite template setup, egress guards and explicit opt-in PostgreSQL suites.

Observed: **838 total:763 passed,51 failed,24 pending**,14failedfiles outof77files. Process exited1. Complete wall time **150.4541885seconds**, so the requested120-second target was **not met**. Two account-lifetime cases and one runtime-account case each hit30-second timeouts while waiting for a pre-handler/barrier after obsolete authentication/deletion setup. Their90seconds are aggregate test timeout time, not a claimed90seconds of removable wall time. Independent browser QA ran concurrently on the shared workstation; no competing full unit run, typecheck or lint was launched by this worker during the timed run.

Initial result and timing are preserved as `.data/m2-integration-initial-tests.json` and `.data/m2-integration-initial-timing.json`; the requested final filenames can be reused after authorized repairs. Full stderr is `.data/m2-final-unit.log` and includes the existing Fastify disableRequestLogging deprecation warning.

| File | Failures | Initial evidence / required owner action |
| --- | ---: | --- |
| `tests/account-lifetime.test.ts` |2|Obsolete registration session setup leaves delayed-writer barriers unentered; root must update real login and recent reauthentication setup. |
| `tests/api-lifecycle-server.test.ts` |1|Old registration token makes bootstrap return401. |
| `tests/api.test.ts` |1|Expects register201rather than generic202and explicit development login. |
| `tests/live-gates.test.ts` |8|Shared fixture expects register201. |
| `tests/network-api.test.ts` |5|Shared fixture reads absent user/token from generic registration; export/delete also require recent bearer-bound reauthentication. |
| `tests/network-voice-tools.test.ts` |3|Two strict input fixtures leak derived authorityVersions; queued-policy adversary becomes unknown after the fixture throws. Security owns review. |
| `tests/openai-live-production.test.ts` |2|Production fictional owners need explicit verified state; global HTTPS rejection now precedes the older broker-only status. |
| `tests/openai-live.test.ts` |1|Production TLS guard precedes expected demo404. |
| `tests/production-security.test.ts` |1|Readiness still expects9migrations rather than current11. |
| `tests/qa-network-api.test.ts` |17|Shared register201fixture; subsequent contract assertions must remain adversarial. |
| `tests/qa-oauth-boundary.test.ts` |4|New production HTTPS/verified-owner prerequisites not represented in the old HTTP fixture. |
| `tests/qa-runtime-account.test.ts` |2|Old registration session and missing deletion reauthentication prevent the intended boundary; one timeout and one401. |
| `tests/review-context-races.test.ts` |1|Export lacks new recent reauthentication, so the expected export payload is absent. |
| `apps/mobile/test/connection.test.ts` |3|SecureStore mock lacks new WHEN_UNLOCKED_THIS_DEVICE_ONLY constant; no evidence that real storage failed. |

These are classifications from failure traces and source inspection, not a permission to weaken production guards or replace expected authorization behavior. Root assigned disjoint repairs. Only the OAuth fixture and SecureStore mock were authorized for this reviewer to change.

## Other complete gates

| Command | Actual result |
| --- | --- |
| `npm run typecheck` |Passed server and mobile TypeScript. |
| `npm run typecheck:e2e` |Passed. |
| `npm run lint` |Exit0, **0 errors and 251 warnings**. Existing warnings remain visible; this is not a zero-warning lint claim. Log `.data/m2-final-lint.log`. |
| `npm run format:check` |Passed all matched files. Log `.data/m2-final-format.log`. |
| `npm run test:components -- --runInBand --json --outputFile=.data/m2-final-components.json` |**59/59across7suites**,10.976seconds. Includes this reviewer's panel tests and peers' independent frontend/native-panel cases; no self-certification implied. |

## Root wiring observations

The current App branches between one-action launch, account proof entry and the subsequent workspace. It keys session-owned content/cache by authentication scope. The current NetworkAgentWorkspace reads network identity directly; it does not poll the legacy bootstrap. Account deletion/sign-out callbacks clear the client credential, while normal sign-out requests Live closure and server logout. The shared client validates registration as a generic account request result rather than a bearer response and applies the new native Keychain accessibility policy.

A source-level P2 candidate was reported to root: Application renders account-proof AuthScreen without a key based on the proof, while AuthScreen initializes mode from initialLink only once. A second incoming proof of another kind during an existing proof screen can retain the previous mode/endpoint. Root owns the source fix; this reviewer has not changed it or claimed a passing regression yet.

The browser focus-return regression also exposed an owned callsite issue: a changing DetailSheet key unmounted a still-open instance, defeating the root's closed-state restoration guard. The changing key was removed; Platform independently verifies actual Close/Escape behavior in its final export. This is not counted as independent certification by this report.

## Authorized fixture adjustments

- OAuth uses a trusted loopback proxy with HTTPS forwarding and explicitly verified fictional owners. Before marking each owner verified, the fixture asserts that the production endpoint rejects the same authenticated unverified owner with email_verification_required. Cookie mismatch, one-use exchange, provider-call and profile-input assertions remain intact. Peer status must actually return200before its disconnected state is assessed.
- Connection tests expose the real SDK's WHEN_UNLOCKED_THIS_DEVICE_ONLY constant in their SecureStore mock; storage behavior and origin-isolation assertions remain unchanged.

Targeted rerun and final integration results are recorded below when complete. Full unit rerun is deliberately held until root confirms all fixture/source repairs are complete.

## Authorized fixture rerun

`npx vitest run tests/qa-oauth-boundary.test.ts apps/mobile/test/connection.test.ts --reporter=json --outputFile=.data/m2-fixture-qa-tests.json`: **8/8 passed** (4OAuth/profile,4connection). No production guard was disabled. The OAuth fixture explicitly proves authenticated unverified owners are denied before its fictional verification seed; successful peer-status checks cannot pass through a403. The secure-storage fixture only adds the installed SDK constant. Scoped Prettier passes; scoped ESLint exits0with existing explicit-any warnings in connection tests.

## Pause checkpoint — focus remains open

Root requested this worker pause after current diagnostics. No further full gates or shared primitive edits were started.

Platform's fresh browser run still failed the retained request-trigger focus assertion after Close/Escape, including after Inbox stopped changing the DetailSheet key. Thus removing the changing key was insufficient; no passing focus-return claim is made.

Installed React Native Web source shows `Modal/index.js` invokes its `onDismiss` callback after `removeActiveModal`, and `ModalAnimation.js` invokes dismissal after its rendered state becomes false. The current shared DetailSheet restores native focus from onDismiss but attempts web restoration only from effect cleanup after two animation frames. Using the actual web dismissal lifecycle is a concrete next diagnostic/fix candidate; it has **not** been verified as the repair. Platform was asked to capture active element, intended row connection/disabled state, ancestor inert/aria-hidden state and direct-focus diagnostics without changing the failing assertion. No such final metrics were yet received by this worker at pause.

Changes during this gate: authorized OAuth production fixture and SecureStore mock only, plus the earlier owned Inbox changing-key removal. No shared primitive, root Auth source, provider configuration, preview process, deployment or external service was changed by this worker. Initial full unit results remain failing until the assigned owners complete repairs and a later authorized gate runs.

## Resumed follow-up

Root resumed the remaining repairs on 29 October. Account-proof replacement, immediate request presentation, actual-dismissal/current-row focus restoration and compact enlarged-text navigation are implemented and verified by targeted regressions. Independent rapid Calendar Escape now passes; full browser acceptance is tracked in [the follow-up report](focus-auth-navigation-followup.md). The earlier pause/failure record above remains historical evidence, not the current fix status.

## Final resumed integration evidence

The orchestrator's saved final unit artifact `.data/resumed-final-unit.json` was inspected: **838 passed, 0 failed, 24 pending opt-in PostgreSQL cases across 80 files**. Its process timing artifact records exit 0 and **92.8709347 seconds**, meeting the 120-second target on this run. The earlier 51 failures are retained above as repaired integration history.

Final component artifact/log: **65/65 across 10 suites**,9.305 seconds. Final server/mobile TypeScript and formatting logs pass; lint has0 errors and 251 warnings. Platform's frozen-export full browser artifact records55 expected cases,0 unexpected,0 skipped,0 flaky,99.761803 seconds. Those are independently executed artifacts, not this worker's independent certification of its own frontend code. Final test-only enlarged-row screenshot strengthening is tracked in [the follow-up report](focus-auth-navigation-followup.md).

Final enlarged-row evidence follow-up: Platform's two strengthened long-list cases passed **2/2 in 12.440 seconds** on the unchanged browser export, including actual final-row font doubling and viewport visibility. Full browser55/55 and strengthened2/2 are complementary checks; no product source changed between them. The focus/account/navigation follow-up is frozen with no remaining source edits from this worker. Device/service release limits remain as documented.
