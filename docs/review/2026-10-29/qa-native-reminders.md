# Independent local reminder review

Reviewer: `/root/platform`; implementation owner: `/root/security`. No production reminder source was changed by the reviewer.

Reviewed the pure planner/coordinator, native Expo Notifications/SecureStore adapter, authenticated provider, session-provider integration, Preferences opt-in and web capability stub. Added `apps/mobile/test/qa-local-reminders.test.ts` with six independent cases using an injected OS driver:

- Sign-in alone never prompts or schedules; explicit opt-in permits one stable schedule across refreshes. Driver inputs contain only identifier, due time and fingerprint, without private purpose/location/reminder text.
- An OS scheduling operation completing after owner change is cancelled before the new scope can restore reminders. Cleanup from an old scope cannot end the new scope.
- A permission grant arriving after explicit disable cannot persist an enabled opt-in or schedule a reminder.
- Canonical event revision changes replace the existing schedule; cancellation and quiet mode remove it without duplicates.
- Lost current server state fences a late OS schedule, clears managed notices and reports reminders paused.
- Foreign-owner, dismissed and past reminders are rejected; a large future source is bounded to 32 notices.

The native adapter uses generic lock-screen text, passive/silent presentation, scoped SecureStore opt-in, stable managed identifiers, and explicit cancellation of pending and presented managed notices. The provider checks the current authenticated session, reads and validates canonical calendar/preferences, and reconciles foreground changes. A global serialized coordinator fences overlapping old/new session operations. Security also added an early stale-ticket guard and a separate regression, and ensures an Android channel exists when permission was already granted without another prompt.

Observed checks:

| Command | Result |
| --- | --- |
| `npx vitest run apps/mobile/test/qa-local-reminders.test.ts apps/mobile/test/local-reminders.test.ts --reporter=json --outputFile=.data/independent-reminder-qa.json` | **22/22 passed**: six independent cases and sixteen implementation regressions; 3.907 seconds. |
| `npm run test:components -- --runTestsByPath apps/mobile/component-test/qa-native-voice.component.test.tsx --runInBand` | **4/4 passed**, 5.850 seconds, after its local API mock gained the session-listener interface used by reminder integration. |
| Mobile TypeScript and E2E TypeScript | Passed after correcting the new independent fixture to canonical `quiet` mode. |
| Scoped ESLint / Prettier on new QA files | Passed. |

No new blocking defect was found in this review. These tests inject all OS calls; no notification was scheduled, permission requested, sound played or native keychain accessed on a real device.

Closed-app cancellation, account deletion or quiet changes made on another device cannot be guaranteed to reconcile before an already scheduled local notification fires. Current implementation reconciles while foregrounded/connected and clears on local session end. Device Focus settings, notification delivery, iOS/Android persistence, permission UI, physical sign-out cleanup and native foreground/background behavior still require actual device validation. The web stub accurately reports local device reminders unsupported. This report does not establish push delivery, background execution or physical-iPhone readiness.
