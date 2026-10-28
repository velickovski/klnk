# Internal coordination implementation

27 October 2026. Local implementation evidence; independent review and release gates remain separate.

Changed `apps/server/src/network/coordination.ts`, `apps/server/src/network/policy.ts`, and `tests/network-coordination.test.ts`. Shared domain/store/migration and calendar integration remain their assigned owners' work.

Implemented opaque member-code invitations with explicit acceptance, decline, block, directional inbound and mute controls. Private policies and owner-confirmed memory have version checks and encrypted persistence. Independent recipient tasks survive service reconstruction and use sorted PostgreSQL owner locks, reread claims and atomic local steps. Per-owner request UUIDs deduplicate exact retries and reject changed instructions. Incoming requests are bounded to 20 per source/recipient/hour and 100 pending recipient requests.

Information delivery preserves the exact message and grants no scheduling authority. Questions disclose only selected, confirmed, unexpired owner-authored memories explicitly scoped to the initiating member and topic. No peer policy or private memory enters a shared message. Public conversations project only the viewer's policy revision; canonical acceptance evidence retains its policy version.

Meeting search checks at most three submitted UTC/IANA slots, prefers a slot within the recipient's routine grant, and asks the recipient to approve an exact available fallback. Initiators accept only exact submitted terms; recipients accept by a current rule or a durable authenticated exact-proposal approval receipt. The calendar independently validates these records. Explicit owner consent can make a scheduling-window exception; it cannot override account, connection, capability, topic, policy revision, expiry, canonical terms, or availability checks. Started slots are rejected. Policy/relationship changes stop pending work and require a new request; pause/resume never refreshes immutable authority. Pending decisions expire without an owner returning. There are no external transports or model calls in these modules.

Checks actually run:

- Initial I1 test run failed because coordination implementation was absent (expected first red test).
- `npx vitest run tests/network-coordination.test.ts tests/network-calendar.test.ts --maxWorkers=1 --no-file-parallelism`: **38 passed / 2 files**, 36.47 seconds, after integration fixes. Ten coordination cases cover exact delivery, duplicate mutation rejection, unknown/blocked/muted/foreign identities, policy revocation, private memory isolation, independent worker reconstruction/concurrent ticks, matching acceptance, explicit scheduling exceptions, automatic slot preference, offline approval expiry, bounded no-progress and cancellation through request control.
- `npx tsc --noEmit` passed before the subsequent root-owned `voice-tools.ts` import was introduced; the most recent concurrent typecheck failed only because that newly referenced root file was not yet written. Coordination's own TypeScript errors were fixed before the combined run.

The tests above use PGlite, an embedded PostgreSQL engine with transaction serialization in the existing Database wrapper. They are not evidence of independent PostgreSQL server processes or competing database connections; that concurrency gate belongs to independent QA. The code uses database row locks rather than a process-local mutex. No actual model, telephone, external calendar, notification delivery, iPhone or assistive-technology check was run here. Ruflo/SPARC/verification skills informed ownership, test-first slices and concrete evidence; no Ruflo runtime was installed or invoked.

Interface additions communicated to root: `findRequest(owner,requestId)` provides lost-response readback. Connection mutation supports the root's `{action,version}` wire shape. Waiting decision tasks use internal task status `waiting`; worker ticks rotate waiting records and prioritize queued effects. Root owns readiness visibility, request ALS authentication, integration and final acceptance.
