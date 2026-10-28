# Independent M0/M1 platform and production-safety verification

Reviewer: `/root/security`, acting on a separate QA card after its implementation report. This review covers the **Platform worker's** composition/reliability work and the **orchestrator's** config, rate limits, logging, runtime gate and operational projections. It does not independently certify this worker's own OAuth, recipient-resolution or model-context changes; those are assigned to the Quality worker.

## Files changed by QA

- `tests/qa-production-safety.test.ts`: 16 independent cases for fail-safe configuration, proxy validation/trust, shared owner and email limits, failed-auth throttling, public/operator diagnostic separation, metadata pruning, legacy/core route separation and sanitized error logging.
- `tests/qa-worker-failure.test.ts`: two additional independent adversarial tests for transaction rollback/backoff/reconstruction and tick-overlap-guard recovery after a transient queue query failure.
- `tests/qa-rate-postgres.test.ts`: two opt-in real-PostgreSQL cases using separate connection pools and two actual Fastify instances.
- `scripts/test-postgres.ts`: added the new rate-limit suite to the required runner, with explicit orchestrator approval and coordination with its Quality owner.

No production source files were changed by this QA card.

## Findings and corrections

1. The initial trusted-proxy parser checked a permissive regular expression rather than a valid IP and CIDR prefix. The orchestrator replaced that with `node:net` IP validation and IPv4/IPv6 prefix bounds. Regressions now reject invalid addresses, oversized prefixes and blanket `true`. A runtime HTTP test proves a trusted loopback proxy may supply the client IP while an untrusted immediate peer cannot spoof it.
2. The first legacy gate also matched `/voice/live/*` and `/demo/status`, shared by the current one-button owner voice path. QA requested explicit exceptions. The corrected gate returns 404 for legacy missions, standalone demo and recorded legacy turns while local core readiness/recovery remain reachable. The Live transport's separate local-only capability restriction still applies until M2; this is not evidence of production voice.
3. The Quality worker found the pre-auth limiter bypass. QA independently verifies the integrated correction: the first 100 missing/invalid-bearer requests get 401, subsequent requests get 429 across two API instances, and a valid owner on that IP remains usable within the separate coarse perimeter budget.

## Actual commands and results

| Command | Result |
| --- | --- |
| `npx vitest run tests/qa-production-safety.test.ts tests/qa-worker-failure.test.ts tests/worker-reliability.test.ts --reporter=json --outputFile=.data/qa-production-safety-results.json` | **26/26 passed**, three files: independent safety 16, independent worker adversaries 2, Platform worker regressions independently rerun 8 |
| `npx vitest run tests/qa-rate-postgres.test.ts --reporter=json --outputFile=.data/qa-rate-postgres-results.json` with the guarded disposable connection-file environment | **2/2 passed on actual PostgreSQL** |
| `npm run test:pg` with the same guarded connection-file environment | **22/22 passed, four files, 15.99 seconds**; original three multiprocess/credential suites plus independent shared-rate suite |
| `npx eslint tests/qa-production-safety.test.ts tests/qa-worker-failure.test.ts tests/qa-rate-postgres.test.ts scripts/test-postgres.ts` | **PASS**, no diagnostics |
| `npx prettier --check tests/qa-production-safety.test.ts tests/qa-worker-failure.test.ts tests/qa-rate-postgres.test.ts scripts/test-postgres.ts` | **PASS** |

The PostgreSQL fixture was started and owned by the Platform worker. QA used the private connection file without printing credentials, created only fresh guarded `qa_*` schemas, and removed its schemas and connections after each suite. The integrated runner's 22 tests ran against the server, rather than being counted as skipped/default PGlite checks. The fixture's start/stop lifecycle remained with Platform.

## Verified behavior and limits

- A standalone child using the shared runtime composition performs injected Google token revocation and deletes an expired tool trace. Both actual entry points were inspected to use that composition. This is not a real Google provider call or a deployed worker process.
- Unreadable legacy and network job payloads consume bounded durable attempts and reach failed/dead-letter state; healthy work behind them progresses. A broken retention row does not starve queue work. An unchanged approval-waiting task is not rewritten on every tick. Network ticks do not overlap.
- An exception after a network task starts rolls back its partial proposal/messages, persists retry timing, and does not block another request. Reconstructing the coordinator preserves the delay; a later permitted retry can make progress. A queue-query failure releases the overlap guard for the next tick.
- Real PostgreSQL atomic upserts admit exactly 25 of 80 concurrent calls across independent pools. Two API instances share one owner's 100-request budget and a normalized email's ten-attempt login limit. Another owner sharing the IP remains independent of that owner's bucket. Tests also verify the raw email, owner IDs, IP and bearer value do not appear in stored rate-limit keys.
- Expired rate metadata is pruned by composed maintenance, while current windows and active lockouts remain intact.
- `/health` returns only status. Public or incorrectly authorized `/ready` reveals only readiness; detailed content-free queue diagnostics require the operator token. A thrown 500 logs fixed operational metadata and request ID, with no concrete private URL, request body, cookie, bearer, email, password, transcript or private provider error in the captured Pino output.

These checks do not establish the full requested production release. CI reachability after push, the entire final unit/browser build, all milestone cards, native transport, account recovery/onboarding, real assistive technology, signing, physical iPhone and multi-instance deployment still need their own gates. No new provider, paid model, external message/calendar action, public deployment or signing resource was used for this QA card. Fastify emitted its existing `disableRequestLogging` deprecation notice; it did not fail the checks.
