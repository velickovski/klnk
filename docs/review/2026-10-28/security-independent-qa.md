# Independent M1 security QA

Reviewer: `/root/quality`. This reviews the Security worker's OAuth/owner-intent/voice changes and root's profile, cookie, proxy and request-limit integration. It **does not certify this reviewer's M0 test-fixture implementation**.

## Findings and verification

| Boundary | Observed result |
| --- | --- |
| OAuth browser binding through the actual HTTP routes | New `tests/qa-oauth-boundary.test.ts` starts two owner flows. Missing, malformed, wrong-browser and duplicate binding cookies return `oauth_browser_mismatch`, make zero provider requests, preserve the initiating pending state and create no Calendar connection. |
| Valid OAuth callback and replay | The original browser completes one adapter exchange against an injected provider with a cryptographically signed fixture ID token. A replay is rejected without another provider request. The other owner remains disconnected. |
| Cookie and public response | Production cookie has HttpOnly, Secure, SameSite=Lax, a scoped path and ten-minute lifetime. Binding is absent from both JSON and the Google authorization URL. Credentialed CORS, callback cookie clearing and no-referrer are asserted. Mobile API fetch uses `credentials: 'include'`. |
| Profile input | Independent HTTP tests accept a normal Unicode name/phonetic spelling, reject oversized/control/bidi/markup input for name, tone and pronunciation, and verify rejected writes leave the saved profile unchanged. |
| Recipient and prompt boundaries | Inspected the immutable recipient checks, name-collision clarification, escaped peer-data delimiters and model-plan connection-ID equality. Existing Security-worker regressions rerun independently, including malicious legacy display names. Model outputs cannot select another connection. |
| Voice disclosure | Inform and ask requests fail closed with `review_required`; adding a model-supplied confirmation field fails strict argument validation. No request is delivered, and traces omit the proposed private message. Meeting submission retains current owner/connection/policy checks. |
| Proxy trust | New `tests/qa-request-limits.test.ts` proves a trusted loopback proxy can supply the forwarded address while an untrusted direct client cannot spoof its address through the same header. |
| Per-email throttle | Actual login requests from ten distinct IPs share the normalized email bucket; the next request is blocked. Persisted counter rows contain keyed hashes, not the email. |
| Unauthenticated request limit | QA found a regression: authorization rejected requests before the new rate-limit hook, so 101 anonymous protected requests all returned 401. Root added a pre-authentication bucket and an invalid-credential bucket. The new regression now receives 429 at the bound. |

Existing `tests/integration-routes.test.ts` was adapted to send the binding cookie from connect and explicitly opt into the legacy adapter fixture. Production legacy defaults were not weakened.

## Commands run

- `npx vitest run tests/qa-oauth-boundary.test.ts tests/google-oauth.test.ts tests/network-owner-intent.test.ts tests/network-voice-tools.test.ts tests/integration-routes.test.ts`: **62 passed / 5 files**, 13.20 seconds, before the additional independent profile case.
- `npx vitest run tests/qa-oauth-boundary.test.ts`: **4 passed**, 8.63 seconds, including the added profile case.
- Initial `npx vitest run tests/qa-request-limits.test.ts`: **2 passed / 1 failed**; reproduced the unauthenticated rate-limit bypass above.
- Final combined `npx vitest run tests/qa-oauth-boundary.test.ts tests/google-oauth.test.ts tests/network-owner-intent.test.ts tests/network-voice-tools.test.ts tests/integration-routes.test.ts tests/qa-request-limits.test.ts`: **66 passed / 6 files**, 18.95 seconds, after the root fix.
- `npx eslint tests/qa-oauth-boundary.test.ts tests/qa-request-limits.test.ts tests/integration-routes.test.ts`: passed.
- `npx prettier --check tests/qa-oauth-boundary.test.ts tests/qa-request-limits.test.ts tests/integration-routes.test.ts`: passed.

## Limits and open work

- OAuth calls were injected local provider fixtures. No Google account consent, token exchange with Google, real calendar write, OpenAI request, microphone capture or physical-iPhone test was performed.
- Blanket blocking voice inform/ask is a safe interim restriction. A working owner-authenticated exact-dictation/readback receipt is still required to fulfill the requested voice sending experience. A model-provided confirmation flag is not an acceptable substitute.
- Request counters currently have no automatic stale-row removal. Persisted keys are HMAC digests, but counter growth still needs bounded maintenance before production scale.
- Real PostgreSQL cross-process rate counters are being independently checked by the Security worker in a separate QA card. The HTTP checks here use actual application SQL against isolated PGlite; they do not establish multi-process row-lock evidence.
- These results concern the inspected M1 candidate. Later feature changes need the final integrated gates and independent review; they do not inherit a blanket security certification.
