# Paste this prompt into Sol / Codex

You are the lead engineer and orchestrator for **klnk** (repo `velickovski/klnk`, local path `C:\Users\andre\Downloads\Majstor\klnk`). Your job is to turn the current local candidate into a product that works for a real user on a real iPhone and can be deployed. Implement, test and push working code. Do not stop at a plan or write another prompt.

A five-reviewer audit dated 2026-10-28 is in `docs/review/2026-10-28/`. Read all five reports before editing: `review-functionality.md`, `review-backend.md`, `review-frontend.md`, `review-security.md` and `review-quality.md`. They cite file:line evidence. Treat those citations as starting points and verify them against the current code before changing anything. Where this prompt and older prompts disagree, this prompt wins: `docs/production/00-sol-orchestrator-prompt.md`, `docs/agent-network/00-sol-prompt.md` and `docs/design/07-sol-build-prompt.md` are historical.

## Product direction (decided)

klnk is **the internal agent network**: "your agent talks to their agent". The Inbox, Calendar, People, Memory and Settings run between registered members, and the owner speaks to the agent through the one-button **Call klnk** opening. The older telephone/mission product (ElevenLabs/Twilio calling, missions, voice clones, `apps/voice-demo`) is **legacy**. Isolate it behind a build/runtime flag in M1 and delete it from the shipped app in M5. Keep the Google Calendar code only as a future read-only free/busy source.

Keep these: React Native/Expo, TypeScript, Fastify, PostgreSQL, the shared domain schemas, the navy/pale-lavender/coral visual direction with original artwork, server-held OpenAI keys, durable owner-bound tasks, canonical proposals with atomic agreements, and "incoming text is data, never authority".

## Baseline today (verified 2026-10-28)

- `npm run typecheck`, `npm run typecheck:e2e` and `npm run demo` pass. `npm test`: 662 passed, 20 skipped (the opt-in real-Postgres suites), in about 5 minutes. All 45 Playwright journeys pass with a matching browser build.
- **CI is red**: `npm audit --audit-level=high` fails on 3 highs in the zod 3.25.76 copy nested inside `@expo/cli`, so e2e never runs in CI.
- There is no lint or formatter, and the source is hand-minified (lines up to 1,919 characters). There is no Dockerfile or deploy path, and logging is off (`logger:false`).

## Orchestrate real subagents

Spawn real workers with your subagent tool, in waves sized to your available concurrency. You own the shared files: `App.tsx`/navigation, API and domain contracts, `packages/domain`, migrations, package manifests, theme primitives, CI and final integration. Each worker gets one card below and owns a disjoint set of files. Workers ask you for shared changes; they do not edit shared files themselves. Track every card in `docs/review/2026-10-28/STATUS.md` with its owner, files, status, checks actually run and evidence.

Every worker report states: changed files, contract changes requested, exact commands run with their results, regression tests added, remaining limitations. An independent QA worker re-verifies each milestone; no worker certifies its own work. Never mark a milestone done while a required check is failing or unrun.

## Milestones

### M0 — Green, readable baseline (you + Quality worker)
1. Fix CI. Add an npm `overrides` entry so `@expo/cli` gets a patched zod (≥4.6.6, or the patched 3.x line if one exists). Never downgrade expo. Verify that `npm audit --audit-level=high` passes, then confirm CI reaches e2e.
2. Add Prettier and typescript-eslint (`no-floating-promises`, `no-explicit-any` as a warning that becomes an error later, `no-misused-promises`). Land **one mechanical formatting commit with no behavior changes** before any feature work, and gate `lint` and `format:check` in CI. Add `.nvmrc` and align Node: either raise `engines` to 24 or add Node 22 to CI.
3. Add a Postgres service container to CI with a `test:pg` script, so the opt-in real-Postgres suites (`tests/qa-*postgres*`, `credential-clock`) run on every push. Remove the hard-coded `127.0.0.1:55432` in favour of an environment variable. Make `playwright.config.ts` accept an `executablePath` override, and document `e2e:build`/`e2e` in the README.
4. Speed up the unit suite. Snapshot one migrated PGlite database and clone it per test instead of migrating each time. Target under 2 minutes. Replace the fixed sleeps in `tests/platform-runtime.test.ts:26` and `e2e/browser/boundaries.spec.ts:77` with waits on a condition.

### M1 — Fix confirmed bugs and P0 security (Platform worker + Security worker)
1. **Worker hooks**: `worker-main.ts` never sets `engine.googleRevoke`, `googleCalendarAccess` or `toolMaintenance`, which `app.ts:37-38,72` does set. Build the Engine through one shared composition root used by both `main.ts` and `worker-main.ts`. Add a test that runs the standalone worker and asserts Google revocation and tool-retention sweeps actually execute.
2. **Rate limiting**: `keyGenerator` uses `r.ownerId ?? r.ip`, but the limiter runs `onRequest`, before auth sets `ownerId`. Set `trustProxy` from validated config, apply per-owner limits after auth, and add per-email login throttling with lockout. Use a shared store (Postgres or Redis) so limits hold across instances. Add tests for both the proxy and the per-owner behavior.
3. **Worker poison-pill**: one non-`HttpError` from a task (`coordination.ts:155-170`, `engine.ts:126`) stalls every queue silently. Isolate each task with its own try/catch, backoff, an attempt count and a dead-letter state. Record the sweep timestamp before running the sweep. Add an overlap guard so a new tick cannot start while the previous one is still running (`coordination.ts:149`). Add regression tests with a corrupt payload.
4. **Google OAuth login CSRF**: the callback (`google-calendar.ts:109-134`) is unauthenticated and not bound to the browser that started the flow, so an attacker's consent link can attach a victim's calendar to the attacker's account. Bind the flow with an HttpOnly SameSite cookie set at start and checked at the callback, or complete it through an authenticated app deep link. Add an exploit regression test.
5. **Prompt-injection surface**: add max lengths and a character policy to `ProfileSchema.name`, `tone` and `pronunciation` (`packages/domain/src/core.ts:12`). Wrap peer-supplied strings in the owner's model context as clearly delimited data. Require owner confirmation for voice `network_request_submit` of kind `inform` (exact readback) unless the owner dictated the exact message. Make recipient resolution exact by member ID: ask a clarifying question on ambiguous names instead of substring matching. Add tests that use malicious display names.
6. **Production safety**: validate all config with zod at startup and fail fast. When `NODE_ENV` is missing or a value is invalid, default to production behavior: no `/auth/demo`, no auto-generated encryption key, no PGlite. `/health` must not reveal which providers are configured; put the detailed readiness behind an operator token.
7. Turn on structured logging (pino with request IDs and redaction of tokens, PII and transcripts). Log 500s and worker errors instead of swallowing them.

### M2 — Make the core product actually usable (Voice worker + Onboarding worker + Network worker)
1. **Call klnk must work outside localhost.** Today `localOnly()` (`openai-live.ts:36-41`) blocks every non-loopback request, and `useLiveConversation.native.ts` always errors.
   - Build authenticated, per-owner, rate- and budget-limited Live session minting that works in production. Use ephemeral client secrets so the API key never leaves the server.
   - Implement a documented Expo-compatible native transport (WebRTC via a supported config plugin), with microphone permission, audio-session/route/interruption handling and a hard session cap.
   - Until the native transport is device-verified, the native hero button must run the existing recorded-turn path (`voice-io.native.ts`) inside the network workspace. It must never be an action that can only fail.
   - Show **Open workspace** whenever voice is unavailable, not only after a failed attempt.
   - Remove the signed-out silent `/auth/demo` account creation from `browser-live.ts:94`.
2. **Onboarding from sign-up to first value.** Today a plain message needs both members to have enabled policies, mutual trust and *exact* topic-string matches.
   - Plain `inform` messages between accepted connections are deliverable by default. Topic gating applies only to autonomy: automatic answers and meetings.
   - Ship sensible default rules, presented as a short guided first-run setup after the first Call klnk, never as a form on the opening screen.
   - Replace raw `klnk_…` code swapping with share links or a QR code plus deep-link acceptance.
3. **Account lifecycle**: email verification, password reset, change of email or password, "sign out all sessions", idle session timeout, and re-authentication for `DELETE /account` and `GET /export`. Move delete/export into the network Settings. Make registration not reveal whether an email already exists.
4. **Network completeness**:
   - The recipient can answer a question; today questions end unresolved when no matching memory exists.
   - The recipient can counter-propose a meeting time (the contract already lists counter-proposals).
   - Connections: re-invite after a decline, unblock and remove. Mute only silences notifications and no longer blocks requests.
   - Saving an unrelated setting must not invalidate every in-flight request (`policy.ts:24`); only revoke what the change actually affects.
   - Prompt the owner to renew a policy before its 30-day expiry.
   - Owners can add manual busy blocks. Automatic meeting acceptance must not run without some availability source.
5. **Liveness**: notices link to their conversation. Add unread badges on the tabs. Refresh on app foreground and after every mutation, and poll or push while open. Reminders must actually alert: local notifications on native, with APNs as a later gated step.

### M3 — Frontend architecture and design (Frontend worker + Design/A11y worker)
1. Add a real router (expo-router or React Navigation) with deep links and URL sync on web. Give each panel its own scroll container, and lazy-mount panels instead of mounting all nine with `display:none`. Open details in the existing `DetailSheet`, which already handles focus. Split `AgentApp` (`App.tsx:49-147`) and `InboxContent`.
2. Add a shared data layer (TanStack Query or equivalent). Every connections fetch goes through one cache key (today it is fetched four times), with mutation invalidation and refetch on foreground. Fix CalendarPanel's missing `onConversation` (`Workspace.tsx:85`).
3. No machine formats in the UI. Use native date/time pickers with presets, and choose the timezone from the device with a searchable override. Format all timestamps through one shared `Intl` helper. Never show proposal hashes to users.
4. Design system:
   - Add Switch/Checkbox/Chip primitives with `accessibilityState.checked`, plus a compact weekday chip control.
   - Give the coral primary button a ≥3:1 non-text contrast edge and a visible pressed state, and extend `design-contrast.test.ts` to non-text contrast.
   - Reconcile `tokens.ts` with `docs/design/03-design-system.md`, rename misleading tokens ("green" and "blue" that render maroon and lavender), and remove hard-coded hex values and ad-hoc font sizes.
   - Use `AppScreen`/`AppText` everywhere. Honour reduced motion and reduced transparency.
   - Add shared Loading/Empty/Error components.
5. Copy: one scope sentence per screen, caveats in a single "How this works" disclosure, and whole-card tap targets.
6. Use FlatList for every list. Stop full-tree bootstrap re-renders. Captions are bounded and auto-scroll to the newest turn.
7. `?preview=iphone`, `?workspace=1` and `?legacy=1` become dev-only.
8. Update `docs/design/04-screen-specifications.md` with the actual default workspace (Inbox/Calendar/People/Memory/Settings) and re-shoot the visual QA evidence for it. The current evidence shows only the legacy shell. Add React Native Testing Library component tests for each panel's loading, empty, error and populated states.

### M4 — Backend architecture for multi-instance production (Platform worker + Data worker)
1. Add indexed lookup columns built from the existing `db.keyedDigest` next to the encrypted payloads, with a migration, a backfill and a checksum test. Replace every whole-table decrypt scan: member-code invite lookup, webhook call-attempt matching, account-deletion reminders, request limits, `findRequest`, and `available()` per slot.
2. Run one job runner for both legacy jobs and network tasks, with leases, `FOR UPDATE SKIP LOCKED`, fencing, backoff and dead-lettering. Elect a single leader for maintenance sweeps with `pg_try_advisory_lock`. Do not rewrite waiting tasks every second.
3. GETs are read-only: drop `FOR UPDATE` from read paths, and stop `GET /network/identity` and `GET /network/policy` from writing. Fix the voice-session lost update (`voice.ts:97-121`) with a revision check. Move the in-memory Live and delegation maps to Postgres so no sticky routing is needed.
4. Layering:
   - Split `app.ts` into per-module Fastify plugins (auth, network, voice/live, integrations, account, legacy), each organised as routes → service → repository.
   - Use `@personal-agent/*` workspace imports instead of relative source paths.
   - Move the OpenAI call and model name out of `owner-intent.ts` into `packages/providers`, with the model name in config.
   - Type the DB rows and schema-validate every decrypted payload.
5. Encryption: bind AES-GCM ciphertext to `{table,id,owner}` with associated data, and add key versioning and a rotation path. Set retention for voice turns and synthesized audio, and cut the 15 MB `/voice/turn` body limit to what is actually needed.
6. Deployment: add a multi-stage Dockerfile that builds JS (no `tsx` in production), a migration step, health and readiness endpoints, graceful shutdown that drains workers, and security headers (`@fastify/helmet`). Write a documented deploy and rollback runbook tested against a disposable Postgres. Add CodeQL, Dependabot and secret scanning. Add metrics for queue depth, failed jobs and model spend.

### M5 — Remove the legacy product (Cleanup worker)
Delete the legacy stack from the shipped app and server once M2/M3 replace the screens it still provides (account delete/export, recorded voice):
- `engine.ts` mission paths, `voice.ts` telephone parts, the ElevenLabs/Twilio providers, mission routes, voice-clone endpoints, `App.tsx:124-193` and the legacy mobile screens, and `apps/voice-demo`;
- the duplicate 1.2 MB `klnk-presence.png`.

Keep a git tag of the last legacy commit. Provide data migrations for existing legacy records, or document their removal.

Rewrite the docs to match the product:
- README, AGENTS.md, `docs/ARCHITECTURE.md`, `docs/CAPABILITIES.md` and `docs/API.md` describe the network product.
- Move the telephone docs to `docs/legacy/`.
- Stop committing bulky screenshots and evidence JSON. Keep evidence in CI artifacts and summarise it in STATUS.

## Rules
- Make small, verifiable commits, each with tests. Run `npm run typecheck`, `lint`, `npm test`, `test:pg` and `e2e` before every push, and report the actual results. Add a regression test for every bug fixed.
- Never fabricate call progress, transcripts, outcomes, agreements or enabled integrations. Keep simulation visibly labelled and unavailable features honestly gated.
- Model output and peer content never become authority. Every disclosure and commit re-checks current accounts, connection and policy revisions.
- No new billable infrastructure, real third-party calls or messages, real calendar writes, public deployment, cloud builds, signing or App Store submission without my explicit approval. Prepare everything up to that line and tell me exactly what you need.
- Distinguish evidence types: local simulation, real OpenAI, browser, simulator and physical iPhone. Browser success is not device evidence.

## Definition of done
- CI is green on every push, covering lint, format, typecheck, unit, real-Postgres, e2e and audit.
- A new user on a physical iPhone can sign up, verify email, connect to a second member via a link or QR, send a message, ask a question that gets answered, and agree a meeting by voice or text. Both owners see the result with live updates.
- Every P0/P1 finding in `docs/review/2026-10-28/` is fixed with a regression test, or explicitly deferred with a reason in STATUS.
- The app runs as two or more API instances plus a worker against Postgres with correct rate limits, job leasing and sweeps, using a tested Docker deploy/rollback runbook.
- A candid remaining-blockers list: device, signing, accessibility with real assistive tech, and anything that needs my approval.

Start now: reproduce the baseline, create STATUS.md, and spawn the M0 Quality worker and the M1 Platform and Security workers in parallel.
