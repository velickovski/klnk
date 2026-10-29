# Security implementation and open launch blockers

Local development status, updated **29 October 2026**. This is an implementation record, not a certification or a production security assessment. The [current review status](review/2026-10-28/STATUS.md), [independent account review](review/2026-10-28/qa-account-security.md) and [operations guide](OPERATIONS.md) supersede older release checkpoints.

## Implemented controls

- Production defaults fail closed without validated database/key/HTTPS configuration. Shared SQL limits apply after authentication and per email; trusted proxy ranges are explicit. Public health/readiness omit provider details. Metadata-only logging excludes bodies, credentials and transcripts.
- Generic registration, password-bound one-use email/reset challenges, session revocation and 30-minute idle/seven-day absolute expiry are implemented. Export/delete require recent bearer-bound reauthentication under owner locks. SMTP delivery is separately disabled by default; real mailbox proof remains unverified.
- Internal network transactions recheck owner, current bearer, connection and operation-specific policy/proposal authority. Counterproposals require fresh approvals. Plain message delivery does not imply meeting authority. Model and peer text never grant disclosure rights; browser Live inform/ask remains review-gated. Native recorded confirmation binds an exact owner plan.
- Native local reminders are explicit opt-in with generic OS content, scoped identifiers and serialized sign-out cleanup. Previously synchronized alerts may remain stale while closed; no APNs or remote cancellation is claimed. The following telephone controls describe retained flagged compatibility code where applicable.

- Bearer sessions use random tokens; only token hashes are stored server-side. Passwords use salted scrypt. Sessions expire and can be revoked. Native clients use platform secure storage; no provider key is distributed to the client.
- API resource queries bind authenticated owner, kind and identifier. Cross-owner contacts, relationship memory, missions, actions, voices and export access are tested in `tests/api.test.ts`.
- Application resource payloads and job payloads use AES-256-GCM at rest. Development automatically generates a local key; production requires a configured key and PostgreSQL. The local key must be protected with OS account/disk access controls; keeping key and database on one workstation is not independent key management. User email/session metadata and operational indexes are not all field-encrypted.
- Mission review versions prevent stale approval. Authorized brief snapshots freeze authority. A preference and owner-entered memory permission do not authorize a new commitment.
- Provider credentials remain server-side. Webhook authentication verifies raw bytes and timestamp before JSON parsing; persistent deduplication and terminal-state checks prevent repeated effects. Provider reads reconcile actual state instead of trusting speech or classifier text as action authorization.
- Call initiation intent is persisted before the request. A timeout does not cause blind redial. Cancellation suppresses future jobs and requests active provider termination through the actual supported API.
- Live calling is disabled by default, with an explicit recipient allowlist, duration/retry/daily limits and commitment restrictions. No real call is part of automated tests.
- Conversation content is not emitted through normal server logs. Export excludes provider credentials. Delete/revoke paths expose provider cleanup state rather than claiming immediate erasure of every provider backup.
- Account/session epochs, invalid-success payloads, SecureStore failures and same-origin owner switches have dedicated regressions. Owner-first database locks prevent delayed writes from resurrecting deleted accounts; deletion rechecks active work atomically.
- Local Live tools require an explicit per-owner grant and current account/session/controller checks for every invocation. Strict names/arguments, immutable server-bound authorization, durable effect receipts, bounded delegation queues and metadata-only activity are independently tested. External effects stay disabled. Provider text never supplies authority.
- Google OAuth uses state, PKCE, verified OIDC account binding, encrypted refresh/revoke and durable cleanup. Injected-provider tests pass; actual Google consent/token lifecycle/write/revoke remain unverified.

## Dependency findings that remain open

Latest audit, **29 October 2026**: `npm audit --audit-level=high` exits 0 with **zero high/critical and 15 low** findings. A scoped `@expo/cli` override selects Zod 4.6.7; Expo remains SDK58. CLI exports and browser checks passed with the override. Existing node-forge 1.4.1 is retained. Earlier three-high reports are historical and no longer describe this lockfile.

Low findings currently arise from deepmerge and its Expo/Jest dependency parents. They remain visible; a passing high-severity gate is not a zero-vulnerability claim. Do not apply a forced SDK downgrade to silence the report.

| Installed path | Finding | Current status |
| --- | --- | --- |
| Historical `expo@58.0.19 → @expo/cli@58.1.15 → node-forge@1.4.0` | RSA signature validation issue [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Compatible 1.4.1 patch now installed; no longer reported by the latest audit |
| Historical `expo@58.0.19 → @expo/cli@58.1.15 → zod@3.25.76` | Validation resource-exhaustion issue [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | Scoped CLI override now resolves 4.6.7; no longer reported by the latest audit |

Audit counts include affected dependency parents, not only distinct root advisories. Reproduce with:

```powershell
npm audit --audit-level=high
npm ls expo @expo/cli @expo/code-signing-certificates node-forge zod --all
```

Keep the development server bound to local/trusted networks; no public Expo dev server was authorized. Production dependency/image inventory and Linux execution still require verification.

## Production work still required

- Actual SMTP proof/reset delivery and operational abuse/identity monitoring. Account lifecycle and shared authentication limits now have local injected/HTTP regression evidence; that does not establish delivery or production operations.
- Separate production encryption-key management, rotation, backup encryption, restore exercises and database access controls. Encryption at rest here is not end-to-end encryption.
- TLS termination and secure infrastructure configuration; the local HTTP API is a development service.
- A provider-authorized commercial arrangement and owner verification before clone enrollment; consent alone cannot mark a voice verified.
- Recipient consent/opt-out and abuse-operation review for the launch market. The current conservative English/Spanish refusal detection is not a universally reliable language-understanding or legal compliance system.
- A validated policy channel or bounded voice flow before live consequential commitments; server-side action restrictions do not guarantee hosted model utterances.
- Local PostgreSQL concurrency and quarantine/application restore passed. Production failover, actual call termination/provider cleanup and independently operated monitoring/journals remain unverified.
- Real-account Calendar OAuth/refresh/revocation verification, public consent setup, privacy notices and archive-specific App Store data-handling declarations.

For concrete limits and source evidence see [CAPABILITIES.md](CAPABILITIES.md), [PROVIDERS.md](PROVIDERS.md) and [ACCEPTANCE.md](ACCEPTANCE.md). No public deployment or billable resource creation is part of this implementation.
