# Provider setup and real-call gate

Verified 26 October 2026 against the official references linked below. These adapters are implemented and locally mock-tested. No real call, paid resource, upload to a provider, clone training, deployment or iPhone compilation is implied.

## ElevenLabs and Twilio

Prepare these resources yourself or authorize their creation separately:

1. An ElevenLabs account and an agent approved for the intended test use.
2. Your Twilio account, a suitable purchased number or verified outbound caller ID, and the imported ElevenLabs phone-number ID.
3. A standard assistant voice permitted for the account. Avoid using any personal voice asset until ownership and verification are documented.
4. A public HTTPS webhook URL with an ElevenLabs HMAC secret. Enable transcription and initiation-failure events. Do not enable audio webhooks for this no-audio pilot.
5. An explicit E.164 allowlist of test recipients who have authorized the test. No emergency, short-code or arbitrary international dialing.

The documented [outbound endpoint](https://elevenlabs.io/docs/api-reference/integrations/twilio/outbound-call) takes `agent_id`, `agent_phone_number_id`, `to_number` and initiation overrides. Set these backend-only environment variables according to `.env.example`: `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_PHONE_NUMBER_ID`, a standard voice ID, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `ELEVENLABS_WEBHOOK_SECRET`. The configured provider agent must allow the prompt, first message, language, voice, duration and strict tool-list overrides used by the adapter. Use a dedicated tool-free agent and no global knowledge base. No shared provider credential belongs in an Expo public variable.

The adapter sends `call_recording_enabled: false` and `telephony_call_config.twilio_call_recording_enabled: false`. Separately configure ElevenLabs agent/workspace audio, transcript and evaluation retention. Turning off Twilio recording does **not** disable all ElevenLabs processing or retention. The [TTS endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) supports previews; zero-retention request settings have plan restrictions and are not assumed.

Live dispatch additionally requires `CALL_PROVIDER=elevenlabs`, `LIVE_CALLS_ENABLED=true`, `LIVE_TEST_RECIPIENTS` containing the separately approved test numbers, `ELEVENLABS_STANDARD_VOICE_ID`, `ELEVENLABS_LLM_PROVIDER` naming the actual selected provider, `PROVIDER_RETENTION_VERIFIED=true`, and `PROVIDER_RETENTION_DISCLOSURE` containing the exact configured transcript/processing statement. No defaults substitute for these facts. Authorization freezes the provider: an already-approved simulation cannot be reused as live-call authority after configuration changes. The operator must confirm that an allowlisted +1 number is actually a US test recipient; country code +1 alone includes other markets.

The [native setup guide](https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/native-integration) explains number import. An inbound-capable shared number is not an implemented, isolated callback product; leave callback handling disabled until inbound owner resolution and authorization exist.

### Required first-message configuration

The exact opening must match the chosen provider, LLM model and retention settings. It must identify the agent as AI, name the owner/entity and general purpose, explain ElevenLabs/service-provider/model processing and any recording or retention, and offer a way to decline AI interaction and opt out. Establish the test recipient’s required consent before dialing and keep the appropriate evidence. See [ElevenAgents Terms, sections 3.5–3.6](https://elevenlabs.io/agents-terms), updated 9 October 2026. A sample starting point, requiring configuration review:

> Hello, I’m an AI assistant calling for Alex to relay their approved message or questions. ElevenLabs and its service providers process this conversation. [Configured model provider] processes the AI responses. [Actual transcript/recording statement.] You can ask me to stop or request no further calls. Are you the intended recipient and comfortable continuing?

This is implementation guidance for the selected pilot, not a claim that disclosure alone establishes legal permission in every jurisdiction. Before public launch, the operator must resolve actual outbound-call permissions, consent, record retention, caller identity, opt-outs, provider restrictions and the owner/recipient markets.

### Webhooks, ordering and uncertainty

`verifyElevenLabsWebhook(raw, signature, secret, nowMs?)` authenticates the original bytes with HMAC SHA-256 and the documented `t=...,v0=...` envelope. It rejects timestamps outside a 30-minute window in either direction, uses constant-time comparison, then parses JSON. The scheme is documented by the [official SDK implementation](https://github.com/elevenlabs/elevenlabs-python/blob/main/src/elevenlabs/webhooks_custom.py). Keep the HTTP raw body; JSON reserialization invalidates the signature.

`webhookDeduplicationKey(event)` provides a stable event-content key. Store that key with the state transition in one database transaction. A duplicate authentic delivery should receive HTTP 200 without repeating actions. Timestamp verification alone does not prevent replay. The [post-call guide](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks) describes transcription and initiation-failure envelopes and retries. Bind a conversation ID and agent ID to the persisted attempt; do not infer user ownership from untrusted dynamic variables in an event.

For Twilio form callbacks, `verifyTwilioWebhook(configuredPublicHttpsUrl, params, signature, authToken)` implements the standard signature calculation. Configure the exact public URL rather than building it from request headers. Source reference: [Twilio webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security). Duplicate and out-of-order status handling belongs in the server transaction; a late `ringing` must not regress an ended call.

Never automatically retry an outbound creation after a network timeout. The call may already exist. Mark its initiation uncertain and reconcile rather than redial. Persist conversation/call identifiers as soon as returned. [Conversation GET](https://elevenlabs.io/docs/api-reference/conversations/get) and [Twilio Call GET/update](https://www.twilio.com/docs/voice/api/call-resource) permit status reconciliation and a supported end request. A disconnected telephone leg after a possible agreement stays uncertain; a provider’s “successful” classifier cannot authorize a commitment or external action.

## Google Calendar example

`GoogleCalendarAdapter({accessToken})` is server-only and receives verified refreshed access from `GoogleCalendarConnections`, never raw legacy integration tokens. Per-owner OAuth/state/PKCE/OIDC, encrypted refresh/revoke and durable cleanup are implemented with mocked-provider evidence. Configure backend `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the exact `GOOGLE_REDIRECT_URI` ending `/integrations/google-calendar/callback`. Current scopes are `openid` and `calendar.events.owned`, bound to the primary owner calendar. Public consent-screen/account setup, actual account verification and a separately authorized sandbox event update/readback/revoke still require execution. See [implementation and limits](production/reports/M4-integrations.md).

`updateExistingEvent({calendarId,eventId,startAt,endAt,timezone,idempotencyKey,expectedStartAt?})`:

1. Fetches the intended existing timed event. It never falls back to creating a duplicate.
2. Detects an already-applied action using a private extended property, and rejects later conflicting edits.
3. Checks the expected original time, if provided, and current overlapping events (all pages), excluding the event being moved and transparent/canceled entries.
4. Patches only the agreed dates and private action marker using `If-Match` with the current ETag.
5. Returns the external event ID. A 412 conflict, expired token or write error must remain a pending action; it must not trigger another conversation.

References: [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [events.patch](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch), [conditional versions](https://developers.google.com/calendar/api/guides/version-resources), [private extended properties](https://developers.google.com/workspace/calendar/api/guides/extended-properties). Calendar availability can change between the check and update; an ETag protects the target event, not an atomic reservation across an entire calendar. Surface post-agreement conflicts for owner handling. Guest notification sending is not part of this action (`sendUpdates=none`).

## Voice cloning gate

The low-level IVC transport posts sample audio to [`POST /v1/voices/add`](https://elevenlabs.io/docs/api-reference/voices/ivc/create), requires explicit owner consent and approved provider account onboarding, and returns the provider’s `requires_verification` flag. Do not interpret “created” as “verified”; do not let the client submit a verified status. The app remains standard-voice-first.

[Professional cloning onboarding](https://elevenlabs.io/docs/eleven-api/guides/how-to/voices/professional-voice-cloning) involves creation, samples, verification CAPTCHA, training and eligibility. Commercially approved per-customer account ownership, clone quota and verification arrangements remain unresolved. Contact provider sales/support with the concrete multi-user model before adding enrollment. Where spoken verification is inaccessible, use the standard voice; provider [manual verification](https://elevenlabs.io/docs/api-reference/voices/pvc/verification/request) is a case-specific provider process, not a guaranteed bypass. [Delete voice](https://elevenlabs.io/docs/api-reference/voices/delete) and [delete conversation](https://elevenlabs.io/docs/api-reference/conversations/delete) are backend transports; deletion failures need durable retries and a disclosed pending status.

## Concrete real-call test awaiting authorization

Use one owner-controlled, consented US test recipient, the standard voice, no audio recording, maximum 180 seconds and zero redial retries. Start with the information-gathering fixture; verify the actual AI/processing disclosure and graceful refusal. Collect a provider transcript, confirm the recipient heard the required disclosure, exercise end-call, and ensure the summary leaves hypothetical or tentative answers unresolved. Then test an outside-authority counteroffer with collect-options fallback. Calendar writes, clone creation and deployment are separate optional tests needing explicit authorization and their credentials. Do not run this plan merely because API keys have been configured.
