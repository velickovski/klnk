# Mission and memory model

`src/core.ts` is the shared, runtime-validated contract. A mission is a goal plus approved talking points, a verified relationship, disclosure rules, limits, language settings, calling policy, follow-up declarations, and a versioned authorization snapshot. Templates populate this same model; they do not introduce separate appointment workflows.

The API must resolve `ownerId` from the authenticated session, check every resource's ownership, and persist the snapshot atomically with the job. `authorizeMission` validates recipient identity confirmation, opt-out, concrete replacement time, timezone, timing bounds, and literal private-fact contradictions. It returns a frozen snapshot. `validateCommitment` reads that snapshot rather than current preferences. The backend additionally needs an immutable digest, revocation/version checks, current external state, and action prerequisites before execution. Changes to a draft do not expand an existing authorization.

Literal contradiction detection is a useful validation rule, not a natural-language privacy guarantee. A paraphrase could disclose a secret. A live generative voice agent cannot guarantee that every utterance follows a policy because external tools are restricted. High-consequence commitments require bounded speech flows or owner handling.

## Sources and disclosure

Every memory has an owner, kind, provenance, creation/update time, scope, confirmation state, and disclosure state. Recipient claims and model inferences remain separate from confirmed owner statements. A preference is context; it cannot increase a budget or approve an action. Standing permissions are deliberately excluded from spoken context retrieval and must be interpreted by a separate server policy.

`selectContext` excludes other owners, other relationships, private/ask memories, proposed/conflicting/unconfirmed entries, expired records, and permissions. Owner-scope memory also requires an explicit `neededMemoryIds` selection. Relationship and mission context must match the current recipient/mission. The caller should further select relevant records for the particular goal and show selected facts during review. Source material remains untrusted input even when attached to a mission.

## Simulation evidence

`simulate` never contacts a person or changes external state. Its stable response fixtures demonstrate different conversation outcomes and return `fixture.synthetic: true`. It produces evidence IDs and distinguishes a request, tentative reply, agreement, owner commitment, and action declaration. Actual follow-ups are executed separately by the backend after authorization and prerequisite validation.

The simulator includes no answer, busy, voicemail, wrong person, AI refusal/opt-out, disconnection after a tentative response, instruction injection, and an out-of-bounds counteroffer. The `calendar_failure` scenario produces a confirmed conversation exactly like the normal fixture; the action worker must inject the calendar failure and retry only the pending action. It must never repeat the phone conversation to repair a calendar write.

The cross-language fixture has fixed Spanish originals and separate English translations. Other language pairs return unresolved rather than fabricating translation support. Arbitrary custom requests use the same generic model, but the fixture only returns receipt for review; it does not pretend to understand or satisfy any possible goal.

## Tests

From the repository root: `npx vitest run packages/domain/test/domain.test.ts`. The tests cover resource and relationship scope, source/confirmation restrictions, frozen budgets, recipient verification and opt-out, explicit appointment evidence, diverse mission outcomes, translation separation, privacy attacks, escalation, uncertain outcomes, and truthful intervention restrictions. Backend integration tests are responsible for durable jobs, isolation, signatures, deduplication, and idempotent actions.
