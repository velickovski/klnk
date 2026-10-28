# People agent

**Prerequisites:** Parent completes M1 mechanical split of `people-memory.tsx`, preserving exports and behavior. Confirm ownership and contact contracts before editing.

**Owned files:** New `apps/mobile/src/features/people/` screen/editor files and dedicated `apps/mobile/test/people*.test.ts` regressions. Do not edit `people-memory.tsx`, App route callbacks, shared components or Memory files concurrently; send requested wiring patches to the parent.

**Work:** Refine the existing relationship list, search, empty/no-results states and contact editor using shared tokens. Improve understandable phone validation, contextual errors and save feedback. Preserve drafts during failure and Save/Discard/Stay behavior. Changing a number must clear recipient verification; editing must never undo recipient opt-out. Show removed relationships honestly in linked records. Measure realistic list sizes and coordinate virtualization/pagination through the shared shell contract when needed. Native contact import remains unavailable unless separately implemented with a supported limited-access design and acceptance evidence.

**Tests:** People scenarios: create/edit/delete fictional contact, invalid international number, number change/verification reset, opted-out recipient, missing/removed record, search/no-results, network failure, duplicate submit, unsaved dismissal and account isolation. Check large text, keyboard/VoiceOver names, focus return and substantial contact fixtures.

**Done/report:** The independently rendered panel passes its scenarios without exposing another owner's data or losing edits. Report files, shared changes requested, actual test commands, representative screenshots, measured list behavior and remaining device gates to the parent.
