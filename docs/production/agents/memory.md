# Memory agent

**Prerequisites:** Parent completes the M1 mechanical People/Memory split and supplies validated memory/scope contracts. Coordinate authorization-sensitive behavior with Requests and Integrations through the parent.

**Owned files:** New `apps/mobile/src/features/memory/` screen/editor files and dedicated `apps/mobile/test/memory*.test.ts` regressions. Do not edit shared `people-memory.tsx`, App wiring, People or server/domain files; request contract corrections from the parent.

**Work:** Polish the existing memory list, filters, search and editor. Make source, confirmation, relationship/request scope, disclosure and expiry understandable. Distinguish empty collection from no search matches. Preserve dirty edits and explain failed saves. Keep proposed/conflicting claims separate from confirmed facts. A remembered preference or permission must not become new execution authority. Editing/deleting memory must not rewrite an already authorized request snapshot. Measure substantial collections and coordinate pagination if needed.

**Tests:** Memory scenarios: create/edit/delete fictional memories; all/review/private filtering; source preservation; failed save; relationship removal; expired memory; unsaved dismissal. Verify via server-backed request fixtures that private, unrelated, unconfirmed, conflicting and expired context is excluded, and scoped allowed context is included only as permitted. Test permission-memory non-authorization and account isolation.

**Done/report:** Rendered provenance/disclosure remain legible at large text and with assistive technology; meaningful context regressions pass. Report files, requested contracts, actual commands, sanitized evidence and unresolved backend/device dependencies to the parent.
