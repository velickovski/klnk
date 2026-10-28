# Live voice demo and recording

The one-button browser demo connects the user to OpenAI GPT-Live 1. It uses the original navy/lavender/coral interface and generated pearl/lavender artwork. It does not execute the existing app's outbound calls, calendar updates or mission actions.

## Start locally

1. `OPENAI_API_KEY` is configured on this workstation and real synthetic-audio/browser tests passed on 27 October 2026; see [evidence](../production/05-evidence.md). On a new machine, add it privately to the project-root `.env` file. Create a project key in the [OpenAI API dashboard](https://platform.openai.com/api-keys) if needed. Never paste it into chat or a frontend file.
2. Run `npm run demo:voice`.
3. Open [the voice demo](http://localhost:4100/demo) in a microphone-capable browser on this computer.
4. Select **Call klnk** and grant microphone permission. Test with headphones first to reduce acoustic echo. End the call when finished.

The script uses a separate local database directory and defaults to port 4100, leaving the existing app's 4000/8081 servers alone. Set `VOICE_DEMO_PORT` if 4100 is occupied. Restart the demo after changing `.env`. Use localhost; direct LAN access from an iPhone is deliberately not supported by the broker. Native iPhone integration and any hosted deployment require separate work.

The current model is `gpt-live-1`, with `marin` and a `gpt-6.1-sol` reasoning backend. It starts tool-free. Subsequent account Settings can explicitly grant local in-app lookups/draft preparation/status; this never enables telephone or Calendar effects. See [current tool evidence](../production/05-evidence.md). Model availability depends on the API project; a ChatGPT subscription does not configure API access. Sessions and reasoning are billed through the API; consult [current pricing](https://developers.openai.com/api/docs/models/gpt-live-1). The local demo requests closure after five minutes and restricts concurrent sessions.

## Connection and privacy

The browser sends an SDP offer to the authenticated local broker. The broker creates the OpenAI session using the private project key and returns the SDP answer, not the key. Microphone and generated audio travel over WebRTC. A trusted server control connection requests closure when the local duration limit expires. Matching owner-bound readback distinguishes requested closure from confirmed closure; unconfirmed sessions retain a retry path. Lost or unidentified creation responses block another paid start. This is a development demo, not a production multi-user voice service.

Microphone access begins only from the call action. End closes browser audio resources and requests provider session closure. If closure cannot be confirmed, do not claim the provider session definitely ended. The demo does not intentionally save audio or transcripts to the application database; OpenAI handling remains governed by the API project's applicable settings and terms. Do not describe it as fully on-device or zero-retention.

Captions reflect actual received events. Microphone failure has an honest recovery path; do not replace the model with browser speech synthesis or fixture audio. Expo web now also has the one-action Live opening. Its advanced text workspace is a separate alternative at `http://localhost:8081/?preview=iphone&workspace=1`, available with `npm run mobile:web`. That alternative does not establish full accessibility equivalence for this Live demo.

## Suggested 45–60 second recording

1. Frame the browser at a 390–430 CSS px phone width or use the centered desktop presentation. Hide unrelated windows, key files and account pages.
2. Record the opening screen, activate Call klnk, and let the actual connected agent greet you.
3. Say: “I have a busy afternoon. Help me write a warm, short message telling Jordan I will be ten minutes late.”
4. Follow up naturally: “Make it more casual.” If interruption works in the live test, demonstrate it with a normal correction.
5. Let the actual answer finish, then End call. Review the video to confirm both sides of the audio were captured.

Use an existing screen recorder that can capture browser/system audio and your microphone. Record a short audio check first; the app does not include a video recorder. No recording is uploaded or sent automatically. This scenario demonstrates drafting in a real AI conversation, not an outbound call or completed delivery.

## Verification and troubleshooting

Keep the live run distinct from mocked contract tests and visual inspection. Record browser/device, model/voice, first audible reply, interruption, captions, mute/unmute, ending and permission-denial recovery. If a key or account access is unavailable, mark the live run **Not tested** even if the UI and automated tests pass.

| Symptom | Action |
| --- | --- |
| Setup needed | Add the server key privately and restart the demo |
| Authorization/model-access error | Check project access and API billing; no silent model substitution |
| Microphone blocked | Change the site's permission or open the separate text workspace |
| Connected but inaudible | Check output device, playback permission and system volume |
| Another session active | End the existing call; investigate unconfirmed closure before creating another |
| Page unavailable from phone/LAN | The demo intentionally accepts local computer access only |

Artwork and the exact image prompt are in [ASSETS.md](preview/ASSETS.md). Runtime behavior is owned by `apps/server/src/openai-live.ts` and `apps/voice-demo/app.js`.
