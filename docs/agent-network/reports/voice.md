# Internal owner voice-tool bridge

27 October 2026. Implemented by the panel/voice worker; independent integration and native/live-audio evidence remain separate.

## Implementation

- `packages/domain/src/tools.ts` adds strict application tools `network_connections_lookup`, `network_request_submit` and `network_request_status`. All arguments are required, objects reject extra properties, and submission derives its durable request identity from trusted owner/Live receipt/call metadata. The model cannot supply identity, a nonce, credentials, authority, an endpoint or a new tool.
- `apps/server/src/network/voice-tools.ts` adds `NetworkVoiceTools(db,live,coordinator,legacyGateway)`. Legacy names delegate unchanged. Network names require current account, bearer, active/unexpired Live receipt, controller lease, explicit selected tool grant and an enabled/unexpired validated own network policy. A trusted async-local guard repeats those checks within each coordinator transaction after sorted participant-owner locks and before any effect. No nested coordinator transaction or provider client is introduced.
- Network submission uses `toolRequestId(context)` as its stable internal request nonce and the coordinator's durable idempotence. Metadata receipts bind call/name/arguments through the existing keyed digest. Same-call conflicting instructions are denied. Lost post-commit results can return unknown and safely reconcile through the same request identity without duplicating work.
- Model-produced outgoing meeting terms must satisfy the initiating owner's current member/topic/duration/notice/window/timezone/weekday/hour limits for every candidate. A voice-tool grant permits initiation independently of incoming auto-accept, but cannot manufacture an owner's exception to those limits. Out-of-bounds terms are blocked with `review_required` and typed-review guidance. The coordinator separately enforces the other owner's current authority and exact-proposal approval requirements.
- Accepted-member lookup returns only connection ID, member ID and member name. Results mark retrieved text untrusted. Submission/status return the permitted shared summary, canonical state, next action and proposal/event evidence; they omit private policies, private memory, bearer/controller details and internal planning. Receipts/traces store structural metadata and digests rather than raw arguments, messages or retrieved data.
- `openai-live.ts` changes only network-aware prompts and the tool-list maximum from seven to ten. `openai-tool-delegation.ts` documents the separate internal authority boundary. Existing completed-function-item correlation, continuation, closure and transport logic remain intact. `gpt-live-1`, `marin`, `gpt-6.1-sol` and no-grant `tools: []` behavior remain unchanged.
- `apps/mobile/src/features/network/VoiceAccessPanel.tsx` offers explicit account permission for only the three network tools and shows saved grant/runtime/delegation state. It reads the current grant before changing the network subset, preserves separately enabled legacy names, leaves native Live gated, and reports unconfirmed changes without claiming success. `features/settings/tool-access.ts` adds labels only.

Root integrated the wrapper, max-ten grant schema, live resolver policy filtering, trusted async-local guard hook and Settings mount in root-owned files. Root retains app/gateway/API contracts/navigation/dependencies and final export ownership.

## Official OpenAI references checked

Applied the installed OpenAI Docs skill and searched/fetched current official documentation before changing Live prompts/configuration:

- [Delegation and tools in GPT-Live](https://developers.openai.com/api/docs/guides/live-delegation): application-owned permission checks, Responses custom-function handling through completed output items, result append and continuation. The existing protocol was preserved.
- [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs): strict required fields and closed object shapes. Runtime schemas still perform business/date/timezone refinements which JSON Schema alone cannot authorize.

No SDK/model migration, protocol substitution, paid request or provider smoke test was performed. A deterministic local bridge test uses the actual delegation parser and actual network gateway/database, with synthetic completed function events.

## Checks actually run

| Command | Result |
| --- | --- |
| `npm exec -- vitest run tests/network-voice-tools.test.ts --maxWorkers=1` | **14 passed**, final run 22:53 local, 14.76 seconds |
| `npm exec -- vitest run tests/tool-gateway.test.ts tests/openai-live-tools.test.ts tests/tool-access-routes.test.ts apps/mobile/test/settings-tool-access.test.ts --maxWorkers=1` | **69 passed** in four existing files |
| `npm exec -- vitest run tests/network-voice-tools.test.ts apps/mobile/test/network-panels.test.ts --maxWorkers=1` | **27 passed** before adding the final Live-parser bridge test; this earlier run had 13 voice + 14 panel cases |
| `npm run typecheck` | **Passed** root/server/domain and mobile after the final bridge test was added |

New cases use real in-memory PostgreSQL-compatible storage, fictional members, actual policies/connections, synthetic active Live receipts and no provider calls. Covered strict arguments, legacy delegation, accepted-only projection, stable/restarted duplicate calls, exact payload conflicts, private trace/receipt redaction, participant-only status, explicit grants, own policy, own scheduling bounds, current controller/live state, post-reservation grant/bearer/controller/policy/block revocation, lost post-commit result recovery and actual Live completed-item → network gateway → structured queued result → continuation.

One transient typecheck caught a fixture's inferred optional-peer type and was repaired. A later concurrent typecheck briefly saw the root-owned owner-intent test before its implementation file existed; the final complete typecheck passed. Neither failed intermediate check is counted as a pass.

## Limits and remaining evidence

These checks verify local routing, schemas, state and authorization, not speech understanding, human intent extraction quality, naturalness, interruption quality, audio latency or spoken delivery. No real OpenAI session was created in this workstream. Typed Inbox remains the route for required personal approvals or exceptions to saved meeting limits. Incoming requests and reminders continue under their separate durable scopes.

Permission updates use the existing unversioned tool-grant endpoint. This panel reads before changing only its subset, but concurrent independent clients can still replace a shared grant; a revisioned grant mutation would require a separate contract change. The server rechecks the actual current grant before effects.

No browser screenshots, export, device build or assistive-technology test was claimed by this worker. Root/QA owns independent integrated two-context browser validation and final export; physical iPhone/VoiceOver/Dynamic Type and live owner-audio checks remain explicit gaps. The installed verification skill's shipped-only guidance was followed through project tests/typechecks; no unavailable Ruflo truth score or rollback claim is made.
