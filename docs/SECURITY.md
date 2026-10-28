# Security implementation and open launch blockers

Local development status, updated **27 October 2026**. This is an implementation record, not a certification or a production security assessment. See [independent QA](production/reports/M4-qa.md) and [release review](production/reports/M6-release-review.md) for current gates.

## Implemented controls

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

Latest audit, **27 October 2026**: `npm audit --json` exits 1 with **three high** and zero critical findings, involving `expo`, `@expo/cli` and nested `zod`. A compatible `node-forge` 1.4.1 patch was applied; the initial four/five-finding outputs below are historical snapshots. This remains an open release gate. See [production evidence](production/05-evidence.md).

The earlier `npm audit --omit=dev` reported five high findings in the Expo build dependency chain. A nonzero audit is not a passing check. “omit dev” includes Expo's CLI because Expo is a mobile application dependency; it does not mean these findings originate in backend request code.

| Installed path | Finding | Current status |
| --- | --- | --- |
| Historical `expo@58.0.19 → @expo/cli@58.1.15 → node-forge@1.4.0` | RSA signature validation issue [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Compatible 1.4.1 patch now installed; no longer reported by the latest audit |
| `expo@58.0.19 → @expo/cli@58.1.15 → zod@3.25.76` | Validation resource-exhaustion issue [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | Fixed line begins at Zod 4.6.6; application/server use 4.6.7, while Expo CLI still requires a Zod 3 dependency |

Audit counts include the affected parents (`expo`, `@expo/cli`, `@expo/code-signing-certificates`) as well as `node-forge` and nested `zod`; they do not represent five distinct root advisories. Reproduce with:

```powershell
npm audit --omit=dev
npm ls expo @expo/cli @expo/code-signing-certificates node-forge zod --all
```

The suggested automated fix would downgrade Expo to SDK 54 and does not preserve this SDK 58 native dependency set. A global Zod 4 override would change a dependency’s major API without evidence of CLI compatibility. Neither workaround was applied. Before producing a release, update to an upstream compatible fixed Expo toolchain or explicitly review an independently tested mitigation. Keep the development server bound to local/trusted networks; no public Expo dev server was authorized.

## Production work still required

- Verified account recovery and identity/email verification; production-grade authentication abuse controls and operational monitoring.
- Separate production encryption-key management, rotation, backup encryption, restore exercises and database access controls. Encryption at rest here is not end-to-end encryption.
- TLS termination and secure infrastructure configuration; the local HTTP API is a development service.
- A provider-authorized commercial arrangement and owner verification before clone enrollment; consent alone cannot mark a voice verified.
- Recipient consent/opt-out and abuse-operation review for the launch market. The current conservative English/Spanish refusal detection is not a universally reliable language-understanding or legal compliance system.
- A validated policy channel or bounded voice flow before live consequential commitments; server-side action restrictions do not guarantee hosted model utterances.
- Local PostgreSQL concurrency and quarantine/application restore passed. Production failover, actual call termination/provider cleanup and independently operated monitoring/journals remain unverified.
- Real-account Calendar OAuth/refresh/revocation verification, public consent setup, privacy notices and archive-specific App Store data-handling declarations.

For concrete limits and source evidence see [CAPABILITIES.md](CAPABILITIES.md), [PROVIDERS.md](PROVIDERS.md) and [ACCEPTANCE.md](ACCEPTANCE.md). No public deployment or billable resource creation is part of this implementation.
