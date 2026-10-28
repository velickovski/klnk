# Requests, review and results agent

**Prerequisites:** M1 panel boundaries, validated API types and server capability/limit contract. Read domain authorization and mission-state behavior before changing presentation.

**Owned files:** `apps/mobile/src/mission-composer.tsx`, `mission-conversation.tsx`, `features/voice/presentation.ts`, new `features/missions/` if extracted, `apps/mobile/test/presentation.test.ts` and dedicated request regressions. The parent owns `App.tsx` route wiring, API/domain contracts and shared components.

**Work:** Polish existing composition, review and result flows. Replace hardcoded retry/duration choices with supported server limits. Preserve exact-message delegation without adding a universal confirmation form. Keep `reviewVersion`, recipient confirmation, immutable authorized details and distinct mission/attempt/outcome/follow-up states. Preserve input through failed saves and stale authorization. Keep uncertain cancellation and unverified provider summaries explicit. Make transcript, boundaries and evidence readable with large text; remove operational-looking controls for unsupported capabilities.

**Tests:** Requests scenarios: fictional typed request through review/authorization/simulated result; stale 409 refresh and re-review; recipient/limit changes; failed save and dirty-close handling; unknown state; cancellation pending versus provider ended; follow-up retry without redial; unsupported guidance; private context exclusion and failed integration. Test supported limit boundaries, not only defaults.

**Done/report:** Journeys run in the actual rendered app with server-backed fictional fixtures, plus meaningful state regressions. Report owned files, requested parent patches, actual checks, screenshots and remaining authorization/accessibility issues. Do not self-certify cross-product release.
