# M1 Security worker report

Owner: `/root/security`. Implementation follows the formatting-only commit `dd9e4a7`. This is an implementation report, not independent milestone approval.

## Changed files

- `apps/server/src/integrations/google-calendar.ts`: each OAuth start now creates a separate random browser nonce, stores its SHA-256 hash in the encrypted pending state, and checks the initiating browser binding inside the state-claim transaction. A missing, wrong, malformed or old unbound cookie fails before token exchange and does not consume the legitimate flow. The nonce is absent from the Google consent URL. The trusted HTTP route must set it as an HttpOnly cookie and remove it from the JSON response.
- `apps/server/src/network/owner-intent.ts`: peer context is explicitly delimited, JSON-escaped untrusted user-message data. The planner receives only the deterministically selected peer and must return that exact connection ID. Immutable member/connection IDs and member codes can resolve recipients; colliding display names, including short-name shadows, require clarification before any paid model call. Exact dictated-message recipient parsing stops before the message body.
- `apps/server/src/network/voice-tools.ts`: member lookups require an exact full name or immutable ID and return an explicit clarification indicator. Model-produced `inform` and `ask` text cannot create a request without an independent owner-confirmation path. They return `blocked / review_required`, the proposed recipient/message for review, and an explicit no-send next action. Blocked results produce blocked traces; raw message content is not retained in trace/receipt resources. Existing bounded meeting delegation remains available.
- `tests/google-oauth.test.ts`, `tests/network-owner-intent.test.ts`, `tests/network-voice-tools.test.ts`: regressions and the shared isolated migrated-database helper.

## Shared changes requested from the orchestrator

- OAuth HTTP routes: strip `browserBinding` from public JSON, set an HttpOnly `SameSite=Lax` cookie limited to the integration path (Secure in production), require and clear it on the callback. Allow credentialed CORS only for configured origins and use credentialed fetch on the browser start request. Native authorization still needs a documented same-browser/deep-link flow.
- Shared profile schemas: maximum lengths and character constraints for name, tone and pronunciation, including control/invisible/bidi characters. Existing malicious legacy profile data remains untrusted even if it bypasses the new input schema.
- Live instructions: explain exact recipient lookup and that information/question sends need owner review; never claim blocked text was sent. No model-provided `confirmed` boolean is accepted as authority.

## Checks actually run

- `npx vitest run tests/google-oauth.test.ts tests/network-owner-intent.test.ts tests/network-voice-tools.test.ts --reporter=json --outputFile=.data/security-worker-tests.json`: **PASS, 56 tests** (OAuth 21, owner-intent 18, voice tools 17). All provider responses are injected fictional fixtures; no billable or third-party request was made.
- `npx eslint apps/server/src/integrations/google-calendar.ts apps/server/src/network/owner-intent.ts apps/server/src/network/voice-tools.ts tests/google-oauth.test.ts tests/network-owner-intent.test.ts tests/network-voice-tools.test.ts`: **PASS, 0 errors, 13 existing explicit-any warnings**. An earlier attempt ran before the shared ESLint configuration existed and failed; the result above is the subsequent configured run.
- `npx prettier --check` for those six files: **PASS**.
- `npx tsc --noEmit --pretty false`: **not passing at worker handoff** because concurrent shared logging integration produced Fastify logger-generic errors in `app.ts:216,295`. No diagnostics referenced worker-owned files. The orchestrator must rerun after shared integration.

The first targeted test run exposed a test-fixture identity that had not been refreshed after a deliberately unsafe legacy profile write. Updating the fixture through `coordinator.identity(peer)` exercises the actual stored malicious name. The corrected fixture and all 56 tests pass.

## Regression coverage

- Forwarded consent URL with no initiating cookie, a different cookie, an empty cookie or cookie-header injection cannot exchange a Google token or consume the original pending state; the legitimate binding can subsequently finish.
- A short-name impersonator cannot receive an exact-text instruction intended for a colliding longer name; immutable member ID disambiguation works without model recipient selection.
- Legacy display text containing a closing untrusted-data marker and injected instructions stays escaped data in the lower-priority model message; it cannot change the selected connection.
- Voice `inform` and `ask` cannot send model-added material or accept a fabricated owner-confirmation argument. Traces show blocked rather than successful execution and contain no proposed private message.
- Partial-name voice lookup asks for clarification; exact immutable member lookup succeeds.

## Remaining limitations

The voice restriction is a deliberate **interim capability gate**: there is not yet an authenticated exact-message readback/confirmation UI or independent owner-dictation receipt in Live. Information and questions can still be sent through the existing owner-confirmed typed Inbox/owner-intent path. A model-generated message cannot stand in for trusted dictation. Do not mark that M2 voice usability work complete on this evidence.

The OAuth regression is service-level with injected provider responses; it does not establish real Google consent, browser-cookie acceptance, native browser handoff or physical-iPhone behavior. The integration route/cookie must be independently tested after orchestration. Existing pending OAuth states without a binding intentionally require a fresh start.

Prompt delimiting reduces ambiguity; it is not a model security proof. Deterministic recipient selection, strict output schemas and commit-time authority checks remain the effect boundary. Current official [OpenAI agent safety guidance](https://developers.openai.com/api/docs/guides/agent-builder-safety) was opened before these changes; the API transport and chosen model were not changed or paid-tested.
