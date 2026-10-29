# klnk network architecture

The Expo/React Native client opens with one Call klnk action, followed by authenticated network screens. React Navigation owns five workspace destinations and deep links; active panels mount lazily. A session/origin-scoped data cache shares queries and drafts, invalidates after mutations, polls while active and refreshes on foreground. Server responses remain authoritative.

Fastify's shared composition root constructs account/mail, owner-intent/recorded-voice, network coordinator/internal calendar, Live broker and maintenance services for API and standalone workers. Shared Zod contracts live in `packages/domain`. PGlite is a single-process local PostgreSQL runtime; server PostgreSQL is required for multiple processes. The compiled artifact and tested process topology are described in [operations](OPERATIONS.md).

## State and authority

A connection requires explicit acceptance. Plain inform delivery needs an accepted, available connection and current delivery opt-ins, not a matching autonomy topic. Questions can fall back to an authenticated human answer. Meetings use canonical proposal versions/hashes, separate owner acceptances and one atomic internal event. Counterproposals invalidate old approvals. Operation-specific policy epochs keep unrelated settings from revoking an outstanding meeting. Manual busy blocks and maintained availability constrain automatic acceptance. Muting changes notices; blocking/removing revokes communication authority.

Transactions lock participating owners in stable order and recheck the bearer, owner, connection, current delegation and exact proposal before disclosure or commitment. Peer strings/model output are data, never authority. Worker poison failures back off and dead-letter without starving healthy tasks. Legacy jobs have database leases/fencing; the later shared network-task lease/index/AAD refactor remains open, so this is not complete cross-host production certification.

## Accounts and voice

Passwords use scrypt; opaque bearer digests have seven-day absolute and 30-minute idle expiry. Account proofs use one-use hashed challenges and encrypted, opt-in SMTP outbox delivery. Verification binds password/credential state; resets, email/password changes and sign-out-all revoke sessions. Export/delete reauthenticate under owner locks. Production requires verified email, PostgreSQL, protected key and HTTPS/trusted origins. Metadata-only logs omit content and credentials.

Browser Live uses the documented server-held GPT-Live broker with durable owner receipts, controller leases, recovery and budget/start/session caps. No unsupported ephemeral GPT-Live token endpoint is invented. Native foreground recorded turns upload bounded audio to real transcription, review owner-bound exact terms and use device speech. Native continuous Live remains gated. Tests use injected transports; no physical audio claim follows from them.

Encrypted payloads currently use AES-GCM without row-associated data or key-version rotation; some network paths still decrypt scans. These are explicit production scalability/at-rest hardening gaps. The [status board](review/2026-10-28/STATUS.md) records evidence and deferrals.

The retained telephone stack is separately flagged off. See [historical architecture](legacy/architecture-telephone.md) for its mission/provider model.
