# First real-call test — prepared, not authorized or run

The owner selected a US test recipient. No real call is authorized in the current session. Leave `LIVE_CALLS_ENABLED=false`; providing account credentials or installing an iPhone build does not change that instruction.

## Before the owner authorizes one call

1. Install the development build on the owner's iPhone, pair it with the intended API and verify the app displays the correct backend/provider state. A browser preview is not an iPhone installation.
2. Complete the account/number/agent setup in `LIVE_PROVIDER_SETUP.md` and the iPhone steps in `IPHONE_SETUP.md`. Store credentials in the backend's local environment or deployment secret store, never chat, source control or Expo public variables.
3. Run the offline readiness check, read-only provider inspection, TypeScript and automated tests. Resolve every missing item. Read-only provider metadata checks do not establish successful calling, audio quality or disclosure delivery.
4. Use a real account with an explicitly verified, consented US test recipient and their E.164 number. The number must appear in the backend's allowlist. Fictional seeded contacts and reserved example numbers are not call targets.
5. Agree the exact test time, owner name, purpose, recipient, language, standard voice, actual processing/retention disclosure, and stop phrase. Confirm the recipient is willing to receive this AI-assisted test. Do not record audio. No clone, payment, booking, refund agreement or calendar write is involved.
6. Prepare one delegated information/message mission with maximum 180 seconds, zero retries, no voicemail, no follow-up actions and no authority to accept a charge or commitment. Review every approved talking point and selected memory. Keep unrelated/private memory excluded.
7. Show this concrete mission and the configured processing/retention statement to the owner and obtain explicit authorization for **that one call**. Do not enable dispatch or execute this plan before then.

## The one-call script

The recipient can act as a cooperative test contact. Ask them to return a small set of hypothetical options, not a real commercial agreement. Example approved question: “For this test, which of two hypothetical meeting times would you prefer? I am collecting your answer only and cannot book or make a commitment.”

The AI must introduce itself as an AI assistant acting for the owner, describe the general message/information purpose and configured provider processing/retention, verify the intended person before discussing the mission, and offer a refusal/stop path. Owner instructions do not authorize impersonation or identity-check bypasses.

The app should show a genuine provider-backed attempt and retain the actual conversation and Twilio IDs. This native telephone integration does not offer live transcript or typed instruction injection. Those controls must remain visibly unavailable. End-call uses the persisted Twilio call SID; the UI must distinguish a requested end from verified terminal provider state.

## Verify and stop

- Verify only the allowlisted recipient's phone rang and the disclosure and approved message were audible. Ask the recipient directly what they heard; do not infer this from a provider “success” flag.
- Exercise the supported end control if agreed for this test. Confirm provider terminal state and that the app's attempt record is reconciled.
- Inspect the complete post-call transcript and any provider summary. Hypothetical options, “I will check,” a voicemail, a disconnected call and a connected/ended status do not establish an agreement.
- Verify no external action, booking, payment, new durable fact or standing permission was created. Live summaries remain explicitly unverified until the owner reviews the evidence.
- Turn live dispatch off again after the approved test. Inspect usage and the provider's actual charges/retention configuration. Do not automatically redial a timeout or uncertain start.

After this test, propose separate, concrete follow-up tests for refusal/opt-out, no-answer/busy, disconnection and webhook retries. Each real recipient call needs authorization; local mocked tests are the current evidence for these paths. Clone creation, calendar integration and deployment are separate activities.

## Current local evidence

`tests/live-gates.test.ts` exercises the native live path with injected ElevenLabs/Twilio HTTP responses and blocks all unmocked network requests. It checks the disabled-call switch at both authorization and durable dispatch, the real request/response contracts, signed webhook deduplication and conservative outcomes, Twilio termination of the actual persisted SID, ambiguous start without redial, and rejection of unsupported controls/actions. These are integration tests of code, not real telephone or iPhone evidence.

`tests/voice-planning.test.ts` checks voice-first delegation without a mission form: exact owner-attributed messages, spoken recipient/number clarification, no calls from ordinary chat or model-generated authority, private context minimization, first-turn/reply-audio idempotence, and original-utterance time anchoring. The default private pilot uses one API process; per-session turn serialization is local to that process. Multiple API replicas would require a distributed pending-confirmation lock before being supported. A simple “in ten minutes” becomes an explicit owner-timezone timestamp with a dispatch deadline; vague or unsupported durations require a spoken clarification.

Shared provider speech/planning services are restricted to `LIVE_OWNER_ID` even when real calling is disabled. Other signed-in users retain deterministic text/device-voice rehearsal; audio uploads cannot spend the shared provider key. Bound-owner provider usage is limited to 100 turn/report receipts in a rolling 24-hour period, and cached retries do not synthesize again. Clearing a voice chat removes its history, pending brief and cached reply audio but keeps content-free effect receipts; repeating a cleared or expired request returns `voice_request_expired` instead of repeating a call. Separate call records and saved memories are not deleted by a chat-clear command.
