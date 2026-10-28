# Frontend review: architecture, design system, UX and accessibility (apps/mobile)

**Baseline:** `npm run typecheck --workspace @personal-agent/mobile` passes, and the mobile vitest suite passes (15 files, 270 tests). Every test covers logic only: no test imports a `.tsx` component (test/*.ts imports only model/state modules). Rendered UI is covered only by e2e/browser.

**Size:** App.tsx has 209 lines but 29.7 KB. Next are mission-composer.tsx (125 lines, 26.4 KB), settings.tsx (206 lines, 24.4 KB), browser-live.ts (22.3 KB), InboxPanel.tsx (74 lines, 16.7 KB) and AutonomyPanel.tsx (71 lines, 15.3 KB). Line counts understate the size because the JSX is written minified. App.tsx has 21 lines over 300 characters (the longest is 1,835), and mission-conversation.tsx has a 1,921-character line. The repo has no Prettier or ESLint config.

**God components:**
- `AgentApp` (App.tsx:49-147) holds 12 state hooks, two pollers, all mission/contact/memory mutations inline (App.tsx:140-144), the tab bar and the modal router.
- `InboxContent` (InboxPanel.tsx:12-74) handles the list, filter, composer, detail, decisions and controls together.

## P0

1. **On iPhone, the only control on the home screen always fails.** `useLiveConversation.native.ts:6` sets `start()` straight to an error state. `LaunchScreen.tsx:30` still renders an enabled "Call klnk" button when `live.supported` is false; only the body copy changes (`:26`). "Open workspace" appears only after an attempt (`canExplore`, `:14`). So an iPhone user has to press a broken button before they can get anywhere.
   - The native recorded-turn voice path (`voice-io.native.ts`, used by `voice-conversation.tsx`) is mounted only in the legacy Home (`App.tsx:162`). That is reachable only through `?legacy=1` or Settings → "Account settings & earlier requests" (`Workspace.tsx:88`).
   - The default `NetworkWorkspace` has no voice entry at all. `OwnerIntentPanel.tsx:24` says "Speak from voice home", which loops back to the broken button.
   - **Fix:** on native, change the hero action to "Talk to klnk" and have it start the recorded-turn `VoiceConversation` flow (or the OwnerIntent flow with recorded audio). Show "Open workspace" without a prior attempt when `!live.supported`.

2. **The default workspace has no spec and no visual QA.** `docs/design/03`/`04` specify four bottom tabs: Home/People/Memory/Settings (03 "Bottom navigation"). The app now defaults to a five-tab `NetworkWorkspace` (Inbox/Calendar/People/Memory/Settings, `App.tsx:122`, `Workspace.tsx:73-91`) that does not appear in docs/design. Every screenshot in `docs/production/evidence/qa/visual-final` (home/people/memory/settings at 390, light and dark) shows the legacy tab shell, which users now reach only through a secondary link. The screens real users see first have no visual or a11y evidence.
   - **Fix:** write a 04-style spec for Inbox/Calendar and re-shoot QA on the default path, or retire the legacy shell.

## P1

3. **Two parallel apps share one bundle.** Legacy and network versions exist side by side:
   - People: `features/people/panel.tsx` vs `network/PeoplePanel.tsx`
   - Memory: `features/memory/panel.tsx` vs `network/MemoryPanel.tsx`
   - Settings: `settings.tsx` vs the network Settings tab
   - Voice: `voice-conversation.tsx` vs `LaunchScreen`

   Users see two "People" concepts and two "Settings". Ad-hoc booleans (`workspace`, `legacy`) stand in for routing (`App.tsx:32,55`).
   - **Fix:** choose one information architecture. Move legacy missions and simulation into a single "Earlier requests" route, and delete the dead surface.

4. **Navigation model.** There is no router, URL sync or deep links. Browser back leaves the app, and reloading drops all state.
   - `NetworkWorkspace` shares one `ScrollView` across all panels (`Workspace.tsx:82`), so the scroll offset carries over when switching tabs, and focus is not moved to the new panel.
   - Inbox opens a conversation's detail card above the list (`InboxPanel.tsx:64` vs list at `:72`). Opening an item near the bottom shows nothing visible and moves no focus.
   - **Fix:** use one scroll container per panel, reset scroll and move a11y focus to the panel header on tab change, and open details in the existing `DetailSheet` (`primitives.tsx:41`), which already handles focus containment and restoration. Consider expo-router before adding more screens.

5. **No shared data layer, so data goes stale and fetches fan out.** `Workspace.tsx:83` mounts all nine panels at once and hides inactive ones with `display:none`, so ~12 requests fire on first render.
   - `/network/connections` is fetched separately by Inbox (`InboxPanel.tsx:26`), People (`PeoplePanel.tsx:18`), Memory (`MemoryPanel.tsx:17`) and Autonomy (`AutonomyPanel.tsx:26`).
   - `/network/policy` is fetched by both Autonomy (`:26`) and VoiceAccess (`VoiceAccessPanel.tsx:55`).
   - Nothing invalidates across panels. After you approve a meeting, Inbox's "Open the internal calendar" (`InboxPanel.tsx:66`) switches to a Calendar that loaded once at mount (`CalendarPanel.tsx:29-32`) and is stale. Accepting someone in People does not update Inbox recipients.
   - The network workspace has no polling or refresh-on-foreground, unlike the legacy app (`App.tsx:97-102`).
   - `onConversation` is never passed to CalendarPanel (`Workspace.tsx:85`), so its "Open conversation" button is dead code.
   - **Fix:** add a `NetworkStore` context or TanStack Query with keyed caches, invalidation after mutations, refetch on AppState `active`, and lazy-mounted panels.

6. **Machine formats leak into the UI.** Users have to type ISO-8601 instants and IANA zones:
   - candidate slots and expiry (`InboxPanel.tsx:58-59`)
   - memory expiry (`MemoryPanel.tsx:43`)
   - delegation timezone, HH:mm and comma lists (`AutonomyPanel.tsx:66`)

   Raw ISO strings are also displayed: `updatedAt` (`InboxPanel.tsx:64`), proposal Start/End/Expires (`:65`), message `at` (`:67`), plan slots (`OwnerIntentPanel.tsx:34`), "Saved {updatedAt}" (`VoiceAccessPanel.tsx:73`) and "Expires {draft.expiresAt}" (`AutonomyPanel.tsx:68`). Users also see the proposal hash "Fingerprint" (`InboxPanel.tsx:65`).
   - CalendarPanel already has an `Intl` formatter (`CalendarPanel.tsx:9-11`).
   - **Fix:** move that formatter into a shared `formatDateTime`, and use a native date/time picker with a device-timezone default plus relative expiry presets (24 h / 7 d / 30 d).

7. **Toggles are modelled as buttons.**
   - Weekdays are seven full-width "Allow Monday"/"Remove Monday" buttons (`AutonomyPanel.tsx:66`).
   - Trusted members and memory permits are "Trust X"/"Permit memory: Y" buttons (`:64`, `:67`).
   - Capabilities are yes/no radio pairs labelled "Deliver information: no" (`:65`).
   - Screen readers get no checked state; the state appears only in the verb.
   - **Fix:** add `Switch`/`Checkbox` primitives with `accessibilityRole="switch"|"checkbox"` and `a11yState({checked})`, and a compact 7-chip weekday control.

8. **The primary action's boundary contrast is too low.** The coral `action` (#FF899A) has `borderWidth:0` when primary (`primitives.tsx:20`). Measured contrast against light `background` is 2.09:1, against `surface` 2.26:1 and against `lavender` 1.96:1, below the 3:1 non-text minimum. The pressed state (#FF9CAA) is 1.14:1 against the default, so press feedback is almost invisible. `test/design-contrast.test.ts:21` checks only label-on-fill pairs.
   - **Fix:** add a 1px `borderStrong`/navy edge in light mode, use a darker pressed coral, and add tests for boundary and pressed contrast.

9. **The copy is too dense to read.** Each panel opens with several disclaimers (`InboxPanel.tsx:47-48,52,60`; `OwnerIntentPanel.tsx:24,38`; `VoiceAccessPanel.tsx:72-73`; `Workspace.tsx:88`). The Inbox list shows a full-width "Open request: {purpose}" button per card (`InboxPanel.tsx:72`) instead of the spec's single-target `RequestRow` (03 component contracts, 72-unit row).
   - **Fix:** keep one sentence of scope per screen and move the caveats into a single "How this works" `Disclosure`. Make the card itself the press target.

## P2

10. **Design-token drift.**
    - Light `text` is #202440 and `accent` #713042, but 03 specifies #151924 and #203D87 (`tokens.ts:6`).
    - The `legacyColors` aliases map `green`, `blue` and `lightGreen` to the maroon accent and lavender (`tokens.ts:11`). `Badge` still takes `tone="green|amber|blue"` (`ui.tsx:44`), so the code no longer describes the colours it renders.
    - Hard-coded hex values remain at `App.tsx:202` and `LaunchScreen.tsx:47,53-54` (duplicating `danger`/`dangerSurface`). Ad-hoc font sizes appear at `App.tsx:126,191-192` and `mission-conversation.tsx` (12/13/14/23).
    - Card radius is a literal 24 instead of `radii.group` (`styles.ts:6`).
    - **Fix:** rename to semantic tones, delete the aliases, and add a lint rule that rejects hex and `fontSize` literals outside `design/`.

11. **Unused design-system pieces.**
    - `AppScreen` and `AppText` are barely used (AppScreen 0 call sites; AppText only in LaunchScreen). Screens rebuild their own SafeArea/ScrollView shells.
    - `reducedMotion` and `reducedTransparency` are computed (`ThemeProvider.tsx:25`) but never read.
    - Dead styles: `hero`, `heroIcon`, `modalHeader` (`App.tsx:201-206`). `Onboarding` is imported but unused (`App.tsx:18`).
    - **Fix:** adopt `AppScreen` per panel, and add `EmptyState`/`LoadingState` primitives to replace the scattered "X has not loaded" `Text` (`PeoplePanel.tsx:39`, `MemoryPanel.tsx:46`, `InboxPanel.tsx:72`).

12. **The web preview paths ship in production.**
    - `?preview=iphone` draws a fake phone frame (`App.tsx:44-46`), which 03 forbids ("Never implement a fake phone frame inside the production app").
    - `?workspace=1` and `?legacy=1` skip the launch screen (`App.tsx:32,55`).
    - All of them are read once at mount and never written back.
    - **Fix:** gate them behind `__DEV__`, or move the frame into a dev-only harness or Storybook.

13. **Performance.**
    - No `FlatList` anywhere. Every list is a `.map` inside a ScrollView (Inbox, Calendar, legacy Home `App.tsx:163-165`, captions `LaunchScreen.tsx:31`).
    - The legacy app polls bootstrap every 3 s and mission detail every 2 s (`App.tsx:100,108`), and replaces the whole `Bootstrap`, which re-renders the entire tree without memoised rows. The interval effect depends on `data?.missions`, so the timer is torn down on every poll.
    - The captions list grows without bound and never auto-scrolls to the newest turn.

14. **Accessibility details.**
    - `Notice` both sets `accessibilityRole="alert"` and calls `announceForAccessibility` (`primitives.tsx:31-32`), so screen readers may announce it twice on iOS.
    - Workspace tabs have no tabpanel association (`Workspace.tsx:91`).
    - `Icon` sets `allowFontScaling={false}` (`Icon.tsx:6`). That is acceptable for glyphs, but the tab icons will not grow with Dynamic Type.
    - Positives: `a11yState` web bridging, 48-unit targets, visible web focus rings, DetailSheet focus trap and restore, the unsaved-changes guard (`App.tsx:75-80`), and status not conveyed by colour alone.

15. **Native readiness.** These parts are solid:
    - SecureStore with tombstone and serialized queue (`api.ts:29-39,82-114`)
    - HTTPS/LAN gating (`connection.ts:17-24`)
    - mic permission requested on user intent with a purpose string (`voice-io.native.ts:42`, `app.config.ts:24`)
    - capture cancelled on background (`voice-io.native.ts:69`)

    Gaps: no native screenshots or VoiceOver evidence (05 A11Y-002 "Not tested"). The web session is memory-only (`api.ts:83`), so a reload signs the user out with no explanation.

## Suggested order

P0-1 (native hero action) → P0-2 (spec and QA for the default workspace) → P1-5 (data store) together with P1-4 (per-panel screens and sheet details) → P1-6/7 (pickers and toggles) → retire legacy (P1-3) → token cleanup and lint/format (P2-10, plus Prettier, because the minified JSX can't realistically be reviewed).
