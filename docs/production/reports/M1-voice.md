# Voice / M1 / implemented; integrated packaging repair pending

Date: 27 October 2026. Host: Windows. No Git metadata exists in this workspace.

## Task and owned files

- `apps/mobile/src/features/live/browser-live.ts`
- `apps/mobile/src/features/live/payloads.ts` (new)
- `apps/mobile/src/features/live/useLiveConversation.web.ts`
- `apps/mobile/test/voice-live.test.ts`
- This report. No broker, launch screen, API, domain, configuration or package files edited.

## Implemented behavior

Account/server epoch changes stop local capture/playback immediately, clear captions and invalidate old channel/permission/SDP continuations. Identified or pending paid creation remains associated with its original server and credential for cleanup. An unresolved session continues to block replacement starts. An anonymous start adopts only its own issued demo credential in the exact next epoch; competing identity changes abort that start.

Readiness requires actual boolean fields. Raw JSON success must be an object; creation, SDP, duration and closure payloads are validated. An identifiable malformed creation is retained before answer validation so cleanup targets that same session. Invalid or missing identity preserves uncertainty and does not trigger an automatic paid retry. Closure readback must identify the expected session.

## Shared contracts

Consumes Platform's `getSessionSnapshot(): { generation, url, token }` and existing epoch-notified `onSessionChange`. The injected controller environment now supplies an identity snapshot. No server/domain wire contract changed. Root owns epoch-keyed App integration.

## Scenarios and checks actually run

Scenario families: AUTH-01, NET-01, NET-02, VOICE-01, VOICE-03, VOICE-04. Feature suite grew from 19 to 42 tests. Cases include account replacement, logout, late permission, late identified creation, private-caption clearing, matching closure identity, self-demo transient-null epoch, competing sign-in, malformed readiness/create/close and invalid JSON.

| Command | Result |
| --- | --- |
| `npx vitest run apps/mobile/test/voice-live.test.ts` | Passed: 42 tests |
| `npm run typecheck` | Passed: root and mobile |
| `npm test` | Passed: 253 tests in 19 files; includes concurrent Platform M1 changes |
| `npm exec --workspace @personal-agent/mobile -- expo export --platform web` | Failed: new shared API-contract runtime import reaches domain `index.ts` export `./core.js`; Metro cannot resolve source `.js` to `.ts`. Reported to Root/Platform; shared repair required |

An initial intermediate test run failed because fixture identity injection was not yet updated; fixture update restored all existing tests before the new cases were added. No credentials or provider response bodies were printed.

## Artifact identity

SHA256 at this report's initial write:

| File | SHA256 |
| --- | --- |
| `browser-live.ts` | `4D7B90FF95108CC4335682BDFAA4E18702802041FF8A947DE4A08DDA0C2F1611` |
| `payloads.ts` | `2D8108C88091178726CBCB59B4E67E12066813C52E64A88169D4818706D2D8C3` |
| `useLiveConversation.web.ts` | `53995B6946ED4AE3AD26B9BB05F3ED7C28A5F75DB3417CF49251719E6DAA6C13` |
| `voice-live.test.ts` | `E7EF2A94337531D01C7A54114D0955CAF3761A1F695AFFFA8F5C27014C41E1AF` |

## Evidence limits and next dependencies

All tests above use fictional deterministic fixtures, with no real microphone or provider sessions. Native remains unavailable. No signed-iPhone, physical audio, accessibility conformance or paid OpenAI success is claimed by this change. Standalone demo/runtime broker unchanged.

Independent reviewer: production_qa inspected the self-authorization exception and found no concrete source-level bypass; this is not rendered hook/device certification. Root must review integration and repair Expo packaging. Next Voice work requires new launch/broker leases; durable broker work depends on Platform's storage interface, and native acceptance requires compatible transport validation plus macOS/Xcode, Apple signing and a physical iPhone.
