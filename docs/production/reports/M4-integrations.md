# Integrations / M4 / local implementation ready for independent review

Task and owned files: new `apps/server/src/integrations/google-calendar.ts`, `google-identity.ts`, `recipient-suppression.ts`, `gateway.ts`; forward migration `005_application_tools.sql`; scoped approved changes in `db.ts`, `engine.ts`, `live-session-store.ts`, `packages/providers/src/index.ts` and provider regressions; new `tests/google-oauth.test.ts`, `authorization-boundaries.test.ts`, `account-lifetime.test.ts`, `tool-gateway.test.ts`; compatibility updates to the worker/storage/API-contract test fixtures; new `scripts/application-tools-smoke.ts` and [sanitized tool evidence](../evidence/application-tools.json). Parent owns routes/config, shared domain tools and broker wiring. Migration 006 is parent-owned; earlier migration bytes were preserved.

## Implemented service behavior

Google Calendar now has owner-scoped authorization state with cryptographic state, S256 PKCE, a one-use nonce and initiating server-session binding. Callback and final persistence recheck that session and the active owner. Returned ID tokens are validated against trusted Google discovery/JWKS, signature, issuer, audience, time, nonce and optional access-token hash. Only the stable account subject is retained privately; no email/profile scopes are requested. Endpoint URLs are fixed/allowlisted and cannot come from model arguments or provider content. These choices follow [Google's authorization flow](https://developers.google.com/identity/protocols/oauth2/web-server), [PKCE options](https://docs.cloud.google.com/nodejs/docs/reference/google-auth-library/latest/google-auth-library/generateauthurlopts), [OpenID validation](https://developers.google.com/identity/openid-connect/openid-connect) and [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth).

First-version access requests only `openid` and `calendar.events.owned`, and binds the connection to the primary owner calendar. The provider's granted scopes and a read-only owner-calendar probe are verified before Connected is stored. Configured credentials, old raw-token records and missing scopes do not become a connected service. The public list is allowlisted; it excludes state verifiers, nonce, session hashes, subjects and credentials.

Access/refresh tokens are encrypted in existing storage. Refresh is coalesced within and across service instances using a durable operation receipt; rotation is saved, and a lost or interrupted refresh cannot be blindly repeated. A stale process refresh becomes reconnect-required after a bounded recovery window. Disconnect immediately blocks local use, distinguishes pending remote revocation from confirmed revocation, and queues encrypted cleanup before attempting it. Cleanup works for tombstoned owners and legacy duplicate grants. Confirmed completion scrubs token-bearing job payloads and connection secrets. Account deletion queues cleanup using the parent's existing transaction before integration records are removed.

The Calendar adapter still updates only an existing authorized event. It now verifies exact event identity, bounds cyclic/paginated availability and reads the event back after PATCH before returning success. Conditional writes, recurrence restrictions, explicit dates/timezone and idempotency markers remain. Engine actions consume verified refreshed access through a server hook; raw legacy credentials no longer bypass that boundary.

## Authorization and lifetime repairs

- **HIGH — suppression loss:** recipient opt-out now survives contact edits, deletion and recreation. Minimal owner-scoped suppression records use a keyed number digest, purpose and account-lifetime retention; they do not retain plaintext telephone numbers. Legacy records are converted. Authorization and actual dispatch recheck suppression. Refusal suppresses the immutable dialed number, including when the contact changed during the call.
- **HIGH — mutable approved context:** authorization now deep-copies selected allowed/confirmed/unexpired context into `authorization.snapshot.selectedContext`. Detail and live dispatch use that snapshot; changing or deleting the source cannot introduce new facts. Legacy authorizations without the snapshot use empty context. Expired frozen facts are excluded.
- **HIGH — account resurrection:** `Repository.put` locks the owner and rejects tombstoned accounts, both standalone and inside existing transactions. Engine writes use owner-before-mission lock ordering. Delayed authenticated profile/contact saves cannot repopulate deleted accounts.
- Controller lease comparisons now use wall-clock database time rather than transaction-start time, without changing migration files. `Engine.cancel` accepts a scoped SQL transaction so gateway policy checks and cancellation share one transaction.

## Application tools and actual trace evidence

The gateway implements the parent's v1 allowlist: `contacts_lookup`, `memory_lookup`, `request_prepare`, `request_status`, `request_dispatch`, `request_cancel`, `calendar_update_existing`. Each invocation validates strict arguments, authenticated owner/session, active durable Live receipt, current controller lease and an explicit tool grant. Model arguments cannot supply identity, grants, URLs or execution authority. Service strings are returned as untrusted data.

Preparation creates a draft for review. Dispatch/cancel/Calendar operations require the server-bound immutable authorized mission; the model cannot bind or authorize one. Calendar retry addresses only an existing authorized action with its evidence prerequisites. All effects use existing engine records. External effects are disabled by default. Queued work is not reported as a confirmed provider effect; simulation remains explicit. Calendar provider success is only labeled verified after authoritative readback.

Stable metadata request IDs and durable receipts precede effects. Duplicates cannot create another draft; changed arguments conflict, and interrupted receipts remain unknown. Raw model arguments are not retained in receipts or traces. A private per-call keyed argument binding is retained for idempotency for 24 hours, then removed; replay of a redacted receipt is blocked rather than re-executed. Non-content receipts remain to prevent duplicate effects. Structural traces expire after seven days; account deletion removes them. The parent wires `Engine.toolMaintenance(now)` to the gateway sweep. Query results are excluded from durable receipts so deleting a source cannot restore its text from a cached result.

[application-tools.json](../evidence/application-tools.json) records three actual deterministic gateway fixture timelines:

| Scenario | Actual tool / status | Verification |
| --- | --- | --- |
| Draft for review | `request_prepare` / `proposed` | `local_commit`; draft has no authorization |
| Explicit grant disabled | `request_dispatch` / `blocked` | `policy_denial`; no job or adapter call |
| Interrupted receipt | `contacts_lookup` / `unknown` | `unconfirmed`; no replay |

These are local application invocations through the gateway, **not observed model-to-tool round trips**. No Live tool was enabled by this worker. The evidence script explicitly configures no provider credentials and asserts that no jobs/provider effects occur and no private fixture values enter traces.

## Executed checks

Windows / Node v24.15.0 / fictional fixtures / 27 October 2026:

```powershell
npm exec -- vitest run tests/google-oauth.test.ts
npm exec -- vitest run tests/tool-gateway.test.ts
npm exec -- vitest run tests/google-oauth.test.ts tests/authorization-boundaries.test.ts tests/account-lifetime.test.ts tests/tool-gateway.test.ts tests/engine.test.ts tests/live-session-store.test.ts tests/storage.test.ts packages/providers/src/providers.test.ts
npm exec -- vitest run tests/google-oauth.test.ts tests/tool-gateway.test.ts tests/authorization-boundaries.test.ts tests/account-lifetime.test.ts packages/providers/src/providers.test.ts
npx tsx scripts/application-tools-smoke.ts
npm run typecheck
```

Broad eight-file selection: **88 tests passed** before the final OAuth recovery/cleanup refinements. Subsequent five-file selection: **60 tests passed**, including worker-confirmed token scrubbing. Final OAuth-only selection: **20 tests passed**, including legacy/tombstone cleanup and interrupted-process recovery. Root/mobile typecheck **passed** after the final code change. The smoke script passed all four assertions and produced successful/denied/unknown trace artifacts with zero provider contacts.

Scenario families: AUTH-01/02, NET-01/02, CAL-01/02, TOOL-01/02/03/04, PHONE-01 suppression, MEMORY-01/02 frozen context, DATA-01. Tests use actual local PGlite transactions, real RSA-signed fictional identity tokens, injected provider HTTP responses and local engine simulation. They do not substitute for provider or device evidence.

## Remaining gates

No real Google account consent, sandbox event mutation, actual Google readback/revoke, recipient call or resource creation was authorized/performed here. Actual Calendar capability still requires configured client/redirect/consent settings and an explicitly authorized test account/event. OAuth provider compatibility and production multi-process refresh/cleanup require that environment. Native system-browser OAuth presentation/device return handling is unverified.

The gateway is not enabled in OpenAI Live; independent QA and broker integration must verify supported tool protocol, authority, lifetime and actual provider-event tracing first. A configured key never grants tools. The trace artifact does not claim a provider used them. Parent reports runtime availability honestly until those gates pass.

Real PostgreSQL evidence and root route/panel/E2E review belong to their independent owners. This worker did not rerun or certify their results. Key custody/rotation, hosted monitoring, independent deletion-journal durability, external sandbox and physical-device release gates remain open. In particular, keyed suppression/idempotency bindings require preserving or deliberately migrating their key-derived identifiers during a future key rotation.

Independent review: QA in progress; parent integration/release acceptance pending. No production-readiness or deployment claim.

## Reference files

- [authentication skill](C:/Users/andre/.codex/skills/authentication/SKILL.md): server identity/session and system OAuth presentation boundaries.
- [networking skill](C:/Users/andre/.codex/skills/ios-networking/SKILL.md): status/schema validation, bounded operations and no blind mutation replay.
- [security credential patterns](C:/Users/andre/.codex/skills/swift-security/references/credential-storage-patterns.md) and [security tests](C:/Users/andre/.codex/skills/swift-security/references/testing-security-code.md): encrypted credentials, cleanup and mocked/device evidence distinction.
- [security anti-pattern review](C:/Users/andre/.codex/skills/swift-security/references/common-anti-patterns.md): secret logging/storage and cryptographic randomness review.
