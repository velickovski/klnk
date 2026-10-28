# klnk review: build, tests, quality gates, developer experience

Local runtime: Node v22.22.0, 4 CPUs. CI uses Node 24.

## Command results (exact)
| Command | Result | Wall time |
|---|---|---|
| `npm run typecheck` (root tsc + mobile tsc) | PASS, 0 errors | 22.3s |
| `npm run typecheck:e2e` | PASS | 3.4s |
| `npm test` (vitest) | PASS: **55 files passed, 3 skipped (58); 662 tests passed, 20 skipped (682)** | 314s (5m15s) |
| `npm test` second run (JSON reporter) | 662 passed / 0 failed / 20 skipped, so the result is stable | ~5m |
| `npm run demo` | PASS, exit 0. All 8 missions run, and it prints "One existing event; updated once despite action retry." | 6.8s |
| `npm run setup:check` | exit 0. Reports provider/owner/recipient/disclosure items as missing and dialing as blocked (expected offline) | 0.6s |
| `npm run e2e:build` | PASS. Expo web export to `apps/mobile/dist-e2e`, 432 modules, 1.4MB JS bundle | 25.7s |
| `npm run e2e` (as-is) | **FAIL 45/45**. `browserType.launch: Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-1248/...`. @playwright/test 1.64.1 expects build 1248 and only 1243 is preinstalled. This is an environment problem, not a code problem. | 43s |
| `npm run e2e` with a temporary config pointing `launchOptions.executablePath` at the 1243 headless shell | **PASS 45/45** | 1.2m |
| `npm audit --audit-level=high` (a CI step) | **FAIL (exit 1)**: 8 vulns (3 high, 5 low) | n/a |

The 20 skipped tests come from the 3 opt-in real-PostgreSQL suites (`describe.skipIf(!connectionFile)`): `tests/qa-postgres-runtime.test.ts:22`, `tests/qa-network-postgres.test.ts:20` and `tests/credential-clock.test.ts:18`. The pass counts match the committed `docs/agent-network/evidence/final-checks.json:7-8` (662/55).

## P0
1. **The CI gate fails today on `npm audit`.** `.github/workflows/quality.yml` runs `npm audit --audit-level=high` before `e2e:build`/`e2e`. It exits 1 because of GHSA-mrhx-c7xc-m3w5 (zod <4.6.6) in `node_modules/@expo/cli/node_modules/zod@3.25.76` (pulled in by expo 58 → @expo/cli). The runtime `zod@4.6.7` is not affected. Because this step fails, the Playwright steps that follow never run in CI. The fix npm suggests is "expo@54 (semver major)", which is a downgrade and wrong. Use an `overrides` entry for @expo/cli's zod, or scope the audit with `--omit=dev`/an allowlist plus a tracked exception.

## P1
2. **Concurrency and agreement correctness are never tested against real PostgreSQL in CI.** All three real-PG multiprocess suites are opt-in. They need `KLNK_POSTGRES_TEST_CONNECTION_FILE` and hard-code `127.0.0.1:55432/klnk_qa` (`tests/qa-postgres-runtime.test.ts:29`). The default suite runs on a single in-process PGlite, so "concurrent ticks" tests such as `tests/network-coordination.test.ts:28` (`Promise.all([coordinator.tick(), new NetworkCoordinator(db,…).tick()])`) are interleaved async calls on one connection. They do not exercise real row locks or isolation. Add a CI job with a `postgres` service container plus `scripts/local-postgres-fixture.ts`, or loosen the guard so a CI-provided URL is accepted.
3. **No lint or format tooling.** There is no ESLint, Prettier, Biome or `.editorconfig` (repo root and `node_modules/.bin` checked). The code is hand-minified. For example, the server+packages TS is about 501KB in only about 5.1k lines. Lines run up to 1,919 chars (`apps/server/src/openai-live.ts:22`), 1,424 chars (`apps/server/src/network/owner-intent.ts:140`) and 887–1,711 chars (`openai-live.ts:20-21`). 142 server lines and 153 test lines exceed 300 chars, and `playwright.config.ts:4-11` and `tests/network-egress-guard.ts` are packed onto a few lines. This makes review, diffs and blame very hard and hides bugs. Adopt Prettier (one-time reformat commit) and typescript-eslint, with at least `no-floating-promises`, `no-explicit-any` and `no-unused-vars`, and gate both in CI.
4. **Node version mismatch.** `package.json:10` says `engines.node >=22.13`, `README.md:31` recommends Node 24, and CI pins `node-version: '24'`. Nothing tests Node 22, there is no `.nvmrc`/`.node-version`, and `@types/node ^24` allows Node 24-only APIs to typecheck while engines claims 22 works. Pick one version: either add a 22.x matrix leg or raise engines to >=24. Also add `.nvmrc`.
5. **Playwright is pinned but browser provisioning is implicit.** `playwright.config.ts` only honours `KLNK_E2E_CHANNEL`, so there is no way to supply an executable path. Any environment with preinstalled browsers of a different build fails all 45 tests in about 4ms each. This is not an issue in CI, which runs `npx playwright install` (quality.yml), but it is a DX trap. Support a `PLAYWRIGHT_CHROMIUM_EXECUTABLE`-style env and document the e2e steps. `README.md:52-60` lists typecheck/test/demo/setup:check but not `typecheck:e2e`, `e2e:build` or `e2e`.

## P2
6. **Slow unit suite.** It takes 5m15s at `maxWorkers: 2` (`vitest.config.ts`). The slowest files are `network-calendar` (65.9s), `google-oauth` (48.7s), `engine` (45.9s), `voice-planning` (44.4s), `network-owner-intent` (38.7s) and `network-voice-tools` (33.2s). Individual tests take up to 6.3s (`openai-live` "closes a provider session created after the browser aborts its SDP request"). Most of the time is per-test PGlite bootstrap and migrations. Use a shared migrated template (snapshot and clone) or per-file DBs, and consider raising `maxWorkers`. `tests/platform-runtime.test.ts:26` uses a real 320ms `setTimeout` and `e2e/browser/boundaries.spec.ts:77` uses `waitForTimeout(300)`. Both are flaky-prone fixed sleeps, though no flakes occurred in 2 runs.
7. **Test style and organization.** The tests are mostly behavioral (they go through `createApp`/`Engine`/`NetworkCoordinator` and assert on persisted state and HTTP responses), which is good. Critical paths are covered: authz and suppression (`tests/authorization-boundaries.test.ts`), review races (`tests/review-context-races.test.ts`), network I1–I3 (`tests/network-coordination.test.ts:23-102`) and voice tool schemas/idempotency (`tests/network-voice-tools.test.ts:38-134`). The weak points:
   - Each `it` packs many assertions on single long lines (e.g. `network-coordination.test.ts:29`), so one failure obscures the rest.
   - Heavy spying in `openai-live*.test.ts` (31 spy/mock calls each) couples those tests to the implementation.
   - `apps/server/src/network/routes.ts`, `network/redaction.ts`, `integrations/google-identity.ts` and `worker-main.ts` have no direct test imports. They are only covered indirectly, if at all.
   - There is no coverage reporting (`@vitest/coverage-*` is not installed), so coverage claims in the docs cannot be verified.
   - The `tests/qa-*` names mix normal unit suites with opt-in suites, so the names do not tell you which tests actually run.
8. **Docs sprawl and repo hygiene.**
   - 205 of 428 tracked files are under `docs/`, about 72.8k words of Markdown: `docs/production` has 104 files, 2.1MB and 35k words; `docs/agent-network` has 59 files, 1.6MB and 11k words; `docs/design` has 25 files and 13k words.
   - 74 PNGs, 8 JPGs and 42 JSON "evidence" files are committed, including SHA-256 manifests (`docs/production/reports/M2-requests-sources.sha256.json`, `M3-voice-sources.sha256.json`) that go stale on any edit, and point-in-time test-count snapshots.
   - `AGENTS.md` routes contributors through orchestrator "prompts" (`docs/production/00-sol-orchestrator-prompt.md`, `docs/agent-network/00-sol-prompt.md`) that are process artifacts, not product docs.
   - `apps/mobile/assets/klnk-presence.png` and `apps/voice-demo/assets/klnk-presence.png` are byte-identical 1.2MB duplicates, and the asset ships 1.2MB into the web bundle.
   - Recommendation: move evidence and screenshots to CI artifacts or releases, collapse the docs into README + ARCHITECTURE + API + SECURITY + OPERATIONS, and shrink the PNG.
9. **Gaps in CI/script coverage.**
   - CI does not run `npm run setup:check` (cheap, offline).
   - CI has no npm cache (`package-manager-cache: false`), which is fine but slow.
   - There is no `lint` or `format:check` script.
   - `apps/voice-demo/app.js` is plain JS outside any typecheck (root `tsconfig.json` includes only `.ts`).
   - There are no `test:watch`, `test:pg` or `check` (all-gates) scripts. Add `"test:pg"` that sets up the fixture and runs the 3 opt-in suites.
10. **tsconfig.** `strict: true` everywhere, which is good. `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `noImplicitOverride` are not set, and `skipLibCheck` is on. These are reasonable but could be tightened for a security-sensitive server.
