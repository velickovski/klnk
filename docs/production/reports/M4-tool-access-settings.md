# Voice permissions and activity — M4 Settings

Agent / milestone / status: Settings worker / M4 / implementation, deterministic regressions and local browser walkthrough passed; independent/native/provider gates remain open.

Task and owned files:

- [ToolAccessPanel](../../../apps/mobile/src/features/settings/ToolAccessPanel.tsx).
- [Permission controller and activity presentation](../../../apps/mobile/src/features/settings/tool-access.ts).
- [Settings](../../../apps/mobile/src/settings.tsx): import and subsequent-workspace disclosure insertion only.
- [Dedicated regressions](../../../apps/mobile/test/settings-tool-access.test.ts).
- This report. App, API validators, server/broker routes and domain schemas remain parent-owned.

Implemented behavior:

- Adds **Voice permissions and activity** inside subsequent Settings. The initial voice home still has exactly one Call klnk control.
- Reads the account's authoritative permission record and runtime availability independently from activity. The single explicit Allow action sends only `enabled:true` with people lookup, permitted confirmed memory lookup, request draft preparation and request status. It never automatically adds previously saved external-action tools.
- Allow requires web, an available runtime, a verified off grant and no unconfirmed change. The UI explicitly separates saved permission from actual runtime availability. A key or backend connection alone never enables the grant.
- A known on grant can be turned off even on native or while the runtime is unavailable. Turn off sends `enabled:false` with the current saved tool list. Existing permission names are displayed in ordinary language, including additional tools already stored by another authorized workflow.
- Only accepted server responses change displayed permission state. Pending operations prevent duplicates. Failure retains the last confirmed state, marks it uncertain and offers Refresh; an uncertain enable cannot be blindly repeated. Account/session changes and unmounted panels reject stale results. Responses for another owner are rejected.
- Permission copy explains the four in-app abilities, that drafts require review/authorization, and that the control does not grant calls, messages or Calendar changes.
- Activity shows at most 12 final decision events within seven days, newest first. It excludes intermediate trace events and uses the actual status, regardless of an event name containing “succeeded.” Proposed, blocked, authorized, queued, running, failed, unknown, cancellation requested and cancelled remain distinct. Draft preparation still says review needed; unconfirmed verification never becomes a completion claim.
- User-facing activity contains human names, status, context and time only. No raw tool function names, reason codes, record/session/request identifiers, arguments or conversation words are rendered. Activity failure retains previously loaded activity with a stale-state notice and independent retry.
- Uses labeled shared buttons, busy/disabled states, status feedback and native announcements. No new capture, playback, provider, deployment or external-action behavior was added.

Shared contracts changed or requested:

- None. Uses parent-validated `GET/PUT /tools/access` and `GET /tools/traces`.
- Enable payload is exactly the four approved in-app names. Disable retains the existing names while setting enabled false. Server/runtime availability and external-effect policy are never changed by this component.
- A pure controller/presentation module accompanies the new component so identity races, failed writes and status truthfulness can be tested without mocking React Native internals.

Scenario IDs / results:

| Scenario | Result |
| --- | --- |
| SETTINGS-03 / TOOL-04 | Passed web/runtime/default-off gating, exact four-tool enable, existing-list preservation, revoke while unavailable/native, pending-write deduplication, no optimistic state, failed/unknown recovery and cross-owner/stale response rejection. |
| TOOL-01/03 presentation | Passed structural activity status mapping, latest-12/final-event/seven-day filtering and raw-identifier exclusion. Server gateway execution and provider outcomes remain owned by their separate tests. |
| AUTH-01 / NET-01/02 | Controller rejects another owner's grant/activity and late account/disposal responses; unconfirmed changes require refresh. |
| A11Y-01/02 | One-action opening preserved. Browser text/labels and settled 320px/200% text layout passed the stated measurements. This is not a full accessibility claim. |
| A11Y-03 / real-provider | Not run: native device and real-provider verification are outside this local panel work. |

Exact commands / environment / artifact:

- Windows, installed Node/Expo 58/RN 0.88 and Chrome. Disposable local accounts and fictional data only.
- `npx vitest run apps/mobile/test/settings-tool-access.test.ts` — **25 passed**, tool timestamp 16:09:20, 27 October 2026.
- `npm run typecheck` — root and mobile passed during implementation; `npm run typecheck --workspace @personal-agent/mobile` also passed with the new component/controller/tests.
- `npm run e2e:build` — passed; actual browser entry **`/_expo/static/js/web/index-fd5c8ec63e1a19a59780c2547a3ea718.js`**.
- `npx tsx scripts/e2e-server.ts`, followed by exploratory Playwright via PowerShell here-string piped to `node --input-type=module` — **six browser checks passed**. All external hosts were blocked. Server stopped afterward; ports 4102/8083 verified free and build/port lease returned to parent.

Actual browser evidence:

1. Initial opening still contains one Call klnk button. Actual permission GET starts off; unavailable runtime disables Allow. Actual activity GET is empty and shows an honest empty state.
2. Only the eligibility GET was explicitly mocked to return runtime available. Clicking Allow sent the actual local API PUT with exactly the four approved abilities. The actual PUT response reported the saved grant on and runtime unavailable; the UI preserved that distinction. Turn off still worked.
3. An existing on grant with an additional Calendar-related permission was seeded in the disposable local account. The UI displayed a human name for it and turned the grant off through the actual API while retaining that exact saved list. No additional tool was added.
4. A fictional failed PUT kept Last confirmed: Voice permissions on, hid the raw technical fixture error and recovered after explicit Refresh and retry.
5. A presentation-only fixture returned 15 valid structural events. The UI showed the latest 12, kept proposed/queued/unconfirmed/cancellation statuses separate despite success-shaped event names, and displayed no raw function names, reason codes or owner identifier.
6. Settled 320px layout with 200% rendered text, line height 1.5, letter spacing .12em and word spacing .16em measured document width **320px**, no overflowing elements, **0 external requests and 0 microphone captures**. An initial immediate measurement during viewport resize was 326px before React committed its responsive layout; the recheck waited two animation frames after resizing and applying text overrides. Fixed-320 checks also measured 320px.

Evidence (local generated, sanitized): [browser metadata](../evidence/panels/tool-access-evidence/browser-report.json), [320px/200% screenshot](../evidence/panels/tool-access-evidence/voice-permissions-320-200.png). These are viewport/state observations, not whole-process conformance evidence.

Mocked vs real-provider vs browser vs native:

- Unit API responses are fictional injected boundaries.
- Browser permission reads/writes use the actual disposable local API. The eligible runtime GET, failed PUT and structural activity dataset are explicitly mocked where stated. No provider key was supplied to the fixture; no voice session or tool execution was started.
- No outbound call, message, calendar action, real account, external request, physical microphone or native device was used. Saving a fixture permission is not evidence of provider execution.

Known defects / limits:

- Native assistive input and runtime behavior remain unverified; Allow is intentionally unavailable on native while revocation remains available.
- Activity is structural metadata. It is not audio evidence or proof of an external effect; request details remain the source for execution/provider outcomes.
- Runtime gating is server-supplied. Production rollout, real voice gateway/provider acceptance and broader whole-product QA are not certified by this panel work.
- The browser resize check must wait for responsive layout commitment before assessing the settled layout; no persistent horizontal overflow was observed after that commitment.

Dependencies / next action: parent reviews the component and integrates final voice runtime/gateway acceptance independently. Continue signed-iPhone and complete web accessibility review separately. No further permission scopes or external tools should be added through this fixed in-app action without a new contract.

Independent reviewer and review result: parent review requested; pending at worker handoff.
