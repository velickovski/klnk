# Compiled server operations

This is a locally verified build and deployment preparation guide, dated 28 October 2026. No public environment, container, cloud resource, SMTP service or iPhone build was deployed. The [earlier recovery runbook](production/operations.md) remains useful for backup and deletion-journal procedures; its historical local-only voice descriptions and migration counts are superseded by the current implementation and evidence below.

## Build and artifact layout

Use Node.js 24 and the committed lockfile:

```sh
npm ci
npm run typecheck
npm run build:server
```

`scripts/build-server.ts` bundles application and shared-domain TypeScript into three ESM JavaScript entrypoints:

| Artifact | Purpose |
| --- | --- |
| `dist/server/src/main.js` | API process |
| `dist/server/src/worker-main.js` | Standalone queue/network/mail worker |
| `dist/server/src/migrate.js` | Migration command |
| `dist/server/migrations/*.sql` | Original checksummed migration files |
| `dist/server/build.json` | Entrypoints, external imports and migration SHA-256 hashes |

The migration directory deliberately sits one level above the bundled entrypoints. The existing `new URL('../migrations/', import.meta.url)` therefore resolves inside the artifact, independently of the process working directory. The build rejects escaped workspace imports and TypeScript runtime imports. Npm dependencies remain external; include compatible production `node_modules` from the same lockfile. Do not copy the JavaScript directory alone and assume dependencies are embedded. Source maps are server artifacts; do not publish them as browser assets.

Runtime commands use Node directly:

```sh
npm run db:migrate:compiled
npm run start:server
npm run start:worker
```

The build command and test harness use development tools. The API, migration and worker children run `.js` using plain Node, with no `tsx` loader. Migration execution is also performed on application database opening; the explicit migration command provides a pre-traffic gate. Preserve applied migration bytes and hashes. A newer or changed ledger fails closed.

## Runtime configuration and network boundary

Production requires privately supplied `DATABASE_URL` and a 64-hex-character `DATA_ENCRYPTION_KEY`. Keep the key separately recoverable from database backups. Use a dedicated least-privilege PostgreSQL role and verify database TLS, access rules and restoration in the actual environment. Local fixture success does not establish those production controls.

Configure these values deliberately:

| Setting | Expected deployment behavior |
| --- | --- |
| `NODE_ENV=production` | Enables production credential, verification and transport gates |
| `HOST`, `PORT` | Bind only on the private application network; container defaults are `0.0.0.0:4000` |
| `APP_ORIGINS` | Exact HTTPS application origins, comma separated; no wildcard or path |
| `PUBLIC_APP_URL` | Approved HTTPS application origin for account links |
| `TRUST_PROXY` | Explicit IP/CIDR ranges of the immediate trusted reverse proxy; defaults to `false` |
| `EMBEDDED_WORKER=false` | Run queue processing in a separate supervised worker process |
| `DEMO_ENABLED=false`, `LEGACY_ENABLED=false` | Keep demo and legacy telephone features disabled |
| `EMAIL_DELIVERY_ENABLED=false` | Keep SMTP off until a separately approved configuration and delivery test |
| `LIVE_CALLS_ENABLED=false` | Keep third-party telephone execution disabled |

Terminate HTTPS at an explicitly trusted reverse proxy and prevent clients from reaching the backend directly. The proxy must replace forwarded protocol/address headers with its own trusted values. Do not trust all addresses or pass arbitrary client forwarding headers through. Production application requests require HTTPS as derived from the trusted connection; supplied browser origins must match exactly. An authenticated native client can omit Origin, while still requiring HTTPS. Public unauthenticated `/health`, `/livez` and `/ready` probes can use the private HTTP network. Operator diagnostics require the separate strong operator credential.

Inject secrets at runtime through the host/orchestrator's protected configuration. Never bake `.env`, database URLs, provider keys or encryption keys into the image, source maps, logs or image build arguments. The image build context excludes `.env*`, local `.data`, Git history, test output and native build folders. A source checkout's `.env` must not be present in the runtime working directory unintentionally: the application deliberately supports dotenv configuration.

OpenAI owner conversation and optional reasoning require the server-side OpenAI key and model access. Missing configuration returns an unavailable state; it does not create simulated audio or a completed provider session. Native recorded voice uses real transcription and device speech, with its actual device gates documented in the [voice report](review/2026-10-28/voice-worker.md). The native client limits capture to 30 seconds; the server currently enforces upload bytes, starts/day and active-turn limits, not parsed media duration. SMTP, Calendar OAuth and telephone providers remain independently gated. A key alone grants no new external-action authority.

## Container preparation

`Dockerfile` has separate build and production-dependency stages with explicit server/root workspace selection. A manifest-only Windows `npm ci --dry-run --ignore-scripts --omit=dev --workspace @personal-agent/server --include-workspace-root` succeeded with 110 planned packages and no React/React Native/Expo/mobile-workspace runtime entries. It created no `node_modules`; actual Linux dependency installation and container resolution remain unverified. Shared domain code is included in the JavaScript bundle. The final image is configured to run as the unprivileged `node` user and defaults to the compiled API. Its readiness probe checks only the local private `/ready` endpoint. Run the worker using the same image and `node dist/server/src/worker-main.js`, overriding or disabling the API-specific container healthcheck for the worker.

Reviewable commands, **not executed on this machine because Docker is unavailable**:

```sh
docker build --target runtime -t klnk-server:review .
docker run --rm --env-file /protected/klnk-runtime.env klnk-server:review node dist/server/src/migrate.js
docker run --rm --read-only --tmpfs /tmp --env-file /protected/klnk-runtime.env -p 127.0.0.1:4105:4000 klnk-server:review
docker run --rm --read-only --tmpfs /tmp --no-healthcheck --env-file /protected/klnk-runtime.env klnk-server:review node dist/server/src/worker-main.js
```

The protected env-file path is illustrative; use an approved secret injection mechanism. These commands are not permission to provision or deploy. Pin the reviewed Node 24 base image by digest, build and scan the image, verify Linux file permissions and read-only execution, exercise TLS proxy forwarding and inspect the production dependency inventory before release. The current tag is an unpinned preparation artifact. Container build/start/health behavior has **not** been verified here.

## Actual compiled multiprocess smoke

The opt-in runner requires an existing dedicated, loopback PostgreSQL `/klnk_qa` fixture. It refuses an ordinary application `DATABASE_URL`, additional base connection options and non-loopback/database targets. Do not point it at a user database. The private fixture file is created by the existing local/CI PostgreSQL setup and is not committed.

```powershell
npm run build:server
$env:KLNK_POSTGRES_TEST_CONNECTION_FILE = 'C:/protected/local-qa-connection.json'
npm run test:compiled
```

CI can alternatively supply `KLNK_TEST_POSTGRES_URL`, subject to the same dedicated loopback `/klnk_qa` guard, with a fresh ephemeral encryption key. There is no application `DATABASE_URL` fallback. The runner creates one random `qa_compiled_*` schema, uses an empty temporary working directory, and passes a strict child environment allowlist. Consequently no repository `.env`, inherited provider key or Node loader enters its runtime children. It uses only loopback HTTP and the guarded PostgreSQL endpoint. Ports 4105 and 4106 must be free; the runner refuses to replace an existing listener. User preview ports 4000/8081 and separate browser-QA ports are untouched.

The actual local run passed these assertions:

- Plain-Node compiled migration command applied all **11** packaged migrations in the isolated schema.
- Two compiled APIs shared connection state and an internal inbox request. With both embedded workers disabled, the request stayed queued until the separate compiled worker started, then reached actual internal delivery with exact text visible to both accounts.
- Explicit scheduling policies and maintained manual availability produced exactly **one internal calendar agreement** with the same event identity in both accounts. No external calendar was contacted.
- A deliberately empty, local no-op cleanup job finished once. A poison ciphertext job exhausted its fifth attempt and failed without blocking healthy work. This establishes queue execution/fencing, not remote cleanup success.
- Across both APIs, a fresh owner received exactly **100** successful status responses and **10** rate denials out of 110 requests. Idle-expired credentials were rejected by both processes.
- Both APIs read the same unresolved Live receipt. With no provider key configured, creation returned `openai_not_configured`; no provider session was invented. This runner does **not** exercise paid Live creation concurrency/day caps, physical audio, or cross-instance sideband control. Separate PostgreSQL tests cover reservation fencing.
- All runtime children, the allocated schema and the private temporary directory were removed after the run. Sanitized local evidence is `.data/compiled-smoke.json`; it contains no tokens, database connection string, encryption key, transcript or audio.

Windows process termination was exercised. Unix SIGTERM drain behavior, container orchestration, cross-host failure, public HTTPS, actual provider traffic and physical iPhone behavior remain unverified. Do not interpret this smoke as a public deployment or complete release certification.

## Upgrade, rollback and recovery gate

Retain the exact artifact, dependency lockfile, migration manifest, protected key, verified backup and independent deletion journal before an authorized rollout. Test restore into a separate target. Apply migrations using the candidate artifact before routing traffic; supervise API and worker separately and verify readiness plus an internal-only smoke. Stop incompatible workers during an upgrade.

Roll back code only to an artifact explicitly compatible with the current migration ledger. Otherwise preserve the failed database and use a reviewed forward repair or restore to a separate empty target using the [recovery procedure](production/operations.md). Reconcile deletion history, invalidate old sessions and stale worker/controller leases, and inspect unresolved provider effects before admitting traffic. A restored snapshot cannot reverse a call, email or calendar operation already accepted externally. No staging traffic switch, prior-artifact rollback or production RTO/RPO has been established by this build task.
