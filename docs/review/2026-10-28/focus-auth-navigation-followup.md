# Focus, account-proof and enlarged-navigation follow-up

Date: 29 October 2026. Owner: `/root/quality`. Root explicitly resumed this work after the earlier pause. Production changes are frozen for Platform's independent final browser run; this report does not independently certify this worker's own frontend implementation.

## Exact source changes

- `apps/mobile/App.tsx`: account-proof entry receives a numeric generation key on every accepted incoming proof. A new proof remounts the form and clears the old password/mode/in-flight UI callback. Raw proof tokens are not used as React keys. `AuthScreen.tsx` required no source modification.
- `apps/mobile/src/components/primitives.tsx`: DetailSheet restores web focus from actual Modal dismissal rather than guessed cleanup frame timing; it checks mounted/closed state, resolves an optional current DOM target by ID, and retains native ref-based onDismiss behavior. Native VoiceOver behavior is still unverified.
- `apps/mobile/src/features/network/InboxPanel.tsx`: clicking a request immediately presents its recorded list data. A fresh detail GET updates the cache only; it can no longer select/reopen a sheet after Close/Escape. Seeding does not replace a higher known detail revision with an older list revision. Focus follows the last opened request, including a Calendar/deep-link entry, and uses an owner-scoped nativeID to find the current row after virtualization/ref replacement.
- `apps/mobile/src/features/network/Workspace.tsx`: navigation uses one horizontal scroll row, preserves full labels/text scaling, keeps numeric unread badges, and reveals the selected tab. It retains arrow-key focus and visible focus outlines. It no longer consumes multiple vertical rows at enlarged text. This changes the navigation layout; root should include it in the design decision record.

## Regression and fixture changes

- New `apps/mobile/component-test/account-link.component.test.tsx`: renders the actual App URL-event wiring with injected transport/native boundaries. Verify→reset clears the prior password and uses the reset endpoint; a late old verify completion cannot dismiss the new reset form. **2/2 pass**.
- New `apps/mobile/component-test/detail-lifecycle.component.test.tsx`: opens a recorded request while its fresh detail GET is pending, closes it, then resolves success or failure. Neither late outcome reopens it or causes another GET. **2/2 pass**.
- `apps/mobile/component-test/setup.ts`: injects the OS notification scheduler/permission boundary and a no-op authentication-change subscription at Security's request. Permission prompts throw unless a test explicitly supplies one; no real notification is scheduled by these tests.
- `e2e/browser/network-workspace.spec.ts`: preserves direct Close/Enter/Escape focus checks; the long 80-row Memory test now explicitly uses320 × 740 with 200% text and asserts navigation height below 140 px while retaining over 280 px of content height. The manual-reply case explicitly refreshes Inbox before opening the new request, avoiding a race against the documented ten-second polling interval; no focus assertion or outcome check was removed.
- `e2e/browser/qa-network-navigation.spec.ts`: formatted at root's request. Platform owns its independent assertions and diagnostic additions. No delay or first-close focus wait was inserted into the rapid Calendar→Close→row reopen→Escape case.

## Observed verification

- Mobile TypeScript and scoped ESLint pass after the final source changes. E2E TypeScript passes.
- Targeted rendered command `npx jest --config apps/mobile/component-test/jest.config.cjs --runInBand detail-lifecycle.component account-link.component`: **4/4 across 2 suites**,3.051 seconds.
- Fresh Expo web export succeeded (605 modules, approximately 1.7 MB). Earlier scoped browser checks passed the long enlarged collection and direct question Close/Enter/Escape/counterproposal flow.
- Independent full browser iteration initially found 54/55 passing, with the rapid Calendar-origin focus case still failing. Failure-only DOM diagnostics established that a connected, enabled current row could be focused manually. A prior iteration showed a new sheet opening after Escape; immediate recorded-data presentation removed that state race. Current-node lookup then repaired restoration after row replacement.
- Platform's unchanged rapid Calendar test passed **1/1**,16.8 seconds, on fresh bundle `index-a5dda7b45b0d40a7b6300b310ffa74e6.js` with the final lookup fix. Platform is running the complete 55-case suite on that same export; its final result is separate evidence and must be recorded before a whole-browser acceptance claim.
- Full component checking briefly exposed reminder-integration fixture gaps (notification SDK import side effects, then a missing onSessionChange in a peer's local API mock). These were reported to Security/Platform and addressed through explicit OS/API fixtures rather than production bypasses. Root owns the final combined component gate.

## Limits

All exercised data is fictional and all API services are isolated loopback fixtures. No user preview process was stopped by this worker, no credentials were changed, and no deployment, paid provider, actual SMTP, device notification, microphone or physical iPhone was operated. Browser text-spacing checks do not establish native Dynamic Type, VoiceOver or WCAG conformance. Current screenshots are browser evidence; Platform independently inspects the 320 px enlarged-text result.

## Final integration artifacts inspected

The orchestrator's final saved artifacts supersede the initial integration failure record:

- `.data/resumed-final-unit.json`: **838 passed, 0 failed, 24 pending PostgreSQL opt-in tests**,80 files. `.data/resumed-final-unit-timing.json` records exit 0 and **92.8709347 seconds** process wall time, meeting the 120-second target for this run.
- `.data/resumed-final-components.json` and log: **65/65 across 10 suites**,9.305 seconds. This includes the new account-proof and delayed-detail regressions plus peers' independent checks.
- Final TypeScript and formatting logs pass. Final lint remains exit0with **0 errors / 251 warnings**; no zero-warning claim is made.
- Platform's complete browser result for the frozen `index-a5dda7b45b0d40a7b6300b310ffa74e6.js` export: **55/55**,99.761803 seconds,0 skips/flakes/retries. The unchanged rapid Calendar Close→reopen→Escape case passes.

A test-only evidence precision improvement follows that full run: both long-list cases enlarge the final newly mounted row again, re-scroll it into view and verify its actual doubled font. This avoids claiming that a row which mounted after the previous helper pass had already been enlarged. No product source or bundle changes are involved; Platform owns the affected-case rerun and refreshed screenshots.

### Strengthened final-row result

Platform reran only the two affected long-list cases against the unchanged a5dda7 export: **2/2 passed in 12.440 seconds**. Both cases now scale the final mounted batch again, verify actual computed font size is twice its original size, re-scroll and assert viewport visibility. Platform inspected the refreshed independent screenshot and confirmed row80 is visibly enlarged. E2E TypeScript and lint pass. No product source, bundle or outcome assertion changed after the 55-case full run.
