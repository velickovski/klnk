# Implementation and validation evidence

Latest local evidence, 29 October 2026: [review status](../review/2026-10-28/STATUS.md) and [independent resumed QA](../review/2026-10-29/platform-resumed-qa.md) supersede the checkpoints below. The current workspace uses five lazy network destinations, shared cache/drafts, current-node modal focus restoration, compact large-text navigation and explicit account/native-voice controls. Root checks passed 838 unit tests (24 PG-only cases separately tested), 65 rendered component cases, 24 actual PostgreSQL cases and 55 browser journeys, plus TypeScript/lint/format and Expo web export. No physical iPhone/audio/assistive-technology conformance is claimed. The latest preview has been reloaded and inspected with exactly one visible Call klnk action; no capture was started by that inspection.

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
