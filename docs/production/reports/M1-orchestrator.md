# M1 orchestrator integration

27 October 2026. Local implementation verified, production release remains open.

Root mechanically split People/Memory component bodies into separate feature directories and retained compatibility exports. Transferred API identity/schema work explicitly to Platform, reviewed its boundary validators/actual-server tests, and integrated Application session lifetime. Restore runs once; token/origin scope changes remount owner-bound workspace/providers; bootstrap/detail/auth/logout continuations check the captured session. Anonymous storage failures retain safe sign-in input rather than accepting a malformed identity.

New runtime schemas exposed NodeNext .js imports to Metro; a narrow shared-package adjacent .ts resolver repairs the export without rewriting domain or duplicating its contracts. M1 integrated root/mobile TypeScript and Expo web export passed. Full deterministic run at the M1 gate:255tests/20files passed. Platform's36fixture tests and Voice's42feature tests are recorded in their reports. New E2E discovery and CI are subsequent checks, not assumed part of that run.

Independent browser QA found missing web selected/checked/expanded states, accessible modal background and no-op direct Request details for stale bootstrap. Root added shared a11yState(native+explicitweb), hides physical background behind portal, and routes the returned missionID directly to authoritative detail. Shared helper2unit tests pass; root/mobile/e2e TypeScript passes. QA's repair subset10/10 and strongermodal/requestsubset2/2passed; see m5-qa.md for artifact identities. This is not full WCAG/native/device acceptance.

Pinned Playwright1.64.1 (Node24compatible), isolated simulator Fastify/in-memoryDB plus staticExpo harness and readonly-CI actions pinned to upstream release commits. Credentials are removed from fixture configuration; no real microphone/provider/service account is used by deterministic browser tests. No trace/HAR/video collects bearer headers. Settings draft loss remains with the assigned Settings worker. Production APIs/local guards remain separate.

Dependency patch:node-forge1.4.0→1.4.1 within existing declared ranges; npm audit high findings4→3. Remaining Zod3/ExpoCLI high findings are not suppressed or forced through an Expo54 downgrade. Required security gate remains open.

No deployment/account/signing/thirdpartycalling was performed. Root retains App/API/domain/theme/manifests/config/route ownership. Next:M2 panels, M3 durable runtime, M4 authorizedtools after contracts, independent fullproduct verification.
