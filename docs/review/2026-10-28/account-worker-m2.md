# M2 Account lifecycle implementation report

Owner: `/root/platform`. Implementation is frozen for independent Security QA. This worker does not certify its own changes.

## Changed files

- `apps/server/src/account/service.ts`: account lifecycle, one-use proof links, current-session reauthentication and retention.
- `apps/server/src/account/routes.ts`: strict authenticated account routes and public proof/reset endpoints.
- `apps/server/src/account/mail.ts`: disabled-by-default SMTP adapter and durable fenced outbox worker.
- `apps/mobile/src/features/network/AccountPanel.tsx`: account status, email/password management, all-session sign-out, export and explicit deletion review in subsequent Settings.
- `tests/account-lifecycle.test.ts`, `tests/account-mail.test.ts`: 23 regressions.

## Behavior

Registration always returns the same generic pending response for new, duplicate and already verified accounts. It does not issue an authentication session or replace another registration's password/name. Password-reset requests use the same response for known and unknown addresses.

Verification links expire after 15 minutes, contain 32 random bytes, and are stored as hashes. Outbound email content is encrypted. Links are placed in URL fragments rather than HTTP query strings. Email verification also requires the chosen current password, preventing an unsolicited attacker-created registration from being verified using only a victim's link. Password reset proves mailbox access, chooses a fresh password and may verify that email through the same proof.

Password changes require the current password. Email changes remain pending until the new address and current password are proved. Successful password reset/change and email-change completion revoke every session and invalidate stale challenges. All-session sign-out checks the exact active bearer. Proof redemption rechecks active account, current credential binding, expiry and consumption inside owner/challenge locks.

An optional trusted `onSessionsRevoked(owner)` callback runs after the database transaction commits for verification, reset, password change and all-session sign-out. It can request closure of existing Live audio without holding SQL locks. Callback failure produces only a fixed operational log and does not undo credential revocation. The integration must retain unresolved closure evidence rather than claiming that deleting sessions ended provider audio.

Reauthentication belongs to the current **session hash**, never a global account flag. Its five-minute bound, seven-day absolute session bound and 30-minute idle bound are evaluated using the database clock. Root supplied session columns and authentication updates and integrated the helper into export/delete routes; independent Security QA owns integrated authorization verification.

SMTP is off by default. Constructing a disabled adapter creates no transport or socket. Approved configuration uses TLS/STARTTLS, certificate checking, bounded connection timeouts, one recipient, no file/URL content fetching, and no SMTP protocol logging. The worker claims with `FOR UPDATE SKIP LOCKED`, a 30-second fenced lease and a maximum of five known-safe connection retries. Uncertain SMTP outcomes or expired leases become `unknown` and are never automatically resent. `accepted` means SMTP submission acceptance, not recipient delivery or verified mailbox ownership. Active sends drain on shutdown.

The worker checks current owner/challenge/lease before submission. Consumed/expired/deleted accounts cannot submit queued proof emails. Outbound token content is removed after acceptance/failure/uncertainty. Retention erases expired challenge content and removes its metadata/outbox after a further day. Owner-first retention locking matches issuance/change/deletion ordering. These ephemeral authentication tables are excluded from backups and removed on account deletion by root's integration.

The account panel clears password drafts after successful operations and remounts for owner changes. Export is an explicit browser download offer or native system share sheet; it does not claim delivery to another application. Deletion has a concrete review action and server-enforced recent reauthentication.

## Shared integration and interfaces

Root owns migration 011, config validation, shared account schemas, normal registration/login changes, authenticated route composition, private export/delete, global idle fences, AuthUI proof-link handling, Settings navigation and whole-app validation.

- `new AccountService(db, { production?, publicAppUrl?, mailEnabled?, onSessionsRevoked? })`
- `registerAccountRoutes(app, accounts)` mounts `/auth/verify-email`, `/auth/reset-request`, `/auth/reset`, `/account/status`, `/account/reauth`, `/account/password`, `/account/email`, `/account/resend-verification`, `/account/sign-out-all`.
- `accounts.requireReauthentication(owner, currentSessionHash, sql?)` and exported `requireRecentReauthentication(db, owner, currentSessionHash, sql?)`.
- `accounts.sweep(now: Date = new Date()): Promise<void>`; run hourly even while SMTP is disabled.
- `createSmtpMailer({ enabled, host?, port?, secure?, user?, password?, from? })`; returns `undefined` if disabled.
- `new AccountMailWorker(db, { enabled, transport?, logger? })`: `start(): void`, `tick(): Promise<boolean>`, `stop(): Promise<void>`.
- `AccountPanel` props: `{ ownerId, onSignOut, onDeleted }`; callbacks clear local authentication after server revocation/deletion.

No production mailbox-preview endpoint or hidden autoverification was added. Tests inspect their own injected/disposable database fixtures only.

## Verification

| Command | Observed result |
| --- | --- |
| `npx vitest run tests/account-lifecycle.test.ts tests/account-mail.test.ts --reporter=json --outputFile=.data/m2-account-tests-final.json` | **23 passed / 2 files**, 0 failed, **12.079 seconds**. |
| Root `npx tsc --noEmit --pretty false` | Passed, including the latest account integration. |
| `npm run typecheck --workspace @personal-agent/mobile` | Passed after root corrected the in-progress App import path. |
| Scoped ESLint for account modules, panel and tests | Passed. |
| Scoped Prettier check | Passed. |

Regressions cover generic registration/recovery responses, encrypted/hashed proof material, password-bound one-use verification, reset and email-change authority, expiry/deletion, per-session reauthentication, idle/absolute expiry, password changes/all-session revocation, a post-commit closure callback that sees deleted sessions and can reacquire the owner lock, backup exclusion/retention, disabled transport initialization, TLS factory settings, five-retry bounds, uncertain-no-resend, owner/challenge checks, one claim across two workers, lease fencing and graceful drain.

Only injected mail transports and factory mocks were used. **No email, SMTP connection, real provider call, deployment, signing, native share/device interaction or physical-iPhone test was performed.**

SMTP options were verified against the current official [SMTP transport](https://nodemailer.com/smtp) and [message configuration](https://nodemailer.com/message) documentation. Nodemailer 10.2.1 and its built-in types were installed/verified by root; no additional runtime was installed by this worker.

## Remaining checks and limits

- Independent Security QA, actual integrated HTTP/AuthUI/Settings journeys and final exports are still required.
- Root wires the post-commit hook to request closure of existing Live sessions. Deleting authentication sessions immediately denies further guarded tool use but alone cannot prove that a provider audio session ended; unresolved closure remains a barrier. Independent QA of this integration is separate from this implementation report.
- A provider operation already in flight cannot be unsent. A cancelled/uncertain email record is not evidence that no email reached SMTP. Proof tokens become unusable after account deletion or challenge invalidation.
- SMTP delivery, domain sender verification, real mailbox receipt and physical-iPhone deep-link behavior remain unverified and gated on approved setup.
- This account card does not claim native accessibility certification or deploy readiness.
