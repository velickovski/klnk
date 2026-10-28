# Settings worker — M2

Agent / milestone / status: Settings implementation worker / M2 / local implementation complete; independent browser review pending, device and real-service gates blocked.

Task and owned files:

- [Settings and optional profile onboarding](../../../apps/mobile/src/settings.tsx).
- [Server selection and calling readiness](../../../apps/mobile/src/setup.tsx).
- [Owner-scoped provider](../../../apps/mobile/src/features/settings/SettingsDraftProvider.tsx), [draft lifecycle](../../../apps/mobile/src/features/settings/draft.ts), [service state presentation](../../../apps/mobile/src/features/settings/connections.ts).
- [Dedicated regressions](../../../apps/mobile/test/settings-draft.test.ts).
- This report. No manifests, server routes, domain policy, credentials or external resources changed by this worker.

Implemented behavior:

- Profile drafts live above inactive tabs inside the identity/backend lifetime. Unsaved edits and failed-save feedback survive panel unmount. Refreshes merge untouched fields, retain dirty edits, and establish the accepted saved baseline. Typing during an in-flight save does not get replaced by its result. Duplicate pending saves are suppressed. New owner stores contain no prior owner's draft. Browser reload protection stays active even while another tab is selected.
- Name and timezone validation is associated with the fields. Names/timezones are trimmed when submitted; invalid or empty timezones never reach the mutation. Discard returns to the latest accepted profile.
- Optional setup is now used inside the Profile disclosure for incomplete profiles. Saving completes setup; no form was added to the one-button opening.
- Voice and saved-service loads have distinct loading/error/retry states and account-lifetime checks. Async preview playback errors are readable. Preview stops on panel unmount. Telephone voice and OpenAI owner-conversation voice are separate. Clone availability is never fabricated.
- Server service statuses distinguish connected, connecting, denied, disconnected, expired, insufficient scope, revoked, unavailable and unknown. Missing status never defaults to Authorized. Existing adapter metadata does not imply OAuth success. Native contacts, app history and microphone access stay accurately scoped.
- Service disconnect and clone deletion have explicit confirm/keep choices and precise local-removal versus remote-cleanup wording. Export prepares full selectable data before the user chooses Share, with cancellation/failure recovery. Account deletion explains termination prerequisites, local removal, queued cleanup and remaining retention; a failed acknowledgement stays retryable.
- Server selection describes account/draft reset, uses credential-free health checks, suppresses duplicate submissions, and ignores unmounted results. Production builds show the local-HTTP option only with explicit `EXPO_PUBLIC_ALLOW_LOCAL_HTTP=true`; development builds retain local setup.

Shared contracts changed or requested:

- Parent integrated `SettingsDraftProvider({ profile, children })` beneath `VoiceWorkspaceProvider` inside its identity-keyed shell. The parent remounts that shell on token/origin change; this is required to clear the same owner's draft when changing backends.
- `SettingsScreen.onSave` is `(profile: Profile) => Promise<boolean>`; true requires accepted PUT plus accepted profile/bootstrap refresh. False or throw retains draft without claiming definite save failure after an ambiguous refresh.
- `SettingsScreen.onDelete` returns `Promise<boolean>` using the existing parent operation acknowledgement.
- Requested parent-owned `Choice.disabled` propagation using shared `a11yState` so busy voice choices announce disabled state. No independent edits to shared primitives were made.
- Requested parent design-decision record: optional profile onboarding, memory-only account/backend draft lifetime, explicit export sharing and unchanged standard live telephone voice.

Scenario IDs and local results:

| Scenario | Result and scope |
| --- | --- |
| SETTINGS-01 | Passed 11 deterministic cases for navigation lifetime, dirty/clean refresh merge, normalized save/refetch, newer edits, canonical refresh, validation, save errors, duplicate submission and owner reset. Actual rendered navigation is awaiting independent QA. |
| SETTINGS-02 | Existing identity/origin API boundaries reused; wording and recovery UI implemented. Export/delete fixture browser journeys were requested from parent QA and not run by this worker. No real account was deleted. |
| SETTINGS-03 | Passed 14 deterministic state-presentation cases; no OAuth, provider account or native integration was connected. Actual expired/revoked provider behavior remains an M4 dependency. |
| A11Y-01/02 | Shared labeled fields, checked/expanded/busy semantics and scalable layout reused; web bundle passed. Keyboard, 320/200% rendered walkthrough requested from independent QA; no conformance claim. |
| A11Y-03 | Blocked: Windows host has no signed iPhone artifact/device. VoiceOver, Voice Control, Switch Control, Full Keyboard Access and Dynamic Type need physical-device evidence. |

Exact checks actually run on Windows / fictional fixtures / 27 October 2026:

- `npx vitest run apps/mobile/test/settings-draft.test.ts` — **25 tests passed**, latest run 15:23 local tool output. No provider/network operation in this suite.
- `npm run typecheck --workspace @personal-agent/mobile` — passed after final profile onboarding integration.
- `npm exec --workspace @personal-agent/mobile -- expo export --platform web` — passed after final onboarding integration; generated `_expo/static/js/web/index-ac0a8198968545c45718c6c847b85ca3.js` (1.3 MB). This is packaging evidence, not native/runtime acceptance.
- Parent owns full root test/E2E integration and final bundle identity after any shared changes.

Evidence links (sanitized): [test source](../../../apps/mobile/test/settings-draft.test.ts). Independent browser evidence belongs in the parent QA report when the current integrated bundle is exercised. No screenshots or personal exports were produced by this worker.

Mocked vs real-provider vs browser vs native: pure deterministic tests and Expo web packaging only; real provider and physical-device scenarios not run. Existing in-app simulation stays labeled.

Known defects and limits:

- Source discrepancy: live `engine.ts` uses `config.standardVoice` for telephone start rather than selected voice records. The UI now states this explicitly; this worker did not change telephone execution or clone provisioning.
- OAuth onboarding, remote OAuth revocation and verified customer clone enrollment remain unavailable. Display mapping does not implement them.
- Drafts intentionally reset when signing out, changing backend or leaving the workspace; current copy asks the user to save first. They are not persisted to browser storage or device files.
- The backend profile has no revision/conflict token. Clean-field refresh merging preserves local edits but cannot implement server-side concurrent-edit conflict prevention.
- Shared voice-choice disabled semantics depend on the parent primitive patch. The handler currently ignores choices while a voice operation is busy.

Dependencies / next action: parent reviews/wires shared patch, rebuilds the E2E bundle, and runs actual Settings navigation/save/refetch/failure/export/delete journeys plus responsive/keyboard checks. M4 supplies verified provider authorization states. Device checks require a compatible macOS/Xcode host and iPhone.

Independent reviewer and review result: requested from parent/independent QA; pending at worker handoff. This report does not self-certify M2 or production release.

Skills applied: [accessibility](C:/Users/andre/.codex/skills/ios-accessibility/SKILL.md), [networking](C:/Users/andre/.codex/skills/ios-networking/SKILL.md), [authentication](C:/Users/andre/.codex/skills/authentication/SKILL.md), [security](C:/Users/andre/.codex/skills/swift-security/SKILL.md). The security credential-storage reference informed account-lifetime cache clearing; this worker did not introduce credential storage or native Keychain code.
