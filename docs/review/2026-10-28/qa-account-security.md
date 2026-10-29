# Independent account security verification

Reviewer: `/root/security`. Reviewed the Platform worker's `account/service.ts`, `account/mail.ts`, account routes and migration 011, the root's HTTP/authentication composition, and the AccountPanel source. This review did not change their implementation. The reviewer's own voice/intent work is independently reviewed by the other workers.

## Regression evidence

Added `tests/qa-account-security.test.ts` with sixteen independent cases:

- Duplicate registration, including normalized email case, cannot overwrite the existing password or profile. Email-link proof cannot substitute an attacker-chosen password. Reset proof rotates the credential and invalidates previous sessions and sibling links.
- Known and unknown reset requests return identical public data and both call the real password-hashing function. This verifies equal expensive work, not constant wall-clock timing.
- Simultaneous reset redemption accepts one winner. Competing reset and email-change proofs share the current credential binding, so only one effect commits. Two owners cannot claim the same target email.
- Reauthentication applies to one exact bearer. An injected SQL boundary expires that bearer after the owner lock and the subsequent credential check rejects it.
- Disabled SMTP never initializes its transport. An expired in-flight mail lease becomes unknown, a late sender cannot restore acceptance, and neither worker automatically resends it.
- A claimed mail item is rechecked after a password change and never reaches SMTP. Late transport completions after password invalidation or account deletion cannot resurrect accepted state.
- Unknown SMTP outcomes clear outbound private content, do not retry automatically, and log fixed metadata without raw email, token, password or provider text.
- The session-revocation callback sees already-revoked credentials and can reacquire the released owner lock. An uncertain cleanup exception cannot undo revocation or leak its private body through logs.
- Actual production HTTP registration returns generic 202/pending data without a session, denies unverified login, disables demo registration, and gives identical incorrect-password responses for known and unknown accounts.
- Actual export/delete routes require current reauthentication for the exact bearer. Export is `no-store` and omits authentication-link/credential records. Idle credentials cannot delete the account.
- Separate export/delete adversaries revoke the bearer in a later HTTP pre-handler, after real authentication. Both handlers recheck authority, return denial, and expose no export or deletion effect. The tests assert the authenticated hook ran, preventing a TLS rejection from falsely satisfying the check.

All production HTTP fixtures use a loopback-trusted proxy with HTTPS forwarding. The first complete integration run passed 37/39; its two failures were fixtures still using HTTP after the new global TLS requirement. The post-auth cases were strengthened during that correction. The corrected independent suite passed **16/16**.

Final combined command: `npx vitest run tests/qa-account-security.test.ts tests/account-lifecycle.test.ts tests/account-mail.test.ts --reporter=json --outputFile=.data/qa-account-security-final.json` passed **39/39**: independent 16, account lifecycle 13 and mail worker 10. The JSON evidence is local and ignored. Root `npx tsc --noEmit --pretty false`, ESLint on the independent suite, and scoped Prettier checks also passed. The existing Fastify deprecation warning about `disableRequestLogging` remains; it was not a test failure.

## Source and interface observations

AccountPanel uses secure password fields with current/new-password AutoFill metadata and remounts its content by owner identity. Password entry remains component state and is cleared after successful account operations. It labels email delivery as disabled/configured and queued rather than claiming delivery or verification. Reauthentication status in the UI is presentation state; the server remains authoritative.

The production handoff's authentication/security skills informed the credential and diagnostic review. Native token storage uses the existing Expo SecureStore path; an explicit `keychainAccessible` policy was requested from the orchestrator as a separate hardening item. No actual Keychain, AutoFill, biometric, native share sheet or physical-device behavior was verified here. Native Apple-specific checklist items are outside these server tests.

## Boundaries

Tests use migrated PGlite fixtures, actual local persistence and real Fastify injection. SMTP and cleanup transports are injected. Concurrency tests demonstrate application serialization in this fixture; they do not establish real PostgreSQL lock scheduling. Mail already submitted to an external server cannot be unsent, and SMTP acceptance would not establish receipt or ownership proof. No actual email, provider request, deployment or preview-service restart occurred.

No new service/mail defect was found in the exercised cases. The final orchestrator must combine this evidence with its full regression run, account UI journeys, real SMTP setup and device validation before making broader release claims.

## Reference files

- `C:/Users/andre/.codex/skills/authentication/SKILL.md`: server authority and password AutoFill guidance, applied to equivalent supported Expo behavior.
- `C:/Users/andre/.codex/skills/swift-security/SKILL.md` and `references/common-anti-patterns.md`: secret storage and sanitized diagnostic review. Their Apple-specific APIs are not claimed as tested.
