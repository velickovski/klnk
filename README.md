# klnk

klnk is an iPhone-first personal voice agent for an internal member network: your agent helps arrange things with another member's agent. The opening has one action, **Call klnk**. The subsequent workspace contains **Inbox, Calendar, People, Memory and Settings**.

Accepted members can exchange plain messages without configuring autonomy. Questions can receive human answers; meeting proposals support counterproposals and current approvals. Agreed meetings appear in both owners' internal calendars. Automatic acceptance requires scoped delegation and explicitly maintained availability. External telephone, messaging and calendar writes stay disabled.

## Run locally

Use Node.js 24 (see `.nvmrc`) and the committed lockfile:

```powershell
npm ci
# Only for a new checkout; preserve an existing private .env:
Copy-Item .env.example .env
npm run dev
```

In another terminal run `npm run mobile:web`. Open the [iPhone browser preview](http://localhost:8081/?preview=iphone). It is the React Native web application at a phone layout, not an iOS device test. Preview/workspace query shortcuts require a development build or `EXPO_PUBLIC_DEV_PREVIEW=true`; production uses normal workspace routes. Expo public configuration must contain only non-secret values.

The local API listens on port 4000. Explicit `NODE_ENV=development` uses single-process PGlite in `.data`; multiple processes require PostgreSQL. Keep `OPENAI_API_KEY` in the server's private `.env`. Clicking Call klnk can use paid OpenAI; keys do not enable third-party calls. A signed-out user sees account access before microphone capture. Missing configuration and failures are shown honestly.

The browser uses the documented GPT-Live server broker. Native iPhone uses bounded recorded turns, server transcription and device speech while native Live remains gated pending a documented compatible transport and actual device tests. The GPT-Live protocol currently documents no ephemeral client-secret flow; a Realtime credential is not substituted. Browser Live inform/ask tools retain a safe review-required block; exact recipient/text review is available through the Inbox and native recorded-turn flow. No native audio success is claimed from browser or injected tests.

Registration returns a generic 202 without a bearer. Sign in explicitly afterwards. Development permits unverified accounts; production requires email proof. Email delivery defaults off and the app says so. Configure approved SMTP and `PUBLIC_APP_URL` before expecting real verification/reset links. Sessions expire after 30 minutes idle or seven days absolute; export and deletion require recent reauthentication. Account controls are in Settings.

## Verify

```powershell
npm run typecheck
npm run typecheck:e2e
npm run lint
npm run format:check
npm test
npm run test:components -- --runInBand
npm run test:pg
npm run build:server
npm run test:compiled
npm run e2e:build
npm run e2e
npm audit --audit-level=high
npm exec --workspace @personal-agent/mobile -- expo export --platform web
```

Real-PostgreSQL and compiled tests require a dedicated loopback database named `klnk_qa`. Supply `KLNK_POSTGRES_TEST_CONNECTION_FILE` privately (JSON `url`/`key`), or `KLNK_TEST_POSTGRES_URL`. They never fall back to the application `DATABASE_URL` and create/drop only random QA schemas. Compiled tests launch two plain-Node APIs and a worker with no provider credentials. Install Playwright Chromium with `npx playwright install chromium`; `PLAYWRIGHT_CHROMIUM_EXECUTABLE` or `KLNK_E2E_CHANNEL=chrome` can select an existing compatible browser. Browser fixtures use separate ports 4102/8083 and fictional data. Existing explicit-any lint warnings remain visible.

For a local phone preview export set `EXPO_PUBLIC_API_URL=http://localhost:4000` and `EXPO_PUBLIC_DEV_PREVIEW=true`. Do not use the E2E export against the user API. Re-export after mobile edits. Current results and remaining release gaps are in the [status board](docs/review/2026-10-28/STATUS.md).

## iPhone and deployment preparation

Windows supports API/tests/web exports. A physical iPhone build needs a Mac with compatible Xcode/signing or an explicitly authorized Expo/EAS build with an Apple Developer account and your own project/bundle identifiers. Configure reachable HTTPS; localhost on an iPhone points to that phone. See [iPhone setup](docs/IPHONE_SETUP.md). No cloud build, signing, App Store submission, APNs or physical-device validation has been performed here.

The [operations runbook](docs/OPERATIONS.md) covers compiled artifacts, protected configuration, migration/backup/rollback preparation and actual multiprocess smoke evidence. Docker is prepared but not built on this Windows host. Do not infer public HTTPS, Linux container or release readiness from the local smoke.

## Documentation and compatibility

Start with [the documentation map](docs/README.md), [architecture](docs/ARCHITECTURE.md), [API](docs/API.md), [capabilities](docs/CAPABILITIES.md), [security](docs/SECURITY.md), [current visual brief](docs/design/00-current-brief.md) and [review status](docs/review/2026-10-28/STATUS.md).

The previous telephone/mission system remains isolated by `LEGACY_ENABLED` and `EXPO_PUBLIC_LEGACY_ENABLED`, both off by default. Its simulator regression command `npm run demo` is explicitly synthetic. Its [historical architecture](docs/legacy/architecture-telephone.md), [API](docs/legacy/api-telephone.md), [capabilities](docs/legacy/capabilities-telephone.md) and provider setup describe retained compatibility code. Full removal/data migration is a later stage; enabling the flag alone grants no calling authority.
