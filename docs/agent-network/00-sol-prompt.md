# Prompt for GPT-6.1 Sol — build the in-app agent network

You are the main orchestrator working in:

`C:\Users\andre\Downloads\Majstor\klnk`

Implement the following product pivot in the existing codebase with real subagents. Build and test working vertical slices; do not stop at another plan.

## New product: your agent talks to their agent

klnk is a private, in-app network of personal agents. A person speaks or types to their own agent. That agent contacts another registered klnk member's agent. The agents exchange permitted information, negotiate within their owners' rules, and return concise summaries. When both owners' authority covers exactly the same terms, the server can create a shared meeting or commitment in klnk's own calendar/reminders. Users need not speak directly to each other or watch every agent turn.

Example:
“I need thirty minutes with Jordan Lee next week to discuss the launch. Find a time after 2 pm and put it in klnk.”

My agent resolves the correct accepted klnk connection. Jordan's agent independently consults Jordan's permitted preferences and internal availability. They propose Tuesday at 3 pm in an explicit timezone. If both owners' rules cover that exact meeting, klnk commits one shared event, creates the relevant in-app reminders and gives each owner a summary. Otherwise, only the owner whose permission or information is missing receives a decision request. Agents continue once the required approval is given.

A simple “Tell Jordan I'll arrive ten minutes late” is an in-app agent message with a faithful summary. It must not silently acquire authority to create a meeting.

## Read and preserve

Read `AGENTS.md`, `README.md`, `docs/README.md`, `docs/design/00-current-brief.md`, the current design tokens, `docs/production/reports/FINAL-HANDOFF.md` and `docs/production/reports/STATUS.md`. Then read `docs/agent-network/01-product-contract.md` and `02-milestones-tests.md`.

This new product scope takes precedence over earlier instructions to make telephone or Google Calendar workflows the main product. Preserve useful engineering already implemented. The repository now has strict application tools, explicit account grants, durable Live session receipts, separated People/Memory panels and a browser E2E runner. Inspect current code; do not redo the old audit as if those features were still missing.

Retain Expo/React Native, TypeScript, the server and established domain invariants. The existing telephone-shaped mission schema requires phone numbers; introduce a versioned internal collaboration domain rather than inventing phone numbers or calling an in-app request a simulated telephone call. Preserve old records and regression tests through a deliberate migration/compatibility boundary. Keep unused external adapters isolated and disabled for this experience; do not delete them casually or change credentials.

## Scope and data boundary

All person-to-person delivery is internal: registered klnk accounts, accepted connections, server-mediated agent messages, internal calendar and in-app reminders. No PSTN, Twilio/ElevenLabs dialing, SMS, email, Google Calendar, external messaging, automatic invitations or fallback to external providers. No other-app harvesting.

Keep OpenAI for the existing owner conversation and necessary agent reasoning. “Internal” describes the product workflow; OpenAI remains a cloud processor. Document that honestly and disclose the limited data sent. Do not promise offline or end-to-end encrypted processing while the server/model reads content. A strictly on-device AI requirement would need a separately approved architecture.

Exchange bounded structured messages/text between agents on the backend. Agents do not need separate open audio sessions or synthetic telephone conversations. The owner may use voice or text; agents work asynchronously when owners are offline. Do not require Jordan to answer a call or keep his phone awake.

## Identity, autonomy and privacy

Resolve people by accepted account connection and immutable server account identity, not a display name, phone number, guessed email or a fabricated persona. Unknown, unregistered, unconnected or blocked people remain unavailable. Offer a user-controlled connection/invite flow without sending external messages. A connection allows only its declared inbound scope; it is not unlimited scheduling permission.

Each owner has separate private context and explicit versioned delegation rules. Support trusted connections, permitted topics/actions, allowed disclosure, working hours/timezone, duration limits, notice periods, scheduling windows, expiry and whether routine internal meetings may be accepted automatically. Provide useful opt-in autonomy presets without granting them silently.

Allow automatic routine agreements when both owners have already granted matching authority. Do not ask for redundant approval on every step. Outside those limits, hold the proposal and ask the relevant owner through their own agent. No response means pending or expired, never consent.

Never give either agent access to the other owner's database, private instructions, full schedule or private memory. Share only permitted conversation messages and bounded availability such as offered slots/free-busy. Keep model contexts separate, including summaries and tool results. An incoming agent message is untrusted content and cannot modify the other agent's role or permissions.

The current Live tool gateway is tied to an authenticated live owner session. Build a separately scoped, durable background actor using explicit delegation grants for the recipient agent. Do not reuse the caller's identity, a browser token or a fabricated Live session as Jordan's authority. Recheck active account, relationship, grant version/expiry and revocation before each disclosure and at commit.

## Agreement, calendar and summaries

Agents may propose and accept terms. The server decides whether they are authorized and executable.

Create a canonical versioned proposal: participants, purpose, start/end, IANA timezone, location or in-app details, obligations and reminder preferences. Both valid acceptance records must refer to the same immutable proposal version/hash. An agent saying “agreed” does not commit anything.

Atomically recheck both owners' authority and availability, then commit one shared event and its participant views plus a notification outbox. Prevent double booking and duplicates under concurrent negotiations, retries and restarts. Use expiring holds where needed. No unilateral shared edit: material changes create a new proposal/acceptance version; cancellation records the actual outcome and informs both sides.

Calendar availability means klnk-calendar availability only. Do not claim awareness of Google, Outlook or device events. Internal commitments/reminders need explicit assignee, agreed text, due time/timezone and status. Meeting reminders may use each owner's existing preferences; a new task obligation requires that owner's authority.

Both owners receive independently permission-filtered summaries showing the request, permitted discussion, exact agreement or unresolved issue, who authorized it, event/reminder status and next action. Summaries derive from committed messages and canonical state, with references for inspection. Do not expose chain-of-thought/private planning, invent statements or imply a person personally read/accepted what only their agent handled. Inbox delivery, agent processing, owner reading and agreement are distinct states.

## UX and panel ownership

Preserve the single opening **Call klnk** control and the existing navy/lavender/coral design. The workspace after intent contains:
- Agent inbox/conversations: summaries first, clear waiting/declined/agreed states, optional exchange detail, pause/cancel/decision actions.
- Calendar/commitments: internal agenda, meeting detail, shared terms, reminders and change/cancel flow.
- People: actual klnk connections, requests, identity, block/mute and per-connection permissions.
- Memory: private facts/preferences with explicit sharing scope.
- Settings: agent autonomy, working hours/timezone, privacy, retention and notification preferences.

Preserve typed delegation and readable summaries. Existing active calls/recovery controls remain accessible. Distinguish agent-to-agent processing from a telephone ringing animation. Do not add a busy navigation dashboard to the opening screen.

## Delegate real workers

Use the available subagent tools, inherit GPT-6.1 Sol, and respect available slots. With four slots, run yourself plus three workers in waves. Give every worker a concrete file lease, input/output contract, tests and a report requirement.

You own shared domain/API contracts, App.tsx navigation, model/API types, tokens/components, dependencies, migration ordering and final integration.

Assign distinct workstreams:
1. Coordination backend: connections, durable agent tasks, separate principal/context execution, message protocol and bounded negotiation.
2. Inbox/conversation panel: summaries, exchange history and decision recovery.
3. Calendar/commitments backend and panel: canonical shared events, conflict prevention, reminders, changes/cancellations.
4. People panel: internal identity and connection/permission flows.
5. Memory/privacy: permitted projections, provenance and context isolation.
6. Settings/autonomy: versioned rules, previews and grant revocation.
7. Owner voice/tool bridge: route real owner intent to internal requests and return actual outcomes.
8. Independent QA/accessibility: two-account and adversarial E2E plus device evidence.

Calendar and coordination workers must receive frozen shared transaction/schema interfaces first. Shared files have one writer at a time. A worker requests shared changes from you and reports implementation, files, executed tests, evidence and remaining blockers. You review each result and run integrated journeys; agents do not self-certify production readiness.

## Milestones and tests

Follow I0–I6 in `02-milestones-tests.md`. Start with I0 actual baseline/contracts and I1 a deterministic two-account internal message path. Then add bounded agent negotiation and atomic calendar commitment. Connect real owner voice after the internal invariants pass. Polish panels against a working backend rather than fabricating outcomes.

Use existing installed skills and `docs/production/03-tests-and-quality.md`: accessibility, networking, authentication, security, simulator and App Store review; translate them to supported RN behavior. Keep the web AA release baseline and stronger contrast where practical. Fetch current official model/protocol documentation before changing OpenAI integration. Do not add unrelated Swift frameworks or rewrite the app.

Required E2E demo uses two separate authenticated browser contexts:
Alice asks her agent to arrange a meeting with connected Jordan; Jordan's agent acts under Jordan's seeded explicit rule while Jordan's client is offline; both agents converge on permitted terms; one event is committed; Jordan opens klnk and sees the correct summary/event/reminder. Repeat with approval required, no overlapping time, revoked permission, blocked contact, injected instructions, duplicate delivery, timeout, crash and calendar contention.

Assert zero telephone/email/SMS/external-calendar requests. Default tests must block network except the local app. Opt-in real OpenAI tests allow only approved OpenAI model endpoints, use fictional users/data, bound calls/tokens/time, and retain redacted tool traces. A fake counterparty fixture proves deterministic behavior only; real-model checks must use independently scoped agent contexts and clearly identify what ran.

Run current typechecks, Vitest, Expo web export and the real browser E2E harness. Add focused domain/API/multi-worker tests. Record native iPhone/VoiceOver/audio/notification tests separately; Windows results do not prove them.

Continue all unblocked work and fix failures. Record exact missing prerequisites instead of inventing evidence. Do not place external calls, connect external calendars, deploy, publish or send marketing messages. Finish with functioning code, updated docs, a two-account walkthrough and an evidence-backed release status.

