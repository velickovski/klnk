# Bundled Chromium CI follow-up

Owner: `/root/platform`, coordinated with Quality (text-accommodation fixture) and independent Security review. This follows CI run 40799632809, which passed 46 browser checks and failed nine. The earlier installed-Chrome results remain historical evidence; they did not establish equivalent bundled-Chromium behavior.

## Product correction

The originating Inbox row was disabled while `open()` ran its canonical detail GET through the mutation task. A rapid dismissal could attempt focus while the button was disabled; the later response enabled the row without restoring focus. The CI trace explicitly recorded a disabled/tabIndex -1 trigger before it became enabled but inactive. Security reproduced the lost one-shot focus using bundled Chromium.

`InboxPanel.open()` now seeds the recorded detail immediately and refreshes through `networkApi.read(..., true)`. Its query owns loading/error publication; the read neither locks mutation controls nor commits selection on completion. Actual mutations retain their task lock and the server's hash/version/owner/authority checks. Security independently reviewed that stale displayed approval, answer or counterproposal terms still fail the current server guards rather than silently applying refreshed unseen terms.

Added a rendered regression that holds the GET pending, asserts the originating row remains enabled, dismisses, then releases the late response and verifies no reopening. The browser Calendar regression also holds the reopened detail GET until **after** its unchanged hard Escape/focus assertion. No forced focus or artificial settling delay is used in that browser path; failure diagnostics are passive.

A subsequent full bundled run passed 55/56 and exposed a separate rapid keyboard handoff: the navigator's deferred heading frame could steal focus after the user had already chosen a control in the new panel. `Workspace` now skips that announcement when focus is already inside the active panel or a dialog, for both arrow and ordinary navigation. It still focuses the selected arrow tab when focus remains outside the panel. The original six rapid keyboard layout journeys remain unchanged; the independent keyboard journey also exercises Tab activation followed immediately by Add-memory focus and Enter. No heading wait or sleep was added to mask the race.

## Test-fixture corrections

- The independent 80-row test now reacquires and scrolls its currently mounted row in one DOM operation inside a condition poll. This avoids retaining a detached virtualized node between Playwright's stability check and scroll action. The final computed-font and viewport assertions remain required.
- Scroll-driving poll intervals use frame-scale steps (16/32/50 ms), retaining the same ten-second deadline. With every mounted row actually enlarged, the previous 250 ms scroll cadence advanced only one or two measured rows per poll and stopped before row 80; this was not a request to increase the timeout.
- Quality's persistent text-accommodation helper now applies to newly mounted/replaced controls and virtualized rows. It also suppresses CSS transitions within the fixture: the app's 0.01 ms reduced-motion duration with transition-property `all` caused synchronous natural-size reads to observe the previous enlarged size and compound it repeatedly. Security independently reproduced that measurement effect. The helper regression covers field replacement, inheritance, unrelated mutations and the same short-transition CSS. No product typography was changed for this fixture issue.

## Verification

- Rendered `qa-frontend` plus `detail-lifecycle` suites: **8/8 passed**, 3.737 seconds, including pending-read focusability and late success/failure closure.
- Mobile TypeScript, E2E TypeScript, scoped ESLint and formatting passed.
- Final fresh Expo E2E export: **596 modules reported by Metro**, `index-ce15d069eac9eeb0fa50ab6d7e965cdf.js`, **1,696,603 bytes**, SHA-256 `3740afe8cc921915ca2fc41b47d497e749e1267f3fecd18afb4dce57e0c7904d`.
- Focused bundled-Chromium run: **4/4 passed**, 41.9 seconds: both 80-row cases, question Close/Enter/Escape and the Calendar rapid Escape with its GET still held pending. Metadata: `.data/ci-bundled-focused.json`.
- After the navigator guard, the independent rapid keyboard handoff passed **1/1**, 6.9 seconds. Metadata: `.data/ci-keyboard-focused.json`.

The final full bundled-Chromium run passed **56/56** in **110.506 seconds**, one worker, zero retries/skips/flakes. Metadata is `.data/ci-bundled-final.json`. Both `KLNK_E2E_CHANNEL` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` were unset. The final run includes the fixture replacement/short-transition regression, all six unchanged rapid keyboard layout journeys, actual 200% final-row checks and the held-GET rapid Escape assertion.

Browser fixtures used 4102/8083 and stopped automatically; user preview 4000/8081 was untouched. No provider, notification, microphone, physical device or external delivery action was performed. This is local bundled-Chromium evidence; a new remote CI run remains required. Container and native-device limitations in the earlier reports remain unchanged. Production source and test behavior were frozen after this final run; only report updates followed.

## Third CI: lazy Memory readiness

Run 40805487936 passed the earlier gates, including all 25 PostgreSQL cases, and passed 55/56 browser journeys. Its remaining failure was the independent keyboard journey attempting to open the lazy Memory editor before the initial collection read enabled Add.

The retained trace establishes the condition directly: focus call `fuqy@14099` resolved to a button with `disabled`, `aria-disabled="true"` and `tabindex="-1"` at trace time 93473.907. That focus call returned at 93475.121; the next Enter began at 93476.567. Snapshots through the keypress still contain the disabled Add button and loading copy. The final failure snapshot shows the subsequently enabled button. Quality independently confirmed the same trace evidence. This is a test readiness error rather than evidence of another product focus regression.

Both Add-memory keyboard sites now require the actual enabled condition before focus and assert actual focus before Enter. The independent journey also holds its Memory GET response, asserts Add is disabled, releases the response and waits for it to enable, so this prerequisite is tested deterministically. Its tab arrows, actual Enter activation, editor visibility, checked-state markup and unsaved server-policy assertions remain required. The six layout cases retain their direct navigation/control sequence; no heading wait, fixed sleep or font-assertion change was introduced. Application source and exported JavaScript are unchanged by this repair.

The focused held-GET journey passed **1/1**, test time **1.9 seconds**, total Playwright duration **13.3 seconds**. E2E TypeScript, scoped ESLint and formatting passed. The subsequent full bundled-Chromium run passed **56/56** in **129.125 seconds**, one worker, zero retries/skips/flakes. Its metadata is `.data/ci-fourth-local-browser.json`; both browser override variables were unset. This includes the held-response disabled-to-enabled regression, all six enlarged layout cases and the held-detail-read rapid Escape restoration. Test fixtures stopped automatically; user preview 4000/8081 was untouched. A new remote CI run still needs to verify this test-only correction.
