# API contract

Local base: `http://localhost:4000`. Authenticated endpoints require `Authorization: Bearer <opaque token>`. JSON requests are limited to 256 KiB. Errors have `{error,message,fields?}`; `401` invalid session, `403` denied scope, `404` absent or other-owner resource, `409` authority/state conflict, `429` limits, `503` unavailable provider. No provider credentials are returned.

| Method | Route | Request / result |
|---|---|---|
| GET | `/health` | Mode and database runtime; no secrets |
| GET | `/livez`, `/ready` | Liveness / database-backed readiness, redacted job/cleanup/uncertain-session counts; 503 when database unavailable |
| POST | `/auth/demo` | Development only; isolated fictional data, `{token,user}` |
| POST | `/auth/register` | `{email,password,name}`; 12+ character password |
| POST | `/auth/login` | `{email,password}` → `{token,user}` |
| POST | `/logout` | Request known Live cleanup, revoke current session; `{ok:true,voiceCleanup:{pending}}` does not assert terminal provider closure |
| GET | `/bootstrap` | Profile, contacts, memories, missions, templates, capabilities, mode, limits and integration availability |
| GET | `/setup/readiness` | Authenticated owner ID, missing/blocked setup checks and actual disclosure; never returns keys |
| POST | `/voice/turn` | `{requestId,sessionId?,text? OR audioBase64?,mimeType?,language?}` → transcript, spoken reply, session and optional mission ID. Request ID deduplicates the whole turn. |
| POST | `/voice/report` | `{requestId,missionId}` → spoken actual result; duplicate requests do not synthesize twice |
| DELETE | `/voice/sessions/:id` | Clear the owner chat and cached replies while preserving non-content request receipts against duplicate execution |
| GET / PUT | `/profile` | Shared `Profile` schema; owner ID server-assigned |
| GET / POST | `/contacts` | Contact list / new manually entered contact; E.164 number; owner verification checkbox |
| PATCH / DELETE | `/contacts/:id` | Owned contact only; opt-outs cannot be cleared through editing |
| GET / POST | `/memories` | Typed source-aware memory; owner-created source forced server-side |
| PATCH / DELETE | `/memories/:id` | Edits retain previous source reference and record owner provenance |
| GET / POST | `/missions` | List / `MissionInput` or `{templateId,...overrides,requestId?:UUID}` → draft. Stable requestId deduplicates creation; changed input conflicts, deleted draft cannot be recreated by replay. |
| GET | `/missions/requests/:requestId` | Owner-scoped original draft readback; 404 absent, 410 deleted. Client retains the nonce across an uncertain save. |
| GET | `/missions/:id` | Mission + attempts, latest transcript/outcome, actions, selected context, capabilities and demo flag |
| PATCH | `/missions/:id` | Draft only; increments review version |
| POST | `/missions/:id/authorize` | `{version,scenario?}`. Version must match review. Scenario is simulator-only. |
| POST | `/missions/:id/cancel` | Revoke queued work, request supported active termination |
| POST | `/missions/:id/intervene` | `{kind,text}`. Simulator clarification/proposal/tightening/end. New commitments require a revised authorized mission. |
| POST | `/missions/:id/actions/retry` | Retry pending/failed actions without another call |
| DELETE | `/missions/:id` | Cancel and delete conversation; queue provider deletion. Wait for live termination. |
| GET | `/calendar` | Demo existing calendar records |
| GET / PATCH | `/settings/voice` | Own voice assets/enrollment availability; `{voiceId,enabled}` |
| GET / POST | `/voices/:id/preview` | Authenticated audio/mpeg stream; provider credentials required |
| POST | `/voices/enroll` | Explicitly unavailable until verified customer onboarding is configured |
| DELETE | `/voices/:id` | Remove own clone and queue provider deletion; standard fallback is not a clone |
| GET | `/integrations` | Explicit sanitized Calendar status projection; no raw integration/OAuth-state records |
| GET / DELETE | `/integrations/google-calendar` | Actual account/capability status / block local use and revoke remotely; response may remain revoke_pending |
| POST / DELETE | `/integrations/google-calendar/connect` | Begin one-use state/PKCE/OIDC flow → fixed Google authorization URL/expiry; cancel pending app authorization |
| GET | `/integrations/google-calendar/callback` | Only this exact callback is public; state and still-valid initiating server session establish owner. One-use code/error, no credentials returned. |
| DELETE | `/integrations/:id` | Known Calendar connection uses actual disconnect; unverified legacy records cannot claim remote revocation |
| GET / PUT | `/tools/access` | Read explicit owner grant/runtime state; PUT strict `{enabled,tools}`. Key/configuration alone never enables it. External effects false. |
| GET | `/tools/traces` | Owner-only structural `{events}` without arguments, transcripts, tokens or raw provider bodies |
| POST | `/voice/live/session` | Authenticated local-only `{requestId:UUID,sdp,authorizedMissionId?:UUID}` → WebRTC answer. Optional binding must be an existing authorized owner request; only server-granted schemas exposed. |
| GET | `/voice/live/requests/:requestId`, `/voice/live/session/:id`, `/voice/live/recovery` | Same owner receipt/session or unresolved owner list; no SDP/audio/private tool content; unknown no-ID starts remain blocked |
| POST | `/voice/live/session/:id/close` | Close same provider session; closing/unconfirmed is not confirmed closed |
| GET | `/export` | JSON export of owned app data, excluding credentials and password/session digests |
| DELETE | `/account` | Revoke work, remove local resources, queue provider cleanup, invalidate sessions |
| POST | `/webhooks/elevenlabs` | Raw-body HMAC `elevenlabs-signature`, timestamp/replay checks; enqueues provider read |

Shared source of truth: `packages/domain/src/core.ts` Zod schemas. Mission review includes goal, approved talking points, recipient identity, separate languages, voice, limits, confidentiality, scheduling, fallback, voicemail, retention and permitted follow-ups. Relative appointment dates must become explicit ISO timestamps with offsets and an IANA timezone before authorization.

Contact/context mutations invalidate affected draft reviews under the same owner lock as authorization. Authorization deep-copies the permitted selected context. Later memory edits/deletion cannot inject new approved content. Outbound tools require an immutable server-bound authorization; request preparation alone creates a draft. See [gateway contract and evidence](production/04-services-and-tool-tracing.md).

Voice responses include `{sessionId,turnId,text,transcript,audioBase64?,audioMimeType?,missionId?,status,needsReply,mode,voiceMode}`. Voice status is `reply|needs_reply|queued|calling_disabled|completed|cancelled`; voice mode is `provider|device|unavailable`. A browser-supplied transcript is supported for its device speech service. Native input uploads a bounded recording; raw input audio is not stored on the backend, and the device deletes its temporary recording after processing. Owner session content and synthesized reply caches are encrypted and expire after 24 hours; non-content request receipts remain to prevent replay from creating a second call. They are separate resource kinds from voice assets, so a session cannot be selected as a clone. Say “clear this conversation” to erase the owner chat, or use the deletion endpoint. This does not erase delegated mission history or durable memories. Audio transfers have a separate 15 MiB request limit; ordinary JSON remains capped at 256 KiB.

Exact-message voice commands can authorize normal execution within the pilot boundaries. Uncertain model interpretations require a spoken readback and yes; a model cannot inject owner identity, phone numbers, standing permissions or external action authority. New numbers require spoken readback confirmation. A private pilot additionally requires the bound owner, signed public HTTPS callback, successful read-only provider inspection, allowlist, at most 180 seconds, zero redial retries, and the explicitly enabled calling switch.

Simulation scenarios: `normal`, `no_answer`, `busy`, `voicemail`, `wrong_person`, `refusal`, `dropped_uncertain`, `counteroffer`, `injection`, `calendar_failure`. These are developer-selected fixtures, never observed real-world outcomes. Phone disconnection does not stop backend execution; reconnect by fetching `/bootstrap` and the mission detail. There is no client-local authoritative call state.
# Internal network v1

The current product uses `/network/*` behind the same authenticated owner boundary. This namespace never routes to telephone, email, SMS or external-calendar adapters. Shared schemas are in `packages/domain/src/network.ts`; actor/account fields are server-derived and unexpected input fields are rejected.

| Route | Purpose |
| --- | --- |
| `GET /network/identity` | Own immutable member identity/code and processing/delivery boundary |
| `GET/POST /network/connections`, `PATCH /:id` | List/create internal invitations and revision-bound accept/decline/block/mute/inbound changes |
| `GET/PUT /network/policy` | Own explicit versioned background delegation; no peer policy endpoint |
| `GET/POST /network/memories`, `PATCH/DELETE /:id` | Private owner facts and explicit sharing/provenance/expiry |
| `GET/POST /network/conversations`, `GET /:id` | Actual participant-only request state, summaries and shared evidence |
| `GET /network/conversations/requests/:requestId` | Same-nonce request readback |
| `POST /network/conversations/:id/decision` | Own exact proposal hash/version approval or decline |
| `POST /network/conversations/:id/control`, `POST /:id/read` | Pause/resume/cancel or read receipt; reading never grants authority |
| `GET /network/calendar`, `POST /:id/cancel` | Shared internal events, own reminders, revision-checked cancellation |
| `POST /network/reminders/:id/dismiss` | Own in-app reminder dismissal |
| `GET/PUT /network/preferences` | Versioned shared retention and in-app notice preference |
| `GET /network/notifications`, `POST /:id/read` | Content-free own outbox projections and dismissal |
| `POST /network/owner-intents`, `GET /:commandId`, `POST /:commandId/confirm` | Bounded own natural-language plan, same-command recovery and exact draft confirmation |

Meetings require one to three explicit UTC/offset instants plus an IANA timezone. No response is consent. Conflicts/policy revisions reject stale actions; removed command/request identifiers return410 rather than recreation. Public payloads exclude peer private rules, raw model/HTTP diagnostics and credentials. Live internal tools require both a current explicit tool grant and current delegation; model arguments cannot choose either owner identity.

Earlier routes documented above are the preserved compatibility surface, not the new delivery mechanism. See [network walkthrough](agent-network/04-walkthrough.md) and [executed evidence](agent-network/reports/FINAL-HANDOFF.md).

