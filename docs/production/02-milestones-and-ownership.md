# Milestones and independent ownership

This is the execution sequence for the [Sol orchestrator prompt](00-sol-orchestrator-prompt.md). Work is future implementation until evidence changes the [status board](reports/STATUS.md). Preserve the existing implemented design; inspect and improve it rather than restarting.

## Dependency and acceptance gates

| Milestone | Work and dependencies | Exit evidence |
| --- | --- | --- |
| **M0 — Baseline and scope** | Orchestrator inspects code, existing processes, configuration readiness without secrets, current tests and design. QA reproduces critical browser journeys; Platform inventories identity/runtime gaps; Voice inventories actual transport. Record implemented, simulated, unavailable and untested separately. | Reproducible baseline commands, environment, prioritized defects, agreed release scope, file leases and no unexplained existing regression. A failing baseline becomes tracked work, not permission to lower the gate. |
| **M1 — Shared contracts and identity** | Orchestrator mechanically separates People and Memory, extracts panel boundaries without changing behavior, and owns shared shell/contracts. Platform repairs account/session lifetime. Establish validated API payloads, capability/limit types, draft ownership and test fixtures. | Existing tests/typecheck pass; same-origin logout/login races and malformed responses have regressions; panel file boundaries and interfaces are documented. No token/data from the previous owner enters a new owner session. |
| **M2 — Panel polish** | Depends on M1. Launch/voice, Requests, People, Memory and Settings workers improve their assigned panels in waves. Reuse the semantic system, existing artwork and one-button opening. Implement all applicable empty/loading/error/offline/denied/pending states and draft recovery. | Each panel passes its task card, rendered walkthrough and accessibility checks. QA reviews consistency; integrated navigation does not lose input or misrepresent authority. |
| **M3 — Production runtime** | Depends on M1; can run alongside M2 with disjoint leases. Platform hardens identity, storage, worker recovery, limits, telemetry and cleanup. Voice implements durable session reconciliation and a documented native transport using Platform's storage contract. | Process-restart and multi-owner tests, migration/restore evidence, bounded provider lifecycle tests, no duplicate effects, and signed iPhone audio/device evidence. Unavailable hardware keeps the device gate open. |
| **M4 — Services and tool gateway** | Design/contracts may begin after M1. Enabling tool execution depends on the applicable M3 identity/session/action gates. Integrations implements the bounded scope in [04](04-services-and-tool-tracing.md), with Voice connecting only approved gateway contracts. Settings consumes real service states. | Validated tools and sanitized traces; OAuth refresh/revoke/isolation; simulated and sandbox integration outcomes; adversarial content cannot increase authority. No missing credential is described as a connected service. |
| **M5 — Cross-product E2E** | Requires integrated M2 and the M3/M4 features claimed for release. QA independently exercises complete journeys and failure recovery; owners repair defects. | Repeatable browser suite, bounded real OpenAI evidence, supported-service sandbox evidence and physical-iPhone scenarios. Every required scenario is pass/fail/blocked with artifacts; unit mocks do not satisfy live/device gates. |
| **M6 — Release candidate** | Depends on required M5 gates. Orchestrator and QA review security/privacy/accessibility, performance, dependencies, operations and release packaging. | Versioned candidate, clean required checks, no unresolved release-blocking defects, reviewed disclosures, backup/restore and deployment/rollback rehearsal, known limitations and exact remaining external prerequisites. No production-readiness claim if required gates remain blocked. |
| **M7 — Authorized rollout** | Only after M6 and explicit rollout scope for the reviewed artifact. Stage, monitor, verify and roll back according to the runbook. | Deployment/device distribution actually verified in the authorized environment, smoke results and monitored outcomes. Public deployment, App Store submission and third-party communications are not implicit in preparing this handoff. |

M2 and M3 are parallel branches after M1. M4 cannot bypass M3's execution prerequisites. Test design, fixture preparation and read-only reviews can proceed ahead of implementation gates.

## File leases and shared boundaries

The orchestrator records one active writer per file in the board/reports. It owns `apps/mobile/App.tsx`, `apps/mobile/src/api.ts`, `models.ts`, `ui.tsx`, `components/`, `design/`, `packages/domain/`, package manifests/lockfiles, shared configuration and test-runner infrastructure. It also integrates route registration in `apps/server/src/app.ts` and configuration changes in `apps/server/src/config.ts`.

Before independent People/Memory work, mechanically extract their screen/editor exports from `apps/mobile/src/people-memory.tsx` into `features/people/` and `features/memory/`, retain compatibility re-exports temporarily, and rerun baseline checks. The orchestrator alone updates `App.tsx` routing and callbacks. Do not combine this extraction with a visual redesign.

Platform and Integrations submit proposed server-route/configuration patches to the orchestrator. Voice owns `openai-live.ts`; Platform supplies persistence and identity interfaces rather than editing that broker concurrently. Requests owns `features/voice/presentation.ts`; Voice excludes that file from its lease. QA owns independent E2E specifications; panel agents own their feature regressions. Shared schema, dependency or design-token changes require an explicit lease transfer, not simultaneous edits.

## Four-slot scheduling example

Keep the orchestrator active and use at most three workers when four slots exist. Discover the actual limit rather than assuming unlimited agents. Reuse workers with new task cards as work completes.

| Wave | Three worker assignments | Orchestrator integration |
| --- | --- | --- |
| Baseline/foundation | Platform identity audit/fixes; Voice transport audit; QA baseline/harness scenarios | Reproduce baseline, split shared panels, freeze API/design contracts and integrate identity patches. |
| First implementation | Launch/Voice; Requests; Platform runtime | Integrate disjoint changes and review panel/runtime evidence. |
| Second implementation | People; Memory; Settings | Review those panels; retain completed runtime work. If Voice/Platform still need a slot, queue one panel instead of overcommitting. |
| Services | Integrations; Voice gateway/native follow-through; QA adversarial/service scenarios | Integrate approved tools/configuration; temporarily lease Settings connection UI when needed. |
| Product verification | QA browser/accessibility; one defect owner; Platform or Voice device/operations work | Run whole-product journeys, resolve cross-panel defects and prepare M6. |

These are scheduling examples, not a requirement to idle completed workers. Start any unblocked, disjoint card. Never dispatch overlapping leases merely to fill slots. A blocked live/device prerequisite does not stop independent local work.

## Worker report and orchestration loop

Before editing, each worker sends the parent its card, prerequisites, exact owned files and needed shared changes. At completion or a blocker, it reports using [the report template](reports/README.md): implemented behavior; files; contract requests; commands actually run; passed/failed/blocked scenario names; sanitized evidence; limitations; and next dependency. Use the scenario families in [03](03-tests-and-quality.md); add exact IDs from that matrix to reports when available.

The parent inspects the patch, integrates shared changes, runs the applicable cross-panel checks, and sends failures to the owning worker. A different reviewer validates release-critical behavior. Workers do not certify their own final release, manufacture device evidence, or mark another agent's dependencies complete. The orchestrator updates milestone status from evidence and keeps one coherent visual/product contract.
