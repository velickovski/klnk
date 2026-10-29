# klnk network API

Local base: `http://localhost:4000`. Protected routes require an opaque bearer. Production requires HTTPS and verified email; browser Origin must match configured origins. Missing/idle-expired/revoked sessions fail closed. JSON contracts in `packages/domain` and route schemas govern payloads.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/health`, `/livez`, `/ready` | Minimal public status; detailed readiness requires separate operator bearer. |
| POST | `/auth/register` | `{email,password,name}` returns generic 202 for both new/existing email, no bearer. |
| POST | `/auth/login` | `{email,password}` returns token/user. Production requires email verification. |
| POST | `/auth/verify-email` | One-use `{token,password}` proof. |
| POST | `/auth/reset-request`, `/auth/reset` | Generic reset request, then `{token,newPassword}`. SMTP delivery is opt-in. |
| GET | `/account/status` | Email verification/delivery and recent reauthentication status. |
| POST | `/account/reauth` | `{password}` grants five-minute bearer-bound reauthentication. |
| POST | `/account/password`, `/account/email` | Current-password proof with new password/email; revokes sessions on committed change. |
| POST | `/account/resend-verification`, `/account/sign-out-all` | Explicit proof delivery request / reauthenticated revocation. |
| POST | `/logout` | Revokes current bearer; provider closure can remain pending. |
| GET / DELETE | `/export`, `/account` | Owner-locked recent reauthentication, scoped export/delete and cleanup safety. |
| GET | `/network/identity` | Owner member identity/share code. |
| GET / POST / PATCH | `/network/connections`, `/network/connections/:id` | List/invite; versioned accept/decline/block/unblock/remove/mute/inbound controls. |
| GET / PUT | `/network/policy` | Current scoped policy; save `{policy,expectedVersion}`. Derived authority epochs are server-owned. |
| GET / PUT | `/network/preferences` | Retention/notice preferences with expected version. |
| GET / POST | `/network/notifications`, `/network/notifications/:id/read` | Owner notices and read acknowledgement. |
| GET / POST / PATCH / DELETE | `/network/memories`, `/network/memories/:id` | Owned scoped memories with confirmation/provenance and revision checks. |
| GET / POST | `/network/conversations` | Inbox / strict idempotent request with stable request UUID. |
| GET | `/network/conversations/:id`, `/network/conversations/requests/:id` | Owner detail / original request receipt. |
| POST | `/network/conversations/:id/decision` | Current canonical meeting approval/decline. |
| POST | `/network/conversations/:id/answer` | Recipient `{version,answer}` for a pending question. |
| POST | `/network/conversations/:id/counterproposal` | Current proposal `{version,slot}`; fresh approvals required. |
| GET | `/network/calendar` | Internal events, own reminders/private busy blocks and maintained availability. |
| POST / DELETE | `/network/calendar/busy`, `/network/calendar/busy/:id` | Private manual busy blocks; delete requires current version. |
| PUT | `/network/calendar/availability` | Explicit maintained-availability horizon. |
| POST / GET | `/network/owner-intents`, `/network/owner-intents/:id` | Bounded owner instruction planning and uncertainty readback. |
| POST | `/network/owner-intents/:id/confirm` | Authenticated exact-plan hash confirmation. |
| POST / GET | `/network/voice/turn`, `/network/voice/turns/:turnId` | Native recorded audio turn / owner receipt reconciliation. See route source for caps and required strict input. |
| GET | `/voice/live/status`, `/voice/live/recovery` | Authenticated readiness/unresolved owner receipts, no paid start. |
| POST | `/voice/live/session`, `/voice/live/session/:id/close` | Brokered WebRTC start / close request; unknown closure never reports success. |
| GET | `/voice/live/requests/:requestId`, `/voice/live/session/:id` | Owner receipt/session readback. |
| GET / PUT | `/tools/access` | Explicit bounded owner grant; configuration alone grants no authority. |

Check `apps/server/src/network/routes.ts`, `recorded-voice-routes.ts` and `account/routes.ts` for exact schemas. Ordinary errors use `{error,message,fields?}`. Protected response content is not publicly cached; proofs/account routes use no-referrer. Raw audio is not stored by recorded-turn receipts. These receipts have a separate metadata TTL; this does not erase owner-intent text under its own lifecycle.

The default server disables legacy telephone/mission routes. [Historical telephone API](legacy/api-telephone.md) documents retained compatibility endpoints and provider integrations; their availability requires separate runtime gates and authority.
