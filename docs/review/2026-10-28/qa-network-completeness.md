# Independent M2 Network verification

Reviewer: `/root/security`, reviewing the Platform worker's coordination, policy and calendar changes and the root-owned HTTP/export composition. This report does **not** independently certify this reviewer's OwnerIntent or voice implementation.

## Evidence

Added `tests/qa-network-completeness.test.ts`, with seven independent regression cases:

- An automatic answer queued under an old disclosure grant cannot reuse that grant after revocation and regrant. A fresh question can use the current explicitly shared memory, while the original question can still receive a personal answer.
- A material meeting permission revocation/regrant invalidates an already issued personal acceptance; processing creates no calendar event, and resume cannot revive the stale authority.
- Counterproposals can cycle back to the original canonical terms hash without reusing its old proposal version or acceptance. An outsider cannot counterpropose. Only both owners' receipts for the current version produce one matching event in both calendars.
- A private busy block inserted after personal approval is checked again before agreement. Both calendars remain empty, the result is unresolved and no private label appears in the peer readback.
- Adjacent intervals do not falsely conflict. Maintenance confirmation that ends one millisecond before the meeting ends cannot authorize automatic acceptance. The recipient can still personally approve the exact free time.
- Account export includes only the exporting owner's private policy, busy blocks, availability and memory. Shared conversation projection omits the peer's private authority epoch. Deleting one account removes shared meeting text while preserving the remaining owner's independent private calendar data.
- Actual Fastify HTTP routes reject anonymous writes and injected owner IDs, bind busy/availability writes to the bearer, return 404 for a peer's busy-block deletion, and return private calendar state with `Cache-Control: no-store` without exposing it to the peer.

`npx vitest run tests/qa-network-completeness.test.ts tests/network-completeness.test.ts --reporter=json --outputFile=.data/qa-network-completeness-results.json` passed **21/21**: seven independent regressions and fourteen Platform completeness tests. The local JSON report is ignored evidence, not a committed artifact.

ESLint on the new independent suite passed without diagnostics. Root TypeScript and the new file's Prettier check passed after correcting the test configuration field name to the existing `mailEnabled`. An earlier TypeScript run correctly rejected the mistaken `emailDeliveryEnabled` fixture field; that unsuccessful run is not counted as a pass.

No defect was found within these tested cases. Source review also checked that operation epochs are separate from optimistic edit revisions, current authority is rechecked under owner locks, private busy intervals participate in both candidate selection and commit conflict checks, and calendar commit verifies persisted exact proposal/acceptance receipts.

## Boundaries

These tests use the migrated PGlite fixture, actual local coordination and one actual in-process HTTP application. They do not prove real PostgreSQL concurrency, notification delivery, native audio, device behavior or an external calendar integration. They make no provider/model request and send no external message. This is targeted M2 verification, not certification of unimplemented later milestones or this reviewer's own voice/intent changes.
