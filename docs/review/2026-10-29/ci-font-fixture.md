# CI browser text-accommodation repair

Date: 29 October 2026. Worker: `/root/quality`. This changes browser test fixtures and evidence only. Production screens, credentials, providers and preview ports 4000/8081 are untouched.

## Failure and repair

CI run 40799632809 exposed six layout failures: newly rendered Memory inputs had 17 px text after the one-shot enlargement helper had already run. The fixture enlarged only the nodes mounted at that moment; React later replaced fields and styles.

`e2e/browser/network-helpers.ts` now exports a persistent `enlargeTextAndSpacing`. It applies a separate test stylesheet, observes inserted/replaced text and controls plus relevant style/class changes, and measures natural font sizes before applying 2× text. React retains its natural inline styles. Repeated helper calls with unchanged paragraph options are idempotent. `data-klnk-qa-base-font` remains available for actual-style assertions.

Verification found a second fixture issue. The app's reduced-motion rule uses a 0.01 ms transition duration; with the default transition property, changing a font override can start a tiny font transition. A synchronous baseline read then sees the previous enlarged value even after the accommodation sheet is physically removed. Reusing that value compounds successive passes. A separate persistent test-only rule disables transition properties and animation names while baseline measurements occur. This rule remains active when the font accommodation sheet is detached.

Security independently reproduced the mechanism in bundled Chromium: detachment alone produced natural measurements 17→34→68→136→…8704. With the separate transition rule, ten iterations remained natural 17 px / actual 34 px, including inherited descendants and unrelated DOM mutations. No product font-growth defect or product source change is implied by this fixture finding.

## Exact files

- `e2e/browser/network-helpers.ts`: persistent text accommodation and stable natural-size measurement.
- `e2e/browser/network.spec.ts`: uses that helper; retains all six 34 px field assertions and target/layout assertions; adds actual React editor discard/remount/focus/typing checks. A new focused fixture case covers replacement inputs, inherited text without compounded scaling, natural 20 px → actual 40 px changes and eight unrelated mutations. Failures retain font-source attachments; passing cases attach final input font/line-height/spacing metadata.
- `e2e/browser/network-workspace.spec.ts`: uses the persistent helper. Long-collection scrolling uses 16/32/50 ms condition-poll intervals with the same ten-second deadline. Persistently enlarged 80-row collections require more scroll batches than the prior partially enlarged fixture; no timeout or font threshold was relaxed.

Platform owns the independent long-collection/Calendar regression file and its associated production request-state fix. Its changes are reviewed separately.

## Commands and observed evidence

- E2E TypeScript, scoped ESLint and scoped Prettier checks pass.
- With both `KLNK_E2E_CHANNEL` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` unset, `npx playwright test e2e/browser/network.spec.ts --grep 'NETWORK layout|text fixture' --max-failures=2` passed **7/7 in 19.4 seconds** using Playwright's installed bundled Chromium. This includes 320/390/430 px light and dark layouts, actual 34 px new Memory controls, and the fixture regression. No retry or provider call was used.
- Earlier diagnosis runs deliberately retained failures for compounded fonts and captured source evidence. Physical detachment alone did not repair the transition issue; this report does not attribute the defect to a generic CSSStyleSheet disabled-state failure.
- Platform is running the full 56-case bundled-Chromium suite against the same current product export. Its final result is the independent acceptance evidence.

The full run loaded the behavioral tests before a final attachment-only addition. It exercises the same font/remount assertions; the added pass-case metadata attachment will also be present in subsequent CI. No product or assertion behavior changed after the helper freeze.

## Boundaries

These are browser fixture results with fictional accounts and local isolated API services. They establish neither physical iPhone typography/assistive-input verification nor a WCAG conformance claim. The retained legacy one-shot helper remains unchanged for legacy tests. No user preview process was restarted by this worker, and no real audio, calling, email or notification service was invoked.

## Additional real keyboard handoff race

The first complete bundled run with persistent scaling passed55/56cases and exposed a separate real Workspace race: after keyboard tab activation, the owner focused Add memory, but a deferred heading announcement could take focus before Enter. Platform repaired the heading RAF guard to preserve a control already focused inside the new panel or active dialog, while keeping deliberate arrow-tab behavior. The existing six rapid focus+Enter layout cases remain unchanged; no heading wait, sleep or relaxed font assertion was added. The final full bundled run must include this production guard.

## Final bundled browser acceptance

Platform's final independent saved artifact `.data/ci-bundled-final.json` records **56 expected,0unexpected,0skipped,0flaky**, **110.505631 seconds**. All six rapid keyboard layout cases pass unchanged after the Workspace focus guard; the new persistent-fixture regression also passes. No retry was used.

The six `network-input-font-metrics` attachments were inspected directly. Every320/390/430px light/dark case records natural **17px**, actual **34px**, line height **51px**, letter spacing **4.08px** and word spacing **5.44px** on the replacement Memory control after typing. These are actual computed values, not only evidence that a helper function was invoked.

Source and tests are frozen with no remaining edits from this worker. Root owns final integrated gates, preview refresh, push and remote CI confirmation. This local browser acceptance is not a remote-CI or physical-device claim.
