# Local validation evidence

October 26, 2026 · Windows host · Node 24.15.0 · npm 11.14.1.

No external calling, resource creation, publishing or deployment was performed.

| Check | Observed result | Limit |
|---|---|---|
| `npm run typecheck` | Backend/shared packages and React Native client passed | Static types do not prove native behavior |
| `npm test` | 99 tests across 11 suites passed: policy, providers, owner voice, API, worker, privacy, connection and storage | HTTP provider responses are mocked; no real calls |
| `npm run demo` | All eight mission kinds exercised through API and durable worker | Explicitly synthetic conversations |
| Calendar failure/retry | Replacement retained as confirmed; pending write retried; one existing event updated once | Local demo calendar |
| Database restart | File-backed PostgreSQL/PGlite reopened encrypted records and queued job with persistent key | Single-process development runtime |
| Expo dependency check | SDK 58 dependencies matched package compatibility metadata | Full native build remains outstanding |
| Expo Doctor | All 20 checks passed after removing an obsolete SDK configuration flag | Configuration checks do not compile native code |
| Expo web export | Compiled successfully | React Native web preview only |
| Expo iOS JS/Hermes export | Compiled successfully | JavaScript bundle, not Xcode compilation or signed app |
| Browser interaction | Demo login, text-only profile onboarding, mission composing/review/authorization, queued/executing/completed states, result and transcript | Browser at 390 × 844; no iPhone binary or VoiceOver verification |
| Voice-first browser interaction | Form-free entry, primary microphone screen, Jordan message through simulated completion, spoken/displayed result and phone frame | Contract tested through optional text input; microphone recognition and acoustic output not verified |
| Owner voice safety | Duplicate turn/report receipts, spoken contact verification, private-clause rejection, owner-bound shared keys, chat clearing and expired-request replay protection | Provider audio/LLM calls use injected mocks |
| Native pause completion | Pure timing checks cover speech/quiet, long pauses, initial silence, missing metering and capture bounds | No microphone activation; device noise/long-pause accessibility still needs testing |

The [result screenshot](screenshots/mobile-information-result.png) shows a rendered information mission, explicit simulation status, collected inspection prices/options and the unresolved owner decision. It is captured from the React Native web preview, not a physical iPhone.

The [voice-first iPhone presentation](screenshots/iphone-voice-home.png) is the actual browser-rendered Home. It follows the requested iOS design guidance and preserves optional text tools. Both this view and the physical-device development configuration remain React Native; browser framing is not an iOS simulator.

`npm audit --omit=dev` reports five high findings in the Expo CLI dependency chain. The application uses patched Zod directly; the CLI's older Zod and node-forge have unresolved advisory findings. See [SECURITY.md](SECURITY.md); no incompatible automatic downgrade was applied.

Still unverified: native iOS compilation, signing, physical-device networking/background behavior, device accessibility, synthesized/clone quality, real recipient calls, provider billing, provider retention dashboard configuration, Google OAuth, production PostgreSQL concurrency/load and App Store release readiness.
