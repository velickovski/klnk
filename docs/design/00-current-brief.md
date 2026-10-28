# Current brief and scope

This brief incorporates the user's visual reference and subsequent request for a real OpenAI voice demo. It takes precedence over the broader workspace layouts in this package.

Product update, 27 October 2026: the [internal agent network](../agent-network/01-product-contract.md) now governs subsequent workspace behavior. Keep the same one-action opening and visual direction. Explicitly granted browser voice tools can resolve accepted members, submit bounded internal requests and read actual results. New shared meetings live in klnk's own calendar. Earlier telephone simulations/external adapters remain separate; they are not this product's delivery mechanism.

## Immediate experience

The opening screen contains **one visible interactive control: Call klnk**. No bottom tabs, scenario selector, onboarding form, mode switch or settings button competes with it. A large pale surface meets a deep navy surface with sweeping asymmetric corners, taking direction from the user's mobile-app reference. Coral identifies the call action. An original generated sculpture supplies the hero image; it does not pretend to be a live audio meter.

The button connects the user to a real AI voice conversation. Once the call starts, relevant controls such as End call, microphone mute and captions appear. This keeps the opening effortless while preserving control during the conversation. Microphone permission is requested on user intent. If capture is unavailable, offer the separate existing text workspace. The Live transport does not implement typed input; do not invent a protocol event to imply it does.

The demonstration is available at `/demo`, served by the local API, and in the Expo web opening screen at port 8081. Both use the documented browser WebRTC transport through the authenticated server broker. It is suitable for recording from a desktop browser at a mobile viewport. It is not yet a native iOS WebRTC implementation. The redesigned Expo screens remain the advanced workspace; they do not appear on the one-button demo home.

## What is real

Use the currently documented GPT-Live 1 voice model with a server-held OpenAI key. The voice conversation and generated replies are real when connected. Account access, credentials, audio permission and a successful live test are prerequisites to claiming that it works end to end.

The demo does not telephone third parties or connect to the existing mission engine. The agent can talk through a request or help draft it, but must not claim it contacted Jordan, edited a calendar or completed another external action. Existing outbound-call simulation and live gates remain separate. Marketing recordings must show this actual scope.

## What remains in the handoff

People, Memory, requests, authorization and Settings are preserved in the advanced Expo workspace and now use reactive shared theme components. Documents 01–05 retain their interaction specifications. After a voice attempt, Open workspace provides access; the standalone demo's recovery link opens that subsequent screen directly. Local inspection can also use `?preview=iphone&workspace=1`. This does not add an action to the default opening screen. See [actual validation evidence](10-validation.md) for implemented behavior and remaining device/live-audio checks.

## Asset and access rules

The provided image is a style reference, not a UI to copy pixel for pixel. Use original generated artwork, live HTML text and real controls. No API key belongs in the frontend, a screenshot or a chat message. Add the key privately to local `.env`; only nonsecret readiness information reaches the page.
