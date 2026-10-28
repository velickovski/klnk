# Actual audit and test evidence

Date: **27 October 2026**, Europe/Skopje. Host: Windows, Node 24, Expo 58 / React Native 0.88. JSON report timestamps use UTC. This is the current verification record; it supersedes earlier statements that no real OpenAI audio had been tested. It does not declare production readiness.

## Current implementation checkpoint

The M0–M4 implementation has advanced beyond the audit below. [The milestone board](reports/STATUS.md) and dated worker/QA reports distinguish implementation from release acceptance. The original 200-test/tool-free audit is retained as historical evidence, not the current feature inventory.

| Evidence | Actual result / boundary |
| --- | --- |
| [M1 identity/API](reports/M1-orchestrator.md) | Validated responses, account epochs, SecureStore failures and shared panel extraction verified locally |
| M2 panels | Settings, People, Memory and Requests implemented; failed-save/draft/review/limits and rendered walkthrough evidence in their reports |
| [M3 independent runtime QA](reports/M3-qa.md) | **9 real PostgreSQL 18.6 cases passed**, including separate-process reservations/fencing, deletion interleavings and encrypted restore; isolated namespaces removed |
| [M3 real voice](reports/M3-voice.md) | Bounded real synthetic-audio browser recheck passed after shutdown ordering repair; one creation, actual audio/captions/mute acknowledgements and terminal closure |
| [M4 integrations](reports/M4-integrations.md) | Secure Google OAuth/refresh/revoke, strict application gateway, suppression and frozen context implemented; deterministic provider boundaries, no Google account or Calendar write exercised |
| [Real read-only Live tool smoke](evidence/voice-application-tools-smoke.json) | **Passed**: one creation, one delegation/contact lookup/local commit, one locally accepted result send and continuation, subsequent caption/audio, terminal closure. Spoken meaning was not semantically verified. |
| [Fictional utterance corpus](reports/M5-corpus.md) | **20/20 text/API/domain cases passed**, zero safety failures/network attempts; not ASR, native audio, human listening or latency evidence |
| [Independent browser QA](reports/m5-qa.md) | **28 integrated cases passed** on the identified web export, including retained input, persisted simulated result, account export/deletion and enlarged People/Memory navigation |
| [Local operations](reports/M6-operations.md) | **17 PostgreSQL dump/quarantine/application-restore assertions passed**; no production traffic switch or prior-artifact rollback |

Root independently ran 65 broker/protocol/gateway checks and two application-to-Live binding cases before enabling **local in-app delivery with an explicit account grant**. The initial permission is off. The local-only Live boundary and disabled external-effects gate remain. Adding a key cannot grant contacts, memory, calling or Calendar authority.

Three separately initiated bounded real read-only tool attempts are preserved. The [first failed](evidence/voice-application-tools-first-failed.json) its tool criterion: connection/closure passed, but only a partial-length input transcript and no delegation. The [second failed](evidence/voice-application-tools-second-failed.json) because the runner checked for an answer before the new silent-lead-in fixture finished. Before each manual recheck, read-only inspection verified the previous database had exactly one closed receipt with terminal evidence; there was no automatic paid retry.

The [corrected third run passed](evidence/voice-application-tools-smoke.json), starting `2026-10-27T15:22:44.187Z`, elapsed 25,311ms. It observed one delegated `contacts_lookup`, an actual successful gateway result (`local_commit`), one nonthrowing trusted socket result send and one continuation, followed by a caption and actual headless remote audio. There is no separate result-item success acknowledgment in the provider protocol; the caption establishes temporal follow-through, not matching spoken meaning or human hearing. The narrow English false-completion regex found no selected phrase; `semanticSpokenResultVerified` remains false. All three attempts closed. No telephone request, message, Calendar operation or physical microphone was used. [Source hashes](evidence/voice-application-tools-sources.json) identify this run; subsequent credential-expiry hardening is tested separately.

Physical iPhone, native full-duplex transport, manual assistive-technology evaluation, real service sandbox and release gates remain open. The expanded suite and current source candidate will receive their own final run/identity; earlier counts apply only to their recorded artifacts.

## Historical audit result before production implementation

Real OpenAI voice works in the tested provider connection and in the standalone browser demo's actual UI → authenticated Fastify broker → OpenAI WebRTC path. Browser testing used isolated headless Chrome, a synthetic microphone and fictional speech. It verified rendered provider captions, remote audio playback progression, mute/unmute acknowledgements and terminal closure.

**No service tool calls or backend delegations were observed.** This agrees with the product's `tools: []` and `tool_choice: 'none'`. Calendar, contacts, telephone, messages and memory were not exercised through OpenAI Live. There is no evidence that merely connecting credentials will enable them.

## Historical audit checks actually run

| Check | Result and limits |
| --- | --- |
| Baseline `npm run typecheck` / `npm test` | Passed; 191 tests in 17 files before new diagnostic tests |
| Audit `npm test` | **200 tests in 18 files passed**, including 9 observer truthfulness/redaction regressions |
| Final `npm run typecheck` | Root and mobile passed |
| `npm exec --workspace @personal-agent/mobile -- expo export --platform web` | Passed; packaging only, not native evidence |
| `npm run demo` | Eight fictional mission scenarios; simulated existing calendar event updated once despite action retry |
| `npm run setup:check` | Correctly reports unavailable ElevenLabs/Twilio configuration and disabled telephone gate; no provider writes |
| `npx tsx scripts/check-openai-access.ts` | Model metadata HTTP 200; key never printed |
| Exported-file secret scan | Configured private key absent from three exported JS/HTML/JSON files; only boolean result printed |
| `node --check apps/voice-demo/app.js` and `node --check scripts/voice-browser-smoke.mjs` | Passed |
| Smoke scripts without `--run-live` | Print opt-in instructions and exit without creating a provider session |
| `npm audit --json` | **4 high**, 0 critical; Expo/CLI dependency chain includes node-forge and nested zod; unresolved, not a passing security gate |
| Markdown consistency/link check | 37 documents, 216 local links checked; zero missing targets |

No application feature, service configuration, credential, calling gate or deployed resource was changed by this audit. Added code consists of reusable diagnostics, fixture generation and observer tests. Documentation supplies the production implementation plan.

## Real provider and browser runs

The user authorized real OpenAI testing with the privately configured key. Four short paid voice sessions were created across initial and stricter rechecks: two provider WebSocket runs and two browser/WebRTC runs. Every started session produced `session.closed`. No physical microphone was captured and no third party was contacted. An initial browser launch failed before a session because the bundled Playwright browser revision was absent; selecting installed Chrome resolved it.

Latest provider-only run: [sanitized JSON](evidence/openai-live-smoke.json).

- HTTP upgrade 101; session started and closed; no transport/provider errors.
- 143 input transcript characters, 157 output transcript characters, 1,046,400 output PCM bytes; assistant output followed input transcription.
- First output audio arrived 2,235 ms after diagnostic start. This is **not** measured conversational response latency or a voice-quality score.
- Elapsed diagnostic time 30,756 ms; no backend delegation/tool event observed.

Latest browser run: [sanitized JSON](evidence/voice-browser-smoke.json).

- Exactly one visible initial button at 390×844.
- One session creation request; actual connected event, remote track playback, real captions, mute acknowledgement and unmute acknowledgement.
- Fictional input transcribed and subsequent assistant caption received.
- UI reported Conversation ended from provider evidence; remote playback released; trusted sideband confirmed `session.closed`.
- 0 provider errors, 0 sideband transport errors, 0 observed tool calls/delegations; elapsed 19,118 ms.

The real browser report predates only the observer's final fixed-label privacy tightening; the runtime app/broker were unchanged, and that tightening passed the nine deterministic observer tests. [Runtime source hashes](evidence/runtime-sources.sha256.json) identify the tested application files. The final provider-only run uses the hardened observer.

These checks establish the stated transport and UI behavior. They do not assess response meaning, naturalness, interruption quality, actual speaker acoustics, model-policy robustness, Expo-panel E2E, native hardware or another service's success. A subsequent caption is an observed event, not proof that a requested external task happened.

## Reproduce the opt-in diagnostics

From the project root, create only fictional audio with the Windows speech engine:

```powershell
./scripts/create-voice-smoke-fixture.ps1
npx tsx scripts/openai-live-smoke.ts --run-live --pcm .data/production-audit/input.pcm
```

The browser diagnostic uses an available Playwright runtime without adding a dependency during this audit. On this workstation:

```powershell
$env:KLNK_BROWSER_TEST_RUNTIME='C:/Users/andre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
$env:KLNK_BROWSER_TEST_CHANNEL='chrome'
node --import tsx scripts/voice-browser-smoke.mjs --run-live --pcm .data/production-audit/input.pcm
```

On another host, use its installed compatible Playwright package/runtime; do not copy a nonexistent machine-specific path. M1/M5 must pin the project's own E2E runner for CI. The browser script serves an isolated simulator-configured local app on port 4101 with a fresh database under `.data/production-audit/`; it closes its browser and server afterward. It never enables telephone calling or uses a real microphone. Do not run concurrently on that port.

Both scripts use fixed model/voice identifiers already used by the app. They keep credentials server-side, request bounded closure, fail on absent terminal evidence, and save allowlisted metadata only. They are opt-in diagnostics, not a production service or complete telemetry pipeline. On an ambiguous connection/closure, investigate the same session before any repeat; these scripts do not implement durable production reconciliation.

The observer records tool items as observed attempts, deduplicated by identity when present. Such an item is not proof of authorized execution or provider success; production must implement the lifecycle in [04](04-services-and-tool-tracing.md). Arbitrary labels, arguments, result bodies, identifiers, transcripts and keys are excluded from the shared summaries.

## Gaps recorded by the historical audit

Several local implementation gaps in this original list are now repaired and verified in the current checkpoint above. Native/device, real service, human usability and release-specific gates remain unresolved; do not read this old inventory as the current implementation state.

- Native Live transport, signed iPhone build, real device microphone/speaker/Bluetooth, interruption/background handling and subjective voice quality.
- Complete Expo rendered-panel E2E and independent human usability validation.
- VoiceOver, Dynamic Type, alternative input, full web AA conformance, timing/equivalent typed access.
- Calendar OAuth and actual sandbox calendar writes; ElevenLabs/Twilio pilot; native contacts/reminders and any messaging adapter.
- Live tool gateway, multi-owner durable session reconciliation, production migrations/worker failover, backup restore and operational monitoring.
- Resolved dependency findings, privacy/release review, deployment and App Store submission.

Use [the milestone board](reports/STATUS.md) for implementation progress. Missing credentials/hardware can block particular verification gates; they do not justify marking those gates passed.
