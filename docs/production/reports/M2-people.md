# People worker — M2

Agent / milestone / status: People implementation worker / M2 / panel implementation and local journeys passed; shared responsive defect open; independent acceptance pending.

Task and owned files:

- [People list/editor](../../../apps/mobile/src/features/people/panel.tsx).
- [Contact draft and bounded search model](../../../apps/mobile/src/features/people/model.ts).
- [People regressions](../../../apps/mobile/test/people-editor.test.ts).
- This report. Parent retains App/API/domain/shared-component ownership; Memory was not edited.

Implemented behavior:

- Genuine empty and no-results states are distinct. Search covers names, relationships and normalized phone numbers, ignores case/diacritics and preserves duplicate-name records. No samples are inserted into empty accounts. Contact buttons include name, relationship, number and recipient status to distinguish similar names.
- The existing shell ScrollView renders a maximum of 50 contact rows per page. Sorting and searching still cover the full supplied contact set. Page indices clamp after filtering/removal; page changes move focus to the results summary. This avoids a nested virtualized list and mounting all 1,000 fixture rows.
- Name, international phone and relationship have separate field errors. Familiar phone punctuation is accepted and normalized to the existing E.164 contract; missing country code, invalid length, leading zero and extensions fail validation. Number changes clear verification; formatting changes to the same canonical number do not. A changed number requires a fresh explicit check before a verified payload can be saved.
- Save/delete operations reject duplicate submission and lock editor fields, language choices and verification while pending. Failed requests preserve the entire draft and show recovery feedback. Existing parent Save/Discard/Stay handling remains registered. A missing/deleted server record is not silently recreated.
- Opt-out can only be retained or strengthened in the editor model. Saving a number change or rechecking the recipient never removes an existing opt-out. Deletion offers Confirm/Keep, explains retained conversations/memories and does not imply new calling authority. Native contact import remains explicitly unavailable.

Shared contracts changed or requested:

- Contact `onSave` and optional `onDelete` now return `Promise<boolean>`; the parent's existing `perform` callback already satisfies this contract. True means accepted API mutation; false/throw retains the modal draft. Parent still owns the actual session/account acceptance boundary and modal close decision.
- Uses parent-owned `Choice.disabled` and `a11yState` for native plus explicit web checked/disabled semantics.
- Shared responsive issue requested: constrain `StatusLabel` to its available width and allow its text to shrink/wrap. Decorative icon text-spacing behavior also needs a shared fix. No edits to root-owned primitives were made by this worker.
- Parent should record the implemented 50-row pagination design choice and the phone-normalization/verification behavior in the design decision log.

Scenario results:

| Scenario | Result and actual evidence |
| --- | --- |
| PEOPLE-01 | Passed deterministic validation/create/number-change/verification/opt-out cases. Exploratory actual browser → isolated local API create/edit/delete also passed with fictional contact data. |
| PEOPLE-02 | Passed 23 dedicated unit cases in total, including failure preservation, duplicate submission, isolated modal stores, true empty/no-results and 1,000-contact pagination. Existing rendered failed-save + Save/Discard/Stay journey passed. |
| A11Y-01 | Existing keyboard modal open/dismiss/focus-return browser test passed. Custom 1,000-contact pagination moved focus to the results summary. Native assistive input remains unverified. |
| A11Y-02 | Existing 320px light/dark panel reflow tests passed at ordinary text. **Failed** custom 320px + 200% text and combined text spacing: document width 326px for a 320px viewport. The overflow diagnostic identifies shared status badge text/wrappers and a decorative icon. |
| A11Y-03 | Blocked: Windows host, no signed iPhone build/device. VoiceOver, Voice Control, Switch Control, Full Keyboard Access and Dynamic Type require native evidence. |

Exact commands / environment / artifact identity:

- Windows, installed Node/Expo 58/React Native 0.88, installed Chrome, fictional local simulator fixtures only.
- `npx vitest run apps/mobile/test/people-editor.test.ts` — **23 passed**, latest run tool timestamp 15:33:37, 27 October 2026.
- `npm run typecheck --workspace @personal-agent/mobile` — passed after final People source changes and test updates.
- `npm run e2e:build` — passed, initially emitted `index-93b417b53de96c077c811ceb409f040f.js`. A later integrated export was loaded by the exploratory browser; its actual entry was **`/_expo/static/js/web/index-d330fd5e2eb8e720eb6db709ed43b3f7.js`**. Do not identify that browser run as the earlier export.
- `$env:KLNK_E2E_CHANNEL='chrome'; npm run e2e -- --grep 'PEOPLE-02|A11Y-01|A11Y-02 320px|SETTINGS-01'` — **5 passed**: People failed-save/unsaved dismissal, keyboard focus restoration, ordinary 320px light/dark cross-panel reflow, retained Settings draft.
- `npx tsx scripts/e2e-server.ts`, then a PowerShell here-string piped to `node --input-type=module` using installed `@playwright/test` — exploratory six successful checks, followed by one responsive failure. Used ports 4102/8083, disposable in-memory API and provider credentials explicitly absent. Server stopped afterward and no listeners remained; ports returned to parent/Requests.

Exploratory browser steps/results:

1. Enter the actual local simulation workspace. Invalid phone reports the associated field error.
2. Create one fictional contact through the actual UI/API with a formatted international number and an explicit recipient check. API readback confirms canonical number and verification.
3. Set opt-out on that disposable fixture through the local API. Refresh and edit its phone in the actual UI; checkbox clears. Explicitly check the new number and save. API readback preserves opt-out and the new number.
4. Open Delete, choose Keep, then confirm Delete. The actual API removes only that fictional contact and the row disappears.
5. Intercept only the presentation bootstrap contact array with 1,000 fictional contacts; this is a **mocked scale fixture**, not 1,000 persisted API contacts. Actual rendered UI mounts 50 rows, advances to rows 51–100 and focuses the summary. Search finds the last contact, distinguishes no results and clears back to a bounded page. Observed update-to-summary time: **39 ms** on this headless Chrome run; no native/performance claim.
6. At 320px, enlarge rendered text to 200% and apply line height 1.5, letter spacing .12em and word spacing .16em. Horizontal-overflow assertion fails; diagnostic and screenshot retained for shared repair.

Evidence (local generated, sanitized):

- [Exploratory browser metadata](../evidence/panels/people-evidence/browser-report.json).
- [Overflow measurements](../evidence/panels/people-evidence/overflow-report.json).
- [320px/200% viewport screenshot](../evidence/panels/people-evidence/people-320-200-overflow.png). This screenshot shows the visible viewport, not a whole-process accessibility audit.
- [Dedicated test source](../../../apps/mobile/test/people-editor.test.ts). The five repeatable browser scenarios remain in parent-owned E2E specifications.

Mocked vs real-provider vs browser vs native: local API CRUD and actual browser UI were exercised with a disposable fictional account. Scale data was intercepted only at the bootstrap presentation boundary. No real providers, paid sessions, physical microphone, telephone calls, real accounts or native device were used.

Known defects / reproducible limits:

- Shared badge/icon overflow described above remains open at handoff; do not mark all large-text gates passed from ordinary-width tests.
- API opt-out is currently a field of a contact resource. Existing-contact edits preserve it, but deleting/recreating a contact may need durable phone-level suppression in the platform/integrations workstream. Parent notified; no server/policy change was attempted under this lease.
- The supplied contact array is still loaded by parent bootstrap. Bounded rendering improves the panel, but backend pagination is not implemented or claimed.
- Full root suite, final integrated build, independent reviewer and device gates remain parent-owned. Worker tests do not certify release.

Dependencies / next action: parent repairs shared responsive primitives, rebuilds once with exclusive build ownership, reruns expanded People large-text checks and independently reviews the panel. Continue to Memory only after a separate lease is granted.

Independent reviewer and review result: parent review requested; independent final acceptance pending.
