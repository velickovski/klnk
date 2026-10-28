# Settings connections worker — M4

Agent / milestone / status: Settings connections worker / M4 / local implementation, deterministic lifecycle checks and missing-configuration browser walkthrough passed; real Google and native acceptance blocked.

Task and owned files:

- [Settings UI](../../../apps/mobile/src/settings.tsx).
- [Connection state presentation and controller](../../../apps/mobile/src/features/settings/connections.ts).
- [New connection regressions](../../../apps/mobile/test/settings-connections.test.ts).
- This report. Parent retains App/API validators; Integrations owns Google OAuth/server routes. No provider configuration, credentials, scopes, external account or resource was changed.

Implemented behavior:

- Consumes the actual sanitized `GET /integrations` Google Calendar status. The old bootstrap Calendar stub is omitted from this UI to avoid presenting obsolete OAuth-unavailable prose beside authoritative state. Contacts/device/microphone notices remain scoped as before.
- Connect is available for explicitly configured disconnected/reconnect states, and hidden for unavailable, connecting, connected or revocation-pending states. `available:false` is correctly treated as unusable access, not missing OAuth configuration: configured disconnected accounts still offer Connect.
- Starts the fixed server authorization route, validates the returned Google HTTPS origin/path and unexpired receipt, and requests the system browser using installed React Native `Linking`. Successful browser launch never marks Calendar connected. The UI asks the user to finish consent, return and explicitly refresh the service status.
- Retains the pending authorization link only in this panel's memory for Retry/Continue; does not log it, persist it, render its OAuth state or handle provider credentials. If Settings remounts while server authorization is pending, the user can cancel and restart when the browser did not open. Pending OAuth consent is distinct from backend token refresh.
- Cancel uses the pending-state cancellation route and explains that cancelling consent is not remote disconnection of an existing account.
- Disconnect uses the actual remote-revocation route with Confirm/Keep. It retains the returned service row, including `revoke_pending`; it does not filter the row away or claim success from local removal. Only server `revoked` plus `provider_revoked` produces explicit Google-confirmed revocation wording. Unknown/failed responses retain the last row with Status needs verification and manual refresh recovery.
- Duplicate operations are blocked. An uncertain authorization start requires a status refresh before a new start. Late results after owner/backend changes or panel disposal are ignored, and cannot open another account's browser flow. Informational connection changes receive web status semantics and native accessibility announcements.
- Connected capabilities and verification/expiry timestamps come from the server. Existing profile drafts, voice, export, account-deletion and sign-out flows remain intact. No tool gateway or execution grant UI was added.

Shared contracts changed or requested:

- No shared contract mutation required. Existing runtime validators already cover sanitized status, authorization receipts, cancellation and disconnection responses.
- New UI/controller uses `GET /integrations`, `POST /integrations/google-calendar/connect`, `GET /integrations/google-calendar`, `DELETE /integrations/google-calendar/connect` and `DELETE /integrations/google-calendar`.
- Server status currently uses `available` for usable access; action eligibility therefore follows explicit status/reasonCode rather than interpreting this flag as a configuration boolean.
- Native flow deliberately uses the parent-requested existing `Linking` browser integration; a native AuthenticationServices/ASWebAuthenticationSession wrapper or app deep-link callback was not introduced.

Scenario IDs and outcomes:

| Scenario | Result and scope |
| --- | --- |
| SETTINGS-03 | Passed 23 new deterministic cases: missing/configured disconnected states, reconnect eligibility, backend-refresh versus browser-consent pending state, fixed/expired/malicious URL rejection, explicit status refresh, duplicate blocking, uncertain starts, browser failure, cancellation, pending/confirmed revocation, failed disconnect, account change and disposal. |
| CAL-01 / TOOL-04 presentation | Consumes Integrations' existing lifecycle contract; no Google consent/token/revocation traffic was performed by this worker. Actual provider state/PKCE/token verification remains Integrations-owned. |
| SETTINGS-01 | Existing 25 Settings draft/state regressions still passed together with the new suite. |
| NET-01/02 | Failed status refresh keeps the row and marks it unverified; retry recovers. Controller tests discard late account/disposal results and require validated authorization URLs. Shared API validation remains parent-owned. |
| A11Y-01/02 | Labeled shared controls, busy state and status/error semantics reused. Actual expanded connections at 320px with 200% rendered text plus combined spacing had document width 320px. No full conformance claim. |
| A11Y-03 / real CAL-01 | Blocked: no Google sandbox consent/account was exercised, and no signed native iPhone/device was available. |

Exact commands / environment / artifact identity:

- Windows; installed Node, Expo 58 / RN 0.88 and Chrome. All accounts/data fictional and disposable.
- `npx vitest run apps/mobile/test/settings-connections.test.ts apps/mobile/test/settings-draft.test.ts` — **48 passed** (23 new connection cases plus 25 existing Settings cases), tool timestamp 15:53:15 on 27 October 2026.
- `npm run typecheck` — **root and mobile passed** after final UI implementation.
- `npm run e2e:build` — passed. The actually loaded exploratory entry was **`/_expo/static/js/web/index-00784d3628e4c439b9b828f1ce96d6dc.js`**.
- `npx tsx scripts/e2e-server.ts`, then a PowerShell here-string piped to `node --input-type=module` using installed `@playwright/test` — **five actual browser checks passed** on the isolated API's missing-Google-configuration path. All external host requests were explicitly blocked. Server was stopped and ports 4102/8083 verified free afterward; build/port lease returned to parent.

Actual browser checks:

1. Google Calendar reports not configured/no account connected. No Connect or Disconnect action is offered.
2. Explicit Refresh retains the actual authoritative unavailable result.
3. A fictional 503 status boundary leaves the service row visible, marks it Status needs verification and displays the error.
4. Removing that injected failure and manually refreshing restores authoritative unavailable state.
5. At 320px, text enlarged to 200% with line height 1.5, letter spacing .12em and word spacing .16em produces document width 320px. **0 external requests, 0 connection mutations** occurred.

Evidence (local generated, sanitized): [browser metadata](../evidence/panels/settings-connections-evidence/browser-report.json), [320px/200% screenshot](../evidence/panels/settings-connections-evidence/google-unavailable-320-200.png). The screenshot is a viewport observation, not whole-process accessibility certification.

Mocked vs real-provider vs browser vs native:

- Unit lifecycle requests/browser opener are injected fictional fixtures. They do not contact Google.
- Browser reads the actual isolated local API for missing configuration. Only the failure scenario intercepts `GET /integrations` with a fictional 503; real retry uses the actual route.
- No real provider, Google account consent, credential, calendar read/write, remote revoke, paid call, physical microphone or native device was used.

Known defects / limits:

- Google authorization/disconnect UI for configured accounts is covered by injected controller tests, not real-account or rendered provider-consent evidence. A supported sandbox account and explicit resource scope are still required for that gate.
- Opening a system browser via `Linking` does not itself prove a popup/tab opened on every browser or establish native callback/lifecycle correctness. Retry/cancel/explicit refresh are provided; device verification remains required.
- Provider-confirmed revocation is shown only when the actual server receipt supplies that reason. A pending/unknown outcome remains visible and cannot be treated as successful remote revocation.
- The original bootstrap still contains a legacy Calendar presentation stub; this panel filters it out and uses the actual service status route. Parent may later remove/update the obsolete server bootstrap prose centrally.

Dependencies / next action: parent independently reviews the patch and final product journeys. Integrations supplies real sandbox OAuth/readback/revoke evidence; native verification needs a compatible signed iPhone build. Future gateway grants require a separate parent-provided contract and lease.

Independent reviewer and review result: parent review requested; pending. This worker does not self-certify M4 or release.

Skill guidance applied: existing accessibility, networking, authentication and security instructions; browser opening and account/credential validation remain separate, and credentials stay server-side. The explicit parent requirement to use installed RN `Linking` determines this implementation's browser presentation mechanism.
