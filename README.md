# klnk

The [28 October improvement status](docs/review/2026-10-28/STATUS.md) tracks the current production hardening work, independent verification and remaining release gates. Earlier handoffs and evidence describe historical candidates.

## Your agent talks to their agent

The current product is an **internal network of registered klnk members**. After the one-button **Call klnk** opening, the workspace has an agent Inbox, internal Calendar, account connections, private Memory and scoped autonomy Settings. Voice and typed owner instructions share the internal request domain. Accepted connections and explicit rules govern delivery; a connection alone never grants meeting authority.

See the [network walkthrough](docs/agent-network/04-walkthrough.md), [product contract](docs/agent-network/01-product-contract.md) and [current implementation evidence](docs/agent-network/reports/STATUS.md). This direction supersedes telephone/external-calendar delivery as the main product. Existing records and adapters remain accessible in the separate earlier workspace; `?workspace=1&legacy=1` inspects that compatibility surface. No phone number is required for a member connection.

Internal meetings require matching canonical terms and both owners' authority. The database atomically checks availability and writes one shared event, each owner's reminders and an in-app notification outbox. Owners can be offline while the server works. Only klnk-calendar availability is known. In-app reminders do not provide closed-app phone alerts.

OpenAI remains a cloud processor for owner voice and optional natural-language planning. Keys stay on the server. Separate owner model requests receive limited own-account context, never the other member's private policy, memory or full schedule. This is not offline or end-to-end encrypted processing. Telephone, SMS, email and external calendar delivery are outside the network registry.

ElevenLabs, Twilio and Google credentials are not needed for this internal product. Apple/Expo signing and a compatible verified native voice transport are still needed for the physical-iPhone release; browser-preview evidence does not establish those.

## Existing design and voice foundation

For the production build, use the [multi-agent GPT-6.1 Sol handoff](docs/production/README.md) and [copyable orchestrator prompt](docs/production/00-sol-orchestrator-prompt.md). It includes panel ownership, milestones, skill-derived tests, service/tool tracing and the [real OpenAI/browser test evidence](docs/production/05-evidence.md).

The new [design handoff](docs/design/README.md) includes a [one-button brief](docs/design/00-current-brief.md), screen specifications, accessibility requirements, and a [6.1 Sol implementation prompt](docs/design/07-sol-build-prompt.md). The selected direction uses navy, pale lavender, coral and original generated artwork.

For the OpenAI owner-to-agent browser demo, configure `OPENAI_API_KEY` privately in `.env`, run `npm run demo:voice`, and open [klnk at localhost:4100/demo](http://localhost:4100/demo). The same one-action opening is in the [Expo iPhone browser preview](http://localhost:8081/?preview=iphone). See [setup](docs/design/09-live-demo.md) and [current evidence](docs/production/05-evidence.md). Optional local in-app voice tools require an explicit account grant in subsequent Settings. A real read-only lookup round trip has passed; external effects remain disabled and telephone execution is separate.

An iPhone-first personal representative: speak to your agent, hear its reply, delegate a conversation, then hear what actually happened. Text and detailed forms remain optional tools.

The advanced workspace's primary flow is voice: “Call Jordan Lee and tell him I am meeting him near the fountain in ten minutes.” A clear message to a verified contact needs no composer form. Missing names/numbers and model-proposed briefs are resolved aloud. Time-sensitive messages are anchored to the original instruction time. That path uses bounded foreground voice turns. Continuous OpenAI conversation uses the separate web transport; native Live and background listening are not implemented.

This repository contains a React Native / Expo development-build client, a TypeScript API and durable worker, PostgreSQL migrations, shared policy schemas, deterministic conversation fixtures, and real HTTP transports for ElevenLabs, Twilio and Google Calendar. **Default mode is simulation. No real calls are made without separately enabled, allowlisted pilot configuration.**

## Run locally

Node 24 LTS and npm are recommended. Windows is supported for the API, automated tests and Expo bundling.

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

In another terminal:

```powershell
npm run mobile
```

Use an Expo **development build** on your iPhone. Set `EXPO_PUBLIC_API_URL` to your computer's reachable LAN address and set `HOST=0.0.0.0` for device development; localhost on an iPhone means the iPhone itself. Native production traffic requires HTTPS. A local browser preview of the same React Native application is available with `npm run mobile:web`; it is not an iOS device test.

Open the [iPhone browser preview](http://localhost:8081/?preview=iphone) for the single **Call klnk** action, backed by the server-held OpenAI key. After an attempt, Open workspace leads to the advanced application. Its [direct inspection link](http://localhost:8081/?preview=iphone&workspace=1) offers **Try the simulation**, with fictional people and source-aware memories and no account form. The advanced browser speech path depends on browser recognition/device speech support. Native recorded turns use ElevenLabs transcription/synthesis once configured. Native OpenAI Live is explicitly gated until a compatible transport and iPhone tests exist. Missing credentials never become fabricated transcripts or audio.

The agent can automatically queue a simulated message, resolve ambiguous people aloud, add/check a number through spoken readback, and speak the actual simulated result. Duplicate voice requests and completion reports are idempotent. Results remain explicitly synthetic. Forms/templates are available behind optional text tools.

The API runs at `http://localhost:4000`. PGlite runs PostgreSQL locally in `.data/postgres` with an embedded worker. It is a single-process development setup. For a PostgreSQL server, set `DATABASE_URL` and a persistent `DATA_ENCRYPTION_KEY`; `npm run db:migrate` applies migrations. With server PostgreSQL, set `EMBEDDED_WORKER=false` on the API and run `npm run worker` separately.

## Validate

```powershell
npm run typecheck
npm run typecheck:e2e
npm run lint
npm run format:check
npm test
npm run demo
npm run setup:check
npm exec --workspace @personal-agent/mobile -- expo export --platform web
```

Use Node 24 (`.nvmrc`). `npm run format` applies the shared Prettier configuration. ESLint enforces handled promises; explicit `any` is currently a warning while existing types are tightened.

Browser journeys run against a separate disposable fixture, with no provider credentials:

```powershell
npx playwright install chromium
npm run e2e:build
npm run e2e
```

Run `e2e:build` again after mobile changes. If using a separately provisioned compatible Chromium executable, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its absolute path; `KLNK_E2E_CHANNEL=chrome` selects installed Chrome instead. A desktop browser result does not establish native iPhone behavior.

`npm run test:pg` requires a dedicated disposable PostgreSQL database named `klnk_qa` on loopback. Set `KLNK_TEST_POSTGRES_URL` privately to its connection URL, or use `KLNK_POSTGRES_TEST_CONNECTION_FILE` pointing to a private JSON file with `url` and a test-only 64-character hex `key`. The runner never reads `DATABASE_URL`; it creates and drops only random `qa_*` test schemas, and fails if no fixture was supplied. CI provisions its own PostgreSQL service and runs these suites on every push.

Production startup requires an explicit PostgreSQL URL, protected encryption key and HTTPS application origins. Missing `NODE_ENV` means production; use the example's explicit `NODE_ENV=development` for local PGlite. `TRUST_PROXY` defaults to `false`; set only explicit trusted proxy IP/CIDR ranges. Public `/health` and `/ready` expose status only. A separately protected `OPERATOR_TOKEN` bearer reveals detailed `/ready` diagnostics; never put it in the mobile app. Structured HTTP/worker logs omit bodies, tokens, email addresses and transcripts.

Legacy telephone endpoints require `LEGACY_ENABLED=true`; the client additionally requires `EXPO_PUBLIC_LEGACY_ENABLED=true` to expose the earlier workspace. Both default off in normal runtime/build configuration. This flag grants no calling authorization. Deterministic legacy regression fixtures explicitly enable it; cleanup hooks remain available for already persisted records.

The demonstration exercises all eight mission kinds and a confirmed appointment followed by an integration failure. It asserts that only the pending calendar action retries and the existing event changes once. Tests cover policies, isolation, authorization, adverse outcomes, retries, cancellation, provider signatures and calendar idempotence. See [acceptance evidence](docs/ACCEPTANCE.md) for precise coverage and remaining gaps.

## iPhone development build

The Expo SDK version and React/React Native pair come from the installed Expo package's `bundledNativeModules.json`. Native configuration includes SecureStore and a development client. A microphone or voice clone is not required.

Building iOS locally requires **macOS, compatible Xcode and iOS SDKs**, plus Apple signing for a physical device. On that machine:

```sh
npm ci
cd apps/mobile
npx expo run:ios
```

Alternatively configure an Expo/EAS account and Apple signing and explicitly authorize a cloud build. No cloud build, signing resource, deployment, App Store submission or third-party call was created during local implementation. The Windows host cannot verify iOS compilation or VoiceOver/device behavior.

## Implementation boundaries

- Simulation supports transcripts and typed owner guidance. The live native telephone adapter supports post-call retrieval and Twilio termination; live transcript, pause, typed steering, takeover, transfer and callbacks remain unavailable.
- Live pilot authorization is restricted to approved test numbers and information/message missions. Automatic live commitments and follow-up actions are blocked until a bounded, validated voice flow is implemented. Server tool checks cannot guarantee every generated utterance.
- Standard assistant voice is supported. Provider preview needs credentials. Verified customer clone enrollment remains unavailable until account arrangements, quotas and verification onboarding are approved. Low-level clone transport is not exposed as a customer enrollment feature.
- Google Calendar has per-owner OAuth/state/PKCE/account verification, encrypted refresh/revoke and durable cleanup, plus an existing-event adapter with availability, ETag and readback checks. These passed injected-provider tests; real-account consent and a sandbox event write/revoke remain unrun. The included calendar demonstration is simulated. Device EventKit synchronization and outbound messaging are unavailable.
- Contacts and shared context are manually entered. Supported iOS adapters are documented but not implemented. There is no Messages-history, native-call-audio or other-app harvesting.
- A replaceable owner planner uses a separate private ElevenLabs text-only agent; it has no calling tools. A deterministic exact-message path works without it in the demo. Audio input is transcribed on the backend, and spoken replies use the configured standard voice. Real provider voice quality and latency remain unverified. Live call summaries keep provider analysis explicitly unverified and do not automatically promote agreements or memories.

Read [local validation evidence](docs/LOCAL_VALIDATION.md), [architecture and operating limits](docs/ARCHITECTURE.md), [API contract](docs/API.md), [capability matrix](docs/CAPABILITIES.md), [provider setup](docs/PROVIDERS.md), [security dependencies](docs/SECURITY.md) and [progress](docs/PROGRESS.md).

For the next physical-iPhone/live-pilot step, use [exact Apple/Expo setup](docs/IPHONE_SETUP.md) and [exact ElevenLabs/Twilio setup](docs/LIVE_PROVIDER_SETUP.md). `npm run setup:check` is offline configuration inspection. `npm run setup:providers` makes only provider metadata GET requests when credentials exist; it never dials, uploads audio, synthesizes speech or creates resources. `npm run setup:iphone -- --api-url https://your-api-origin` prepares public client configuration locally. Live calling remains off until separately authorized; keys alone do not enable it.
