# Internal calendar worker report

27 October 2026. This is implementation evidence for the internal-calendar slice, not final release certification.

## Changed files and interfaces

- `apps/server/src/network/calendar.ts`: `InternalCalendar` implements the frozen availability, commit, list, cancellation and reminder-dismissal methods.
- `apps/mobile/src/features/network/CalendarPanel.tsx`: agenda, agreement details, acceptance provenance, owner reminders, cancellation confirmation and recovery feedback.
- `tests/network-calendar.test.ts`: 28 focused backend cases using fictional members and embedded PostgreSQL/PGlite; no provider transport or external effects.

Shared API/domain/dependency files were not edited by this worker. Coordination agreed on persisted conversation proposal/acceptances before commit, `networkReceiptId` owner approval receipts, private policy lookup by owner-scoped list, and processing state before commit. Root owns API/navigation/build integration.

## Implemented checks and behavior

Commit runs inside a caller-owned transaction and locks active owner rows in lexical order through `lockNetworkOwners`. It independently rereads the conversation, both current private policies and accepted connection, validates current versions/expiry/scope, exact candidate terms and canonical hash, both matching acceptances, and an exact durable receipt for owner approval. Agent prose is never acceptance. Obligations remain disallowed by the shared schema. Availability is rechecked while owner database locks serialize overlapping requests; no JavaScript mutex or tentative reservation is used by this module.

The event ID is deterministic for a conversation. One event, per-owner reminders and per-owner internal outbox records commit together. A matching duplicate delivery returns the existing event without recreating effects. Restart recovery was tested with a persistent encrypted database closed and reopened. The outbox is internal persistence; it does not send anything externally or establish notification delivery.

Routine working hours, duration, notice and horizon constrain `delegation_rule` acceptance through the coordinator's timezone-aware helper. Following the root's explicit integration decision, the initiator's exact original candidate or a recipient's exact durable owner approval may accept outside routine scheduling preferences; enabled/current/unexpired policy, trusted connection, meeting capability and exact terms are still mandatory. The current schema rejects overnight policy windows. DST repeated-hour intervals, an interval crossing a sub-minute closing boundary, and overnight-window rejection are covered.

Calendar reads lock the authenticated owner before projection, enabling root's request-principal/session recheck and a consistent read against cancellation. They expose participating shared agreements and only that owner's reminders. Due status is derived on read and makes no push-delivery assertion. Cancellation requires a current common revision and atomically updates the event, both owners' reminders, both internal outbox notices and the canonical conversation summary/state. Changed material terms require a new request and new acceptances.

The panel reuses semantic shared components, flexible text, labeled controls and status words in addition to colors. Inline cancellation confirmation explains the impact on both participants. Async response application is fenced by mounted identity generation, request sequence and the existing API session snapshot. If the write succeeds but refresh fails, the panel reports that the change was saved and requests a refresh rather than implying it failed. There is no unilateral editing UI or unsupported change-proposal action.

## Commands actually run

| Command | Observed result |
| --- | --- |
| `npm exec -- vitest run tests/network-calendar.test.ts` | Initial 25/25 passed, 28.72 seconds. Subsequent tests expanded coverage. |
| `npm exec -- vitest run tests/network-calendar.test.ts tests/network-coordination.test.ts` | Final run: 2 files, 35/35 passed, 33.02 seconds (28 calendar and 7 coordinator cases). |
| `npm run typecheck` | Final run passed server/shared TypeScript and mobile TypeScript, exit 0. Earlier run encountered the concurrently unfinished InboxPanel; that dependency was subsequently implemented. |
| `Get-Command ruflo -ErrorAction SilentlyContinue`; `Test-Path node_modules/.bin/ruflo.cmd` | No installed executable found; local package check returned False. No package installed or fetched. |
| `git diff --check -- apps/server/src/network/calendar.ts tests/network-calendar.test.ts apps/mobile/src/features/network/CalendarPanel.tsx` | Unavailable: this workspace has no Git metadata; Git produced its no-index usage output. This is not a passing diff check. |

The installed iOS accessibility and Verification & Quality Assurance skills were read and applied to equivalent RN semantics and project-owned verification. Ruflo truth-score/automatic rollback examples are explicitly aspirational in that skill; none were run or claimed.

## Remaining independent gates

- Root owns the integrated Expo export/build lease. This worker did not run an export or modify generated build output.
- Separate real PostgreSQL processes/connections must verify transaction contention independently; the focused concurrency test uses PGlite's embedded transaction serialization. Database owner-lock statements are asserted, but that alone is not proof of multi-process behavior.
- Actual browser agenda rendering, 320/390/430 reflow, enlarged text, keyboard/focus journeys and session-switch UI adversarial tests remain for integrated QA.
- Physical iPhone, VoiceOver, Switch Control and Dynamic Type verification remain unrun. Shared semantics and static type checks do not establish accessibility conformance.
- No push/device calendar integration, real model request, network request or external provider effect was performed by this worker.

All four leased files are released to the root for integration and independent QA.
