# Architecture and operating limits

## Shape

`apps/mobile` is the Expo/React Native iPhone client. `apps/server` hosts a Fastify API and database-leased worker. `packages/domain` contains shared Zod contracts, policy, context filtering, outcomes and fixtures. `packages/providers` contains small replaceable HTTP transports. Provider keys never enter the mobile bundle.

One SQL schema runs on PostgreSQL or local PGlite. The local embedded runtime is real PostgreSQL compiled to WebAssembly; it is single-process, not the production deployment. Server PostgreSQL uses `FOR UPDATE SKIP LOCKED` and leases for concurrent workers. Jobs persist before side effects, expire abandoned leases and use deterministic stage/action identifiers. No vector store or separate workflow vendor is needed.

Resources use encrypted typed JSON payloads with an owner/kind/id index and revision. Passwords use scrypt, opaque seven-day bearer sessions are stored as SHA-256 digests, and device tokens use iOS SecureStore. AES-256-GCM encrypts resource and job payloads; it does not encrypt user email, database indexes, audit IDs or PostgreSQL files. Production requires external PostgreSQL, a separately managed persistent encryption key, HTTPS termination, protected backups and secret management. Windows file ACLs must protect the local data/key directory. The development key stored alongside data protects accidental inspection, not theft of the whole computer.

## Authority

A draft has a review version. Authorization requires the current version and creates an immutable recipient/number/brief/action/provider snapshot. A simulated authorization cannot become a live call after a configuration change. Authorized missions cannot be edited. A materially different proposal requires ending and reviewing a new mission. Free-text guidance cannot expand authority. Preferences and stored standing-permission notes never grant tool authorization automatically.

The server rechecks contact ownership, number, explicit verification, opt-outs, dates, duration, retries, approved action declarations and evidence. Client-supplied owner IDs, completed action statuses and arbitrary external identifiers do not become authority. All resource reads, edits, deletes, exports and voice preview routes scope by the authenticated owner.

Only confirmed, allowed memories from the current relationship/mission, plus explicitly selected owner memory IDs, enter context. Unconfirmed, conflicting, inferred, private and ask-first items are excluded. This is a deterministic scope filter with a bounded context count; semantic relevance ranking is not implemented. Mission goal/background/private facts stay out of the live provider prompt. Approved talking points, allowed source material and disclosable facts are separate inputs. They must be reviewed carefully; software cannot infer every sensitive implication in freeform text.

Recipient statements and shared documents never authorize a new tool or retrieve unrelated memory. Live provider tools/knowledge bases/MCP are disabled in the request and require an override-enabled, dedicated tool-free provider agent. This restricts external actions. **It does not prove every spoken model utterance is compliant.** Live booking, purchases, payments, refund commitments, autonomous calendar writes and other consequential actions are gated off until bounded voice validation exists. The current live pilot supports approved message delivery and information collection only.

## Execution and evidence

Mission state, call attempts and follow-up records are separate. A connection is not an agreement. A transcript is evidence, not confirmed memory. Outcomes distinguish request, discussion, actual recipient agreements, agent commitments, alternatives, pending actions and uncertainty.

The deterministic simulator uses explicit fixtures, including tentative responses and malicious disclosure requests. Simulated agreements are labeled synthetic. Editing an arbitrary goal does not create a model-planned real conversation. Original Spanish and the fixed English translation are stored separately; arbitrary automatic translation is unavailable.

An outbound dispatch is persisted before its HTTP request. A failed/ambiguous create is not retried automatically. It surfaces uncertainty for provider reconciliation; this deliberately trades automatic recovery for avoiding duplicate calls. Signed webhook payloads only enqueue authenticated provider reads. HMAC is checked against raw request bytes with a bounded timestamp, and logical events are deduplicated transactionally. Final attempts ignore delayed intermediate events.

Cancellation cancels queued work and requests Twilio termination where a call SID is available. Remote completion can race cancellation; any side effect already completed is retained. A provider timeout without an external identifier may need dashboard review. Account deletion refuses to claim termination while a live attempt remains unconfirmed, then removes local data and tombstones the account while provider cleanup jobs retry. Failed provider deletions require operations attention; contractual backup retention is not under the app's direct control.

## Follow-up actions

An action has its own approved declaration, prerequisites, execution status and external identifier. Calendar updates target an existing event. The Google adapter re-fetches current state, checks availability, uses ETags and an idempotency marker. These checks prevent ordinary duplicate writes and detect modified events; another event can still be added between availability checking and a patch, since Google provides no transaction across both operations.

The demo calendar and in-app reminder records are persisted locally. A reminder is an inspectable commitment, not an OS reminder or a delivered push notification. OAuth onboarding, server refresh-token exchange and remote token revocation are unfinished. No on-device EventKit call is assumed while the phone is offline. Messaging actions remain blocked without a communication adapter.

## Retention and operations

Audio recording is disabled in the live transport. Native provider workspace/agent retention must be verified and accurately disclosed before enabling calls. The application does not advertise zero retention or end-to-end encryption. Transcript expiry removes local transcript entries and queues provider conversation deletion; summaries and approved memories remain until deleted. A production operator must monitor failed jobs, rotate keys, configure recovery/backups, add email verification/password recovery, harden account creation, and validate launch-market calling and recording requirements.

Owner conversation uses bounded foreground voice turns, a separate private text-only owner planner, and a standard speech voice. The phone permission is optional for text fallback. Raw input audio is discarded after processing; encrypted owner chat/reply caches expire after 24 hours or can be cleared by voice. Non-content turn receipts remain so clearing/expiry cannot cause an old request to execute again. Native pause-based turn completion is level-based and still needs physical-device validation; this is not continuous background listening or realtime barge-in.

Initial operating scope is a **United States allowlisted test pilot**, not general US or worldwide compliance approval. No service resources, calls or deployments are provisioned by setup. The bound private owner has a five-call ceiling per rolling day, maximum live duration 180 seconds and zero redial retries. Shared provider speech/planning is bound to that same owner and capped at 100 turns/reports per rolling day; stop and chat-clear controls remain available at the quota. Provider billing caps and account-level spending controls still need configuration. Live end-to-end behavior, voice quality, device accessibility and App Store readiness remain unverified.
