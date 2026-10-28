# Backend architecture & code quality review (klnk)

**Scope read:** docs (ARCHITECTURE, API, 03-contracts), every file in `apps/server/src/**`, `packages/{domain,providers}/src`, migrations 001–008. `tsc --noEmit` passes.

**Size:** line counts understate how big these files are. The code is very dense (58 lines over 400 characters; `openai-live.ts:22` is 1,919 characters on one line). Measured in bytes: `engine.ts` 45 KB/461 lines, `app.ts` 34 KB/345, `openai-live.ts` 33 KB/425, `google-calendar.ts` 32 KB/303, `voice.ts` 32 KB/303, `domain/core.ts` 29 KB, `network/coordination.ts` 28 KB/213, `providers/index.ts` 28 KB. About 197 KB of server code belongs to the legacy telephone/ElevenLabs/Twilio/Google path. The new `network/` path is about 102 KB.

## P0: correctness bugs with a traced path

1. **The standalone worker is missing its hooks, so cleanup and retention silently stop.** `app.ts:37-38,72` sets `engine.googleRevoke`, `engine.googleCalendarAccess` and `engine.toolMaintenance` on the Engine after it is built. `worker-main.ts:9` builds `new Engine(db,config)` and never sets them. When the documented split deployment runs (`EMBEDDED_WORKER=false` plus `npm run worker`):
   - every `google_revoke` job throws `'Google cleanup unavailable'` (`engine.ts:178`), retries 5 times and ends `failed`, so the OAuth token is never revoked after account deletion;
   - Google `calendar_update` actions fail (`engine.ts:413`);
   - `gateway.sweepRetention` never runs, because `engine.ts:391` uses `?.` and skips it. Tool-argument digests are never redacted and `tool_trace` rows are never purged, which breaks the documented 7-day / 24-hour retention.

   In a mixed deployment where API instances also run the embedded worker, whether a job succeeds depends on which process happens to claim it. Fix: inject these as constructor dependencies through one shared composition root.

2. **Rate limiting is effectively global per IP and ignores the owner.** `app.ts:44` uses `keyGenerator: r => r.ownerId ?? r.ip`. `@fastify/rate-limit` runs on `onRequest` by default (`node_modules/@fastify/rate-limit/index.js:13`), and `ownerId` is only set later in the `preHandler` hook (`app.ts:52-56`). So the key is always the IP. `trustProxy` is not set, so behind a load balancer every user shares one bucket: 100 requests/min overall, 5/min for register, 10/min for owner intents (`network/routes.ts:60`). Fix: set `trustProxy`, and either move rate limiting to `preHandler` or key it on a token hash.

3. **One bad task can stall the network worker, with no log.** `coordination.ts:155` selects the same 20 oldest tasks every second. Any error inside a task that is not an `HttpError` (decryption failure, ZodError from `calendar.commit` at `calendar.ts:48`, a pg error) is rethrown at `coordination.ts:170`. That aborts the whole loop and is then swallowed by `.catch(()=>{})` at `coordination.ts:211`. The transaction rolls back, so the task keeps its old `updated_at` and comes back first on the next tick, and every task behind it starves. The legacy engine has the same pattern: `engine.ts:126` runs `sweepRetention` before claiming a job, and `lastRetentionSweep` is only set after the sweep succeeds. So one corrupt `voice_turn` or attempt payload makes the sweep throw every 750 ms, and no job is ever claimed again (the error is swallowed at `engine.ts:52`).

## P1: architecture, concurrency and scalability

4. **Network ticks can pile up and exhaust the connection pool.** `tick()` (`coordination.ts:149-152`) starts a new `runTick` every second even while earlier ticks are still running; `activeTicks` only tracks them. The hourly full sweep (`preferences.ts:35-51`) runs one transaction per conversation, so it easily takes more than 1 s. Ticks then accumulate on the shared `pg.Pool` (`max:8`, `db.ts:42`), which the HTTP traffic also uses in embedded mode. Fix: add a `running` guard like `Engine.tick` has.

5. **The design does not scale to multiple instances.**
   - Network tasks are not claimed with `SKIP LOCKED` or a lease. N workers all pick the same 20 rows and queue up on the same owner row locks (head-of-line blocking).
   - Tasks waiting for approval are rewritten every second (`coordination.ts:162`, which re-encrypts the payload and bumps `updated_at`), so idle conversations cause constant writes.
   - All three retention sweeps run hourly on every instance with no leader election (`engine.ts:367-391`, `gateway.ts:179-188`, `preferences.ts:35`).
   - The legacy engine processes one job per 750 ms per process (`engine.ts:130`).

6. **Encrypted blob storage forces full-table scans that decrypt every row.** `resources` and `network_records` keep every queryable field inside AES-GCM JSON. Lookups therefore decrypt whole tables:
   - `invite`: every identity record in the system (`coordination.ts:36-37`);
   - the ElevenLabs webhook: every user's attempts (`app.ts:337-338`);
   - account deletion: every reminder and outbox row (`data-lifecycle.ts:75`);
   - the submit rate check: every conversation of the recipient (`coordination.ts:86`);
   - `findRequest`: the whole inbox, called up to 4 times per owner-intent command (`coordination.ts:101`, `owner-intent.ts:39,51,52,129`) and also used by `routes.ts:78`;
   - `available()`: re-parses every event of an owner for each candidate slot (`calendar.ts:35`).

   `db.keyedDigest` already exists (`db.ts:114`). It can be used for blind-index columns (`member_code_digest`, `provider_conversation_digest`, `request_id`, `conversation_id`, `event_id`).

7. **Lost update on voice sessions.** `voice.ts:97` reads the session outside any transaction. `voice.ts:121` writes it back after only checking `privacyVersion`, with no revision check. Within one process, turns on the same session are ordered by an in-memory Map (`voice.ts:61-62`). Across instances, two concurrent turns on the same session will drop one history entry. `openai-live.ts:80` and `openai-tool-delegation.ts:33-35` also keep in-memory session maps, so they need sticky routing.

8. **No observability.** `Fastify({logger:false})` (`app.ts:40`). The error handler turns 500s into a generic body and logs nothing (`app.ts:57-64`). Both worker loops swallow errors (`engine.ts:52`, `coordination.ts:211`). The whole server has three `console.log` calls. There are no metrics on queue depth or failed jobs, and no request IDs. `/ready` (`readiness.ts`) is the only signal, yet the docs ask an operator to "monitor failed jobs".

9. **Layering and boundaries.**
   - Route handlers contain domain transactions and raw SQL: account deletion (`app.ts:302-327`), webhook matching (`app.ts:328-340`) and `resolveToolAccess` (`app.ts:76-89`).
   - `Engine` is a god class: mission authorization, job runner, leases, retention and provider calls.
   - Network authority is passed implicitly through `AsyncLocalStorage`, which changes what the low-level `lockNetworkOwners` does (`store.ts:8,18-24`). Any async work started from inside a request inherits it.
   - The server imports workspace packages by relative source path in 20 places (`'../../../../packages/domain/src/network.js'`) instead of `@personal-agent/domain`.
   - `owner-intent.ts:72-74` calls OpenAI directly with a hardcoded `model:'gpt-6.1-sol'` instead of going through a `packages/providers` adapter.

10. **GET requests take write locks and write data.** Every network read takes `SELECT … FOR UPDATE` on the user row (`store.ts:15`) through `identity`, `inbox`, `detail`, `policy`, `calendar.list` and `notifications`, which serializes reads against the worker. `GET /network/identity` (`coordination.ts:32`) and `GET /network/policy` (`coordination.ts:68`) also write records.

## P2: quality and hygiene

11. **Config is not validated.** `config.ts` has no schema: `PORT` can become `NaN`, and a typo in `CALL_PROVIDER` silently falls back to `simulator`. The `Config` type is built by awkward `Omit` gymnastics (`config.ts:2`).
12. **Typing.** `Row = Record<string, any>` (`db.ts:9`) feeds every query. Counts of explicit `any`: `app.ts` 24, `engine.ts` 20, `voice.ts` 12, `gateway.ts` 9. Network receipt and outbox values are `list<any>` (`preferences.ts:23,28`). Payloads from the database are decrypted without schema parsing on most paths.
13. **Duplication.**
    - A UUID-from-hash helper is copied 5 times (`coordination.ts:15`, `calendar.ts:14`, `policy.ts:95`, `preferences.ts:8`, `owner-intent.ts:23`).
    - The lock pattern "lock user `FOR UPDATE` then resource `FOR UPDATE`" is repeated at least 12 times in `engine.ts`.
    - `receipt` and `receiptIn` are identical (`owner-intent.ts:33,47`).
14. **Schema friction.** Every new kind rewrites the `resources.kind` CHECK constraint (migrations 002/005/006/008). `audit` has no index on `owner_id`, yet it is deleted by owner (`app.ts:325`). `network_records` foreign keys have no `ON DELETE` rule, which only works because users are tombstoned and never deleted.
15. **Backups load the entire database into one in-memory JSON string** (`db.ts:123-133`), which will not scale.
16. **Embedded-mode difference.** PGlite serializes everything through a single promise queue (`db.ts:87-95`). An un-scoped `repo` or `db` call inside a transaction deadlocks under PGlite but only waits on a lock under Postgres, so local tests do not exercise production concurrency.

## Target architecture

- A `composition-root.ts` shared by `main.ts` and `worker-main.ts`.
- `modules/{auth, network, legacy-telephony, integrations/google, voice-live}`, each split into `routes → service → repository`.
- Typed repositories per aggregate, holding encrypted payloads plus plaintext or HMAC index columns.
- One generic job runner (lease + `SKIP LOCKED` + backoff + dead-letter + structured logs) used by both legacy jobs and network tasks. Network tasks would become `jobs` rows, or `network_records` would gain `lease_*` columns.
- Leader-elected periodic maintenance using `pg_try_advisory_lock`.
- A zod-validated config.
- pino logging with request IDs, plus metrics for queue depth, failures and lease losses.
- Legacy telephony moved behind a feature flag and module boundary, ready to delete.

## Incremental refactor sequence

1. Fix P0s 1–3. Small diffs: constructor injection plus a shared builder, `trustProxy` plus moving the rate limiter after auth, a per-task try/catch with backoff/dead-letter, and setting `lastSweep` before the sweep runs.
2. Turn on logging and the error-handler log. Add the tick overlap guard.
3. Add a migration with digest and index columns and backfill them. Replace the full scans one call site at a time.
4. Extract the job runner. Move network tasks onto leases and `SKIP LOCKED`. Add leader election for sweeps.
5. Split `app.ts` routes into per-module plugins. Replace relative package imports with workspace imports. Move the OpenAI call into `packages/providers`.
6. Remove `FOR UPDATE` from read paths (use plain reads plus session validation) and make GETs side-effect-free.
7. Quarantine and then delete the legacy telephony, ElevenLabs, Twilio and Google modules once the product commits to the network path.
