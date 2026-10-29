# Compiled server and container preparation

Owner: `/root/security`, on the subsequent Build/Deploy preparation card. Root retained package manifests, CI, runtime/config composition and final integration. No external deployment was performed.

## Files

- `scripts/build-server.ts`: esbuild Node 24 ESM bundles for API, worker and migrations; shared domain is bundled, npm dependencies remain external. Copies all eleven original migration files to the path resolved by bundled `import.meta.url`, and writes a checksummed artifact manifest. Generated output is fixed to `dist/server`; linked output directories are rejected before replacement.
- `scripts/compiled-smoke.ts`: guarded PostgreSQL, actual compiled-process smoke. Refuses ordinary application database fallback, non-loopback endpoints and databases other than the dedicated `klnk_qa` fixture. Allocates/drops only its own random schema. Runtime children use a strict environment allowlist and empty temporary working directory, excluding repository dotenv/provider keys and TypeScript loaders. Output contains fixed result metadata rather than captured raw child diagnostics.
- `Dockerfile` and `.dockerignore`: multi-stage build/production dependencies; explicit server/root workspace selection; unprivileged final user; compiled API default, private readiness probe and documented worker override. Local credentials, generated data, Git history and client build folders are excluded from the build context.
- `docs/OPERATIONS.md`: current build/start configuration, exact proxy/HTTPS boundary, container preparation, actual smoke evidence, upgrade/recovery pointers and unverified gates. The old operations document's historical migration/local-only descriptions are identified as superseded.

Requested root contracts: five npm scripts (`build:server`, `start:server`, `start:worker`, `db:migrate:compiled`, `test:compiled`), direct pinned esbuild development dependency, and an opt-in compiled PostgreSQL CI gate. Root approved these; this worker did not edit manifests or CI. The runner supports the existing private fixture file or the explicit CI-only `KLNK_TEST_POSTGRES_URL`, with no application URL fallback.

## Actual checks

`npx tsx scripts/build-server.ts` passed: three JavaScript entrypoints and eleven migrations. The artifact manifest listed external dependencies only; no unresolved workspace or `.ts` runtime import escaped. Migration SHA-256 bytes were checked by the smoke.

`npx tsx scripts/compiled-smoke.ts`, with the existing private fixture file, passed twice after rebuilding. Actual plain-Node child processes exercised:

| Check | Observed result |
| --- | --- |
| Compiled migrations from an empty working directory | All eleven applied in the allocated schema |
| API process topology | Two API processes on 4105/4106, embedded workers disabled |
| Separate worker | One compiled standalone worker; queued work remained queued until it started |
| Exact internal message | Delivered to the recipient's internal inbox with matching text across APIs |
| Authorized internal meeting | Exactly one shared calendar event, matching identity and exact submitted start time |
| Local empty cleanup fixture | Job done once, attempt one, lease cleared; no provider deletion claimed |
| Poison ciphertext fixture | Failed at attempt five, lease cleared, healthy work completed |
| Shared owner rate limit | 100 successful responses and ten 429 responses across 110 concurrent requests to both APIs |
| Shared idle session expiry | Both APIs rejected the expired bearer |
| Shared unresolved Live metadata | Same unconfirmed receipt visible through both APIs |
| Provider unavailable | Live creation returned 503 `openai_not_configured`; no invented session |
| Cleanup | Runtime children stopped, own schema dropped and private temporary directory removed |

Local sanitized evidence is `.data/compiled-smoke.json`, ignored by Git. It states providers were unconfigured; it is not a packet capture or paid-provider usage measurement. Live paid creation concurrency/day caps remain covered by separate reservation tests, not this compiled smoke.

The final script TypeScript and ESLint checks passed without diagnostics; scoped Prettier checks passed. A harmless earlier explicit-any warning in the harness was removed using an explicit response shape. The repository whitespace check passed apart from Git's existing LF/CRLF conversion notices.

The safe manifest-only Windows production dependency dry run also passed: **110 packages planned**, no React/React Native/Expo/mobile-workspace runtime entries, and no `node_modules` created. The ignored `.data/production-deps-dryrun` folder was intentionally left in place, as requested by root. This is dependency-plan evidence, not an actual production install.

## Remaining limitations

Docker is not installed on this machine. No image build, Linux install, image scanning, runtime filesystem/TLS verification or container healthcheck execution occurred. The Node 24 base-image tag needs a reviewed digest before release. Only Windows termination was exercised; Unix SIGTERM drain and actual orchestrator supervision remain unverified. User preview services on 4000/8081 were not touched. The existing PostgreSQL fixture lifecycle remains owned by Platform/root.

No provider keys were supplied to runtime children. No real audio, phone call, SMTP message, external calendar, public deployment, signing or cloud build occurred. This is a prepared and locally compiled server artifact, not a completed public release or full M4 certification. Root must rebuild the final integrated source and run the full gates before publishing a candidate.
