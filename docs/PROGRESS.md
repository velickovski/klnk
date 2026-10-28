# Implementation progress

Current production checkpoint, 27 October 2026: all panels, account/session fencing, durable Live receipts/controller ownership, worker leases, secure Google OAuth and the granted local tool gateway are implemented. Independent browser/PostgreSQL checks and real synthetic-audio tool evidence are linked in [production evidence](production/05-evidence.md). [The release review](production/reports/M6-release-review.md) keeps native hardware, real services, dependency, privacy/operations and rollout gates open. Later sections preserve earlier checkpoints; their counts and tool-free limitations are historical.

## Production audit and multi-agent handoff — 27 October 2026

The [production package](production/README.md) now contains a code-grounded Sol orchestrator prompt, M0–M7 milestones, eight independently assignable agent cards, skill-derived test criteria, service/tool tracing requirements and a release board. Production implementation remains pending; the package does not claim completion.

Validation passed 200 tests in 18 files, root/mobile TypeScript and Expo web export. Real OpenAI WebSocket and standalone Chrome/broker/WebRTC diagnostics used fictional synthetic audio and confirmed terminal closure; browser captions and mute/unmute acknowledgements passed. No application service tools were enabled or observed. Native iPhone, human voice quality, external-service workflows and production operations remain unverified. See [exact evidence](production/05-evidence.md). Added scripts/tests support reproducible opt-in diagnostics; no production runtime configuration or calling gate changed.

## klnk one-button voice demo and design handoff

The 2026-10-26 design pass adds an isolated browser demo at `http://localhost:4100/demo`, launched with `npm run demo:voice`. It follows the user's curved navy/lavender/coral reference, has one opening Call klnk control and original generated artwork. A server-held OpenAI key enables GPT-Live 1 with Marin and a tool-free reasoning backend. This owner conversation does not place outbound telephone calls or execute missions.

The earlier visual handoff starts at [the design index](design/README.md), with a [visual implementation prompt](design/07-sol-build-prompt.md) and [recording guide](design/09-live-demo.md). At that checkpoint, typecheck and 191 tests across 17 suites passed; Expo web export and all eight simulator templates passed. The one-action opening is in Expo web, with reactive shared components and preserved advanced workspace. Session recovery, owner-bound closure readback, manual-send timing and modal edit guards are implemented. Real audio had not yet been tested at that checkpoint; the later production audit above supersedes that limitation for synthetic browser/provider testing. Native iPhone behavior remains unverified.

## Earlier implementation record

Date: October 26, 2026. The foundation used the working title Personal Voice Agent.

The supplied brief is being implemented in an initially empty directory. No existing repository changes were overwritten, and no parent-project secrets were read or reused.

## Delivered foundation

- Expo SDK 58 iPhone-first client with text-only onboarding, editable contacts and source-aware memory, eight generic mission templates, composer/review, call status/results and settings.
- Fastify API, opaque sessions and scrypt passwords, owner-scoped encrypted records, PostgreSQL migration, PGlite development database and leased durable worker.
- Frozen authorization/version checks, selected context, separate attempts/outcomes/actions, deterministic adverse fixtures, cancellation, retry/idempotence and provider uncertainty handling.
- Real ElevenLabs/Twilio/Google Calendar transports with mocked HTTP tests and verified API references. Default simulation makes no telephone calls.

## Continue here

Run the commands and evidence checks in README. Review `docs/ACCEPTANCE.md`, `docs/CAPABILITIES.md`, `docs/PROVIDERS.md` and `docs/SECURITY.md` before enabling anything live.

Remaining work includes production identity onboarding/recovery, device contact/share/App Intent adapters, evidence-grounded live summaries, verified clone onboarding, real-account Google OAuth/refresh/revocation verification, stronger bounded voice commitment control, real-time telephony features with a genuinely supported integration, push notifications, operator monitoring and legal/market review. These are not blocked merely by adding an API key.

## Voice-first and physical-device preparation

The owner requested a voice-first experience with no required app forms, plus an iPhone-sized browser view. Home now centers spoken conversation; the initial demo opens without form onboarding. Native recording and provider speech replies, browser speech fallback, spoken contact/number clarification, automatic message delegation and audible completion reports are wired. A separate private, tool-free ElevenLabs text-only owner planner supports broader conversation without adding a fourth provider account. Clear exact-message commands use a deterministic path; recipient calls still use a separate telephone agent.

Owner turns and reports have durable idempotency receipts, per-session serialization, 24-hour content expiry and isolated storage. Clearing/expiry strips cached speech/history but preserves non-content receipts against duplicate execution. Timing such as “in ten minutes” anchors to the original instruction; private clauses and consequential commitments fail closed. The configured pilot owner, HTTPS webhook, read-only provider inspection and 180-second/zero-retry limits add live setup checks. Native pause completion can submit after two seconds of measured quiet; it still needs device testing. The real-calling switch remains disabled. No microphone recording, provider transcription/synthesis, provider account call, cloud build or actual telephone call was performed during agent testing.

The user has no Apple Developer/Mac setup yet and selected a US test recipient. Exact prerequisites are in `docs/IPHONE_SETUP.md` and `docs/LIVE_PROVIDER_SETUP.md`. The requested external iOS design skill informed system typography, safe areas, scalable text, touch targets and navigation while retaining React Native. `docs/screenshots/iphone-voice-home.png` records the actual browser presentation.

The subsequent local run passed all 99 tests across 11 suites, including voice privacy/expiry, owner-bound billing limits, duplicate requests, actual transport payloads under mocks, pause timing and API-origin isolation. Expo Doctor passed all 20 checks. Current web/iOS JavaScript bundles exported successfully; no native iPhone or microphone test is implied. The requested ten Swift/iOS bundles were installed as 86 deduplicated Codex skills; pinned provenance and verification are in `docs/IOS_SKILLS.md`.

The Windows host can validate TypeScript, backend behavior, Expo bundling and browser-rendered React Native flows. It cannot validate an iOS build or physical-device behavior. macOS/Xcode or an explicitly authorized EAS build, signing, approved provider accounts and an approved real-call test are the next external prerequisites.

No real calls, contacts with third parties, billable resources, deployment or publication were performed. The integration run passed type checks, all 48 tests across five suites, the eight-mission API demonstration, Expo dependency checks and all 20 Expo Doctor checks. Both web and iOS JavaScript/Hermes bundles exported successfully. Browser QA exercised onboarding, authorization, simulated execution/results, memory edits and unavailable voice/integration states at a phone-sized viewport. The final API steering check also verified that instructions entered while dialing survive connection and that a boundary stop prevents commitments. See `docs/LOCAL_VALIDATION.md`; none of these establish iOS native compilation or device readiness.
