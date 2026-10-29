# M2 Network implementation report

Owner: `/root/platform`. Code is ready for independent QA; this implementation report does not certify the milestone.

## Implemented behavior

- Exact `inform` messages between accepted members no longer require enabled autonomy, mutual policy trust, topic matching or an unexpired delegation. Current accounts, recipient inbound permission, request expiry and explicit message opt-out still govern delivery.
- Questions without a permitted automatic answer wait in the recipient's Inbox. Only that recipient may publish a personal answer against the current conversation version. Shared memories remain unavailable unless the recipient's current original operation epoch and explicit scope permit automatic disclosure.
- Mute affects notifications only, including suppression of older pending notices. It does not invalidate queued requests or change the connection's authority epoch. Blocking, removal and inbound permission changes still fence work.
- Declined/removed connections can be invited again in either direction. A stable storage pair is preserved while logical invitation direction changes. Unblock removes only the acting owner's block and never silently restores accepted consent.
- Separate operation authority epochs preserve meetings across unrelated question/reminder edits without rewriting old owner approval receipts. Current edit revisions remain available for optimistic forms and audit. Revoking and regranting a meeting rule cannot revive an old request.
- A meeting decision owner can counterpropose a future free time. New proposal version/hash and fresh personal receipt replace all old acceptances. An alternate slot can commit only after both owners personally approve the new exact terms. Original request acceptance never carries over to the new time.
- Owners can add/edit/remove private busy intervals with version checks. Calendar availability checks include these intervals, including the final atomic commit.
- Automatic recipient meeting acceptance requires an explicit maintained manual-calendar source covering the complete proposed slot. An empty calendar is not treated as a source. Without one, the exact recipient owner decision is required. A new source does not retroactively approve an already waiting proposal.
- Public conversation/calendar projections omit the peer's private authority epoch. Raw source policy/memory and private busy labels are not disclosed to the peer.

## Files changed

Application: `network/coordination.ts`, `network/policy.ts`, `network/calendar.ts`, `network/preferences.ts` under `apps/server/src/`.

New regressions: `tests/network-completeness.test.ts` (14 tests), plus two actual PostgreSQL concurrency cases in `tests/qa-network-postgres.test.ts`.

Existing compatibility fixtures updated: `tests/network-api.test.ts`, `tests/network-calendar.test.ts`, `tests/network-coordination.test.ts`, `tests/qa-network-api.test.ts`, `tests/qa-network-postgres.test.ts`, `tests/worker-reliability.test.ts`. Fixture helpers omit server-owned authority metadata; autoaccept fixtures explicitly acknowledge their fictional manual availability. Historical assertions that mute or disabling autonomy must block an exact information message were replaced with the current message opt-out/block/inbound safety checks.

## Root-owned shared integration

Root supplied the approved optional domain fields for connection/policy/conversation/acceptance authority epochs, removed connection state, busy/availability records, answer and counterproposal inputs, and migration 010.

Implemented method signatures:

- `coordinator.answer(owner, id, { version, answer })`
- `coordinator.counterpropose(owner, id, { version, slot })`
- `calendar.saveBusy(owner, input, id?, expectedVersion?)`
- `calendar.deleteBusy(owner, id, expectedVersion)`
- `calendar.confirmAvailability(owner, { confirmedThrough })`

Trusted `submit` guards now accept optional `authorityVersion` and `connectionAuthorityVersion`; new OwnerIntent receipts can preserve unrelated setting/mute edits. Old receipts without these fields retain strict revision fallback checks.

Root owns authenticated route/client wiring, busy/availability account export/deletion/restore handling, and private peer epoch redaction in exported conversation/event records. Security owns OwnerIntent/voice projection adoption and its fixtures. Frontend owns question/counterproposal/busy/source controls, reminders and policy renewal UI.

## Commands and results

| Command | Result |
| --- | --- |
| `npx vitest run tests/network-completeness.test.ts tests/network-coordination.test.ts tests/network-calendar.test.ts tests/network-api.test.ts tests/qa-network-api.test.ts tests/worker-reliability.test.ts --reporter=json --outputFile=.data/m2-network-tests-final.json` | **82 passed / 6 files**, 0 failed, **24.667 seconds**. Includes all 14 new completeness cases. |
| Explicit private local PostgreSQL fixture, then `npm run test:pg` | **24 passed / 4 files**, 0 skipped, **24.30 seconds**. Includes actual separate-process busy-block lock race and two independent PostgreSQL answer transactions. |
| `npx tsc --noEmit --pretty false` | Passed after shared integration stabilized. |
| Scoped ESLint on four changed network modules, new completeness cases and PG suite | Passed with **0 errors**, 3 pre-existing explicit-any warnings in preferences. |
| Scoped Prettier check/write on changed source and fixtures | Passed. |

Earlier affected-suite/PG attempts exposed historical behavior assertions (mute/autonomy incorrectly expected to block messages, old availability-free autoaccept fixtures) and were not counted as passes. Those fixtures were deliberately updated to the approved product contract while preserving explicit opt-out and locking safety regressions.

The local PostgreSQL fixture was left running for root's separately coordinated isolated M1 CI repair tests; root owns its eventual stop. No external provider, model, email, telephone call or real calendar operation was used in these tests.

## Remaining limits

- Operation epochs are conservative within the same operation. Changing a different trusted member/topic in a meeting rule can still pause a meeting request; per-member/topic revocation epochs are not implemented.
- Manual calendar confirmation is an owner-maintained source. Google/EventKit availability is not connected, and no guarantee about an external calendar is implied.
- Delivery status does not claim recipient reading. A personal answer is distinct from automatic memory disclosure; neither grants meeting authority.
- Notifications remain in-app records here. Foreground refresh, native local alerts, routing and actual device evidence belong to their separate cards.
- Authenticated API/client integration and independent QA must pass before the whole M2 milestone is accepted. These source/PG checks are not physical-iPhone or real-audio evidence.
