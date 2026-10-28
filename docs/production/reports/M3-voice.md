# Voice / M2 and M3 / local implementation passed; native and release gates open

Date: 27 October 2026. Host: Windows, Node 24.15.0; Expo 58 / React Native 0.88. No Git metadata exists in this workspace. This report does not certify production readiness.

## Owned files and behavior

- `apps/server/src/openai-live.ts`: injected durable receipt store, reservation before paid creation, UUID deduplication, owner-bound recovery, terminal persistence, restart reconciliation and controller lease heartbeat/fencing.
- `apps/mobile/src/features/live/`: UUID creation/recovery, strict receipt validation and duration warning; preserves M1 identity isolation and original-owner cleanup authorization.
- `apps/mobile/src/features/launch/LaunchScreen.tsx`: five-minute/OpenAI audio disclosure and approaching-limit announcement, preserving the one visible initial interactive action.
- `apps/voice-demo/app.js`: stable request UUID and recovery by existing receipt after a lost answer; no replacement provider creation.
- `tests/openai-live.test.ts`, `tests/voice-demo-client.test.ts`, `apps/mobile/test/voice-live.test.ts`: meaningful lifecycle, isolation, restart, quota, fencing and recovery regressions.
- `scripts/voice-browser-smoke.mjs`: shutdown failure still records sanitized evidence rather than losing the report.
- This report, [sanitized live report](M3-voice-browser-smoke.json) and [source hashes](M3-voice-sources.sha256.json).

No provider/model/voice configuration, calling gate or native SDK dependency changed. Telephone execution remains separate. The server's production/nonloopback guard remains enforced.

## Shared contracts and integration

Platform supplied SQL migrations and `LiveSessionStore`; Root injected it into `createApp`, validates API recovery payloads and sequences broker disposal before the owned database closes. Root also guarded account deletion while a voice receipt remains unresolved. Those files belong to their respective owners.

`POST /voice/live/session` now requires `{requestId: UUID, sdp}`. The server reserves first. A repeated UUID returns a conflict and never sends another provider creation, including after confirmed closure. `GET /voice/live/requests/:requestId` is authenticated, owner-bound and local-only; returns `{requestId,receiptId,status,sessionId?,expiresAt}`. No SDP, audio, credential or transcript is persisted by this receipt contract.

The store enforces one unresolved request per owner, bounded server concurrency and daily owner creation limits. Defaults in the supplied store are four concurrent sessions, twenty receipts per owner/day and a 300-second bound; these are local engineering defaults, not a public rollout authorization or production budget decision.

Provider 5xx/transport loss and missing identity remain uncertain. An accepted ID arriving after controller ownership was lost is recorded observationally; only the current controller may attach/close it. Startup claims expired/unowned receipts, preserves unknown creation and closes the same known provider identity. Heartbeats renew leases; lost ownership or storage renewal failure fences the local sideband and blocks additional starts. A second healthy controller does not reclaim the first one's session. Closure requires persisted provider terminal evidence; a local close, expired timer or revoked credential is not terminal proof.

## Deterministic checks actually run

| Command | Result |
| --- | --- |
| `npx vitest run tests/openai-live.test.ts` | Passed: 30 tests, including app-owned database shutdown |
| Targeted broker + standalone + Expo Live suites | Passed: 104 tests before adding the final shutdown regression; the additional broker regression passed separately |
| `npm test` | Passed: 320 tests in 25 files, including concurrent Root/Platform integration at this run |
| `npm run typecheck` | Passed: root and mobile |
| `npm exec --workspace @personal-agent/mobile -- expo export --platform web` | Passed; web packaging only |
| `node --check apps/voice-demo/app.js` and `node --check scripts/voice-browser-smoke.mjs` | Passed |

Scenario families: AUTH-01, NET-01/02, VOICE-01/03/04/05, OPS-02/03 and DATA-01. Broker restart cases instantiate a replacement broker against the same isolated SQL state and explicitly expire the controller lease; they are not a multi-host PostgreSQL or operating-system process-kill rehearsal. Provider/network/audio boundaries are mocked in these suites.

## Real OpenAI browser evidence

Two bounded owner-to-agent paid browser attempts used the existing fictional PCM fixture, headless installed Chrome and the actual local authenticated broker/WebRTC flow. No physical microphone, third-party call, service write or new infrastructure was used.

The first attempt **failed shutdown**: Fastify's database close ran before broker lease release, producing `PGlite is closed`. Its JSON report was lost because the finally block threw. A separate read-only inspection of that attempt's isolated database found exactly one `closed` receipt with terminal evidence present. That verifies persisted closure, not success of the overall failed run. Root repaired disposal order; Voice made disposal idempotent, awaited an in-flight heartbeat and added the owned-database regression. The diagnostic now retains a sanitized report on shutdown failure.

The bounded recheck **passed**, started `2026-10-27T14:20:41.405Z`, elapsed 19,784 ms:

- Exactly one paid creation and one initial visible button.
- Actual provider start, remote audio playback progression and captions.
- 103 input and 169 output transcript characters counted; content omitted.
- 604,800 observed output audio bytes; this is transport evidence, not acoustic quality.
- Provider mute/unmute acknowledgements, terminal `session.closed`, released playback and clean service shutdown.
- Zero observed tool calls, delegations, provider errors or sideband transport errors.

Exact command (runtime location is workstation-specific):

```powershell
$env:KLNK_BROWSER_TEST_RUNTIME='C:/Users/andre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
$env:KLNK_BROWSER_TEST_CHANNEL='chrome'
node --import tsx scripts/voice-browser-smoke.mjs --run-live --pcm .data/production-audit/input.pcm
```

The recheck proves the standalone browser/broker path. It does not establish rendered Expo Live E2E, human interruption quality, perceived naturalness, native transport, device routing or any service tool.

## Open gates and dependencies

- Native Live remains explicitly unavailable. The current native adapter still provides bounded recorded turns separately. Compatible Expo58/RN0.88 native transport validation, macOS/Xcode, Apple signing and physical iPhone audio/lifecycle/accessibility tests remain prerequisites. No SDK or cloud build was added.
- Real PostgreSQL multi-process failover, rolling restart and restore evidence remain required beyond deterministic PGlite lease tests.
- Whole-product accessibility, hearing/speech alternatives, timing evaluation and device testing remain open; disclosure and captions alone do not establish AA conformance.
- Logout/token revocation can prevent an old credential from reading a final cleanup receipt. Root was notified to reconcile cleanup before revocation or provide an authorized recovery path. Account-change media shutdown itself is covered.
- Live creation IDs are retained for the current browser controller/page lifetime. Cross-page/account reauthentication recovery UX and durable receipt retention/cleanup policy need a bounded product contract before public release.
- No Live tools are enabled. M4 shared gateway contracts and independent adversarial review precede activation.
- Independent M3 QA review remains pending; QA reviewed the earlier M1 source exception only. Root must schedule an independent challenge of no-ID recovery, fencing, unknown outcomes and tenant isolation.

Official sources fetched before this work: [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc), [server controls](https://developers.openai.com/api/docs/guides/voice-server-controls), [session lifecycle](https://developers.openai.com/api/docs/guides/live-conversations). Current controller and store evidence does not authorize exposing the local demo publicly.
