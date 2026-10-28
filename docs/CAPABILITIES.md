# Capability and evidence matrix

Checked against official documentation on **26 October 2026**. “Implemented” below describes source code and local mocked tests, never a successful telephone call or iPhone device test. The initial operating scope is an allowlisted US test pilot. Public calling, international expansion, recording and commercial onboarding require a separate launch review for the actual configuration and recipient jurisdiction.

## Telephone path

The backend uses ElevenLabs’ native Twilio integration. The iPhone is a control client, not a cellular audio interceptor. The adapter sends an approved mission prompt and disclosure as initiation overrides, disables inherited tools and knowledge bases, sets a duration cap, and stores the returned conversation ID and Twilio call SID. These overrides must be enabled for the configured provider agent; a provider rejection must fail the attempt. See [outbound request schema](https://elevenlabs.io/docs/api-reference/integrations/twilio/outbound-call).

| Capability | Deterministic simulator | Native ElevenLabs + Twilio implementation | Honest fallback |
| --- | --- | --- | --- |
| Outbound recipient call | Simulated, visibly labeled | Backend API adapter; credentials and authorization required | Run a demo mission |
| Call status | Persisted simulated stages | Poll conversation and Twilio resource; signed post-call reconciliation | Reconnect and fetch persisted state |
| Live transcript | Simulated transcript | Unavailable in this adapter; no verified external subscription channel implemented | Post-call transcript |
| Live translated transcript | Fixture original and owner translation | Unavailable | Original post-call text; translation requires an implemented processing adapter |
| Typed owner guidance | Simulated assisted controls | Unavailable on the native telephone connection | Cancel and prepare a revised mission |
| Update instructions during a call | Simulated | Unavailable | New authorization for the next attempt |
| Pause / mute recipient / owner takeover | Unavailable | Unavailable | Request end |
| Termination | Cancel simulation | Twilio call update using actual call SID | Show requested/pending until provider state confirms |
| Transfer | Unavailable | Not implemented | End and let owner call |
| Callbacks | No automatic inbound handling | Not implemented; do not expose the shared number as a personal callback service | Collect a callback instruction for owner handling |
| Final transcript and analysis | Generated fixture | Conversation GET and signed post-call events | Mark pending or uncertain until evidence arrives |
| Audio recording | No audio | Twilio recording explicitly off; ElevenLabs agent retention requires dashboard configuration | Text-only result |
| Conversation deletion | Delete local fixture | Conversation DELETE adapter | Retain deletion-pending record if provider fails |

ElevenLabs documents [final conversation retrieval](https://elevenlabs.io/docs/api-reference/conversations/get) and [post-call events](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks), not a guarantee that an unrelated mobile SDK can steer this outbound telephone session. Polling is eventual state recovery, not a low-latency transcript guarantee. Twilio’s [call resource](https://www.twilio.com/docs/voice/api/call-resource) supports ending or canceling a call. A provider status of `completed` proves a connected call ended; it does not prove message delivery to the intended person, agreement, or goal completion.

Purchased Twilio numbers can support inbound and outbound calls; verified caller IDs support outbound only. Import and provision numbers deliberately. No number is purchased by this repository. See [native Twilio configuration](https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/native-integration).

## iPhone platform access

| Data or entry point | Platform capability | First version behavior / dependency |
| --- | --- | --- |
| Owner facts, mission instructions and relationships | App-owned data | Text entry works without microphone permission |
| Contacts | Explicit permission; limited/full/denied states | Manual entry is complete fallback. Native import requires development build and correct permission handling |
| Calendar creation | EventKit write-only can create events | Does not permit reading or correctly rescheduling an existing event |
| Existing calendar event / availability | EventKit full access or server calendar OAuth | Backend uses an optional Google adapter; no remote EventKit assumption |
| User-shared text/files/screenshots | Explicit import through supported picker/share integration | Text can be pasted; broader share extension is future native work |
| Siri / Shortcuts | App Intents exposes app-specific operations | Native App Intent extension is not implemented; no always-listening claim |
| Existing SMS/iMessage history | No general third-party access | User pastes chosen excerpts |
| Built-in Phone recordings | No supported general access API | User explicitly shares supported files |
| Native cellular call audio | Not available through CallKit | Calls use the app’s backend infrastructure |
| Other apps’ private data | Sandbox prevents unrestricted access | Separate authorized adapters only |
| Custom wake word after termination | Not a general entitlement of an ordinary app | Open the app / future supported Siri intent |
| Default calling / carrier messaging roles | Entitlements and restrictions apply | Not dependencies of this application |

Apple’s [Contacts guidance](https://developer.apple.com/documentation/contacts/accessing-the-contact-store) supports selected-contact access and requires `NSContactsUsageDescription`; contacts outside that grant must not be fetched. [EventKit guidance](https://developer.apple.com/documentation/eventkit/accessing-the-event-store) distinguishes write-only from full access and requires the appropriate modern usage strings. A backend cannot invoke an iPhone event store while the device is offline.

Apple DTS confirms limits for [Messages and built-in recordings](https://developer.apple.com/forums/thread/848299) and [native call audio](https://developer.apple.com/forums/thread/835552). These are Apple staff answers; they are not permission grants. [Platform sandboxing](https://support.apple.com/guide/security/security-of-runtime-process-sec15bfe098e/web) limits cross-app access and background work. [App Intents](https://developer.apple.com/documentation/appintents) exposes supported app actions to system experiences; no general phone-control permission follows from it.

[Default Calling App entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.calling-app) is documented from iOS 18.2 and allows default calling-app selection; it does not grant native Phone audio interception. [TelephonyMessagingKit](https://developer.apple.com/documentation/telephonymessagingkit) is documented from iOS 26 for iPhone SMS/MMS/RCS, requires the carrier-messaging entitlement and default-app selection, and currently requires end users to have an EU-registered account and a device located in the EU. Apple-provided development provisioning can permit testing elsewhere. This restricted carrier role does not give an ordinary app the existing Messages history. Neither role is a dependency of this application.

## Voice and privacy

| Capability | Implementation status |
| --- | --- |
| Standard assistant voice | Usable default; configured provider voice ID remains server-side |
| Voice preview | Backend TTS adapter with fixed/short preview text; only owned or configured standard assets may be exposed |
| Instant clone | Low-level consent-gated adapter; end-user enrollment disabled pending approved account/verification arrangement |
| Professional clone | Documented workflow only; creation/training/captcha onboarding not wired into app |
| Clone enablement | Must depend on server-recorded ownership and provider verification; a client checkbox cannot mark verified |
| Clone revoke/delete | Local selection must be revoked immediately; backend provider delete adapter supports cleanup |
| Accessibility fallback | Standard voice and text-only onboarding; no clone or recorded verification required |

[Voice cloning concepts](https://elevenlabs.io/docs/eleven-api/concepts/voice-cloning) distinguish few-shot Instant cloning from fine-tuned Professional cloning; quality depends on samples and cannot promise perfect indistinguishability. The [IVC API](https://elevenlabs.io/docs/api-reference/voices/ivc/create) returns `requires_verification`; false is not a universal proof of the speaker’s identity. [PVC onboarding](https://elevenlabs.io/docs/eleven-api/guides/how-to/voices/professional-voice-cloning) requires eligible plan access, samples, verification and training. A [manual-verification API](https://elevenlabs.io/docs/api-reference/voices/pvc/verification/request) exists; provider support must determine appropriate evidence for the individual. The complete product remains available with a standard voice.

No ordinary subscription is assumed to include one verified Professional clone per application customer. Actual quotas, account ownership, customer consent collection, permitted commercial use, costs and provider verification need written confirmation for this multi-user product before enrollment is switched on.

## Enforcement boundary

The server can enforce ownership, selected memory, tool permissions, recipients, action prerequisites, duration and external writes. It cannot guarantee every utterance produced inside a hosted voice agent. The adapter disables inherited tools, but a prompt is not a transaction firewall for verbal promises. High-consequence negotiations need bounded, reviewed flows or owner handling until a validated pre-utterance policy channel is implemented. Live assisted controls stay unavailable rather than silently treating typed text as if it reached the recipient.

App Store readiness remains unverified. Device accessibility checks, signing, purpose strings, privacy disclosures, account deletion, provider data handling and [App Review requirements](https://developer.apple.com/app-store/review/guidelines/) must be validated for the eventual release build. Windows can run the backend, tests and JavaScript bundler. An iOS native compilation needs macOS/Xcode or an explicitly authorized cloud build; see [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/).
