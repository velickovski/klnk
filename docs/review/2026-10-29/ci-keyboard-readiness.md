# CI keyboard readiness audit

Date: 29 October 2026. Worker: `/root/quality`. CI run:40805487936.

## Confirmed cause

The failing `qa-network-navigation.spec.ts` keyboard case focused Add network memory immediately after lazy Memory navigation. Source inspection shows Add is intentionally disabled until both memories and connections have loaded (`loaded = memoryQuery.data !== undefined && peopleQuery.data !== undefined`), or while its panel task is busy.

The downloaded CI trace independently confirms the missing readiness condition:

- Focus call `fuqy@14099` began at93468.884ms.
- At93473.907ms Playwright resolved the intended element as a **disabled button**, `tabindex=-1`, `aria-disabled=true`.
- The focus call returned at93475.121ms without an error.
- Enter was sent at93476.567ms; the editor never opened. The eventual failure snapshot shows Add enabled and Memory loaded, which does not establish that it was enabled at the earlier focus attempt.
- The Memory GET started at93465.303ms and took10.195ms. Its completion overlapped this focus attempt; DOM/query readiness cannot be inferred from the request having started or subsequently completed.

This evidence supports a fixture readiness omission, not another demonstrated product focus-steal defect. No product source changes are authorized or needed for this repair.

## Authorized fixture change

The shared keyboard sequence in `e2e/browser/network.spec.ts` now performs:

1. Assert the actual Add button is enabled.
2. Focus it.
3. Assert it actually received focus.
4. Send Enter immediately.

That single shared site covers all six320/390/430px light/dark cases. Other Add uses in the file use Playwright click, which already performs an enabled actionability check. The large-text, replacement-input, keyboard, visibility and outcome assertions remain intact. No heading wait, fixed sleep, changed timeout or relaxed font threshold was added.

Platform owns the independent QA case and its held-Memory-GET disabled→enabled regression. Its held response preserves actual production data and proves the readiness barrier before the same focus→Enter sequence. Product source remains unchanged.

## Evidence and checks

The CI trace was read from `.data/ci-third-artifact/.data/e2e-results/qa-network-navigation-inde-c33fa-eal-tab-keyboard-navigation/trace.zip` and extracted only into ignored `.data/quality-ci-third-trace` for inspection. Trace JSON, rather than the late screenshot alone, determined the cause.

Scoped E2E TypeScript, ESLint and formatting pass for the authorized fixture patch. Platform owns isolated browser ports4102/8083 and the complete bundled-Chromium rerun after the fixture freeze; final observed results are appended below when available. No user preview, provider, phone, SMTP or native-device action was performed by this worker.

## Final local browser result

Platform's saved `.data/ci-fourth-local-browser.json` was inspected: **56/56 passed**, **129.125 seconds**, zero skipped, unexpected or flaky cases and no retries. The full run includes all six layout readiness sequences and the held-Memory-GET proof integrated into the existing QA case. No product source changed. Isolated fixture ports4102/8083 stopped after the run. Remote CI acceptance remains a separate check after push.
