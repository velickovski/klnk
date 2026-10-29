# Independent workspace frontend QA

**29 October update:** the historical focus gate and cramped large-text navigation below were corrected and independently reverified. The final fresh browser run passed **55/55**, including the unchanged fast Calendar-origin Escape regression. See [resumed verification](../2026-10-29/platform-resumed-qa.md) for bundle identity, observed evidence and remaining device limits. Earlier failures below are retained as history.

Reviewer: `/root/platform`. Quality owns the network panels, cache/provider and navigation implementation; root owns shared primitives and integration. This reviewer implemented AccountPanel and does not certify its account behavior here.

## Added independent checks

`apps/mobile/component-test/qa-frontend.component.test.tsx` renders the actual panels, router, shared theme and session provider with injected HTTP responses. Five checks cover:

- A keyed owner or origin scope change clears private cached memory and unsaved drafts and fetches the new scope rather than retaining the previous response.
- An explicit connection mutation is sent once and invalidates another mounted query consumer.
- Unsaved switches and trust checkboxes expose checked state without changing saved authority.
- A Calendar event navigates through the actual router to its matching Inbox conversation.

`e2e/browser/qa-network-navigation.spec.ts` adds six independent browser journeys against a fresh Expo export and isolated API fixture:

- Exactly one opening action, `Call klnk`, reaches real account entry; registration returns generic pending 202 without a token, and the disabled SMTP message is visible.
- Eighty private memories are created through the actual authenticated API. The actual FlatList renders a bounded initial batch and reaches the last record at 320 px width with 200% text/spacing. A focused unsaved editor survives tab/history return.
- Reloading a join URL requires explicit sign-in, retains the prefilled code and creates no invitation through navigation/history alone.
- Signing out and signing into a different owner in the same page removes old cached rows and private drafts.
- A genuinely agreed internal calendar event opens the matching Inbox request, with Close/Escape focus restoration checked from the Inbox row.
- Keyboard arrow navigation retains focus on the selected tab, and actual browser switch markup reports checked draft state while saved autonomy remains off.

## Findings and resolution

The initial browser switch check found two nested switch roles: a focusable wrapper and an input with the same accessible name. Root removed redundant web wrapper semantics from NativeSwitch while preserving native semantics. The fresh bundle passed the strict single-switch browser query and checked-state assertions.

**Unresolved release gate:** detail-sheet focus restoration still fails after Close/Escape. Root supplied an explicit return-focus ref, Quality wired the actual Inbox row trigger and removed the changing DetailSheet key. The latest fresh-bundle run still failed both Quality's question-dialog Close assertion and this reviewer's Calendar-to-Inbox Escape assertion. The dialogs close, the matching conversations load and the trigger rows remain present, but the rows are inactive. Source owners were notified; no passing claim is based only on source inspection. Additional active-element/ref diagnostics have not been collected before the requested pause.

The first large-text/focused-editor collection run failed to materialize row 80 within the poll window (snapshot showed initial rows and rows 73–74). An unchanged bundle passed on the next run after adding DOM scroll/layout diagnostics, without changing production source, timeout or assertions. Both subsequent fresh bundles also passed. This is retained as an intermittent layout observation; no speculative collection change or conformance claim follows from those reruns.

Visual inspection of the passing 320×740 large-text screenshot showed a remaining usability limit: the header and five wrapped tabs leave approximately 84 px for the content pane at 200% text plus spacing. The final real row is reachable and no horizontal overflow was detected, but this cramped layout is not a claim of excellent large-text usability or accessibility conformance. Root was notified.

## Observed checks

- Independent rendered component suite: **5/5 passed**, latest rerun 3.001 seconds.
- Mobile TypeScript, root TypeScript and E2E TypeScript passed during this review; E2E/root checks were repeated after fixture adaptations.
- Scoped ESLint passed (pre-existing explicit-any warnings remain in assigned server fixtures). Scoped formatting passed.
- Initial browser subset: default account entry and join/history passed; switch duplication and long-list timing failed. The next unchanged-bundle subset passed the real 80-row collection (4.5 seconds) and same-page owner change (1.5 seconds).
- Fresh Expo E2E export passed: **604 modules**, `index-7ab3ee3c6cdbcbdb4fb9fa304470d9a9.js`, **1,693,155 bytes**, SHA-256 `8b99ce1670d076189dc82bb3808b92c80e5fe7b1243e5298481ffdaf03a6699a`.
- Fresh browser network group (`qa-network-navigation.spec.ts`, `network-workspace.spec.ts`, `network.spec.ts`): **21 passed / 2 failed**; both failures are the unresolved detail-sheet focus gate. Independent journeys account for **5 passed / 1 failed**. Saved JSON: `.data/m3-browser-network-initial.json`.
- After parent-authorized retained fixture adaptations, `accessibility.spec.ts`, `boundaries.spec.ts`, `journeys.spec.ts`, `permissions-recovery.spec.ts`: **32/32 passed**, 37.5 seconds, Chrome, one worker, zero retries. Saved JSON: `.data/m3-browser-retained-final.json`.
- Assigned server fixture suites (`api`, `api-lifecycle-server`, `live-gates`, `network-api`, `qa-network-api`): **41/41 passed**, 17.418 seconds. Saved JSON: `.data/m3-platform-fixture-tests.json`.

Retained tests now open the actual Local demo disclosure and explicitly sign in before microphone-denial tests. They use authenticated `/voice/live/status`, preserve capture/paid-start/uncertainty assertions and inspect the current default workspace's typed fallback. Registration fixtures assert generic 202/no token, then explicitly log in through the development API. The request-expiry clock test signs in again after advancing the embedded clock rather than bypassing the new idle-session boundary. No hidden autoverification or authorization weakening was introduced.

Screenshots under `evidence/`: `qa-independent-call-entry.png`, `qa-independent-auth-entry.png`, `qa-independent-memory-80-large-text.png`. These were inspected. Work stopped after the parent requested finishing owned fixture adjustments and pausing further development. **The unresolved focus gate means this report is not release approval.**

## Limits

The browser fixture disables all real providers and SMTP and permits explicit local development sign-in for unverified fixture accounts. Production registration still requires configured email delivery and verification; these journeys do not establish real mailbox delivery.

DOM and rendered-component checks do not establish physical iPhone keyboard, VoiceOver, Dynamic Type, OS permission, native speech or accessibility conformance. The large-text browser override tests reflow and interaction, not full WCAG AA certification. No real microphone, model, email, telephone call, deployment or user preview server was used or changed.
