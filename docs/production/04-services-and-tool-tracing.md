# Services, authorization and tool evidence

This document defines the bounded integration scope for the production effort. Read [milestones](02-milestones-and-ownership.md) and [current evidence](05-evidence.md) before changing a capability flag. The original audit describes the earlier baseline. The implemented gateway/OAuth details and exact checks now live in [M4 integrations](reports/M4-integrations.md); root local broker integration requires explicit per-account permission and keeps external effects disabled.

## Current service matrix

| Service | Implemented today | Intended production work | Evidence still required |
| --- | --- | --- | --- |
| OpenAI | Browser Live, server-held key, durable receipts/controller leases and optional granted local application tools. Real synthetic-audio contact lookup/result/continuation passed after two preserved diagnostic failures. | Compatible native transport and production lifecycle. | Semantic/human spoken evaluation, signed iPhone/device behavior and production hosting gates. |
| ElevenLabs | Telephone-agent transport; optional separate text-only owner planner; bounded STT/TTS and standard voice preview. | Preserve adapter and private-pilot controls; reconcile its role with the OpenAI owner conversation without duplicating paid speech paths. | Metadata readiness and a separately scoped, consented pilot. A mock response is not provider acceptance. |
| Twilio | Account/number metadata, actual call status and supported cancellation/termination transport. | Reliable call identity reconciliation and termination, with signed/provider-authoritative evidence. | Approved recipient trial, ringing cancellation, connected termination, delayed event and network-failure verification. |
| Google Calendar | Per-owner state/PKCE/OIDC authorization, encrypted refresh/revoke and cleanup; existing-event transport with ETag/idempotency/readback. Verified with injected HTTP, not a real account. | Supported, authorized existing-event updates only; configure a dedicated sandbox. | Actual account/consent, token lifecycle, approved fixture event update/readback and revoke. |
| Contacts | Manual owner-scoped records and spoken number readback. | Optional supported iOS contact selection, explicit import/mapping, deduplication and revocation handling. | Permission denied/limited/revoked and selected-contact tests on iPhone. |
| Memory | Owner-scoped in-app records with source, confirmation, disclosure and retention semantics. | Controlled tool access through existing policy; clear save/delete/review UI and traceable outcomes. | Cross-owner, private/ask disclosure, expiry, provenance and deletion tests. No external service key is needed. |
| Reminders | Durable in-app proposed commitment/memory record. | Keep the in-app scope explicit. A device EventKit adapter is a separately designed extension, not assumed from the word “reminder.” | App record lifecycle tests now; device permission/timezone/duplicate tests if the extension is explicitly selected later. |
| Messaging | No outbound adapter. | Remain unavailable in this production scope unless a specific service and authorized implementation are added to the plan. | No email/SMS/chat send should occur in current validation. |

Runtime evidence: [Live broker](../../apps/server/src/openai-live.ts), [API capabilities and integration routes](../../apps/server/src/app.ts), [engine actions](../../apps/server/src/engine.ts), [provider transports](../../packages/providers/src/index.ts), [owner planner](../../packages/providers/src/owner-planner.ts).

The installed Codex connectors and skills are development tools. They do not automatically become tools available to the klnk application or grant a customer account access. An OpenAI API key provides model access, not Calendar authorization, contact permission or telephone execution authority.

## Earlier tool-free baseline

The browser sends an SDP offer to the authenticated local broker, which creates the Live session and attaches a trusted server control socket. With no explicit tool grant, Responses delegation still uses `tools: []` and `tool_choice: 'none'`. An enabled account grant now selects validated schemas; only the trusted sideband may deliver function results/continuation. Browser client events remain close/mute/unmute. The local-only boundary is unchanged.

The bounded tests recorded zero delegations and zero external tool calls. That observation applies to the tested conversation; code independently establishes that application tools are disabled. Transcript text saying “I did it” would not prove any tool ran. Future validation must connect a model proposal to a server decision, adapter operation and verified result.

## Gateway ownership and contract

The gateway is implemented in [gateway.ts](../../apps/server/src/integrations/gateway.ts), with [strict shared schemas](../../packages/domain/src/tools.ts) and [trusted context](../../apps/server/src/integrations/tool-contract.ts). The orchestrator owns shared contracts/integration, the service worker owns adapter verification, Voice owns documented delivery, and QA independently challenges authority and traces. Panels consume these states; they do not hold credentials or grant authority through model text.

The v1 registry is frozen and uses the current official [Live delegation protocol](https://developers.openai.com/api/docs/guides/live-delegation): finished nested function items, matched call IDs, structured result items and explicit continuation. Broker tests establish protocol behavior; they do not prove real model use or that speech was heard. Native delivery stays unavailable until compatibility and device acceptance pass.

The first registry should expose only operations required by the existing product: owner-authorized contact lookup, allowed memory lookup, a request preparation/review path, dispatch/status/cancel through the mission engine, and the supported Calendar operation after OAuth. Exact names are a contract decision. Do not expose raw SQL, arbitrary HTTP, arbitrary shell execution, unrestricted URLs, broad MCP tool discovery or provider credentials to the model.

Every invocation must follow this sequence:

1. Bind the proposal to the authenticated owner, conversation/session epoch and server-generated request identifier. The model cannot select its own tenant.
2. Validate a strict tool-name allowlist and argument schema. Resolve resource identifiers inside the owning account. Treat service text, contact names, memory and tool results as untrusted data.
3. Check current capability, account/token status, required scope and action policy. Recheck these at dispatch; a previously rendered enabled button is not authority.
4. Reuse the immutable authorized brief and review version. A preference, stored permission or model interpretation never grants a new commitment. Preserve direct exact-message authorization already supported by the application; clarify only what is missing or materially changed.
5. Persist intent and an idempotency receipt before any external effect. Derive identity from owner + authorized operation + stable request/action identifier, not from a fresh model-generated identifier on each retry.
6. Execute through the server adapter with bounded time, quotas and a worker/session ownership strategy. Secrets remain server-side.
7. Validate the provider response and, when necessary, read back the intended resource. Preserve `unknown` when a response is lost after possible acceptance. Reconcile that receipt before any retry; never report success from an HTTP timeout or generated language.
8. Store the authoritative outcome, emit a sanitized trace and return a structured result to the voice/UI layer. Spoken success must match the stored outcome.

Suggested operation states are `proposed`, `blocked`, `authorized`, `queued`, `running`, `succeeded`, `failed`, `unknown`, `cancel_requested` and `cancelled`. Final naming must map to existing domain states without creating a competing source of truth. A cancel request is not proof that the provider stopped. If an external operation completed during cancellation, preserve and display the actual completion.

## Redacted trace contract

Implement a server-owned event stream or persisted audit view; it is distinct from a full transcript. Default traces should be sufficient to answer **which tool was requested, whether policy allowed it, which adapter ran and what evidence confirmed the outcome**.

| Field | Rule |
| --- | --- |
| `schemaVersion`, `eventId`, `occurredAt`, `event` | Versioned schema, unique event identity, UTC timestamp, known event enum. |
| `traceId`, `requestId`, `sessionRef`, `actionId` | Server-generated or validated stable correlation identifiers. Omit unavailable values; never invent provider IDs. |
| `ownerRef` | Opaque internal reference with authorized access. Do not use email, telephone number or full name. |
| `toolName`, `toolVersion`, `adapter` | Allowlisted names and versions; identify simulation versus a real provider explicitly. |
| `capability`, `scopeCheck`, `authorizationRef`, `reviewVersion` | Policy decision metadata, not a copy of the private instruction or OAuth token. |
| `argumentSummary` | Allowlisted structural facts only, such as resource count, operation kind or schema-validation outcome. No raw model arguments, contacts, calendar titles or message bodies. |
| `idempotencyRef`, `attempt`, `providerRequestRef` | Correlate retries and provider receipts. Restrict provider references to authorized diagnostics. |
| `status`, `reasonCode`, `durationMs`, `verification` | Stable sanitized outcome/error codes; verification such as `provider_readback`, `provider_terminal_event`, `local_commit` or `unconfirmed`. |
| `usage` | Available numeric usage/cost metadata with source and units. Missing provider usage remains unknown. |

Use events such as `tool_requested`, `tool_validated`, `tool_blocked`, `authorization_checked`, `tool_started`, `tool_result_received`, `tool_reconciliation_required`, `tool_succeeded`, `tool_failed` and `tool_result_reported`. An event named succeeded requires authoritative evidence. A planned call or a model-declared function name is not an executed tool.

Never store API keys, Authorization headers, OAuth access/refresh tokens, full signed URLs, SDP, raw audio, full transcripts, provider response bodies or arbitrary exception messages in default traces. Define access controls, bounded retention, account-deletion handling and export behavior for trace data. Hashing personal content does not automatically make it safe to retain. Tests must exercise redaction with secret-shaped fixtures.

A useful QA artifact is one sanitized timeline per scenario: model proposal → schema/policy decision → existing authorization receipt → adapter attempt → provider/readback evidence → spoken/UI result. Include a separate denied/unavailable scenario proving no adapter request occurred. This enables review without exposing private conversation content.

## Test progression by service

Deterministic contract tests are required before any paid or externally mutating test. Service metadata and tokens are never proof of successful write capability. The user authorized bounded owner-to-agent OpenAI tests with fictional audio; actual recipient calls, real calendar changes and new external resources need their own concrete scope when not already authorized.

| Service | Sequence and stop conditions |
| --- | --- |
| OpenAI | Schema/lifecycle mocks → metadata/access check → bounded synthetic-audio session → actual browser UI/broker/WebRTC → native device. Verify output, interruptions where exercised, captions, mute/unmute acknowledgement, cap and terminal closure. After the gateway exists, use fictional/in-app tools first and inspect the complete trace. Stop automatic new-session retries after ambiguous creation. |
| ElevenLabs | Injected transport and hostile-tool tests → GET-only agent/voice/number metadata → verify empty inherited tools, recording/retention and owner separation → explicitly scoped audio or consented calling test. Missing critical metadata remains unknown/blocked. Standard voice availability does not verify calling. |
| Twilio | Mock accepted/unconfirmed/terminal states and signature boundaries → GET-only account/number identity → approved allowlisted recipient test → ringing cancel/connected termination and readback. Never create a new call just because a prior start timed out. |
| Google Calendar | Mock OAuth state/PKCE, account binding, refresh race, revoked/expired token, scopes, ETag/DST/recurrence/conflict/idempotency → dedicated test account and calendar authorization → read-only identity and selected-event checks → explicitly authorized update of one fixture event → readback and replay proving one effect → disconnect/revoke. Do not use the owner's real calendar as an implicit sandbox. |
| Contacts | In-app fixture CRUD/isolation/number-readback tests → supported iOS selected-contact flow → denied/limited/revoked access, duplicate mapping and deletion. Import only selected data required for the task; do not interpret permission as bulk-harvesting authorization. |
| Memory | Fixture tool proposals and disclosure policy → committed in-app save/read/delete trace → cross-owner/private/ask/expiry/prompt-injection tests → deletion during in-flight replies. Source and confirmation status must survive round trips. |
| In-app reminders | Explicit timezone/date and duplicate-request tests → one durable app record → edit/cancel/expiry behavior. Label its in-app scope. A future EventKit extension needs a new contract and device evidence. |
| Messaging | Keep capability unavailable. Assert that requesting a send produces no adapter call and no fabricated sent status. Add a service-specific plan before enabling any transport. |

Use a distinct test identity, fixture data and environment marker. Capture only redacted metadata in checked-in evidence. Record credential absence, account limitations, device absence and approval-dependent external actions as specific blocked gates while continuing independent local work.

## Required negative and recovery scenarios

- A different owner supplies another account's session, contact, memory, integration, event or action identifier.
- A tool result or calendar description tries to add tools, switch accounts or change the authorized message.
- Credentials are revoked after the interface displayed Connected but before dispatch.
- Two devices, duplicate model proposals, lost HTTP responses and restarted workers target the same operation.
- Provider acceptance occurs just before a network timeout, cancellation or process crash.
- Account deletion/clear-chat happens while model generation or a tool operation is in flight.
- A Calendar event changes after review, an availability page is missing, a timezone crosses DST, or an update concerns a recurring series.
- The tool succeeds but the final spoken reply is lost; readback must show completion without rerunning the effect.
- The model claims completion although the tool was blocked or unknown; UI and persisted result must remain truthful, and the regression evaluation must fail.

## Completion gate

For each enabled service, the owning worker reports the implemented capability, exact environment, account/scope prerequisites, tests executed, one successful trace, one denied trace, one ambiguous-outcome recovery trace and remaining limits. QA independently checks the adapter receipt against the UI/spoken outcome. The orchestrator enables a release capability only after these gates pass. Missing accounts or device evidence keep that capability unavailable; passing OpenAI voice alone does not close the service milestone.
