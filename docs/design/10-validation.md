# Implementation and validation evidence

## Workspace design follow-through — 29 October 2026

The sign-in screen, all five network destinations, optional setup, native recorded-turn panel and shared detail sheets now carry the home design. Implemented: navy full-width titles, system type, lavender/system canvas, continuous opaque groups, icon-led feature headings, coral capsule actions, concise introductory copy and grouped Settings. Setup and availability disclose on intent; mounted editors and canonical receipt/draft state survive collapse. Request reviews, sharing/retention/permission warnings and actual recovery states remain explicit. No new dependency, API/schema, provider permission or external action was added.

Shared primary buttons use the existing 120ms press transition; sheets use Modal fade with keyboard dismissal and focus restoration. Tabs remain immediate. Independent QA found a real Reduced Motion listener collision in the installed React Native Web AccessibilityInfo implementation when nested theme providers unmounted; browser providers now own exact matchMedia listeners and initialize preferences synchronously. Native AccessibilityInfo behavior is unchanged.

Actual local evidence: root/mobile/E2E TypeScript passed; 838 unit cases passed with 25 PostgreSQL-only skips; all 68 rendered component cases passed. Lint has 0 errors and 251 existing explicit-any warnings. Scoped Prettier, whitespace and documentation-link checks passed. Independent six-case browser verification passed in 19.9s with 0 skips/flakes, including actual 200% text, whole-word headings/categories at 320/390/430, retained unsaved Preferences with 0 PUTs, live Reduced Motion changes after full home/account/workspace navigation, and animated/reduced sheets with Escape/focus restoration. The final **whole-product browser run passed all 67 cases in 131.14 seconds**, with no skips, retries or flakes, on fixture export `index-9efc445d96f37e65678d806227bb7b7a.js`. Browser fixtures use separate local services, not the user's API/provider credentials. PostgreSQL was not rerun for this UI-only pass.

The stronger whole-word assertion initially produced 64 passes / 3 fixture failures by comparing glyph ink height with line height, even on a visibly single-line Inbox heading. It now checks occupied text lines; actual ancestor/control clipping assertions remain intact. Earlier real word fragmentation was fixed with full-width screen titles and intrinsic disclosure labels. Failed fixture artifacts remain under ignored `.data/workspace-style-qa/whole-word-height-fixture-failure/`; no product failure is hidden by increasing timeouts or removing checks.

Preview export `index-d3585de520f0d53d81b62dd4084d2ed6.js`: 2,417,464 bytes, SHA256 `ce5a735b22f317d07d2ecba4e5b9872093fb8175f838bf0c332c92bef0c7de8b`. The configured private key is absent from exported files. This is 1,969 bytes above the preceding home export, with no new package. The user browser was observed idle, then opened at `http://localhost:8081/?preview=iphone&workspace=1` on the refreshed sign-in screen; no capture or account submission was performed there. API health returned OK. Earlier GitHub CI links do not validate this revision; its own commit workflow must be checked separately.

Publication preflight, 29 October: all 25 actual PostgreSQL cases passed again in 38.38 seconds against the isolated loopback QA database. This extends the UI-only checkpoint above; no application database schema or provider setting changed.

Visual evidence uses fictional browser fixture accounts: [overview](preview/expo-workspace-overview-2026-10-29.png), [Inbox](preview/expo-workspace-inbox-2026-10-29.png), [Calendar](preview/expo-workspace-calendar-2026-10-29.png), [People](preview/expo-workspace-people-2026-10-29.png), [Memory](preview/expo-workspace-memory-2026-10-29.png), [Settings](preview/expo-workspace-settings-2026-10-29.png), [200% Settings](preview/expo-workspace-settings-200-text-2026-10-29.png), [actual detail sheet](preview/expo-workspace-sheet-2026-10-29.png). [User preview sign-in](preview/expo-workspace-signin-2026-10-29.png) was captured separately without signing into a fixture account. Native iPhone rendering, VoiceOver, Dynamic Type, soft-keyboard avoidance, animation performance and real audio remain device gates. No native Liquid Glass or whole-product AA/AAA conformance is claimed.

## Expo home refresh — 29 October 2026

Implemented the user's shorter, feature-focused iPhone-style opening in the existing Expo app: one headline, original artwork, static Meetings / Memory / Answers cues, curved opaque surfaces and one prominent Call klnk action. No navigation, text field, fabricated outcome or enabled-integration badge was added. Connected controls, audio-unblock recovery, typed workspace access and uncertain-closure blocking remain intact. The standalone `/demo` was not visually changed.

| Check actually run | Result |
| --- | --- |
| Root/mobile TypeScript and E2E TypeScript | Passed |
| `npm test -- --reporter=json --outputFile=.data/home-design-unit-results.json` | 838 passed; 25 PostgreSQL-only cases skipped. PostgreSQL was not rerun for this UI-only change. |
| `npm run test:components -- --runInBand` | 68 passed; includes closure uncertainty and actual connected-control dispatch. Native worklet timing is a mocked boundary here. |
| `npm run e2e:build` and `npm run e2e` using bundled Chromium | Export passed; all 61 journeys passed, including 5 new whole-label/sole-action/motion cases. Existing workspace/failure/authorization journeys retained. |
| Independent rendered QA | 14 layout cases: 320/390/430 widths, light/dark OS appearance, normal/200% text plus spacing, and 320×568 short-screen cases. One opening action, zero page overflow/errors/capture. Feature labels stay whole; short-screen primary action measured 272×64 at y469–533. |
| Motion browser evidence | Artwork records one 280ms entrance and settles. Noncommitting press scales the action. Changing Reduced Motion removes artwork animation and the button transform while preserving the mounted action/focus. No microphone was started. |
| `npm run lint`, scoped Prettier and `git diff --check` | Lint: 0 errors, existing 251 explicit-any warnings. Formatting and whitespace checked. |
| Production dependency audit | 0 high/critical/moderate; 8 low (`npm audit --omit=dev --audit-level=high`). |
| Preview export and configured-secret scan | Passed. Served entry `index-48d48f878062f9a97564db5a2b14c3aa.js`, 2,415,495 bytes, SHA256 `0681f55f8d6ff7a7543929a2766631e01ea7072094cfb0dd75830832986da548`. Configured private key absent from exported files. API health returned OK. |

The active in-app browser was observed idle, refreshed at `http://localhost:8081/?preview=iphone`, and visually inspected with the new headline/features and exactly one Call klnk control. [Actual refreshed preview](preview/expo-home-2026-10-29.png), [200% text](preview/expo-home-200-text-2026-10-29.png), [independent motion metrics](preview/expo-home-motion-2026-10-29.json). Local detailed probes remain under ignored `.data/home-design-independent-qa/`; regression results under `.data/e2e-results/`.

The SDK-matched animation runtime adds **719,284 bytes** to the minified web entry versus the preceding export (1,696,211 bytes). This is a measured size tradeoff, not a performance result. A signed native build, release-device frame timing, physical voice/audio, VoiceOver and native Dynamic Type remain untested. No native Liquid Glass, Apple authorship or whole-app WCAG conformance is claimed. No provider/calling gates, credentials, retention settings or external resources were changed. Earlier CI links below refer to the preceding revision; this refresh requires its own remote verification.

## Earlier implementation checkpoints

Latest local evidence, 29 October 2026: [review status](../review/2026-10-28/STATUS.md), [independent resumed QA](../review/2026-10-29/platform-resumed-qa.md), [Chromium CI follow-up](../review/2026-10-29/browser-ci-repair.md) and [PostgreSQL cleanup follow-up](../review/2026-10-29/ci-postgres-cleanup.md) supersede the checkpoints below. The current workspace uses five lazy network destinations, shared cache/drafts, current-node modal focus restoration, compact large-text navigation and explicit account/native-voice controls. Latest checks passed 838 unit tests (25 PG-only cases separately tested),66 rendered component cases,25 actual PostgreSQL cases and56 bundled-Chromium journeys, plus TypeScript/lint/format and Expo web export. No physical iPhone/audio/assistive-technology conformance is claimed. The repaired preview has been reloaded and inspected with exactly one visible Call klnk action; no capture was started by that inspection. Failed remote runs are retained in the follow-up reports rather than hidden behind an earlier local pass.

Date: 2026-10-27. Environment: Windows, Node 24, local Fastify services and Codex in-app browser. This covers the standalone demo and Expo web application, not a signed iPhone build.

The current production implementation and independent QA supersede this earlier design checkpoint: see [current evidence](../production/05-evidence.md) and [status](../production/reports/STATUS.md). People/Memory are separate features; Settings drafts, request limits/review guards, shared web ARIA states, scalable badges and adaptive navigation have been implemented. Independent QA passed 28 integrated browser cases, including 320/390/430 widths and 200% enlarged People/Memory checks, on its identified export. No native or whole-product AA/AAA certification is claimed.

The remaining sections preserve the earlier design checkpoint (200 tests/18 files and tool-free transport). They do not describe the subsequently implemented optional local application gateway or current suite count.

## Implemented behavior

The standalone demo and Expo opening use the selected sculpture, navy/lavender/coral composition and exactly one opening action: **Call klnk**. Conversation controls appear only when relevant. Expo now has reactive semantic tokens, shared components, grouped Settings, preserved People/Memory/request review/results and visibly labeled simulation. Modal editors have Save / Discard / Stay; stale authorization refreshes the current review and resets recipient confirmation.

The workspace controller preserves draft, history, session and request identity across tabs in memory. It reads the owner-scoped receipt before retrying an uncertain command with the same ID. Manual send disables silence timers; the 30-second capture cap stops and holds for explicit Send or Discard. Backend limits are unchanged.

Both web openings use documented OpenAI Live WebRTC. Native Live explicitly reports unavailable and does not capture. The existing bounded expo-audio workspace path is separate; it is never substituted for a failed Live connection.

## Checks actually run

| Check | Result |
| --- | --- |
| `npm run typecheck` | Root and mobile passed |
| `npm test` | **200 tests in 18 files passed** after the production diagnostic additions; 191/17 at the earlier design checkpoint |
| Broker regressions | 17 mocked tests: contract, local origin/auth/ownership, secret separation, concurrency, cap, ambiguous/malformed startup, closure evidence and aborted response cleanup |
| Standalone client regressions | 28 controlled DOM/media/network tests; no actual microphone/provider |
| Expo controller/transport tests | Draft/navigation/receipt recovery, manual timing, neutral statuses, stale SDP/timer isolation, matching closure ID, mute ACKs, uncertainty, keepalive close and idle cleanup |
| Browser fetch receiver regression | Actual in-app browser reproduced the old `Window.fetch` Illegal invocation; the corrected adapter returned HTTP 200 from a read-only local fixture. No credentials, microphone or provider session used |
| Color tests | 15 tests: specified opaque text pairs reach 7:1 and control boundaries 3:1 in both token themes; not a whole-app accessibility certification |
| JavaScript syntax | `node --check apps/voice-demo/app.js` passed |
| Expo web export | `npm exec --workspace @personal-agent/mobile -- expo export --platform web` succeeded |
| `npm run demo` | Eight fictional templates exercised; one existing calendar event updated once despite action retry; no provider called |
| Exported bundle secret check | Configured private OpenAI key absent from the exported JavaScript; only boolean output logged |
| Read-only account access | `npx tsx scripts/check-openai-access.ts`: HTTP 200 model metadata for gpt-live-1; liveSessionStarted:false |
| Local readiness | Project servers restarted on 4000/4100; both report configured OpenAI readiness. Simulation and disabled real-calling gates preserved |

The deterministic provider/audio/telephone regression suite uses controlled boundaries or fictional fixtures. Separate opt-in real OpenAI diagnostics are recorded in the production evidence above. Model metadata access alone does not establish session creation, audible output, latency or billing readiness.

## Browser observations

Actual Expo opening: one button, zero textboxes at 390×844 and 320×568. At 320×568 the Call target measured 272×52 CSS px and fit in the initial viewport. A local light-theme boundary around the fixed lavender panel keeps keyboard focus navy (3px), including when the workspace uses dark OS appearance.

Actual advanced workspace: Settings and People inspected at 320×740 and ordinary desktop preview size, without horizontal page overflow. An unsent disposable draft survived People → Home → Type. The person editor focused Close on opening; Escape retained the edit and focused Save your changes; Stay restored the field; Discard restored Add a person. No test contact was saved. These are particular keyboard checks, not a complete keyboard or screen-reader audit. Desktop field focus does not establish iPhone soft-keyboard avoidance.

Standalone static HTML/CSS probes had the voice script removed: widths 320/390/430, 200% root text and a 320-wide text-spacing/closure-error fixture. Headings doubled, content width equaled viewport width and recovery actions remained reachable without horizontal overflow. These are layout fixtures, not live connection or audio evidence.

An additional Expo People DOM/CSSOM probe removed scripts and doubled pixel font sizes and line heights. At widths 320/390/430, document content width equaled viewport width and no button/tab extended horizontally outside the viewport. Navigation labels wrapped; the heading measured 68px instead of 34px. This is a static text-resize check, not native Dynamic Type or live interaction evidence. Icon-font loading in that isolated clone is not representative of the running app. The temporary probe/server was removed after inspection.

Evidence:

- [Expo opening](preview/expo-opening.jpg), [320×568](preview/expo-opening-320.jpg), [keyboard focus](preview/expo-opening-focus.jpg).
- [Grouped Settings, 320 wide](preview/expo-settings-320.jpg), [unsaved-edit prompt, 320 wide](preview/expo-unsaved-320.jpg).
- [Static standalone layouts](preview/voice-demo-layout-100-static.png), [200% text](preview/voice-demo-layout-200-static.png), [opening actions](preview/voice-demo-opening-actions-static.png).
- [Static Expo People at 200% text, 320 wide](preview/expo-people-200-static-320.jpg).

## Trust and cleanup

Private credentials and fixed session configuration stay server-side. The Live model has no external-action tools. Local broker access requires loopback host/address and its own origin or an explicitly configured loopback Expo origin. Session mutation/status requires authentication and owner binding. Caller speech cannot authorize telephone actions through this tool-free transport.

Local tracks/playback stop on End, failed setup, navigation and backgrounding. Provider closure is confirmed only by session.closed or matching owner-bound broker readback. Failed closure retains its ID for retry. Lost/no-ID creation blocks another paid start. Unmute waits for the matching provider ACK. Tests cover late media/SDP/timer callbacks affecting later sessions.

Unload sends an authenticated keepalive close using the captured server/token. Delivery/readback is best effort; the server independently requests closure at five minutes. Broker control metadata is currently process memory: abrupt server termination loses reconciliation state. Check the provider before restarting after an unresolved start/closure. The documented REST hangup endpoint describes SIP calls; it was not assumed to support this WebRTC transport.

## Remaining verification

| Item | Status |
| --- | --- |
| Actual Live session, first output, captions, mute/unmute and End | **Passed** in standalone Chrome UI/broker/WebRTC with synthetic microphone; see production evidence |
| Human voice quality, interruption/barge-in and physical audio | **Not tested**; synthetic transport evidence is not human/device evaluation |
| Actual microphone-denial/output-device behavior | **Not tested**; mocked failure paths pass |
| Native OpenAI continuous transport | **Not implemented**, explicitly gated |
| iOS build/sign/install, microphone routing, soft keyboard and background behavior | **Not tested** on this Windows machine |
| VoiceOver, Dynamic Type, Bold Text, Increase Contrast and alternative input | **Not tested** on a device |
| Full WCAG audit, browser/screen-reader pairing and complete timing/keyboard equivalence | **Not tested**; no whole-app AA/AAA claim |
| Persistent broker reconciliation across process restart | Not implemented for this private local demo |
| Deployment, third-party calling, account setup and marketing distribution | Not performed; outbound calling remains disabled |

The earlier Expo CLI dependency audit reported existing high-severity findings. This work adds no visual/native transport package and does not resolve that separate dependency work.

## Fetch invocation incident — 2026-10-27

The Expo hook stored bare `fetch` in its controller environment, then invoked it as an environment method. The in-app browser requires the Window receiver and rejected this call before dispatch. The controller marked creation attempted too early, so it also displayed an incorrect unconfirmed-closure warning.

`browser-fetch.ts` now invokes `globalThis.fetch` with its browser receiver for creation and both cleanup requests. Creation becomes uncertain only after fetch returns its request promise; synchronous invocation failures remain safe to retry, while rejected request promises retain the existing conservative gate. Two regressions cover receiver binding across all three operations and the synchronous-failure/async-network-failure distinction. The 19-test live transport suite, full 191-test suite, TypeScript and web export passed. The failed preview was reloaded after observing microphone-off/error state; it returned to Ready when you are with one Call klnk action.

[Actual browser receiver regression](preview/fetch-receiver-regression.jpg). This incident-specific check proves browser fetch invocation only. Subsequent real Live transport results are recorded in [production evidence](../production/05-evidence.md).
