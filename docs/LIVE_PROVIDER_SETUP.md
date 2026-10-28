# ElevenLabs and Twilio setup for the first iPhone pilot

Verified against official documentation on October 26, 2026. This guide prepares a controlled test. **Do not place a call yet.** No provider account, number, agent, webhook, voice asset or paid service has been created by this implementation.

The owner conversation and recipient telephone call are separate paths. The owner can record a short spoken request, receive an assistant reply, and later hear a summary. This uses ElevenLabs transcription and speech synthesis through the backend. The recipient call uses an ElevenLabs agent with native Twilio telephony. An owner voice conversation does not itself authorize an outbound call.

## What to provide locally

Put secret values in the ignored root `.env` file or your backend secret manager, never in chat, source control or an `EXPO_PUBLIC_*` variable. The iPhone receives only the app session and backend URL.

| Service | Value | Where it comes from |
|---|---|---|
| ElevenLabs | `ELEVENLABS_API_KEY` | Workspace API key with the endpoint permissions below |
| ElevenLabs | `ELEVENLABS_AGENT_ID` | Dedicated recipient-calling agent |
| ElevenLabs | `ELEVENLABS_OWNER_AGENT_ID` | Separate private text-only agent that interprets the owner's conversation; it is not attached to a telephone number |
| ElevenLabs | `ELEVENLABS_PHONE_NUMBER_ID` | ID returned by importing your Twilio number; this is not the telephone number or Twilio `PN` SID |
| ElevenLabs | `ELEVENLABS_STANDARD_VOICE_ID` | Accessible standard assistant voice selected in your account |
| ElevenLabs | `ELEVENLABS_WEBHOOK_SECRET` | HMAC secret from the configured workspace post-call webhook |
| ElevenLabs | `ELEVENLABS_LLM_PROVIDER` | Actual provider used by the selected agent LLM, for the spoken disclosure |
| Provider settings | `PROVIDER_RETENTION_DISCLOSURE` | Exact statement describing the configured transcript/processing retention |
| Twilio | `TWILIO_ACCOUNT_SID` | Account/project SID beginning `AC` that owns the imported number |
| Twilio | `TWILIO_AUTH_TOKEN` | Credential for that same account, used only on the backend for call reads and termination. The low-level adapter supports API-key pairs, but that alternative is not wired into the application environment yet. |
| Pilot | `LIVE_OWNER_ID` | The one authenticated app owner allowed to use the configured shared provider accounts; obtain it from `/setup/readiness` after signing in |
| Backend | `PUBLIC_API_URL` | Public HTTPS origin with no path or embedded credentials; callbacks use `/webhooks/elevenlabs` |
| Pilot | `LIVE_TEST_RECIPIENTS` | One or more owner-approved E.164 numbers; the initial app gate is US-only |
| Backend | Public HTTPS base URL | Used by the iPhone and the signed post-call webhook route |

Keep `LIVE_CALLS_ENABLED=false`. Credentials and a successful readiness check are not permission to call. Do not reuse a simulation authorization for a live mission.

The private pilot binds shared provider usage to `LIVE_OWNER_ID`, including paid owner speech/planning and voice previews. Another demo account can still use deterministic text/device-speech simulation, but cannot consume these shared credentials. Provider voice turns and reports are capped at 100 receipts per rolling day, with route rate limits as well. This binding does not require enabling telephone calling: owner speech can be tested while `LIVE_CALLS_ENABLED=false`.

## ElevenLabs account and API key

Use an account/workspace with API access, an available standard voice, and ElevenAgents/telephony quota sufficient for a short test. The plan, current balance and commercial eligibility must be checked in your own account; no ordinary subscription is assumed to supply verified personal clones for multiple customers.

The runtime key needs `convai_read`, `convai_write`, `voices_read`, `text_to_speech` and `speech_to_text` for this implementation. Read-only agent, phone and conversation checks use the conversational permissions. Owner audio transcription uses Speech to Text; spoken replies and summaries use Text to Speech. Keep voice creation/write permissions off while cloning is unavailable. Set a small key credit quota. A backend service-account key is appropriate when your workspace plan supports it; a personal development key inherits its user's access and may require a Full Seat. [API authentication](https://elevenlabs.io/docs/api-reference/authentication), [workspace API keys](https://elevenlabs.io/docs/overview/administration/workspaces/api-keys), [permission names](https://elevenlabs.io/docs/api-reference/service-accounts/api-keys/create).

The owner audio transport uses `POST /v1/speech-to-text`, multipart `model_id=scribe_v2`, a directly uploaded audio file, synchronous output, no diarization, no audio-event tags and no transcription-webhook fan-out. Supported iPhone recording formats include M4A/MP4. This app caps a turn at 10 MiB; the mobile/server flow should impose a shorter time limit. It does not use remote-source URLs or transcript editing. Provider logging defaults apply: enterprise-only zero retention is not silently requested. The owner must consent to this processing before using the microphone flow. [Transcription API](https://elevenlabs.io/docs/api-reference/speech-to-text/convert), [Scribe quickstart](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/speech-to-text).

Replies use the standard voice through `POST /v1/text-to-speech/{voice_id}` and bounded MP3 output. The default transport model is `eleven_multilingual_v2`; an explicitly configured supported model/language may replace it. Voice/model language support must be checked for the intended owner language; listing a language in the app does not validate pronunciation, names or dialect quality. No voice-quality test has been run. [Speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).

## Private owner-conversation agent

For general owner speech beyond the local deterministic command patterns, create a second dedicated ElevenLabs agent and place its ID in `ELEVENLABS_OWNER_AGENT_ID`. This uses your existing ElevenLabs account rather than requiring another model provider account. It remains separate from the agent that later calls the recipient.

Require authorization on this owner agent, select an LLM, set `conversation.text_only=true`, cap its duration at 60 seconds, and leave its first message empty. Keep tools, MCP, knowledge bases, procedures, transfers and workflows empty. Enable prompt, first-message, language and empty-tool-list overrides as above, plus `conversation.text_only` and `conversation.max_duration_seconds`. Set privacy/retention deliberately for these owner conversations too. The owner's recorded speech is transcribed first; only the resulting text, selected candidate contact names/IDs, language/timezone/current time and the last six brief owner-assistant turns enter this planner. Phone numbers and the memory store are excluded.

Before every planning turn, the backend reads the current owner-agent configuration and fails closed if private authorization, text-only mode, duration, finite retention, recording-off settings, empty inherited capabilities or required overrides are missing or unsafe. This check is not cached. It then obtains a private signed URL with `GET /v1/convai/conversation/get-signed-url?agent_id=...`, opens the documented WSS connection, sends the text-only initiation and one `user_message`, and accepts one structured response. It handles ping/pong and closes on a result, timeout, malformed response or any tool request. Returned model text cannot make a call, authorize a mission, select a phone number or bypass the server's identity checks. The backend validates the resulting intent and resolves a unique owned recipient separately. It can then speak a clarification or a concise mission review; execution remains a separate explicit authorization. [Signed URLs](https://elevenlabs.io/docs/api-reference/conversations/get-signed-url), [Agent WebSockets](https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket).

This first owner experience is short record-and-reply voice turns, with optional typing for accessibility. It is not a continuously listening assistant. Microphone recording starts only after owner permission and a deliberate action; a call result is spoken only when available and requested/opened by the owner. Backend work can continue while the phone is unavailable, but background iOS playback and push delivery are separate capabilities.

## Dedicated recipient-calling agent

Create a separate, simple agent for this pilot. Select the standard voice and intended recipient language, choose an LLM, and record its actual provider for the disclosure. Set a maximum duration of 180 seconds, voice recording off and a finite retention period (7 days is a useful test setting). Keep custom tools, MCP connections, knowledge bases, procedures and workflows empty. Only reviewed end/turn/language/voicemail built-ins are acceptable; transfer and keypad tools remain disabled.

Enable these initiation overrides under `platform_settings.overrides.conversation_config_override`:

```json
{
  "agent": {
    "first_message": true,
    "language": true,
    "prompt": {
      "prompt": true,
      "tool_ids": true,
      "native_mcp_server_ids": true,
      "knowledge_base": true
    }
  },
  "tts": { "voice_id": true },
  "conversation": { "max_duration_seconds": true }
}
```

The outbound request sets `tool_ids_strict=true`, documented as permitted whenever tool IDs may be overridden. The metadata preflight verifies required overrides, empty inherited capabilities, the standard voice, duration and provider privacy fields. Missing safety metadata remains **unknown**, not ready. Verify any inherited workspace settings in the dashboard. No read-only check proves future generated utterances are compliant. [Agent configuration API](https://elevenlabs.io/docs/api-reference/agents/get), [outbound API](https://elevenlabs.io/docs/api-reference/integrations/twilio/outbound-call).

The checker requires explicit empty current `tool_ids`, `native_mcp_server_ids` and `knowledge_base` arrays. It accepts omitted/null optional legacy `tools`/`mcp_server_ids` only alongside those empty current lists, and rejects any nonempty legacy list. Optional workflow/procedure attachments and built-in tool objects follow the official GET models' `None` defaults; an unset attachment is not a requirement to write an obsolete field. Nonempty or malformed attachments remain blocked. The separate strict-tool override flag is not required when the documented `tool_ids` permission already allows it. [Official prompt output model](https://github.com/elevenlabs/elevenlabs-python/blob/main/src/elevenlabs/types/prompt_agent_api_model_output.py), [official agent response model](https://github.com/elevenlabs/elevenlabs-python/blob/main/src/elevenlabs/types/get_agent_response_model.py).

The actual first message must disclose AI identity, the owner and general purpose, processing by ElevenLabs and the configured model provider, actual retention and an opt-out. It must not reveal a sensitive mission title before confirming the intended person. Audio recording off does not mean no provider processing or transcript storage. The app's live pilot continues to block consequential commitments, appointments, refund negotiations and external actions until a bounded voice flow is validated. [ElevenAgents terms](https://elevenlabs.io/agents-terms).

## Twilio number and account

Use a real Twilio account/project, with required account verification and the selected number's current Voice setup/registration complete. Twilio test credentials cannot prove a real telephone connection. A purchased voice-capable number is the straightforward first setup. An already verified caller ID is also supported by ElevenLabs for outbound calls, but does not provide this app with inbound callbacks. **Do not trigger new caller-ID verification by telephone now**: that API itself places a real call. If your account offers SMS verification, you can complete that yourself; otherwise leave it pending until calling is approved. [Voice setup](https://help.twilio.com/articles/55716616689819-How-do-I-complete-the-Voice-setup-guide), [caller-ID verification](https://www.twilio.com/docs/voice/api/outgoing-caller-ids).

Import the number in ElevenAgents → Phone Numbers using its E.164 number and the same Twilio account credentials or a supported limited API key. ElevenLabs configures the Twilio number during import; this is an account change, not a local operation. Save the resulting ElevenLabs phone-number ID. You do not need to assign an inbound agent for the outbound-only test. Do not direct unreviewed inbound traffic into this app. [Native integration](https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/native-integration), [phone metadata API](https://elevenlabs.io/docs/api-reference/phone-numbers/get).

For a Twilio trial, verify the eventual recipient in the same account and account for the trial announcement and current limits. A trial may expire, restrict destinations and disconnect long calls. An upgraded account removes some trial restrictions but does not replace number registration or destination permissions. Use only the one approved, owner-controlled test number. [Trial restrictions](https://help.twilio.com/hc/en-us/articles/360036052753-Twilio-Free-Trial-Limitations).

In Voice → Settings → Geo permissions, enable only the low-risk destination country needed for the approved test. Keep premium/high-risk ranges off. Confirm the specific recipient using Twilio's permission check. The current application pilot accepts approved US recipients only; a `+1` number is not by itself proof of US jurisdiction. Calling North Macedonia or another market needs a deliberate application/policy and provider review before changing that restriction. Configure account billing/usage alerts as well as the app's duration and daily limits. [Geographic permissions](https://www.twilio.com/docs/sip-trunking/voice-dialing-geographic-permissions).

The backend uses Twilio's call resource to inspect and end the exact returned call SID. A termination request is not reported as finished until a terminal state is observed. There is no transfer, takeover or general live typed-control implementation in this adapter. [Call resource](https://www.twilio.com/docs/voice/api/call-resource).

## HTTPS post-call webhook

The owner app needs a reachable API; the telephone provider additionally needs public HTTPS. A localhost/LAN-only URL is insufficient for ElevenLabs callbacks. Prepare hosting or an explicitly approved development tunnel separately. Do not expose an unauthenticated local development service just to obtain a URL.

Create a workspace webhook pointing to `https://YOUR-BACKEND/webhooks/elevenlabs`, use HMAC authentication, and store its secret only on the backend. On the dedicated agent, select that webhook and enable `transcript` and `call_initiation_failure`; choose JSON format. Leave `audio`, `unredacted_audio` and `unredacted_transcript` disabled. The application verifies the original body bytes, timestamp and replay key, then reconciles through an authenticated provider read. [Workspace webhooks](https://elevenlabs.io/docs/api-reference/webhooks/create), [post-call events](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks).

## What the local checks establish

`getAgent`, `getPhoneNumber`, `getAccount`, `listIncomingPhoneNumbers` and `listVerifiedCallerIds` make GET requests only. They do not synthesize audio, transcribe audio, purchase a number, change an agent, verify a caller ID or start a call. Twilio account metadata is sanitized to exclude the raw account endpoint's `auth_token`. Never print the complete ElevenLabs agent response: it may contain private prompts/configuration.

A configured-key check can verify account access, imported-number ownership, standard-voice access and visible agent settings. It cannot prove caller-ID presentation, the recipient's consent, actual voice quality, cellular routing, webhook delivery from the provider, successful end-call behavior or correct spoken agreements. Those require a later separately approved real test. The next test should use one approved number, the standard voice, 180 seconds, no redial and a simple information request. No call is authorized by this guide.

Apple signing, Expo/EAS installation and backend connectivity are described in the iPhone setup guide. Voice cloning, Google Calendar onboarding and live consequential commitments are not prerequisites for the first disclosed information/message call and remain separate work.
