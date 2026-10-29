# Independent production voice QA

Reviewer: `/root/platform`. The reviewed voice implementation belongs to `/root/security` and root integration. This report does not independently certify this reviewer's account, worker or network implementation.

## Scope and findings

Reviewed the authenticated continuous Live routes, durable reservation/session guards, signed-out browser controller, recorded transcription routes/service, native recorded-voice panel, native capture hook and its pause detector. All providers, recording and device speech used by these checks are injected local fixtures. No actual audio or provider request was made.

**Fixed before passing:** recorded voice endpoints initially lacked the production HTTPS and exact-Origin protection already present on continuous Live. Independent HTTP tests reproduced acceptance over HTTP. Security added the shared owner-voice guard to all recorded endpoints; root also added the earlier global production HTTPS/Origin boundary. The final HTTP tests assert the global `403 https_required` / `origin_not_allowed` response before any paid request. This change closes the observed gap rather than relying on browser CORS response visibility.

**Documented limit:** `maxCaptureSeconds: 30` is the native client's capture bound. The server validates decoded upload bytes (2 MiB), base64 encoding, durable owner attempts (60/day), route starts (6/minute) and provider timeout. It does not parse uploaded media duration. A custom client can submit compressed audio lasting more than 30 seconds within the byte limit. Server spending must not be represented as a guaranteed 30-seconds-times-60 audio allowance. Security confirmed and documented this distinction; no untrusted client duration field was introduced as a substitute for media inspection.

## Added independent checks

`tests/qa-voice-production.test.ts` covers:

- Product status requires authentication and the production HTTPS/exact-Origin boundary; configured status is private/no-store and never exposes a key; legacy demos remain disabled.
- Rejected Live provider starts still consume the owner route budget, errors omit provider bodies, and canonical receipts cannot be read by another owner.
- Production Live reservation rejects missing, foreign-owner, idle and absolutely expired bearer hashes before writing a receipt or contacting a provider.
- Both transports reject an idle bearer; recorded receipt readback is owner scoped.
- Recorded routes reject unsafe transport/origin before transcription and enforce their HTTP attempt limit.
- A bearer that becomes idle while transcription is pending is rechecked after the provider returns; no owner-intent receipt or conversation is created from that late transcript.
- Signed-out browser start never captures a microphone, creates a demo identity or sends a paid request.

`apps/mobile/component-test/qa-native-voice.component.test.tsx` renders the actual `NativeVoicePanel` with the actual theme/session provider and injected HTTP/capture/speech interfaces. It covers:

- Unavailable server status leaves capture off.
- The exact server reply is passed to device speech; completion resumes capture, and a subsequent spoken turn carries the server-provided immutable review reference.
- An uncertain POST does not automatically retry. Explicit canonical read followed by a missing receipt exposes a same-recording retry preserving the original identifier and bytes.
- Backgrounding stops capture/playback and suppresses late result speech; unmount cleans up.

The native `useVoiceIO` source uses Expo Audio recording with metering, its installed pause detector, cache-file removal, generation checks and AppState cleanup. Source inspection is not evidence that actual iPhone permission, microphone capture, speaker routing or interrupted recording worked.

## Observed verification

| Command | Result |
| --- | --- |
| `npx vitest run tests/qa-voice-production.test.ts --reporter=json --outputFile=.data/m3-independent-voice-qa.json` | **8/8 passed**, 0 failed, 7.617 seconds. |
| `npm run test:components -- --runTestsByPath apps/mobile/component-test/qa-native-voice.component.test.tsx --runInBand` | **4/4 passed**, one suite, 1.850 seconds. |
| Root `npx tsc --noEmit --pretty false` | Passed after root integration. |
| Mobile `npm run typecheck --workspace @personal-agent/mobile` | Passed after correcting root's App import path. |
| Scoped ESLint / Prettier for the two new test files | Passed. |

The initial failed HTTP checks and subsequent changes were communicated to the source owners. No voice production source was changed by this reviewer.

## Remaining verification and constraints

- Browser/export integration is a separate gate; these checks do not certify the final rendered browser bundle.
- Physical iPhone recording, interruption, permission, device speech, silent-mode behavior, VoiceOver and foreground/background recovery remain untested.
- The native transport is bounded recorded transcription plus actual device text-to-speech, explicitly distinct from native OpenAI Live/WebRTC. No native continuous Live verification is claimed.
- Continuous Live uses the documented server-key broker and backend `/v1/live/sessions`. The official Live flow does not expose the Realtime ephemeral-token endpoint as a compatible Live endpoint. Do not invent an ephemeral Live endpoint or claim completion of a literal ephemeral-token requirement without a supported API change.
- Provider acceptance is not proof the owner heard speech or a recipient accepted a meeting. Canonical network state, authorization and evidence still govern external effects.
- No real model/audio call, email, telephone call, deployment, external delivery, signing or physical-device check was performed.

API compatibility was checked against the official [Live WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc), [Live session creation reference](https://developers.openai.com/api/reference/resources/live/methods/create) and [Live guide](https://developers.openai.com/api/docs/guides/live).
