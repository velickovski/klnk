# Experience and navigation

This file describes the existing mission workspace and its redesign. The separate live demo starts with one Call klnk button as defined in [00](00-current-brief.md). Its OpenAI owner conversation is a new transport; the existing foreground ElevenLabs turn limits below are not GPT-Live limits.

## Information architecture

Keep four bottom destinations: **Home**, **People**, **Memory**, **Settings**. Home contains the conversation with klnk and recent requests; request details open above it. People and Memory use list → detail/editor. Settings groups account, voice, connection, privacy and data controls.

Keep the existing modal routes for compose, review, request detail, person and memory. A new navigation dependency is unnecessary for the first pass. When navigating, preserve text drafts and owner conversation state in the authenticated app session. Stop and discard microphone capture on leaving the capture surface or backgrounding; preserve the submitted conversation state. Do not store raw audio or sensitive drafts on disk just to preserve navigation.

On iPhone, respect safe areas and use one primary scroll region. The keyboard lifts the composer and exposes its Send control. Expanded text can scroll the screen without hiding critical actions. On wide web previews, center a readable content column, with optional list/detail adaptation only after mobile behavior is complete.

## Core journeys

### First session

1. Show a concise explanation of bounded delegation and the current operating mode.
2. Keep the existing fictional-demo entry and account sign-in routes. Demo needs no microphone or registration form.
3. Ask for microphone permission only after Talk is activated. Offer Type in the same location before and after denial.
4. Show missing setup as an understandable status with a path to connection details. Never imply credentials alone enable calling.

### A direct message

The user says or types “Call Jordan Lee and tell him I am meeting him near the fountain in ten minutes.” The existing exact-message path may queue a request when the recipient and authority satisfy server checks. Do not insert a mandatory review form into every direct-message flow. Present the actual reply and a link to the persisted request. Keep the original time context in its record.

### Clarification and review

Ask one missing question at a time. Show candidate people with a distinguishing relationship and masked number when needed. A spoken number needs the existing readback/confirmation. A model-proposed brief uses the existing confirmation path. Optional detailed composition leads to a summary of recipient, statements, boundaries and other authorization fields before the authorize action.

### Execution and return

Show queued/calling/decision states from server data. Closing the app does not cancel execution. On resume, refresh bootstrap and the open request detail before asserting a state. Do not autoplay an old report after reconnect or steal focus on each poll. A user can open the current request and request a report again.

### Result and next step

Lead with what is known. Separate recipient agreements, agent commitments, unresolved questions and follow-up actions. A failed follow-up gets its own retry; retrying it never repeats the conversation. Memories retain their source and verification status. An inferred preference is not a verified fact, and a permission note is not authority.

## Three independent state layers

### Owner input presentation

These are derived UI states, not additions to the API enum. `needs_reply` is response metadata that can coexist with speaking/idle; it is not microphone permission.

| UI state | Source / trigger | Primary action and recovery |
| --- | --- | --- |
| Ready | No capture, playback or pending request | Talk; Type remains visible |
| Listening | `voice.listening` true | Finish message; separate Discard recording |
| Preparing | Submit request pending | Text status and activity indicator; prevent duplicate submission |
| Speaking | `voice.speaking` true | Stop playback; full reply remains readable |
| Clarification | Reply has `needsReply` | Speak or type a reply; preserve session ID |
| Unavailable/error | Permission, capture, network or speech failure | Type; retry only the failed operation with clear scope |

Precedence for presentation is error notice alongside current state, then listening, request pending, speaking, ready. Avoid a stale `busy` flag hiding Stop playback. Microphone actions operate only on microphone state; telephone cancellation is a separate request-detail action.

Current auto-listening after a clarification reply is part of the foreground conversation. Make this behavior understandable during an active voice session; Stop disables it. Never resume capture automatically after navigation, backgrounding, reconnect or merely playing a previous reply. Barge-in is not supported.

The recorder offers a pause mode with 2-second silence detection and 8-second initial silence, plus Manual send that disables both timers. At the 30-second capture cap it stops and holds the message for explicit Send or Discard. These are implementation facts, not a timing-accessibility certification; native and criterion-level evaluation remain in the validation plan.

### Persisted request state

| Domain state | User-facing label | Available path |
| --- | --- | --- |
| `draft` | Ready to review | Edit / review |
| `authorized` | Authorized | View approved brief / end request |
| `queued` | Waiting to start | View details / end request |
| `calling` | Conversation in progress | View actual state / request supported termination |
| `awaiting_owner` | Your decision needed | Inspect alternative; end and revise for new authority |
| `completed` | Conversation complete | Read outcome; do not infer agreement from this label |
| `partial` | Partly completed | Read what remains unresolved |
| `unresolved` | Not resolved | Inspect evidence and create a revised request if appropriate |
| `cancelled` | Request cancelled | Separately show whether call termination is confirmed |

### Attempt and follow-up state

Keep attempt evidence distinct from request cancellation. If a request is cancelled while the call attempt is nonterminal, show “End requested” or “Ending call…” until provider evidence confirms termination. Do not add a local countdown that asserts the call ended.

Follow-up states remain `proposed`, `pending`, `succeeded`, `failed`, `blocked`, `cancelled`. Show a confirmed conversation result and a failed calendar action together. Never let a generic green success component hide partial failure.

## Capability and failure behavior

- Prefer request-detail capabilities over bootstrap for actions on that request. Do not show live transcript, guidance, takeover, pause or transfer unless supported. In the current live adapter they are unavailable; show a concise explanation when relevant, not a wall of disabled controls.
- Simulator transcript/guidance is explicitly simulated. Provider summaries are unverified unless evidence establishes otherwise.
- After an ambiguous timeout, fetch existing state before suggesting a new submission. Keep request IDs stable when retry semantics support replay; never automatically reissue a potentially executed command with a new ID.
- For a stale review (409), refresh the brief, explain what changed, and require the current review version for authorization.
- Preserve typed text after failed sending. Clear it only after a confirmed successful response; avoid parallel sends.
- No offline queue exists. Offline UI retains an in-memory draft and says it has not been sent; do not promise automatic execution later.
- Deletion and revocation need distinct labels. Deleting a retained record does not undo completed actions or all provider retention.
