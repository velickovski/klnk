# In-app agent network contract

Contract for the user's new direction, 27 October 2026. Implementation and actual verification are recorded separately in [current status](reports/STATUS.md); requirements in this contract are not themselves test evidence.

## Intent and boundaries

A member delegates to their own representative. A trusted service routes messages to the recipient's separately authorized representative. Both agents can act while their owners are offline. Human-to-human chat or a telephone network is not needed. The recipient's normal experience is a concise inbox summary and a calendar/commitment result, with decisions only when their granted authority is insufficient.

The first release supports delivery of approved information, questions/answers from permitted context, and routine internal meeting or reminder coordination. Exclude purchases, payments, external bookings and external service effects from its tool registry. Preserve ordinary owner voice and typed input. OpenAI cloud processing remains a dependency; internal coordination does not imply local-only AI processing.

## Current code to reuse

| Existing boundary | Reuse / required extension |
| --- | --- |
| `packages/domain/src/core.ts` | Existing ownership, review and immutable authority concepts; its phone-required Contact/Mission/Attempt schemas are not an internal-member protocol |
| `packages/domain/src/tools.ts` | Strict application tool definitions and trace shapes; add versioned internal tools and adapter/status enums through orchestrator ownership |
| `apps/server/src/integrations/gateway.ts` | Server-side grants, receipts, policy and idempotency patterns; its live-session actor is not a background recipient identity |
| `apps/server/src/openai-tool-delegation.ts` | Existing bounded owner voice tool/results bridge; expose internal request operations after contracts pass |
| `apps/server/src/live-session-store.ts`, `db.ts`, `engine.ts` | Durable state, transactions, jobs, fencing and policy patterns; preserve existing tested behavior |
| `apps/mobile/src/features/people/`, `memory/`, `settings/` | Existing separated panels and draft state; extend rather than repeating completed extraction |
| `e2e/browser/`, `playwright.config.ts`, package scripts | Existing runnable browser tests; add truly independent authenticated contexts and local fixtures |

Previous verification is in [FINAL-HANDOFF](../production/reports/FINAL-HANDOFF.md). Its counts are historical until reproduced; this documentation pass did not rerun or extend runtime tests.

## Proposed durable domain

Freeze these schemas with the orchestrator before parallel implementation. Names are proposed; align with existing conventions.

- **Connection:** authenticated member IDs, directional invitation/acceptance, inbound-agent permission, block status, current revision. Accepting a connection never silently grants calendar authority.
- **AgentPolicy:** owner, version, capabilities, trusted connections, disclosure rules, scheduling windows, timezone, duration/notice bounds, autonomous acceptance permission and expiry.
- **AgentRequest:** initiating owner, accepted connection, exact delegated purpose, allowed disclosures, operation scope, expiry and immutable authority snapshot. Sending a message is narrower than negotiating a meeting.
- **AgentConversation / Message:** participant set, server-verified acting owner/agent, role, ordered sequence, parent/message IDs, version, structured action, shared content, delivery/processing receipts.
- **Proposal / Acceptance:** canonical terms hash/version, expiry, each accepting owner's policy/version or explicit approval receipt. Revised material terms invalidate old acceptances.
- **Agreement:** authoritative result referencing the final proposal and both acceptance receipts; finalized, declined, expired, cancelled or explicitly awaiting a decision.
- **CalendarEvent / ParticipantView:** one shared event identity, access-controlled views and common revision. Preserve participant-local private notes separately.
- **Commitment / Reminder:** authorized assignee, text, source agreement, due time/timezone, status and per-owner reminder schedule.
- **Summary / InboxItem:** recipient projection and source event IDs, versioned update, unseen/read status. Delivery/read state never implies approval.

Agent messages use a bounded protocol such as `inform`, `ask`, `propose`, `counterpropose`, `accept`, `decline`, `needs_owner` and `close`. The model cannot choose the actor's authenticated principal. The backend validates schema, policy and transition before delivering a message. Worker retries are at-least-once; durable receipts and unique constraints ensure effects occur once.

## Authorization and private context

Maintain one private context per owner and conversation; use separate model requests or equally strict context isolation, never a single model prompt containing both private profiles. Cross-owner access is narrowly mediated by participant membership and allowed projections, not unrestricted repository reads.

Background execution uses a durable scoped grant and server worker identity. Login session expiry does not automatically delete an intentionally authorized background task; define that lifecycle separately. Explicit revocation, account deletion, block, grant expiry or task cancellation must stop future disclosures/actions. No infinite or global authorization is inferred from a connection.

At each action, recheck active accounts, connection, tool capability, request scope and policy revision. At final commit, check both owners again. Rules changed while a model response is running take effect before its next effect. Do not disclose meeting titles or full schedules simply to find free time.

Bound the conversation by configurable turn, token, wall-clock and spending limits. Use a stopping condition for repeated proposals and no progress. Initial development fixtures may use six proposal exchanges and three candidate slots; these are implementation defaults, not invented completed evidence. When exhausted, produce a useful unresolved summary. Rate-limit inbound requests, respect block/mute and avoid notifications for every agent turn.

## Atomic agreement and calendar behavior

For a meeting:
1. Validate canonical participant/terms identity and matching acceptance versions.
2. Lock or otherwise serialize the relevant owner schedules in deterministic order.
3. Recheck current authority, expiry, connection status, availability and tentative-hold ownership.
4. Persist the agreement and one shared calendar event atomically with the outbox records for both owners.
5. Deliver/update summaries and reminders idempotently; notification failure cannot duplicate the event.

Use a database-supported concurrency strategy backed by real PostgreSQL tests; a process-local mutex is insufficient. Test overlapping times, late approvals, DST ambiguity, overnight events and policy changes. Store UTC instants and the intended IANA timezone. Ask for clarification on ambiguous local times; do not silently select a DST interpretation.

Tentative holds expire and are distinct from confirmed meetings. Cancelling before commit prevents finalization. Cancelling a committed meeting follows a recorded shared-state transition and notifies affected participants. Rescheduling or changing obligations requires a new agreed version unless both owners' existing grants explicitly cover that exact adjustment.

Only the internal klnk calendar is checked. Availability is not a statement about a person's entire life or third-party calendars.

## Summaries, inbox and reminders

Use canonical messages and structured agreement state as the summary's evidence. A factual template must remain available if model summarization fails. Summarization failure cannot erase a successful event or trigger another negotiation.

Each owner sees the permitted shared exchange and their own private context, never the other owner's hidden planning or policies. Show requested action, agreed details, unresolved points, authority source, next step and actual calendar/reminder status. Attribute “Jordan's agent accepted under Jordan's scheduling rules”; only record Jordan personally accepting when an authenticated human action proves it.

Default to one completed summary, an actionable approval request, or a meaningful blocked/failure notification. Preserve an inspectable message log without treating internal chain-of-thought as a transcript. Information already delivered to a participant cannot be guaranteed to vanish from their memory; define reasonable shared-record retention and account-deletion behavior explicitly.

In-app reminders are durable due items available on return and while the client is connected. They do not guarantee an alert when the app is closed. Local device notifications may be added after permission/timezone/rescheduling tests; external push and email/SMS reminders are outside this release. Do not say a reminder was received merely because it was queued.

## Egress and migration

The new path must not invoke external call, messaging, OAuth, calendar or webhook transports. Keep old adapters/records behind their compatibility boundary. Introduce a distinct internal routing mode/capability instead of globally weakening previous safety gates.

Use a fail-closed outbound allowlist in tests: the default suite allows local endpoints only; explicitly opted-in real-model runs may contact the approved OpenAI endpoints. Log known tool names/status and opaque receipt references, not tokens, private prompts, raw audio or full tool arguments. No phone number is required for a new internal connection. Never migrate a phone contact into a member connection without verified account linkage.

