# Requests / M2 / implemented; independent review and device gates open

Date: 27 October 2026. Host: Windows, Node 24, installed headless Chrome. All walkthrough accounts, numbers, messages and outcomes are fictional. No provider was called and no real calendar changed.

## Owned files

- `apps/mobile/src/mission-composer.tsx`
- `apps/mobile/src/mission-conversation.tsx`
- `apps/mobile/src/features/voice/presentation.ts`
- `apps/mobile/src/features/missions/request-state.ts` (new)
- `apps/mobile/test/request-state.test.ts` (new)
- `apps/mobile/test/presentation.test.ts`
- This report and `M2-requests-artifacts/`.

M3 broker/Live files remained frozen during this work. Root retains App/API/domain/theme/configuration ownership.

## Implemented behavior

The composer derives available duration/retry choices and fresh duration defaults from bootstrap limits intersected with existing domain bounds. It supports live 180/0 and stricter arbitrary limits such as 45/0. Compatible custom durations remain visibly selected. Existing drafts/templates outside tighter limits retain their values and require an explicit supported choice; no silent rewrite occurs. Missing/incompatible limits block save/authorization.

Recipient confirmation binds to the complete review snapshot, review version, current recipient identity/number/verification, limits and selected context. Changes invalidate confirmation immediately during rendering, without depending on an effect after paint. Server stale-version 409 refresh still requires re-review and never automatically retries authorization. Selected context now reuses the authoritative domain `selectContext`, excluding other-owner, private, expired, unconfirmed, unrelated and permission memories.

Failed saves preserve typed fields and offer local recovery feedback. Root repaired the shared save callback so accepted POST/PATCH routes to the returned review identity before refreshing bootstrap: a later refresh failure cannot offer a duplicate draft submission.

Guidance is scoped to its request. Unsupported capability states show an explanation without operational-looking input/save controls. A successful older guidance save clears only an unchanged text/kind; newer edits and failed submissions remain. The existing editor guard is available for unsent guidance, with Save registration absent when capability is unsupported. Root agreed to pass editor callbacks and key the detail by mission ID; this last guard wiring needs the next integrated browser review.

Deletion confirmation is scoped to a mission ID. Unknown status remains neutral and does not enable destructive controls. Cancellation pending, terminal provider evidence, unverified summaries and follow-up-only retry remain distinct. Reported agent commitments are labeled as reported or simulated. The form-free exact-message workflow was untouched.

## Checks actually run

Scenario families: REQ-01/02/03/04/05, NET-01, A11Y-01/02. These are partial evidence for each family, not whole-family release certification.

| Check | Result and limits |
| --- | --- |
| `npx vitest run apps/mobile/test/request-state.test.ts apps/mobile/test/presentation.test.ts` | Passed: 15 tests; limits, unchanged templates, full review identity, unknown status and guidance edit retention |
| `npm run typecheck` | Passed: root and mobile, including final guidance guard source |
| `npm run e2e:build` | Passed twice; final rendered walkthrough used the identified bundle below |
| `KLNK_E2E_CHANNEL=chrome npm run e2e -- --grep REQ-01` | Passed: existing rendered exact-message journey, before the final shared save/primitive rebuild |
| `node .data/request-walkthrough.mjs` with isolated `npx tsx scripts/e2e-server.ts` | Passed: nine rendered checks on the final identified rebuild; no microphone capture or provider credentials |
| Full `npm test` | Passed: 372 tests in 28 files, including concurrent Root/Platform work at this run |

The final small guidance editor-guard addition postdates the nine-check screenshot bundle; it passed TypeScript and feature tests but is not represented as browser-certified by those screenshots. A preliminary walkthrough against an older bundle stopped during setup; Root's shared changes were then rebuilt and the complete identified walkthrough passed. No failed run is counted as a pass.

## Rendered walkthrough and artifacts

[Sanitized walkthrough JSON](M2-requests-artifacts/walkthrough.json) records nine checks:

1. Bootstrap 180-second/zero-retry controls expose no unsupported choices.
2. A 503 save failure preserves the draft and shows recovery text.
3. Dirty-close **Stay and edit** preserves fields.
4. Authorization requires the recipient checkbox.
5. An actual stale-version 409 refreshes the revised brief and clears confirmation, with no automatic authorization.
6. Reconfirmation leads to a real local simulated request.
7. A browser response fixture declaring unsupported guidance removes its input/save controls.
8. A stricter 45-second fixture offers only supported durations.
9. An accepted POST followed by bootstrap 503 remains in the created review, with one accepted draft submission.

The bootstrap limits and unsupported-guidance cases deliberately replace selected browser response fields while retaining the actual isolated API for accounts, drafts, stale review and simulated execution. They do not enable a telephone adapter or establish real service behavior.

Actual loaded JavaScript: `index-37daaf64f6946d3bb783f9bff16d28c9.js`, SHA256 `17186513821537ded3651037f86daf7aaea414b211744458c5d6ef87fbd36cf9`.

Screenshots at 390×844, light appearance:

- [Failed save](M2-requests-artifacts/failed-save.png)
- [Confirmed review](M2-requests-artifacts/review-confirmed.png)
- [Stale review reset](M2-requests-artifacts/stale-review.png)
- [Simulated result](M2-requests-artifacts/simulated-result.png)
- [Unsupported guidance](M2-requests-artifacts/unsupported-guidance.png)
- [Stricter limits](M2-requests-artifacts/strict-limits.png)
- [Accepted save / failed refresh](M2-requests-artifacts/accepted-save-refresh-failure.png)

The worker visually inspected failed-save, accepted-save and stricter-limit screenshots. This is not independent usability testing or accessibility conformance. Ports 4102/8083 were stopped and released after the walkthrough.

## Remaining dependencies / defects

- Root's guidance editor callback/key wiring must receive an integrated dirty-close walkthrough; unsupported guidance must keep Save unavailable.
- Shared authorization race identified for Root: the server currently accepts mission review version/scenario and freezes the current contact number. A different device can change/reverify that number after the UI checkbox without bumping mission review version. UI refresh invalidation is implemented, but the server needs an expected-recipient binding or equivalent invalidation before real-calling release. No shared authorization code was changed here.
- A missing successful mission-create HTTP response has no durable client creation receipt in the existing mission POST contract. The fixed accepted-response/failed-refresh case does not establish idempotence for a completely lost create response; that needs a shared operation contract.
- Physical iPhone, VoiceOver/Voice Control/Switch Control, Dynamic Type, all appearances/widths, enlarged text and independent panel QA remain unverified for this change. Do not infer AA conformance from these screenshots.
- Independent reviewer: pending. Root must review shared wiring, authorization races and cross-panel journeys before closing the milestone.
