# klnk: functionality and product coherence review

Scope: README/AGENTS/docs read against `apps/mobile`, `apps/server`, `packages/domain`. No repo files were edited.

## What exists end to end (verified in code)

- **Network workspace (default after sign-in):** Inbox, Calendar, People, Memory and Settings tabs (`apps/mobile/src/features/network/Workspace.tsx:15-33`). Routes are in `apps/server/src/network/routes.ts:19-45`.
- **Request kinds:** `inform`, `ask` and `meeting` are processed by a deterministic worker (`network/coordination.ts:174-200`). There is no LLM-to-LLM negotiation.
- **Typed natural-language planning:** one OpenAI call (`network/owner-intent.ts`). Exact "Tell X that ..." messages skip the model.
- **Legacy telephone/mission product:** still fully wired. Server: `app.ts:129-132` (voice turns), `:180-251` (missions), `:260-290` (calendar, voices, Google), `:328` (ElevenLabs webhook), plus `engine.ts`, `voice.ts` and `integrations/google-calendar.ts`. Mobile: `App.tsx:124-193`, `mission-*.tsx`, `voice-conversation.tsx`, `setup.tsx` and `settings.tsx`.

## P0: the core product does not work as advertised

1. **"Call klnk" is localhost-only and disabled in production.** `localOnly()` returns 404 when `config.production || !demoEnabled`. It returns 403 unless both the request IP and the Host header are loopback (`apps/server/src/openai-live.ts:36-41`). It guards session create, close and read (`:391-420`). Voice tools are also blocked in production (`app.ts:75`). So the headline feature only runs on the developer's own machine: an iPhone on the LAN can't use it, and no deployment can. README:5, README:21 and the brief (`docs/design/00-current-brief.md:11`) all describe it as the product.
2. **On native iPhone, the only opening action always fails.** `useLiveConversation.native.ts:4-6` sets `state:'error'` on every start. The error tells the user to "open the advanced workspace for bounded recorded turns". Those turns exist only in the legacy Home (`App.tsx:162`), not in the network workspace the app now opens by default (`App.tsx:122`). "Open workspace" only appears after a failed attempt (`LaunchScreen.tsx:14,32`). The result on an iPhone: a dead button, then a workspace with no voice at all.
3. **Signed-out "Call klnk" silently creates a throwaway demo account.** `browser-live.ts:94` POSTs `/auth/demo` when no token exists. That account gets a random email and password that are never shown (`app.ts:103-106`). It is seeded with legacy phone contacts and the "Alex Morgan" profile (`seed.ts:13-20`) and has zero network members. Web sessions are memory-only (walkthrough step 1), so a reload orphans the account. When `DEMO_ENABLED=false` or in production, signed-out voice just fails.
4. **No path from sign-up to first value.** Every request kind, including a plain `inform` message, requires both owners to have (`network/policy.ts:20-27`):
   - an *enabled* policy,
   - that policy listing the peer as trusted,
   - the *exact same topic string* in its topics,
   - the matching allow flag.

   The default policy is `enabled:false, topics:[]` (`policy.ts:15`). Questions and meetings additionally need the *inviter* to turn on inbound (`policy.ts:21`). A new user has to exchange an opaque `klnk_<24 chars>` code out of band (`coordination.ts:31`, with no share link, QR code or deep link), wait for acceptance, configure about 15 Autonomy fields, and agree on topic spelling with the other person before saying "I'm running late". There is no onboarding guide, checklist or empty-state CTA that explains this (`InboxPanel.tsx:53` only says "Accept a member connection").
5. **No account lifecycle for a real launch.**
   - Only register, login, demo and logout exist (`app.ts:91-108`).
   - There is no password reset, email verification, or email/password change.
   - Sessions hard-expire after 7 days with no refresh (`auth.ts:22`).
   - Account delete and export are only reachable through "Account settings & earlier requests", i.e. the legacy telephone UI (`Workspace.tsx:30` leads to `App.tsx:133`).

   STATUS.md and FINAL-HANDOFF.md list "onboarding/recovery" as open, but README presents the network as "the current product".

## P1: two products in one repo, and docs that contradict each other

6. **README contradicts itself.** Lines 5-13 describe the internal network. Lines 23-27, 47-49 and 81-86 still pitch telephone delegation ("Call Jordan Lee…", ElevenLabs/Twilio, "Default mode is simulation"). The `npm run demo` validation runs the eight legacy mission kinds (README:58-63, `package.json` "demo").
7. **Stale guidance documents.**
   - `AGENTS.md:7-11` sends agents to the design and production handoffs and never mentions `docs/agent-network/`.
   - `docs/ARCHITECTURE.md` has 0 mentions of the network.
   - `docs/CAPABILITIES.md:1-72` is entirely about the telephone path.
   - `docs/PROGRESS.md:3` "current checkpoint" omits the pivot.
   - The contract cites `production/reports/FINAL-HANDOFF.md` as baseline (`01-product-contract.md:23`).
8. **The auth screen sells the wrong product.** The primary button is "Try the simulation", captioned "Local demo · fictional people · simulated calls" (`App.tsx:191`). Real sign-in is a tertiary compact button. The form header still reads "PERSONAL VOICE AGENT" (`App.tsx:192`). The demo then lands in an empty network workspace.
9. **Duplicated concepts confuse users.**
   - Two People models: phone `Contact` (`people-memory.tsx`) and member `Connection` (`PeoplePanel.tsx`).
   - Two Memory stores: `/memories` and `/network/memories`.
   - Two calendars: `/calendar` (`app.ts:260`) and `/network/calendar`.
   - Two voice stacks: recorded `/voice/turn` (ElevenLabs) and WebRTC Live.
   - Two Settings surfaces.
   - Two launch UIs: `apps/voice-demo/` and `LaunchScreen.tsx`.
10. **The network is unresponsive to incoming work.**
    - Network panels fetch once on mount and then only on a manual "Refresh" (`InboxPanel.tsx:29,50`, `NotificationsPanel.tsx:11`). There is no polling and no AppState refresh, unlike legacy (`App.tsx:97-101`).
    - There is no unread badge on the tabs.
    - Notices don't link to their conversation; the text says "Open the matching conversation below" (`NotificationsPanel.tsx:12`).
    - Reminders are list rows only, with no `expo-notifications` and no due-time surfacing.

    For an "agent works while you're away" product, nothing tells the owner anything happened.
11. **"Agents talk" is thinner than claimed.**
    - **Meeting:** the worker just picks the first free candidate slot from the initiator's list (`coordination.ts:187-197`). There is no counter-proposal, although the contract lists `counterpropose` (`01-product-contract.md:39`). The recipient can only approve or decline.
    - **Ask:** if no pre-shared, confirmed, topic-matched memory exists, the request ends `unresolved`. The recipient human is never asked (`coordination.ts:181-182`), and there is no reply/answer route in `routes.ts`.
12. **Availability is close to meaningless.**
    - The only events are klnk-agreed meetings, with no way to add busy blocks (`CalendarPanel.tsx`: only refresh, cancel and dismiss controls).
    - External calendars are excluded, even though a tested Google adapter exists (`integrations/google-calendar.ts`).
    - "Accept routine meetings" can therefore double-book real life.
13. **Connection dead-ends.**
    - Re-inviting after a decline returns the existing declined record forever (`coordination.ts:41`).
    - There is no unblock or remove action (`coordination.ts:11`).
    - **Mute denies all requests** (`policy.ts:20-21`), so it behaves like block. That contradicts the UI copy and the contract, where mute means fewer notifications (`01-product-contract.md:49`).
14. **Fragile authority.** Any policy save bumps the policy version. That invalidates every in-flight request, including pending approvals (`policy.ts:24`). Policies also auto-expire after 30 days by default (`policy.ts:15`), which silently stops all delegation, and nothing reminds the owner to renew.

## P2: UX and cleanup

15. The meeting form requires raw ISO instants, with offsets, for slots and expiry (`InboxPanel.tsx:58-59`). Proposals display raw ISO strings (`InboxPanel.tsx:65`), while Calendar formats them (`CalendarPanel.tsx:63`).
16. Policy topics are global, not per member (`policy.ts:25`). Free-text topic matching is case- and spelling-exact.
17. `invite()` decrypts every identity row on each invitation (`coordination.ts:36-37`). That is O(N) and would also make member-code lookups slow at scale.
18. Default "Call klnk" has no tools until the user finds the "three internal voice permissions" in Settings (`VoiceAccessPanel.tsx`, `app.ts:76-77`). Out of the box it is a tool-less chatbot, and the 5-minute cap applies (`LaunchScreen.tsx:33`).
19. Copy everywhere carries disclaimers ("does not grant approval", "not end-to-end encrypted") that crowd out the actual result (for example `InboxPanel.tsx:47-48,60`, `Workspace.tsx:30`).

## Features worth cutting or isolating

- **Cut** the legacy telephone/mission stack from the shipped app. Move it to a branch, or behind a build flag. That covers `engine.ts`, `voice.ts`, ElevenLabs/Twilio in `packages/providers`, the mission routes, `App.tsx:124-193`, and `mission-*`, `setup.tsx`, `settings.tsx`, `voice-conversation.tsx`, `features/missions|people|memory|settings/connections`, plus the voice-clone endpoints (`app.ts:276-281`) and `apps/voice-demo/`. It is the main source of confusion and of untested provider surface.
- **Keep, but repurpose:** the Google Calendar OAuth adapter, for read-only free/busy.

## Highest-value next builds

1. **Production-capable voice.** Authenticated, non-loopback Live sessions on the deployed server, plus a native iPhone transport. Until then, give native a working fallback inside the network workspace: typed `OwnerIntentPanel` or recorded turns.
2. **Real onboarding.**
   - Register, then a guided "connect your first person" step with a shareable invite link/QR (deep link), not an opaque code.
   - Sensible default policy: messages allowed from accepted connections, no topic gate for `inform`.
   - Password reset and email verification.
   - Account delete and export moved into the network Settings.
3. **Notifications.** Polling or SSE in the workspace, unread badges, notices that deep-link to their conversation, and local/APNs reminders.
4. **A real loop back to the human.** Let the recipient answer an `ask` and counter-propose a meeting time, so a request doesn't end `unresolved`.
5. **Availability.** Manual busy blocks, plus Google/EventKit free-busy, before enabling auto-accept.
6. **Connection management.** Unblock, remove and re-invite; make mute suppress notifications only.
7. **Doc consolidation.** One README story, with AGENTS.md, ARCHITECTURE.md and CAPABILITIES.md updated to the network product, and legacy docs moved under `docs/legacy/`.
