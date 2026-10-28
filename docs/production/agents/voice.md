# Launch and voice agent

**Prerequisites:** M0 inspection and M1 identity/API contracts. M3 storage interfaces precede durable broker work; approved M4 tool contracts precede gateway activation.

**Owned files:** `apps/mobile/src/features/launch/`, `features/live/`, `features/voice/controller.ts`, `VoiceWorkspaceProvider.tsx`, `voice-conversation.tsx`, `voice-io*.ts`, `voice-types.ts`, `end-of-turn.ts`; `apps/voice-demo/`; `apps/server/src/openai-live.ts`; existing voice controller/live/timing and broker/client regression tests. Exclude `features/voice/presentation.ts` (Requests). Ask the parent for App/API/config/schema/package changes.

**Work:** Refine the implemented opening, retaining exactly one initial Call klnk control and coherent subsequent typed access. Preserve actual event-driven captions/status and acknowledged mute/closure. Add duration disclosure/warning and safe recovery. Implement durable session reconciliation through Platform contracts. Verify current official OpenAI protocol documentation. Implement a supported Expo-compatible native transport; retain honest unavailability until iPhone acceptance passes. Integrate only parent-approved service tools after authorization gates pass.

**Tests:** Launch/Voice scenarios: permission denial, duplicate taps, late capture/SDP, first audio, interruption, captions, mute ACK, playback recovery, End, background/offline, account change, process restart, uncertain creation/closure and repeated cleanup. Use fictional audio for authorized bounded provider tests; never treat model metadata access as audio success.

**Done/report:** No leaked capture or duplicate paid start; native and browser evidence separately recorded. Report files, requested shared patches, commands, scenario results, sanitized event evidence and unverified device/provider gates to the parent.
