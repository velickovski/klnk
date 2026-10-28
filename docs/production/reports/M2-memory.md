# Memory worker — M2

Agent / milestone / status: Memory implementation worker / M2 / local implementation, targeted model/API checks and rendered walkthrough passed; independent acceptance and native gates pending.

Task and owned files:

- [Memory list/editor](../../../apps/mobile/src/features/memory/panel.tsx).
- [Memory model and presentation rules](../../../apps/mobile/src/features/memory/model.ts).
- [Dedicated editor/list regressions](../../../apps/mobile/test/memory-editor.test.ts).
- [Server-backed context regressions](../../../tests/memory-panel-context.test.ts), moved under a narrow parent lease.
- This report. Settings, People, App, API/domain policies and server implementation are outside this lease.

Implemented behavior:

- All, Needs review, Private and Expired filters remain independent. Search covers text, memory kind and source reference. A genuine empty collection is distinct from no matching results; no sample facts are inserted. Lists render at most 50 rows per page, with full-collection filtering, clamped page indices and results-summary focus on page changes.
- Cards separately show claim kind, confirmation, sharing rule, owner/relationship/request scope, provenance reference and expiry. Proposed, unconfirmed and conflicting entries never acquire a confirmed-fact label. Invalid stored expiry is identified and remains excluded from new context. A minute clock updates expiry presentation while the panel is mounted.
- New entries default to private, owner-entered context. Relationship scope requires a deliberately selected current contact; the editor no longer silently chooses the first contact. Removed relationships and unavailable linked requests remain visible and block an invalid save. The relationship picker renders at most 20 matching choices with search for larger contact sets.
- Each editor has its own modal/account draft. Empty text and invalid scope have readable errors. Pending save/delete operations lock fields and choices, suppress duplicate submission and preserve the draft after false acknowledgements or exceptions. Existing parent Save/Discard/Stay registration remains intact.
- The editor preserves the stored expiry without introducing an unvalidated expiry-clear contract. Existing provenance stays visible; copy explains that the server records an owner edit while retaining the previous source reference.
- Permission memories are explicitly described as non-authorizing and excluded from call context. Delete has Confirm/Keep choices and explains that authorized snapshots and conversation copies remain, and pending request execution must be controlled separately.

Shared contracts changed or requested:

- `MemoryEditor.onSave` and optional `onDelete` return `Promise<boolean>`; the parent's existing `perform` callbacks already satisfy these contracts. Parent retains session/account acceptance and modal ownership.
- Shared `Choice.disabled` is used for busy state; inherited controls use explicit web/native semantics from parent primitives. No shared primitive was edited by this worker.
- Discovered a server risk: current memory resources were read after authorization. Parent assigned the Engine fix to Platform/Integrations. Its chosen contract is `authorization.snapshot.selectedContext`, a deep copy of eligible content/source/disclosure. Authorized detail/dispatch use the frozen array; missing legacy snapshots fail closed. This worker's actual API regression confirms post-authorization edits/deletion do not change the frozen content/source or authorization object. Platform owns live-dispatch and expiry-crossing verification.
- Parent approved moving server-backed cases into root tests, where the Node TypeScript environment applies. Both root and mobile typechecks pass without weakening checks or editing server configuration.
- Parent should record bounded pagination, deliberate relationship selection, read-only stored expiry and retained authorized snapshot deletion semantics in the design decision log.

Scenario results at this checkpoint:

| Scenario | Result |
| --- | --- |
| MEMORY-01 | Passed model tests for distinct source/confirmation/scope/disclosure/expiry and four actual isolated API cases for context inclusion/exclusion, source attribution, owner isolation, frozen content/source after edit/delete and permission non-authorization. |
| MEMORY-02 | Passed draft validation/failure/duplicate/late-input locking/deletion retry/isolation and 1,000-memory bounded list tests. Actual browser UI/API CRUD, removed-relationship validation/recovery and 1,000-memory rendering/filter/search also passed. Existing rendered failed-save recovery passed. |
| A11Y-01/02 | Existing keyboard/modal focus restoration passed. Memory pagination focuses its summary. People and Memory passed four 320px/200% text plus spacing layouts across light/dark appearances after the parent's shared badge/icon repair. These observations are not full conformance or native evidence. |
| A11Y-03 | Blocked: no signed iPhone build/device on this Windows host. |

Checks actually run / environment / artifact identity:

- Windows, installed Node/Expo 58/React Native 0.88; fictional fixtures only; no provider effects.
- `npx vitest run apps/mobile/test/memory-editor.test.ts` — **20 passed**.
- `npx vitest run apps/mobile/test/memory-editor.test.ts tests/memory-panel-context.test.ts` — **24 passed**, latest tool timestamp 15:43:23, 27 October 2026. API tests use disposable PGlite memory storage, worker disabled, simulator mode, live gate false and provider keys explicitly absent.
- `npm run typecheck` — **root and mobile passed** after the approved test move. The earlier experimental mobile placement exposed two server-config implicit-any errors; placement was corrected without disabling checks.
- `npm run e2e:build` — passed; exported **`index-aea5930317b2227757aa48a379115963.js`**. The exploratory browser recorded that exact loaded entry.
- `$env:KLNK_E2E_CHANNEL='chrome'; npm run e2e -- --grep 'MEMORY-02|PEOPLE-02|A11Y-01|A11Y-02 320px'` — **5 passed**: Memory/People failure preservation, keyboard modal focus return and ordinary 320px light/dark cross-panel reflow.
- `npx tsx scripts/e2e-server.ts`, then a PowerShell here-string piped to `node --input-type=module` using installed `@playwright/test` — **5 exploratory Memory checks and 4 responsive layouts passed**. Used disposable fixture ports 4102/8083 with provider credentials absent.

Exploratory browser results and artifacts:

- Actual UI/API created a private owner-sourced memory; edited text/confirmation/disclosure; API readback retained the prior source reference.
- The UI saved relationship scope, then a disposable fixture contact was removed through the local API. The list showed Removed relationship, save rejected the stale relationship, and choosing owner context recovered explicitly.
- Delete offered Keep and Confirm; confirmed deletion removed the fictional memory through the actual local API.
- A bootstrap-only presentation fixture supplied 1,000 memories. The rendered UI mounted 50 rows, paged/focused its summary, filtered 500 needing review, distinguished no results, cleared filters and found the last item. Observed update-to-summary time: **50 ms** in headless Chrome on this host; this is not a native performance score.
- Four 320px layouts enlarged rendered text to 200% and applied line height 1.5, letter spacing .12em and word spacing .16em. People/Memory, light/dark each reported document width 320px and zero measured overflowing elements. The previous People badge/icon failure did not recur against this loaded artifact.
- [Sanitized browser metadata](../evidence/panels/memory-evidence/browser-report.json).
- [Memory light screenshot](../evidence/panels/memory-evidence/memory-320-200-light.png), [Memory dark screenshot](../evidence/panels/memory-evidence/memory-320-200-dark.png).
- [People light recheck](../evidence/panels/memory-evidence/people-320-200-light.png), [People dark recheck](../evidence/panels/memory-evidence/people-320-200-dark.png).

Parent-requested final guidance guard check:

- After parent integrated the request EditorGuard callbacks, rebuilt with `npm run e2e:build`; the actually loaded entry was **`index-3cb21e05374637503cabe892cadd66df.js`**. This is separate from the earlier Memory/layout artifact identified above.
- An actual disposable local draft was displayed through explicitly intercepted simulated active bootstrap/detail responses. The guidance endpoint returned a fictional 503. Browser checks passed: failed guidance preserves the unsent instruction; dirty close offers Save/Discard/Stay; Stay retains the draft; explicit Discard closes and reopening is clean. No real call or guidance provider operation ran.
- Initial exploratory assertion used the wrong Playwright role (`header` instead of a heading/text locator); corrected locator passed all three checks without changing application code.
- [Sanitized final guidance metadata](../evidence/panels/memory-evidence/guidance-close-report.json). The fixture server was stopped after this check and ports 4102/8083 were verified free.

Mocked vs real-provider vs browser vs native: deterministic mobile model tests, actual local API/database fixtures and actual rendered browser CRUD were exercised. Scale/layout collections were explicitly mocked at the bootstrap presentation boundary. No real provider, paid session, microphone, phone call, real account or native device was used. Screenshots are visible-viewport evidence, not full-process accessibility certification.

Known defects / limits:

- Independent reviewer acceptance and final integrated whole-product checks remain parent-owned. The local rendered/model/API gates above passed.
- Stored expiry is displayed and preserved; creation/editing/clearing expiry is not added under a schema that currently accepts arbitrary strings.
- Bootstrap still supplies complete memory arrays. Bounded rendering is implemented, server pagination is not.
- Deleting a memory removes its resource, while an already authorized snapshot may retain and use its approved copy. The confirmation now states this explicitly. Account deletion/retention cleanup remain platform-owned.

Dependencies / next action: parent independently reviews the panel and integrates the recorded design decisions, then reruns whole-product checks against the final candidate. Native assistive-technology evaluation requires a compatible device host.

Independent reviewer and review result: requested from parent; pending. This checkpoint does not self-certify M2 or release.
