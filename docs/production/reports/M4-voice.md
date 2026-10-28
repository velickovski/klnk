# Voice / M4 delegation and owner recovery / local checks passed

Date: 27 October 2026. Host: Windows, Node 24 / Expo 58. Source identity: [SHA256 manifest](M4-voice-sources.sha256.json). No provider traffic was initiated by this worker for M4. Root owns the separate bounded provider diagnostic and its evidence; this report does not promote a failed or unobserved delegation into success.

## Owned implementation

- `apps/server/src/openai-live.ts`
- `apps/server/src/openai-tool-delegation.ts` (new)
- `tests/openai-live-tools.test.ts` (new)
- Additional owner-recovery lease: `apps/mobile/src/features/live/browser-live.ts`, `payloads.ts`, `useLiveConversation.web.ts`, and `apps/mobile/test/voice-live.test.ts`.
- This report and its source manifest.

Requests, shared App/API/domain/configuration, service credentials, native transport and package manifests were not edited during this card. Root integrates callback/runtime access, API response schemas and recovery-only launch UI.

## Trusted binding and protocol

The broker accepts optional `toolGateway` and `resolveToolAccess(ownerId, authorization?, authorizedMissionId?)` dependencies. The route passes the authenticated bearer only to the trusted resolver. The resolver's hash, owner binding and optional approved-request context remain ephemeral on the server; no raw bearer, auth hash, owner identity or grant is sent to OpenAI. The advertised function schemas come only from the existing application registry intersected with the resolved grant.

An explicit `authorizedMissionId` must have a matching, available nonempty tool binding **before durable reservation or provider creation**. Undefined, empty, foreign/unavailable or mismatched binding fails closed. Without a grant and without an explicit approved-request binding, the original no-tools configuration and honest no-service instructions remain.

Model/voice/backend remain `gpt-live-1` / `marin` / `gpt-6.1-sol`. The browser's allowed outgoing events remain only close/mute/unmute. No production or nonloopback guard changed. Recovered sessions obtain no tool context and only reconcile/close their existing identity.

The ephemeral helper correlates the outer delegation and nested `response.created` ID. It collects only completed `function_call` items from nested `response.output_item.done`; transcripts, argument deltas and empty `response.completed.output` snapshots do not create actions or prove spoken delivery. It waits for complete batches, submits matching `response.item.create` function outputs, then sends one `response.create` when all currently pending results are supplied. It does not retry ambiguous sends or create another paid session.

Bounds: four calls per response, sixteen call identities per session, eight actual invocations per minute, eight continuations, twenty-four response records, sixteen active delegation associations and sixteen outstanding announcements. Duplicate calls are deduplicated; changed/reused identities, malformed correlation, excess budgets, rejected tool commands or invalid Responses configuration close the same session without new tool execution. QA found the original announcement map lacked a bound; the new limit and conflict checks resolve that finding, and the independent regression passes.

The helper rechecks trusted access before invoking and before sending a result. The gateway independently rechecks owner, bearer hash, controller lease, grant and immutable authorization inside its SQL operation. Retrieved/tool text remains untrusted. Structured proposed, blocked, queued or unknown states keep their meaning. Sent results explicitly do not claim spoken delivery. Invalid/oversized output or an accidental auth-hash echo becomes a sanitized uncertain result.

Closing stops admission immediately, persists closing before allowing another gateway operation, requests provider closure and awaits already-started callbacks. No result/continuation is sent after cancellation, lost ownership or closure. An atomic operation that wins before closing remains recorded; transport cancellation does not roll back a committed effect. External effects remain disabled by the shared gateway configuration.

## Owner recovery

`GET /voice/live/recovery` retains the existing authentication/local guard and returns only the owner's unresolved receipt metadata in the same shape as `readRequest`. Listing performs no new session creation or tool invocation and does not free unresolved capacity.

The Expo browser controller checks authenticated recovery on mount/restoration and before capture/paid start. A known ID is ended/read back through its original receipt. A no-ID receipt remains visibly uncertain and blocks a new paid start. Recovery never acquires a microphone automatically. Normal refresh does not replace a current connecting/connected session or its captions. Late responses from an old identity, origin or disposed controller are ignored.

A refreshed credential is adopted for cleanup only when an authenticated server response establishes the same globally identified receipt/provider session, or the original credential still identifies the request. Another account reusing a request UUID cannot clear the old receipt. Old IDs are not sent to a different server origin. A concurrent-device reservation denial triggers read-only recovery of the actual existing request instead of blindly retrying creation.

Limit: the standalone demo keeps its anonymous credential only in page memory. Losing that credential cannot establish ownership of its old receipt; no fabricated recovery or automatic paid replacement is provided. An old client reference with only a request UUID and no receipt/provider identity cannot prove same-owner reauthentication solely from a new credential; authenticated fresh-owner recovery remains available on a fresh controller. Unknown creation identity still needs provider/operator reconciliation.

## Checks actually run

| Check | Result |
| --- | --- |
| `npx vitest run tests/openai-live-tools.test.ts` | Passed: 31 deterministic helper/broker binding cases after the QA budget repair |
| `npx vitest run tests/qa-live-tools.test.ts` | Passed: 6 independent actual app/gateway boundary cases, including orphan announcements |
| `npx vitest run apps/mobile/test/voice-live.test.ts` | Passed: 60 cases including authenticated recovery, stale epochs/origins, no-ID blocking and foreign UUID collision |
| Combined protocol + independent QA + existing broker + browser controller | Passed: 127 tests in 4 files |
| `npm run typecheck` | Passed: root and mobile after the QA test annotation repair |
| `npm exec --workspace @personal-agent/mobile -- expo export --platform web` | Passed: 418 modules; packaging only |
| Earlier full `npm test` before final QA/client additions | Passed: 523 tests / 44 files; 9 real-PostgreSQL tests skipped |
| Final full `npm test` | Passed: 550 tests in 47 files; 9 real-PostgreSQL tests / 1 file skipped. This is not a real PostgreSQL verification pass |

All provider sockets in this worker's M4 tests are deterministic doubles. The positive lookup test does use the real `ApplicationToolGateway` with an isolated PGlite owner/grant/session and verifies lookup output plus sanitized trace. Negative tests cover model-supplied owner fields, missing/foreign binding, multiple calls, duplicate delivery, changed arguments, cancelled responses, delayed results, revoked grants, session closure, output identity, budgets and provider-command rejection. These do not establish native or live-provider tool behavior.

## Review, dependencies and limits

Root source review found no concrete authority defect, then requested the explicit-binding precondition, which now has zero-paid-request regressions. Independent QA exercised the actual Root callback/gateway boundary and found the announcement-budget issue; that issue is repaired and retested. Root owns final review of the latest client recovery and launch typed-recovery affordance.

Official OpenAI documentation fetched before changes: [Delegation and tools](https://developers.openai.com/api/docs/guides/live-delegation), [session lifecycle](https://developers.openai.com/api/docs/guides/live-conversations). The documented result events have no separate success acknowledgement; an appended/continued backend result does not prove playback or that the caller heard it.

Still required: Root's evidence-backed real OpenAI tool smoke, full rendered recovery/reauthentication walkthrough, signed-iPhone transport/audio/accessibility tests, real PostgreSQL process failover and release/security/accessibility gates. A normal browser start supplies no approved-mission binding, so mutating tools cannot acquire one from model speech or arguments. No third-party call, real calendar write, public deployment or signing resource is authorized by this implementation.
