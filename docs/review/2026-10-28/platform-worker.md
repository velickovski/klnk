# M1 Platform worker report

Owner: `/root/platform`. Implementation is ready for independent QA; this report does not certify M1.

## Implemented

- Shared `createRuntime` composition supplies Engine's Google revocation, identity-checked Google Calendar access, and tool-retention hooks to the API and standalone worker. Construction starts no timers and grants no authority.
- Legacy jobs commit their lease and attempt count before decrypting their payload. Unreadable ciphertext now follows existing bounded retries, backoff and terminal `failed` handling.
- Legacy retention marks the sweep timestamp before attempting the sweep. Sweep errors no longer prevent ready jobs. Individual corrupt voice/attempt rows no longer prevent subsequent retention work.
- Network ticks have an overlap guard, preserve unchanged waiting tasks, isolate every task failure, back off persistently and quarantine unreadable tasks after five failures with `dead_letter` status.
- Network sweep errors no longer prevent healthy queued work. Participant deletion ends the stale task without allowing effects.
- Worker errors use fixed content-free event/reason classifications through the shared Pino logger. Startup/shutdown logs avoid provider configuration or content.

## Changed files

- `apps/server/src/composition-root.ts` (new shared builder)
- `apps/server/src/worker-logging.ts` (typed content-free logging boundary)
- `apps/server/src/engine.ts`
- `apps/server/src/network/coordination.ts`
- `apps/server/src/worker-main.ts`
- `apps/server/src/main.ts`
- `tests/worker-reliability.test.ts`
- `tests/worker-composition-child.ts`

## Shared integration requested from root

- `app.ts`: use `createRuntime`, remove duplicate service constructors and hook assignments.
- Migration 009: `failure_attempts`, `next_attempt_at`, `dead_lettered_at` on `network_records`; include columns in protected backups. Root supplied this migration.
- `logging.ts`: shared Pino logger. Root supplied it.
- `readiness.ts`: expose a content-free dead-letter count/degraded status for operators.
- No public domain/API contract change was required.

## Regression evidence

- `npx tsc --noEmit`: passed.
- Recheck during shared integration: failed only at `app.ts`'s Fastify/Pino logger generic boundary (root notified); this is not counted as an integrated pass. Root must repair and rerun before accepting M1.
- `npx vitest run tests/worker-reliability.test.ts`: **8/8 passed**, 17.65 seconds.
- `npx eslint apps/server/src/composition-root.ts apps/server/src/worker-logging.ts apps/server/src/worker-main.ts apps/server/src/main.ts apps/server/src/engine.ts apps/server/src/network/coordination.ts tests/worker-composition-child.ts tests/worker-reliability.test.ts`: passed with **0 errors, 20 existing explicit-any warnings**.
- `npx vitest run tests/worker-reliability.test.ts tests/engine.test.ts tests/network-coordination.test.ts tests/platform-runtime.test.ts tests/voice-retention.test.ts`: **41/41 passed across 5 files**, 24.66 seconds.

New tests verify shared hooks, actual separate child-process cleanup, integration identity mismatch, sweep failure throttling without starvation, corrupt legacy and network payload retries/quarantine, retention progress after corrupt content, network tick overlap, and unchanged waiting-row timestamps/ciphertext.

The child process opens a disposable on-disk PGlite database. Its Google endpoint transport is injected and returns a fixture response. **No real Google revocation, paid model request, telephone call or external effect was performed.**

## Remaining limitations

- Network task execution still uses owner locks rather than a shared cross-instance leased generic runner. That M4 architecture work is not claimed here.
- Periodic sweeps have a per-process timestamp, not cross-instance leader election.
- Corrupt retention rows are logged and revisited on a later scheduled sweep; they require operator repair. No private payload or raw exception text is logged.
- A dead-lettered task remains available for operator investigation; it does not invent a successful conversation outcome or automatically regrant authority.
- Standalone composition was verified in a separate process against disposable PGlite; the full multi-instance PostgreSQL milestone still needs independent verification.
