# Independent QA / final local browser wave / device and release gates open

The final rebuilt deterministic browser suite passed **32/32**, with zero skipped, flaky or failed cases. This is local browser integration evidence, not M5 completion or release certification. Native, manual assistive technology, external-service, performance and human-usability gates remain open.

## Current integrated result — 27 October 2026

Actually ran `npm run e2e:build`, then `$env:KLNK_E2E_CHANNEL='chrome'; $env:KLNK_E2E_SCREENSHOTS='true'; npm run e2e` on Windows/Node 24.15.0, pinned Playwright 1.64.1 and installed headless Chrome. The final full run started at 15:41:06 UTC and passed 32 cases in 116.9 seconds, after an earlier full 32-case pass (177.3 seconds) and a focused eight-case screenshot/heading follow-up (77.9 seconds). The browser-loaded response and exported file both hashed to **2e528891031c07b983764cad97ec136b15b3c0d03d6996234f961111b0212812**, bundle `index-00b72dc0187662ccac68836f776bbf40.js`. Tests have no retries. The final suite includes the stronger full-heading-in-viewport assertion and optional simulated-result/tool-permission screenshots. The focused follow-up is [separately recorded](../evidence/qa/m5-browser-focused.json). E2E TypeScript also passed with `npx tsc -p e2e/tsconfig.json --noEmit`.

Evidence: [sanitized final cases, loaded/export bundle, layout and test hashes](../evidence/qa/m5-browser-final.json), [fictional screenshot directory](../evidence/qa/visual-final/). The [earlier 28-case record](../evidence/qa/m5-browser-integrated.json) is historical. The fixture uses real isolated Fastify/PGlite accounts and the simulator worker; provider credentials, including Google configuration, are absent. QA used no physical microphone, paid session, external account or service write. Export preparation did not open Share; deletion affected only a disposable fixture account.

Passing journeys cover the sole initial Call klnk action; denied capture to editable typed workspace; exact typed message to one authoritative simulated request/detail/terminal result; late old-owner successful and unauthorized responses; owner-bound drafts; malformed successful payload recovery; People/Memory failed saves and guarded dismissal; Settings navigation retention, failed save with actual retry/refetch, explicit export preparation and disposable deletion.

Four final cases cover tool permissions and asynchronous no-ID recovery. The tool eligibility case mocks **only GET runtimeAvailable presentation**: its enable and disable PUTs, returned disabled runtime, owner grant persistence and final GET readback are actual local API operations. Another mocked foreign-owner GET is rejected by the client before controls or mutation. Both delayed no-ID receipt journeys use explicitly mocked recovery endpoints, preserve uncertainty and typed access, and never capture or create a session; terminal rejection permits the sole Call action again without automatically starting. Unknown closure now says “Check the earlier session.” and explicitly keeps closure unconfirmed, rather than claiming an ended conversation.

Responsive checks cover 320/390/430 CSS px, light/dark and Reduce Motion. Six People/Memory cases enlarge resolved text to 200% plus line-height 1.5, letter spacing .12em, word spacing .16em and real body-paragraph margin 2em. Across **48 navigation targets**, minimum measured size is **97.5 × 88 CSS px**; text fits both axes, target bottoms remain <=832 in an 844px viewport, full primary Add actions fit the viewport and clipping ancestors after scrolling, and document horizontal overflow is absent. This is programmatic resolved-text enlargement, not actual browser zoom or native Dynamic Type.

**QA harness correction:** the earlier 276/307px-high navigation measurements applied paragraph margins to control labels and enlarged decorative icon glyphs. Those measurements and their screenshots are superseded, not product requirements. The corrected helper excludes decorative aria-hidden glyphs, applies paragraph margins only to explicitly identified body paragraphs and adds stronger full-action/clipping assertions. The People search placeholder can truncate at enlarged text; its persistent Find a person label remains visible. These partial checks do not establish WCAG conformance or complete form clipping coverage.

## Independent visual review and open rubric cells

Normal 390px light/dark captures show one coherent navy/lavender/coral system, clear page headings, persistent form labels, distinct primary actions and consistent bottom navigation. The 320px enlarged captures retain complete Add actions and legible selected navigation. The simulated result distinguishes its outcome from its SIMULATED badge and explicit no-one-contacted notice. The granted-but-unavailable tool state separately identifies saved permissions and unavailable runtime, with an enabled Turn off action. A focused eight-case recheck additionally required the complete opening heading in the viewport; both settled opening screenshots match because the opening intentionally uses a fixed light conversation panel. These are an agent visual/interaction review of fictional local fixtures, not representative user research.

| Observed panel | Hierarchy | Typography/spacing | Interaction clarity | State completeness | Consistency | Accessibility | Performance |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Opening / unknown closure | 4 | 4 | 4 | Unscored | 4 | Unscored | Unscored |
| Home | 4 | 4 | 4 | Unscored | 4 | Unscored | Unscored |
| People | 4 | 4 | 4 | Unscored | 4 | Unscored | Unscored |
| Memory | 4 | 4 | 4 | Unscored | 4 | Unscored | Unscored |
| Settings overview | 4 | 4 | 4 | Unscored | 4 | Unscored | Unscored |
| Simulated terminal request/result | 4 | 4 | 4 | Unscored | 4 | Unscored | Unscored |
| Tool-grant/runtime-unavailable state | 4 | 4 | 4 | Unscored | 4 | Unscored | Unscored |

Scores apply only to directly observed states; 4 means the reviewed local state meets the internal visual direction, not that every state or complete process passes. The complete populated/empty/error/active matrix in both themes and interaction recording remain missing. Accessibility has focused keyboard/ARIA/spacing checks, but manual screen-reader and full AA process review remain unrun. No representative iPhone release performance profile, 20-cycle resource measurement, 20-run conversational median/p95, native assistive-input/device matrix or human usability/naturalness score is available. Consequently the “>=4 in every dimension” release rubric is **not satisfied** by this report.

Runtime/security evidence is in [M3](M3-qa.md) and [M4](M4-qa.md). Root's separately authorized real readonly voice/tool smoke is separate evidence; QA did not run it, and temporal captions/result forwarding do not establish spoken semantic correctness. The native strategy remains [explicitly blocked pending device evidence](../../../e2e/native/README.md). No deployment, App Store action or final release approval is claimed.

## Historical M1 verification and repairs

Owned QA files: `e2e/browser/{helpers.ts,journeys.spec.ts,boundaries.spec.ts,accessibility.spec.ts}`, `e2e/native/README.md`, this report, the M0 report and sanitized QA evidence. Root owns the runner/manifests/configuration/fixture and product repairs. QA changed only tests, strategy, reports and evidence.

## Commands and exact artifacts

Environment: Windows, Node 24.15.0, pinned `@playwright/test` 1.64.1, installed Chrome headless, 390×844 default. Root's fixture serves exported Expo on 8083 and a test-only HTTP proxy into real Fastify/PGlite on 4102. Per-scenario headers select isolated abuse-limit buckets; actual production handlers and limits remain unchanged. In-memory fictional accounts, simulation worker, no provider credentials, no real microphone, no paid sessions, no external account/resource mutation. No trace/HAR/video was captured.

| Actual command | Result / scope |
| --- | --- |
| `npm run e2e:build` | Passed; initial bundle `index-f2390b48381abde9b37b668119a62547.js` |
| `$env:KLNK_E2E_CHANNEL='chrome'; npm run e2e` | **10 passed / 9 failed**, 19 scenarios, 1.7 minutes |
| `$env:KLNK_E2E_CHANNEL='chrome'; npm run e2e -- --grep 'microphone denial\|malformed Live\|API-01\|AUTH-01\|MEMORY-02'` | 5 passed / 1 failed; corrected denial fixture really attempted capture once and denied before any session; remaining failure was missing Private radio state |
| `$env:KLNK_E2E_CHANNEL='chrome'; npm run e2e -- --grep 'late successful owner A'` | 1 passed; delayed real A bootstrap cannot populate B's profile |
| `npm run e2e:build` after root repairs | Passed; bundle `index-07454e517b4ad28050d3d4e0e91c8e25.js` |
| `$env:KLNK_E2E_CHANNEL='chrome'; npm run e2e -- --grep 'A11Y-\|REQ-01\|MEMORY-02'` | **10 passed / 0 failed**, 13.2 seconds |
| `$env:KLNK_E2E_CHANNEL='chrome'; npm run e2e -- --grep 'REQ-01\|A11Y-01 keyboard'` | **2 passed / 0 failed** after stronger dialog/background assertions |

The grep strings above use literal `|` alternation when copied to PowerShell; Markdown escapes are for table rendering. The latest specification contains **20 scenarios** after adding the independent late-successful-bootstrap race. The complete 20-case suite has not yet been rerun against the final integrated panels; do not aggregate separate subsets into a claimed full-suite pass.

Sanitized evidence: [initial results](../evidence/qa/m1-browser-initial.json), [repair rechecks and artifact/source hashes](../evidence/qa/m1-browser-recheck.json). There is no Git repository metadata in this workspace; source/export SHA-256 identifies the reviewed artifact. Screenshots were optional and not enabled in these runs. Raw transient Playwright reports remain under `.data/e2e-results/` and are overwritten per run.

## Defects found, repair ownership and independent outcome

| ID / severity | Reproduction and actual defect | Root repair / QA outcome |
| --- | --- | --- |
| A11Y-01 / P1 | All six width/theme cases found Home `role=tab` without `aria-selected`. Separate DOM probe found Talk/Type/When to send radios without `aria-checked` and Profile without `aria-expanded`. | Root added explicit web ARIA state mapping while retaining native `accessibilityState`. Six width/theme cases pass; Private checked-state and modal failed-save journey pass. Helper source reviewed; this is not full accessibility conformance. |
| REQ-01 / P1 | Fresh typed exact message creates one simulated mission and displays Request details, but the click originally searched stale `data.missions=[]` and did nothing. | Root routes the actual returned mission ID to authoritative detail and refreshes. Recheck requires a real dialog, its **SIMULATED** badge and explicit fictional/no-one-contacted notice. Passed; one voice-turn POST, no mandatory composer, no capture. |
| SETTINGS-01 / P1 | Profile → edit Your name → People → Settings/Profile replaces unsaved text with Alex Morgan. | **Open** for Settings worker. Full initial run independently reproduced the M0 defect. Not waived or hidden by test changes. |
| Modal background / P1 accessibility risk | The initial Memory selector discovered both background and dialog Private radios through the accessibility tree. | Root hides the workspace accessibility subtree while the portal modal is open. Keyboard recheck explicitly requires background Home tab absent, focused Close, Escape dismissal and trigger focus restoration. Passed. Device/screen-reader behavior still unrun. |

One initial Memory failure was a QA selector ambiguity; it was corrected by scoping Private to the dialog. The required checked-state assertion remained and failed until root fixed the real semantics. The initial microphone-denial fixture omitted model/voice fields required by M1's schema; QA corrected it and added an assertion of exactly one denied capture attempt, then reran it successfully. Neither correction relaxed the product contract.

## M1 identity and API review

AUTH-01 late A 401 after A logout/B sign-in passes without logging B out. A separate browser test snapshots a genuine A bootstrap after saving a distinctive fictional profile, holds its response through sign-out/new simulation, then releases it: B retains Alex Morgan and A's profile does not appear. AUTH-04 typed unsent draft survives panel navigation and is empty for the next owner. API-01 malformed successful auth remains signed out with retry; malformed successful bootstrap shows an error/retry without a page crash. Malformed Live readiness requests neither capture nor a paid session. Actual denied capture reaches an editable separate typed workspace.

Independent source review confirms API acceptance uses an epoch/token/origin snapshot before and after body decoding; identity invalidation aborts old requests; App keys the workspace by owner lifecycle and guards refresh/detail state; AuthScreen guards response/storage continuations; old-session logout cannot clear a newly selected identity. The Live anonymous self-sign-in exception is restricted to its own immediately next epoch and issued token; web `setSession` publishes synchronously, and another replacement increments the epoch again. No concrete bypass was found in this source review. Native SecureStore behavior is not device-tested by this result.

## Historical passed / open / blocked scopes at M1

Passed in the recorded browser subsets: sole opening action and keyboard focus; actual capture-denial recovery; malformed auth/bootstrap/readiness; same-origin late success and 401 owner races; typed draft ownership; text spacing/200% enlargement of opening; 320/390/430 light/dark basic page reflow; selected/checked/expanded semantics observed; keyboard clean-sheet focus return and hidden background; contact failed-save guard; private-memory failed-save retention; direct simulated request details.

Open at that point: Settings draft retention and the integrated full 20-scenario rerun, both subsequently verified above; large-list fixture/performance evidence; expanded panel state matrix; manual browser screen reader and all applicable AA criteria; actual provider conversational/tool/closure runs for changed claimed features; human usability/naturalness evaluation. The initial reflow test checked document horizontal overflow and reachable opening action; later target/text-range measurements remain a partial clipping/zoom audit.

Blocked/not run: exact signed iPhone transport/artifact; VoiceOver/Voice Control/Switch Control/Full Keyboard Access on hardware; safe areas/audio/routes/interruptions/performance; service OAuth sandbox/readback/revoke; real PostgreSQL failover/restore/staging; exact release-archive privacy/security review and authorized rollout. See [native checklist](../../../e2e/native/README.md). No public deployment or App Store action was performed.

Next dependency: complete panel/runtime/service owners' work, then independent integrated QA with every required matrix entry pass/fail/blocked and artifacts. Orchestrator review of QA changes and final release decision remain pending.
