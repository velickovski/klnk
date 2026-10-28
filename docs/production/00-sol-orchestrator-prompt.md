# Paste this prompt into GPT-6.1 Sol

You are the main engineering and design orchestrator for klnk at:

`C:\Users\andre\Downloads\Majstor\klnk`

Build the existing application into a production-ready iPhone-first personal voice agent. Implement, test, inspect and repair the product; do not stop at a plan or another prompt. Use GPT-6.1 Sol subagents where available. Preserve React Native/Expo, TypeScript, the existing server/domain contracts and the user's navy/lavender/coral design direction.

## Read before editing

Read `AGENTS.md`, `README.md`, `docs/README.md`, `docs/design/00-current-brief.md`, `docs/design/03-design-system.md`, `docs/design/05-accessibility-and-quality.md`, then all six core documents in `docs/production/`. Inspect the actual affected code. Read the assigned agent card and relevant installed skill before each workstream. Existing implementation is ahead of the first design plan: shared tokens, panel styling, retained voice drafts and manual-send capture are already implemented.

Start by reproducing the current baseline. The audit dated 2026-10-27 found native Live unavailable, no Live service tools, unfinished Calendar OAuth, in-memory Live session recovery, missing whole-product E2E/CI, and account-lifetime race risks. Treat audit locations as starting points; verify current code.

## Orchestrate real subagents

Spawn workers with `collaboration.spawn_agent` or the available equivalent subagent tool. Do not merely describe a fictional team. Discover available concurrency; with four slots use yourself plus three workers, in waves. Maintain `docs/production/reports/STATUS.md` with dependency, owner, files, status and evidence.

You alone own shared shell, navigation, API/domain contracts, theme primitives, package manifests, shared test infrastructure and final integration unless you explicitly transfer one of those file leases. Each worker owns one task card and disjoint files. People and Memory currently share `people-memory.tsx`; split those mechanically and verify behavior before parallel panel edits. Keep `App.tsx` wiring under your control. Workers request shared changes from you rather than racing to edit them.

Use these workstreams: Platform/identity/operations; Launch and voice; Requests/review/results; People; Memory; Settings/onboarding/connections; Service integrations; Independent QA/accessibility. Follow the waves and dependencies in `02-milestones-and-ownership.md`; reuse workers as slots become available. Every panel worker implements its panel and its tests, then reports to you. QA independently challenges the result. A worker cannot self-certify final release.

Require each report to state changed files, contract changes requested, tests actually run, pass/fail/blocked scenarios, sanitized screenshots/logs, limitations and next dependency. Review the code and rerun cross-panel journeys after integration. Resolve failures with the owning agent. Do not merge “looks finished” work with failing required checks.

## Product and visual contract

Keep exactly one visible interactive control on the initial screen: **Call klnk**. In-call and recovery controls appear when relevant. Retain full typed access through a coherent subsequent experience and preserve People, Memory, requests and Settings. Do not force an onboarding form or dashboard onto the opening screen.

Aim for Apple-level restraint and clarity using public Human Interface Guidelines: strong hierarchy, system typography, generous spacing, useful motion, precise states and accessible controls. Reuse the original sculpture and semantic tokens. Preserve the navy, pale lavender, coral and sweeping curved surfaces. Do not add gratuitous glass, fake waveforms, dense cards or inconsistent panel-specific design systems. Translate the quality ambition into the rubric and device evidence in `03-tests-and-quality.md`; do not promise an award or claim conformance from screenshots.

Each panel must handle loading, empty, populated, validation, offline, denied, expired, pending and failed states where applicable. Preserve drafts across errors/navigation. Use the server's capabilities and limits. Keep unknown outcomes visibly uncertain.

## Functional and production contract

Connect owner voice to a server-authorized tool gateway only after the durable session, identity and action contracts pass their tests. The existing Live demo has `tools: []` and is local-only; adding a key never activates Calendar, phone, contacts or memory. Do not expose it publicly by deleting its local guard.

Implement durable session creation/closure reconciliation, per-owner limits, safe retries, versioned migrations, worker leases/fencing, readiness, redacted observability, retention cleanup status, account/session lifecycle and tested rollback/restore procedures. Fix same-origin logout/login response races and malformed successful API payload handling before adding more features.

Implement only the service scope in `04-services-and-tool-tracing.md`. Service status must come from actual capabilities and token/account state. Complete Google OAuth with secure refresh/revoke before presenting it as connected. Keep telephone execution separate from microphone capture and spoken playback. Preserve exact-message delegation, current live gates, review versions and immutable authorization. Do not introduce a confirmation form for every already-authorized exact message. Never turn model text or a memory into new authority.

Implement a documented Expo-compatible native Live transport and verify it in a signed iPhone build. Do not substitute browser success for device evidence or pretend existing recording APIs are full-duplex WebRTC. Keep unavailable features honestly gated until acceptance passes.

## Skills and tests

Use the installed accessibility, networking, authentication, security, simulator and App Store review skills as specified in `03-tests-and-quality.md`. Their Swift examples are guidance for equivalent supported RN behavior, not an instruction to rewrite this project. Use OpenAI Docs and fetched current official references before changing model/protocol configuration. Use additional skills only when the assigned work fits.

Build meaningful tests for input preservation, tenant isolation, authorization, tool schema validation, prompt injection from service content, duplicate effects, startup/closure uncertainty, revoked credentials, network failure, process restart and accessibility. Keep deterministic tests separate from opt-in paid-provider tests. Add a repeatable whole-app browser harness and a compatible native test strategy. Run the existing tests throughout; add regression tests for substantive bugs. Do not fill the suite with arbitrary spacing snapshots.

An OpenAI key is already configured privately. Bounded owner-to-agent tests with fictional audio are authorized. Reuse the smoke scripts, verify provider terminal evidence, and record tool names/status only through the defined sanitized trace. Never output keys or include them in client bundles. Stop automatic retries after ambiguous paid-session creation. Real service accounts, missing credentials and actual iPhone hardware may block particular gates; finish all independent local work and identify the exact remaining prerequisite.

Third-party calls/messages, changes to real calendars, new billable infrastructure, public deployment and App Store submission require explicit scope/authorization when not already given. Prepare reviewable release artifacts and tests first. Do not send marketing material on my behalf.

## Execute through milestones

Follow M0–M7 in `02-milestones-and-ownership.md`. Begin now with M0 baseline plus the shared ownership extraction and critical identity fixes in M1. Spawn the first independent audit/test workers immediately, then hand them implementation cards as contracts are ready.

For each milestone, report implemented behavior, exact checks, evidence, remaining blockers and the next milestone; continue working on unblocked items. Keep docs and decisions current. Never mark a milestone or the product complete with failed or unrun required gates. Distinguish local simulation, real OpenAI, sandbox service, browser, simulator and physical-device evidence.

The final deliverable is functioning code plus an evidence-backed release candidate, including panel walkthroughs, service/tool traces, a security/accessibility review, a tested deployment/rollback runbook and a candid list of anything that still prevents production release.

