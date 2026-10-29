# Screen specifications

## S00 One-button live demo

This is the user's selected opening experience. Render the navy/lavender curved composition, original hero illustration, short invitation and exactly one visible button: **Call klnk**. The button requests capture and establishes an OpenAI session. It changes into an appropriate connecting/cancel or end-call state. Connected controls and captions appear only when relevant. Text delegation remains in the separate Expo workspace. Show genuine connection errors and setup needs. Never play fixture audio or synthesize a success state to hide a connection failure. See [the current brief](00-current-brief.md) and [live-demo guide](09-live-demo.md).

The default subsequent workspace is the internal member network described below. S01–S09 retain historical telephone-screen specifications for flagged compatibility code; they must not govern new network UI.

## Current network workspace

The five destinations are Inbox, Calendar, People, Memory and Settings, with React Navigation URLs/deep links and lazy active-panel mounting. A session-scoped cache/draft store preserves safe edits between destinations, clears them on account/origin change, refreshes on foreground and invalidates queries after mutations. Each list owns its scroll container; collection screens use virtualized FlatList rows. The one-button opening has no navigation bar.

Inbox contains the optional typed owner instruction, scoped request composer, linked notices and current conversation rows. Question detail offers an actual human answer; meeting detail supports a new time/counterproposal and current canonical approvals. Details use the shared modal with explicit Close, Escape dismissal on web and return to the originating row. Errors preserve drafts and ambiguous writes reconcile their original request identity.

Calendar displays internal agreements, own reminders and private manual busy blocks. It explains the maintained-availability horizon needed for automatic acceptance; absence of an external calendar is not described as free time. Meeting rows open their conversation. Date/time fields use platform pickers and a shared Intl formatter, with device timezone and searchable override; proposal hashes stay out of presentation.

People presents real member connections, share/deep links and explicit acceptance. Re-invite, remove, mute and block states remain distinct; received links never auto-accept. Memory preserves ownership, confirmation and disclosure fields. Settings contains scoped delegation, permission expiry/renewal, retention/notices, voice permissions and account proof/password/export/delete controls. Registration is generic, sign-in explicit and unavailable email delivery is stated honestly.

On native iPhone, Call klnk reaches the bounded recorded-turn flow in the network workspace while continuous native Live remains gated. The flow reads all proposed terms, binds owner confirmation to the current plan, stops capture on background and never substitutes simulated audio after failure. Browser Live retains its separate transport and safe inform/ask review gate. Device behavior remains unverified on this Windows host.

Loading, empty, error and populated states have rendered component coverage. Color token checks alone do not establish accessibility conformance. Large-text navigation and real browser focus must pass their retained journey assertions; physical VoiceOver, switch input, keyboard and audio testing remain release gaps.

Use the tokens and component contracts in [03](03-design-system.md). The reference renders representative states; this file defines the complete build. Every screen supports loading, empty, error, long content, both themes and large text. State text comes from actual data.

## S01 Welcome and access

Small wordmark → “A little less to take care of.” → one sentence explaining delegated conversations → current operating mode → demo entry → sign in/create account. In demo mode, label the primary entry “Try the simulation.” Keep existing server behavior and make clear the people are fictional. Do not imply demo login works without the server.

Account fields have visible labels, supported autofill, inline errors and a keyboard-visible submit action. Connection setup is a secondary path, with technical addresses inside a details area. Loading disables duplicate auth submissions. A failed login preserves safe input, explains the error and returns focus to the relevant field.

## S02 Home and owner conversation

At 390-wide/default type, the intended order is:

```text
safe area
klnk                                      Simulation

What can I
take care of?
Speak or type a request.

                  aperture
               Talk to klnk
                 Ready
             [ Talk | Type ]

Needs your decision                 only if applicable
request row

Recent requests
Jordan Lee            Message about meeting      status

Home       People       Memory       Settings
bottom safe area
```

The mode label explains simulation on activation; it does not toggle real calling. The aperture is the Talk action with a visible label. Type reveals a 3-line growing field and Send. “Speak or type a request” is instructional; neither path is described as second-class access.

After the first turn, shrink the introductory area, show role-labeled turns, keep the latest reply readable and leave older turns reachable. Separate user and agent by alignment plus labels, not color alone. Do not hide the entire conversation after the sixth turn; render an explicit “Earlier messages” disclosure or a bounded, accessible list.

Only `awaiting_owner` belongs under “Needs your decision.” Group `authorized`, `queued`, `calling` under “In progress.” Terminal requests appear in Recent. No tasks means “Your requests will appear here” with no invented production activity.

Listening shows Finish message and Discard recording. Speaking shows Stop playback. Preparation shows actual request activity with no guessed percentage. Permission denial presents Type immediately and instructions to change system permission; unavailable speech output leaves the textual reply intact. Replaying a reply never reopens the microphone.

When a return from another tab restores a conversation, restore text and session state but leave microphone off. On network error preserve the entered message, explain that execution may be uncertain, and fetch current state before a resend that might duplicate work.

## S03 Optional detailed request composer

Header “New request” → person → plain-language intention → approved statements → boundaries → optional settings → Review request. Retain all eight mission kinds through existing templates. Ask only for fields needed by the chosen kind; advanced sections retain existing values.

Visually separate what the agent may say from private context. Person selection shows verification, opt-out and number state. A changed phone number resets verification through existing logic. Empty contacts offers Add a person. Opt-out prevents calling with a clear reason.

Optional sections include languages/voice, timing, voicemail, retention and follow-ups. Use human labels for existing domain values. Preserve validation and limits from contracts; show errors beside fields and an error summary at the first invalid submission.

## S04 Review and authorize

Lead with recipient and intended action. Show exact approved statements, boundaries, timing/timezone, languages, voice, voicemail, disclosure, retention, and any follow-up authority. Private context is labeled and remains separate from permitted speech. Let the user edit the draft.

Use “Authorize simulation” for simulated execution and an accurate supported-live label only when gates permit it. Include the current mode close to the action. A disabled gate shows its reason and a relevant setup path; it never becomes a clickable promise to call.

On success navigate to the persisted request. On stale version, retain context, refresh and require another review of the current version. Do not authorize using a cached review version. Existing direct-message voice authorization remains intact; this screen is not forced into that path.

## S05 Active request

Status/mode → request title → recipient → current evidence-backed activity → required decision if present → approved brief disclosure → appropriate actions → transcript/evidence → attempt record.

“Your decision needed” surfaces the proposed alternative and existing boundaries. New commitments require ending and revising the request; a text guidance field does not expand authority. Show simulator guidance only when capabilities permit it and label its actual effect.

Keep End request available for active work. Explain that it revokes queued work and requests supported call termination. After cancellation, retain an “End requested” indication while attempt evidence is nonterminal. Closing the detail sheet is not cancellation. Connection loss leaves the last known state labeled and offers Reconnect.

Live-transcript absence is an empty state, not a fabricated conversation. Show “Transcript available after the call, when provided” only where adapter behavior supports it. Do not render pause, takeover, mute or transfer as enabled controls in the current live adapter.

## S06 Result and evidence

Lead with the outcome summary and operating mode. In simulation, place “No one was contacted” near the result, including after navigating away and back. For live provider analysis, keep “Unverified provider summary” visible; do not use a verified-success treatment.

Order: what happened → recipient agreements → agent commitments → unresolved items → follow-up actions → transcript and sources → attempts and approved brief. Omit empty sections without changing the meaning. Expanded evidence exposes original language, separately labeled translation, source references and timestamps.

If the conversation succeeded but a calendar update failed, show both. “Retry pending follow-up” invokes only action retry. If no result exists, say so and offer refresh where appropriate. “Call ended” alone is not proof of delivery. Deletion is secondary, explicit and explains that completed external actions and provider retention may remain.

## S07 People and person detail

Title and Add a person → optional local search when enough contacts justify it → alphabetical list with name, relationship and meaningful verification state. Initials are decorative. Keep real account emptiness separate from demo fixtures.

Person detail contains name, relationship, phone, verification and opt-out, then relevant context. Use persistent labels and readable international numbers. Do not label manual number verification as provider identity verification. Changes are saved explicitly; failed saves retain the edit. No native address-book import button until an adapter exists.

## S08 Memory and memory detail

Title and Add a memory → list grouped by person or type, with fact, preference, inference or permission-note distinction. Each item exposes source, verification and disclosure scope. Inferences say “Inferred”; they do not gain a verified badge from visual styling.

Memory detail allows supported edit/confirmation actions and shows provenance. Confirmation is explicit. Permission notes explain that a new request still needs proper authority. Avoid auto-generated “relationship intelligence” scores or source-free personality claims.

## S09 Settings

Group Profile, Voice, Calling and connection, Privacy and data. Avoid a long field wall by opening focused sections. Keep sign out and account deletion separate. Advanced diagnostics include server address and provider setup; Home shows only actionable readiness.

Production appearance follows the OS initially. Do not add theme switches that lack persistence or accessibility preference support; the reference theme switch is a design-inspection control. Voice uses available standard voices and actual preview audio. No enabled clone enrollment, EventKit sync, calendar OAuth or notification permission buttons for unavailable integrations.

Export and deletion preserve existing confirmation and retention explanations. Loading prevents duplicate destructive requests. A data export is not an invitation to log its contents. Connection changes preserve existing origin-bound session clearing.

## Shared recovery states

| State | Design response |
| --- | --- |
| Initial loading | Static structure plus labeled activity; no indefinite shimmering decor |
| Refresh failure | Keep useful last-known data, label it, offer retry |
| Empty account | Specific explanation and a relevant action; no fictional data |
| Expired session | Sign-in route; do not claim pending work was cancelled |
| Missing permission | Explain which action needs it; retain usable text routes |
| Unsupported capability | Short explanation and a supported alternative, where one exists |
| Unsaved form dismissed | Save/discard/stay choice when meaningful edits would be lost |
| Long text or large type | Grow and reflow; show full critical content; keep actions reachable |
| Unexpected state | Neutral label and refresh; never default to success |

## Content fixtures for review

Use only fictional people in previews: Jordan Lee, a friend meeting near the fountain; Maya Chen, a colleague with a preferred meeting time. Include an ambiguous Jordan, a long name, a missing number, an opted-out person, an inferred memory, a partial result, a failed follow-up and an unverified summary in development fixtures. Every synthetic execution fixture carries its simulation disclosure.
