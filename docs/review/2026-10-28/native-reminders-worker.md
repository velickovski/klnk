# Native local reminder implementation

Worker: `/root/security`; implemented on 29 October 2026 after midnight in the existing milestone review folder. This is implementation evidence, not independent device or release certification.

## Implemented

- `apps/mobile/src/features/network/local-reminders.ts`: injected, serialized reminder coordinator. It schedules only future canonical reminders owned by the current account, attached to confirmed participant events, and permitted by the saved notification preference. Quiet and Decisions only cancel local reminder schedules. It keeps at most the nearest 32, uses stable scope/reminder identifiers, updates changed due times and removes cancelled, dismissed, retained-away or missing events.
- `reminder-device.native.ts`: actual Expo Notifications adapter. It checks current OS permission without prompting, schedules one-time date triggers, and cancels only klnk-managed identifiers. Permission is requested only by the explicit Enable action. Notification content is generic; meeting text, names, location and conversation content do not enter the lock-screen payload. It uses passive, silent local alerts without badges. Android creates its local channel before requesting permission or scheduling.
- `device-reminders.native.tsx`, `device-reminders.tsx`, `device-reminders.types.ts`: native lifecycle/context and an honest unsupported browser surface. Native foreground handler setup/cleanup belongs to the provider, with no subscription installed merely by importing the module. The provider checks the canonical identity, scopes preferences by SHA-256 of server origin/account ID and refreshes calendar/preferences while foregrounded and on return. There is no APNs/Expo push token registration or background fetch.
- `data-provider.tsx`: reminder provider sits inside the session provider above both voice home and workspace. Its lifecycle is independent from the workspace-active polling flag. Session changes invalidate in-flight work and cancel managed schedules. A restored process clears old schedules before trusting its authenticated identity. This does not add controls to the opening screen.
- `PreferencesPanel.tsx`: explicit opt-in/off controls, permission/status display, user-triggered device Settings link, refresh, quiet-policy explanation and closed-app freshness limitations.
- `apps/mobile/test/local-reminders.test.ts`: sixteen pure injected regressions. No native permission or notification is performed by these tests.

Device opt-in is stored with the existing Expo SecureStore, scoped to account and server, using `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. A single serialized coordinator fences late permission results, late native schedules, stale controls and prior-session cleanup. Same-owner re-login cannot let an old cleanup cancel the replacement's schedules. Signout cancellation does not delete unrelated notification identifiers.

## Shared contract and compatibility

Root installed `expo-notifications ~58.1.6`, matching both the installed Expo 58 `bundledNativeModules.json` and [Expo 58 documentation](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/). Root verified the installed config plugin and added `enableRemoteNotifications:false` plus `enableBackgroundRemoteNotifications:false`. Thus this feature does not request APNs capability or remote-notification background mode. Existing Expo Crypto and SecureStore dependencies are reused.

The installed [push-notifications skill](C:/Users/andre/.codex/skills/push-notifications/SKILL.md) guided explicit authorization, current-status checks, foreground handling and honest OS-delivery limits. Its Swift/APNs examples were not treated as a requirement to register for remote notifications; this feature needs only local scheduling.

## Actual checks

| Check | Result |
| --- | --- |
| `npx vitest run apps/mobile/test/local-reminders.test.ts apps/mobile/test/network-data.test.ts --reporter=json --outputFile=.data/local-reminder-final.json` | **26/26 passed**: reminder 16, existing session-data 10 |
| `npm run typecheck --workspace @personal-agent/mobile` | **PASS**, including native source |
| ESLint on all eight owned source/test files | **PASS**, no diagnostics |
| Scoped Prettier | **PASS** |
| `EXPO_NO_DOTENV=1 npx expo export --platform web --output-dir dist-reminder-check` from mobile workspace | **PASS**, 605 modules; native OS adapter isolated from browser export |

Regressions cover: no initial prompt/opt-in, explicit permission request, denied permission without repeated prompts, quiet/Decisions-only cancellation, event cancellation/dismissal/removal, permission revocation, changed due-time replacement, nearest-32 bounds, owner mismatch, signout and unrelated-notice preservation, same-scope replacement during an in-flight schedule, late permission response, stale-owner controls during a replacement schedule, failed canonical readback and private-text exclusion.

An early mobile test import used Node crypto for fictional IDs; it was replaced by deterministic fixture IDs to match the mobile TypeScript environment. Another concurrent TypeScript run surfaced an independent QA fixture's invalid `off` preference; its owner corrected it. The passing result above is subsequent to those corrections. Quality owns the new OS/API Jest mocks; Platform independently reviews this implementation and updates the native-voice test's local API mock for the new session-change subscription.

## Limits and remaining evidence

No physical iPhone, real permission dialog, actual scheduled/delivered alert, notification tap, Focus behavior, denial recovery or native build was tested. Expo SDK compatibility and a successful web export do not establish device behavior. OS settings and scheduling limits can delay or suppress an alert; scheduling is not delivery evidence.

Only foreground sync can learn server edits or remote account changes. A previously scheduled generic alert can still appear while the app is closed until its next successful sync. There is no background push or APNs cancellation. Explicit local signout/owner changes attempt OS cancellation immediately through the serialized device queue; OS API failure remains a device-validation concern. Tapping a generic local alert opens the application; no unverified account is selected or external action authorized from its payload.

Opt-in is local to this account/server/device. Browser preview keeps in-app notices and exposes no native permission control. Local reminders do not enable phone calls, email, Calendar-provider writes, critical alerts or external communication. No real permission, notification, provider request or deployment occurred during this work.
