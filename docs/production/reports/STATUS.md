# Production milestone board

Historical foundation: the current product pivot and its fresh evidence are tracked under [agent-network status](../../agent-network/reports/STATUS.md). Counts below belong to the earlier candidate and are not reused as verification of new network features. Its saved source archive remains immutable.

Updated: 27 October 2026, Europe/Skopje. Implementation in progress; no production certification or rollout.

| Milestone | State | Owner | Dependency / evidence |
| --- | --- | --- | --- |
| M0 baseline | Reproduced locally | Root + three Sol workers | Root typecheck/webexport pass; initial 200-test audit baseline preserved and integrated M1 run255tests/20files passes. QA confirms one-action launch and Settings draft loss. See reports. |
| M1 contracts/identity | Local implementation verified | Root + Platform + Voice | Identity epochs, validated payloads, storage failures and owner-scoped drafts passed unit/API and independent browser checks. |
| M2 panels | Local checks passed; native/manual gates open | Root + panel workers + QA | All panels implemented, including failed-save/review/limits, text scaling and typed recovery. Independent integrated browser pass; manual assistive input/device acceptance unrun. |
| M3 runtime | Local runtime verified; device gates blocked | Platform + Voice + QA | Durable receipts/controllers/workers, independent PostgreSQL multi-process tests, encrypted and dump/quarantine restore passed. Signed iPhone/native Live unavailable. |
| M4 services/gateway | Local in-app voice verified; real-service gates open | Root + Integrations + Voice + Settings + QA | Strict tools/traces, explicit grants, OAuth/suppression and frozen context. Real read-only Live lookup/result/continuation passed; no telephone, message or Calendar effect. |
| M5 E2E | Automated local checks pass; device/human gates blocked | Root + independent QA | Root557 tests passed;11 PostgreSQL cases passed separately. Canonical browser32 passed with exact loaded/exported hash, grants/recovery and corrected enlarged-layout checks. Fixed20-case text/API corpus passed. |
| M6 candidate | Local review candidate prepared; release blocked | Root + QA | Source manifest/archive and final handoff; operations17 assertions passed. Native, manual accessibility/usability, real services, dependency and production operations gates remain open. |
| M7 rollout | Not authorized/performed | Root | No public deployment, App Store submission or third-party contact. |

## Active file leases

| Owner | Files | Task / restriction |
| --- | --- | --- |
| Root | App.tsx, shared components/design/models/domain, package manifests/lockfiles, app.ts/config.ts, people-memory compatibility file and initial extraction, Playwright config/scripts/CI, STATUS.md | Shared integration and M0/M1 shell; one writer per shared file |
| production_platform (Sol), frozen | Integrations/runtime/operations and credential-clock source/tests/reports | M3/M4/M6 handoffs complete locally; final Google credential-expiry wall-clock check verified with real PostgreSQL. |
| production_voice (Sol), frozen | Broker/helper, browser recovery, Requests/presentation and reports | Protocol, closure, authority and owner-restoration tests passed. Root owns final integration and actual provider evidence. |
| production_qa (Sol), frozen | e2e/browser/**, e2e/native/**, QA tests/reports/evidence | Independent runtime/tool/browser review complete locally; exact loaded artifact and partial visual rubric recorded. No release certification. |

| production_settings (Sol), frozen | Settings/People/Memory panels, connection/tool permission UI, corpus and reports | Local checks and walkthroughs complete. No real Google authorization/third-party traffic. |

Root mechanically split People and Memory before panel edits; compatibility exports retained. Root integrated owner-scoped Settings drafts, modal guards, explicit web ARIA states, scalable badge/icon fixes and direct voice request navigation. Contact/memory CRUD invalidates draft reviews under the owner lock; authorization freezes selected context. Durable draft submission receipts protect lost-response retries. Independent review found and verified the deletion atomic recheck and Google cleanup-readiness fixes. Source hashes, not Git commits, identify this non-Git workspace.

## Open external gates

Compatible Expo58/RN0.88 native transport is unproven; macOS/Xcode, Apple signing and physical iPhone absent. Google OAuth sandbox and consented telephone recipient scope are absent. These gates remain blocked/unrun while independent local implementation continues. New infrastructure, real Calendar writes, third-party communications and rollout are not authorized.
