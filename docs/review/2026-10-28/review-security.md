# klnk review: security, privacy, auth, infra and ops

Scope: apps/server (Fastify), the network module, integrations, CI and ops docs. Read-only review; no repo files were changed.

**Bottom line:** I found no cross-member IDOR. Every network and resource lookup binds the authenticated owner after fetching by id. That covers `store.ts:66/102`, `calendar.ts:123,150`, `preferences.ts:186`, `coordination.ts:77,79` and `db.ts` `Repository.get/put` (owner+kind+id, and upserts refuse a different owner or kind). The real risks are elsewhere:
- The Google OAuth callback is not tied to the browser that started it.
- The rate limiter is not actually per-member, and is unsafe behind a proxy.
- A peer-controlled profile name has no length limit and reaches the owner's model, which has tools.
- CI is red.
- There is no production deploy path.

## P0: blocks any non-local deployment

1. **The rate limiter never keys by member and breaks behind a proxy** (high confidence). `@fastify/rate-limit` runs on `onRequest` (`node_modules/@fastify/rate-limit/index.js:13`). `req.ownerId` is only set later, in `preHandler` (`app.ts:52-56`). So `keyGenerator: r.ownerId ?? r.ip` (`app.ts:44`) always uses the IP. Fastify is created without `trustProxy` (`app.ts:40`).
   - Behind any load balancer or TLS terminator, all users share one bucket. That means 100 requests/min in total, 10 logins/min (`app.ts:96`) and 5 registrations/min (`app.ts:91`) for the whole service. One client can lock everyone out.
   - Without a proxy, a distributed credential-stuffing attack is not limited per account. There is no lockout and no per-email throttle.
   - The store is in-memory, so limits multiply with each instance.
   - Fix: use `trustProxy`, a shared store (Redis), a `preHandler` hook or a token-hash key, and per-email login throttles.

2. **CI is failing by construction** (high). `.github/workflows/quality.yml` runs `npm audit --audit-level=high`. Today `npm audit --omit=dev` reports 8 findings (3 high, 5 low) in the expo → @expo/cli → zod@3.25.76 chain (GHSA-mrhx-c7xc-m3w5), which `docs/SECURITY.md` already acknowledges. Every push is red, so the gate gives no signal. Either pin the Expo fix or add an explicit, reviewed audit allowlist.

3. **There is no deployable artifact** (high). There is no Dockerfile or other deploy manifest. Production would run `tsx` from source (`package.json` `dev`/`worker`), the server speaks plain HTTP (`main.ts:3`), and there is no build/`dist` step. The production-only checks are DATABASE_URL and the key (`db.ts:29`). That is fine for local work, but any deployment needs a real build, TLS and secret injection first.

## P1

4. **The Google Calendar OAuth callback is not tied to the browser that started the flow** (high confidence it happens; exploiting it needs phishing).
   - `GET /integrations/google-calendar/callback` is unauthenticated (`app.ts:53,284`). It looks up the state row for any owner (`google-calendar.ts:109`) and checks the *initiator's* session hash (`:115`). Nothing ties the browser that completes the flow to the one that started it.
   - Exploit: attacker A calls `POST /integrations/google-calendar/connect` (`app.ts:282`), gets a real `accounts.google.com` URL (valid for 10 minutes, `:56`) and sends it to victim V. V consents on Google's genuine klnk consent screen. V's refresh token is then stored under A's account (`:134`), and A's klnk can read and write V's calendar.
   - PKCE and the nonce do not help, because A generated both. Fix: set an HttpOnly, SameSite cookie at begin and require it at the callback, or finish through an authenticated app deep link.

5. **A peer-controlled, unlimited-length name reaches the owner's model, which has tools** (medium confidence; the tool runtime is currently dev-only).
   - `ProfileSchema.name` is `z.string().min(1)` with no max (`packages/domain/src/core.ts:12`). Only the 256 KB body limit applies, and `tone`/`pronunciation` are also unbounded.
   - That name becomes the peer's network identity (`coordination.ts:30-32`). From there it flows into the owner's live voice model through `network_connections_lookup` (`voice-tools.ts:91`) and into the owner-intent LLM prompt (`owner-intent.ts` L57, `acceptedConnections`).
   - Exploit path: in the voice session the model can call `network_request_submit` with `kind: 'inform'` and arbitrary `message` text. The guard only adds checks for meetings (`voice-tools.ts:77-85`). An attacker who is trusted by policy can name themselves "Bob <injected instructions>". When the owner asks to message "Bob", the lookup returns the injected text and the model can be induced to send what the owner said in the conversation to the attacker.
   - Current mitigations: the results are tagged `untrusted:true`, the instructions warn about untrusted text (`openai-live.ts:21`), tool access is opt-in, and `toolRuntimeAvailable()` is false in production (`app.ts:75`).
   - Fix before enabling in production: cap name/tone/pronunciation lengths, require owner confirmation for voice `inform`/`ask` (as the typed owner-intent path already does through a draft), and strip names down to a safe character set.

6. **Name collisions can hijack or block owner-intent recipient matching** (medium). `mentionedConnections` matches peer names by substring with word boundaries (`owner-intent.ts` L77), and names are not unique.
   - A trusted peer can rename itself to a common token (for example "a") to force endless "clarification" responses.
   - A peer can also copy another contact's short name, for example "Bob" while the real contact is "Bob Smith". Then "tell Bob that …" resolves only to the attacker and is auto-submitted as `explicit` information (`exactInformation`, L89-92; `apply`, L111). This only works with a peer the owner has already marked trusted, which limits the impact.

7. **Account security basics are missing** (high confidence they are absent).
   - There is no password-change, reset or "sign out all sessions" endpoint (the only routes are `app.ts:91-115`). A leaked password cannot be rotated.
   - Sessions last 7 days with no idle timeout or rotation (`auth.ts:20`).
   - `DELETE /account` (`app.ts:302`), `GET /export` and the OAuth connect flow need only the bearer token, with no re-authentication.
   - There is no email verification, and registration reveals whether an email exists: a duplicate email returns 409 "That record already exists." (`app.ts:61,93`).

8. **Production safety depends on NODE_ENV being set** (medium). `production` is true only when `NODE_ENV==='production'` (`config.ts:4`). If an operator forgets it:
   - `/auth/demo` mints accounts without credentials (`app.ts:103`, 8/min).
   - An encryption key is silently generated next to the data in `.data/local-encryption-key` (`db.ts:36-38`).
   - PGlite is used instead of Postgres.
   - Fix: when `HOST` is not loopback or `DATABASE_URL` is set, require an explicit key and disable demo mode.

## P2

9. **Unauthenticated information disclosure.** `/health` returns provider mode, storage type, the live-calls flag and full credential-presence readiness checks (`app.ts:65`, `readiness.ts:9-22`). `/ready` returns job, lease and network-task counts and migration names (`readiness.ts:29-38`). Restrict these, or return only a status.

10. **Endpoints that scan and decrypt the whole table (DoS / scalability):**
    - `POST /network/connections` decrypts every identity record on each call, with no lock and no route limit (`coordination.ts:36-37`).
    - The webhook decrypts every `attempt` row for every owner (`app.ts:337-338`).
    - Account deletion decrypts every reminder and outbox row (`data-lifecycle.ts:236-237`).
    - The retention sweep scans every conversation (`preferences.ts:197`).

    These need indexed lookup columns, such as a keyed digest of the member code or the conversation id.

11. **Encryption at rest has gaps.** AES-GCM is used without associated data (`db.ts:108-120`), so ciphertexts are not bound to row id, owner or kind; anyone who can write to the DB can swap payloads between rows. There is a single key with no key id or rotation path. Email, session metadata and network `owner_a/owner_b` are stored in plaintext; `SECURITY.md` acknowledges this.

12. **PII retention.** `voice_turn` stores full responses, including synthesized `audioBase64` (`voice.ts:133,297`), with no TTL. Network content has a 30-day retention (`preferences.ts:171`), but nothing equivalent covers voice turns, missions or attempts. `/voice/turn` accepts 15 MB bodies at 20/min per IP (`app.ts:129`), which adds memory pressure.

13. **Leaks within the network.** `connections()` returns the peer's full identity, including `memberCode`, even for pending, declined or blocked connections (`coordination.ts:46`). A blocked party keeps the blocker's code and can see that it was blocked. There is no unblock action (`coordination.ts:52`).

14. **Contacts allow self-asserted `verified` and API hardening is thin.** `PATCH /contacts/:id` lets the client set `verified:true` through the body spread or on a phone change (`app.ts:156-157`). The live gates are allowlist-bound, so the impact is low. There are also no security headers on API responses, and no CodeQL, secret scanning or Dependabot in CI.

15. **Webhook replay window is 30 minutes** (`packages/providers/src/index.ts:292`). Persistent dedup (`app.ts:335`) mitigates this, and the signature check (HMAC over raw bytes, constant-time compare) is correct. The `preHandler` auth exemption for the webhook compares the raw URL, while the body parser compares the path without its query string (`app.ts:49,53`). A query string therefore causes a 401, not a bypass.

16. **Ops doc inconsistency.** `operations.md` cites `.data/production-audit/platform-runtime.json`, but `.data/` is gitignored, so that evidence is not in the repo.

## Verified OK

- Tokens are 32 random bytes, stored as SHA-256 hashes, and expiry is checked (`auth.ts`).
- Passwords use scrypt with a constant-time compare and a dummy hash on unknown users (`app.ts:99`).
- CORS uses an allowlist (`app.ts:43`).
- Network routes re-validate the session inside each transaction (`store.ts:64-70`), and IDs are parsed as UUIDs with Zod (`routes.ts:16`).
- OAuth uses state, PKCE S256 and a nonce, with ID-token iss/aud checks (`google-identity.ts:8`).
- Live demo routes are restricted to loopback with origin checks (`openai-live.ts:36-52`).
- Logging is off (`logger:false`) and errors are sanitized (`app.ts:57-63`).
- Workflow actions are pinned by SHA with `persist-credentials:false`.
- No secrets are tracked in git.
