# Implementation plan for 6.1 Sol

## Read and preserve

Read [the latest brief](00-current-brief.md), `AGENTS.md`, the project README and the affected runtime files before changing code. The immediate deliverable is the one-button OpenAI browser demo. The full Expo workspace redesign is a subsequent stage. Do not rebuild a demo that is already implemented.

| Concern | Existing or new source |
| --- | --- |
| Browser recording demo | `apps/voice-demo/index.html`, `styles.css`, `app.js`, `assets/` |
| OpenAI session broker and local demo routes | `apps/server/src/openai-live.ts`, registered by `app.ts` |
| Private configuration | `apps/server/src/config.ts`, `.env.example`; never commit `.env` |
| Expo shell, auth and routes | `apps/mobile/App.tsx` |
| Existing turn-based voice | `apps/mobile/src/voice-conversation.tsx`, `voice-io.native.ts`, `voice-io.web.ts`, `end-of-turn.ts` |
| Request review and result | `apps/mobile/src/mission-composer.tsx`, `mission-conversation.tsx` |
| People, memory, preferences | `apps/mobile/src/people-memory.tsx`, `settings.tsx`, `setup.tsx` |
| API and current shared UI | `apps/mobile/src/api.ts`, `models.ts`, `ui.tsx` |
| Authoritative behavior | `packages/domain/src/core.ts`, server `engine.ts`, `voice.ts`, `app.ts` |

## Stage A: finish and validate the recording demo

1. Keep one visible opening action and the supplied-reference direction. Verify the generated image loads locally; do not put rasterized UI text into the artwork.
2. Keep the OpenAI key and authoritative session configuration server-side. Restrict the demo to local development. Preserve existing telephony gates and credentials.
3. Verify the documented GPT-Live SDP/session/event contract. Use actual transcript/audio events. Distinguish connecting, connected, muted, ended and failed states.
4. Stop tracks, playback and session resources on End, navigation and failed setup. Prevent duplicate connections. A timeout must not be displayed as a successful connection.
5. Use a real key only after it is privately configured. Confirm model access, first audio, interruption, captions, mute, end and microphone-denial recovery. Record the actual test result.
6. Use [09](09-live-demo.md) for the marketing recording. No third-party contact or publication is part of this test.

Done when the screen looks correct at 320/390/430 widths, real conversation is verified, all termination paths release resources, and the evidence distinguishes mocked tests from a live session. If no key or model access is available, the UI and mocked tests can be complete while live verification remains explicitly open.

## Stage B: theme and shared Expo components

Create `src/design/tokens.ts` and `ThemeProvider.tsx`. Replace module-mutated `colors`/`styles` gradually with reactive values. Build `AppScreen`, `AppText`, `ActionButton`, `TextField`, `Notice`, `StatusLabel`, `Disclosure` and `DetailSheet` in `src/components/`. Keep temporary compatibility exports in `ui.tsx` while migrating.

Use actual safe-area insets. Apply current appearance and accessibility settings reactively. Begin with opaque surfaces; native glass is optional after compatibility/device verification. Do not add a visual dependency for an effect that CSS or existing RN primitives already provide.

Done when fields, buttons, errors and sheets render in both themes and at large type with consistent semantics and contrast. Do not migrate every feature in the same edit.

## Stage C: preserve conversation state and correct status mapping

Extract a controller from `voice-conversation.tsx` into `src/features/voice/`, leaving platform audio adapters intact. Preserve session/request identity across tabs in memory. Keep typed drafts after errors. Stop capture on navigation/background, without dropping submitted history. Separate Stop playback, Discard recording and End request.

Create pure presentation mapping for mission/attempt/outcome/follow-up states. Unknown states are neutral. Only `awaiting_owner` means a decision is needed. Reconnect before resubmitting uncertain commands. Type additional bootstrap `limits`/`integrations` fields if consumed; derive their exact shapes from the route response.

Add meaningful regression tests under `apps/mobile/test/` for any extracted state/presentation functions, draft preservation and stale-response handling. The root Vitest pattern already includes this folder; a test under an arbitrary new `src` path will not run automatically.

## Stage D: migrate workspace screens

Migrate request rows and active/result detail first, then optional composition/review, People, Memory and Settings. Follow S01–S09 and preserve endpoint payloads. Keep authorization-critical fields visible in review and retain `reviewVersion`. Do not add inaccessible disabled controls for unavailable capabilities.

Extract `src/features/missions/`, `people/`, `memory/` and `settings/` only as each feature moves. Preserve the existing `App.tsx` auth and connection ownership until the new shell has been verified.

## Stage E: accessibility and native evidence

Resolve the existing recorder's timing issue as a bounded behavior change with dedicated tests, not a cosmetic toggle. A manual-send/continuation design must preserve backend audio limits and prevent unexpected submission. Audit the new Live demo separately. Run the [accessibility matrix](05-accessibility-and-quality.md) and record gaps.

Windows can verify web rendering and JavaScript exports. Native iOS compilation, microphone routing, VoiceOver and system material behavior require an actual compatible iPhone build. Do not claim those from a browser screenshot.

## Implementation checkpoint — 2026-10-27

- Stage A: recovery, owner-bound closure readback, acknowledged mute, startup uncertainty blocking and browser lifecycle regressions implemented. The key is configured. A real standalone browser/broker/WebRTC run with fictional synthetic input passed audio, captions, mute/unmute and closure; see [production evidence](../production/05-evidence.md). Human interruption quality, physical microphone permissions/routing and native verification remain open.
- Stage B: reactive semantic tokens, shared components, opaque themes, safe-area shell and one-action Expo opening implemented. Browser inspection and color-pair tests do not establish native accessibility.
- Stage C: in-memory workspace controller retains draft/session/request identity across tabs; receipt readback precedes uncertain resend. Status presentation keeps unknown states neutral and cancellation pending explicit.
- Stage D: request detail/review, People, Memory and grouped Settings migrated. Unsaved modal edits have Save / Discard / Stay; stale authorization refreshes the current review without resubmitting it.
- Stage E: manual-send mode disables silence timers; the 30-second capture cap stops and holds for explicit Send. Native timing, Dynamic Type and assistive-technology evaluation remain open. The Live web transport remains explicitly unsupported by the native hook.

Evidence and release gaps are maintained in [10-validation.md](10-validation.md). The stages above are implementation progress, not a claim that the end-to-end voice or accessibility acceptance gates have passed.

## Verification commands

For changed server/mobile TypeScript and integration behavior:

```powershell
npm run typecheck
npm test
```

After Expo UI changes, also export the web bundle and inspect the actual application:

```powershell
npm exec --workspace @personal-agent/mobile -- expo export --platform web
```

Run `npm run demo` only for changes touching mission behavior, using the local simulator. Do not use provider setup or real telephony as a routine visual check. The standalone browser demo has no Expo bundling dependency; syntax-check its script and verify its route and interactions directly.

Maintain acceptance evidence with command, result, environment and untested items. Do not add snapshot tests for arbitrary spacing. Test failures that could lose input, duplicate paid sessions, expose secrets, expand authority or display false success.
