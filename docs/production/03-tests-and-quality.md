# Test strategy, installed skills and design acceptance

This is the required future release matrix. Only [05-evidence.md](05-evidence.md) records tests actually run. Each implementation report must identify scenario IDs, exact command, build/artifact identity, environment, fictional/live data, result and sanitized evidence. “Blocked” and “not run” never count as passed.

## Layers and execution

| Layer | Purpose | Execution rule |
| --- | --- | --- |
| Unit/contract | Pure domain/controller behavior, schema/error handling, authorization | Existing Vitest discovery; fast, deterministic, no external calls |
| API/database integration | Authentication, ownership, idempotency, migrations, jobs | Isolated fictional account/database; add real PostgreSQL two-worker suite |
| Whole-app browser E2E | Rendered Expo panels, real local API, complete journeys | Add a compatible pinned runner; semantic selectors; route only external provider boundaries for deterministic tests |
| Real OpenAI smoke | Actual provider access, speech events, lifecycle, tool observation | Opt-in bounded scripts; fictional audio; never an implicit part of npm test |
| Service sandbox E2E | OAuth and actual read/write/reconcile/revoke per enabled service | Explicit sandbox/test account and authorized resource scope; capture provider readback |
| Native simulator/device | Exact signed build, OS permissions, audio/lifecycle, assistive input | macOS/Xcode for build; physical iPhone for audio routing and real performance |
| Operational staging | Failover, migrations, restore, rate limits, deletion, telemetry | Isolated staging candidate and documented fault injection |

Current commands: `npm run typecheck`, `npm test`, `npm run demo`, `npm run setup:check`, `npm exec --workspace @personal-agent/mobile -- expo export --platform web`. The existing root test globs are `tests/**/*.test.ts`, `packages/**/*.test.ts` and `apps/mobile/test/**/*.test.ts`. Arbitrary tests next to feature code will not run without a deliberate configuration change.

The opt-in smoke scripts are a useful start, not the final whole-product E2E harness. The browser smoke currently uses a supplied Playwright runtime, synthetic input and the standalone demo. Pin/own the E2E dependency and CI configuration during M1/M5; verify compatibility with installed Expo 58 / React Native 0.88 before adding packages. Do not silently download native SDKs or initiate a cloud build.

## Skills translated into acceptance tests

Read the actual installed files when beginning the relevant task. Paths below are valid on this workstation; resolve from the skill catalog on another host. Swift examples must be translated into supported Expo/RN behavior. Unrelated hardware/gaming skills do not add requirements to this app.

| Skill | Source | Required application |
| --- | --- | --- |
| ios-accessibility | [SKILL.md](C:/Users/andre/.codex/skills/ios-accessibility/SKILL.md) | Name/role/state/value, focus, alternative input, text scaling, meaningful motion, every common task on device |
| ios-networking | [SKILL.md](C:/Users/andre/.codex/skills/ios-networking/SKILL.md) | Real status/schema validation, cancellation, bounded retries, invalid-success responses and stale account responses |
| authentication | [SKILL.md](C:/Users/andre/.codex/skills/authentication/SKILL.md) | Server identity validation, token lifecycle, OAuth callback/PKCE/state, canceled auth recovery; Apple/passkeys only if selected |
| swift-security | [SKILL.md](C:/Users/andre/.codex/skills/swift-security/SKILL.md) | Equivalent SecureStore failure and credential isolation tests; actual device verification for Keychain behavior |
| ios-simulator | [SKILL.md](C:/Users/andre/.codex/skills/ios-simulator/SKILL.md) | Exact installed artifact and runtime, permission/lifecycle scenarios, evidence; simulator limits are explicit |
| app-store-review | [SKILL.md](C:/Users/andre/.codex/skills/app-store-review/SKILL.md) | Recheck current Apple requirements, privacy manifest/labels, purpose strings, review access and exact release archive |
| openai-docs | [SKILL.md](C:/Users/andre/.codex/skills/.system/openai-docs/SKILL.md) | Fetch current official protocol/model guidance before changes; verify actual account behavior separately |

Use contacts-framework, eventkit or callkit only for a deliberately implemented native capability. CallKit is not the same as authorizing an outbound provider call. Use debugging-instruments/performance skills on a compatible native host when measuring. Native Liquid Glass is optional; a cosmetic web blur does not prove native material support.

## Required scenarios

Each table row is a test group, not a requirement for one oversized test. Give individual cases stable suffixes. Reuse existing coverage and add regressions for uncovered failures.

| ID | Owner | Scenario and pass condition |
| --- | --- | --- |
| AUTH-01 | Platform | A request starts as owner A, then A logs out and B signs in on the same origin: late A 200 cannot populate B's UI; late A 401 cannot log B out |
| AUTH-02 | Platform | Expired/revoked token, canceled sign-in, malformed secure-store data and origin mismatch never restore an invalid identity |
| AUTH-03 | Platform | SecureStore read/write/delete rejects: report honest state and prevent silent restoration of an old credential; no secret in report/log/bundle |
| NET-01 | Platform | Valid 2xx, invalid JSON 2xx and wrong-shaped 2xx: only validated payload becomes success; 401/403/404/429/5xx/timeout/offline give actionable errors |
| NET-02 | Platform | Origin/account switch, cancellation, out-of-order response and redirect cannot leak a token or apply stale state; safe/idempotent retries only |
| VOICE-01 | Voice | Exactly one visible initial interactive action; permission requested only on intent; denied/missing microphone leads to usable typed recovery |
| VOICE-02 | Voice | Real provider start, first input/output/captions, mute and unmute acknowledgements; no timer-generated connection or fabricated transcript |
| VOICE-03 | Voice | Rapid double tap, late permission, stale SDP, network drop, navigation and backgrounding cannot duplicate paid starts or retain capture |
| VOICE-04 | Voice | End releases local tracks/playback; provider closure needs terminal event/readback; lost creation identity blocks blind retry and survives server restart |
| VOICE-05 | Voice | Announce actual duration bound and approaching limit; preserve useful context through allowed continuation; manual recording cap holds for explicit Send/Discard |
| VOICE-06 | Voice + QA | Real interruption/barge-in, headphones/Bluetooth/speaker, route changes, phone interruption and app background/foreground on iPhone |
| REQ-01 | Requests | Typed and spoken exact-message → verified recipient → authoritative authorization → actual simulated outcome; no new mandatory composer for an already-authorized exact message |
| REQ-02 | Requests | Ambiguous person, edited number, stale reviewVersion and changed recipient force the required new review; prior confirmation cannot leak across revisions |
| REQ-03 | Requests | Bootstrap limits drive choices; live 180-second/zero-retry and tighter fixtures show no invalid options |
| REQ-04 | Requests | Lost submission reads same receipt before replay; cancel-requested, call-ended, unverified analysis and follow-up failure stay distinct |
| REQ-05 | Requests | Retry calendar follow-up never redials; provider completion does not invent an agreement; result cites actual evidence |
| PEOPLE-01 | People | Create/edit/delete fictional contacts; international-number validation, duplicate/ambiguous names, opt-out and number change invalidating verification |
| PEOPLE-02 | People | Search/no results, failed save, Save/Discard/Stay, keyboard focus and 1,000-contact fixture; no claim of automatic iOS import |
| MEMORY-01 | Memory | Source, confirmation, scope, expiry and disclosure shown; private/unconfirmed/unrelated/expired/deleted facts excluded from unauthorized context |
| MEMORY-02 | Memory | Failed save preserves edits; deletion does not change frozen mission authorization; relationship deletion leaves coherent references |
| SETTINGS-01 | Settings | Draft settings survive navigation or Save/Discard/Stay protects them; timezone validation and successful save/refetch agree |
| SETTINGS-02 | Settings | Changed API origin clears old session; export/delete use disposable fixtures; deletion queued/failed/complete stays honest |
| SETTINGS-03 | Settings + Integrations | Disconnected, connecting, denied, connected, expired, insufficient-scope and revoked states match real backend capability |
| TOOL-01 | Integrations | User request selects an available registered tool; validate arguments/owner/scope/policy before any dispatch; inspect trace and provider readback |
| TOOL-02 | Integrations | Prompt injection in contact names, memory, event text, provider responses and tool output cannot add tools or bypass permissions |
| TOOL-03 | Integrations | Duplicate event, concurrent devices, timeout after acceptance and restart cause at most one external effect; unknown outcome is reconciled |
| TOOL-04 | Integrations | No credential, denied scope or expired/revoked token returns explicit unavailable/reconnect; never use another owner's service account |
| CAL-01 | Integrations | State/PKCE/callback binding, consent denial, refresh rotation/revocation, same-account readback; token secrecy |
| CAL-02 | Integrations | Existing-event update only: availability, ETag conflict, timezone/DST, recurring-event identity, timeout/retry; only authorized event changes once |
| PHONE-01 | Integrations | Simulator and disabled/allowlisted gates; signed callback replay, provider start uncertainty, actual termination/reconciliation and opt-out |
| PHONE-02 | Integrations + QA | Consented controlled recipient only after separate scope exists: voice disclosure, interruption, actual outcome and failure readback |
| OPS-01 | Platform | Ledgered migrations apply once; concurrent startup and incompatible schema fail safely; real PostgreSQL upgrade and rollback/forward-repair rehearsal |
| OPS-02 | Platform | Two workers, job > lease, process death and retry exhaustion: no duplicate external effect; renewable lease/fencing and operator recovery |
| OPS-03 | Platform | Health distinguishes liveness/readiness; provider outage, budget/rate limits and costs surface useful redacted diagnostics |
| DATA-01 | Platform | Retention expiry, account deletion during in-flight work, provider cleanup failure/retry and backup restore do not resurrect disallowed data |
| A11Y-01 | Every panel + QA | Keyboard-only and screen-reader common tasks; labels/roles/states, errors, reading order, focus return on every modal exit; no trap |
| A11Y-02 | Every panel + QA | 320/390/430 widths, 200% text, zoom/reflow/text spacing, light/dark, Increase Contrast/Bold Text/Reduce Motion/Reduce Transparency |
| A11Y-03 | Every panel + QA | Physical iPhone VoiceOver, Voice Control, Switch Control and Full Keyboard Access; effective targets >=44×44 pt and usable touch alternatives |
| A11Y-04 | Voice + QA | Same task available without hearing or speech; assess live captions, equivalent typed path and timing for the whole process before AA claim |
| RELEASE-01 | QA | Exact archive privacy manifest, actual SDK/network data flows, microphone explanation, review login, deletion flow, supported-device scope |
| RELEASE-02 | QA | Release build secret scan, dependency triage, signed artifact, production configuration, rollout/rollback and monitoring evidence |

## Whole-product journeys

The independent QA worker owns these after the panel tests pass:

1. Fresh launch → intended voice permission → real agent conversation → interruption → captions → mute → End → confirmed cleanup → subsequent workspace.
2. Typed request → fictional verified person → correct approved context → exact review/authorization → simulated execution → evidence-based result → follow-up retry without redial.
3. Authorized service workflow in a sandbox: connect the intended account → request → validated tool → authorization check → one external effect → provider readback → matching UI/spoken result → revoke → subsequent access denied.
4. Mid-task disconnect/restart/re-authentication → retained draft or readback → no duplicate effect, no cross-owner data, and an understandable recovery path.
5. Repeat the common tasks with keyboard and a screen reader; repeat native-specific cases on the exact iPhone artifact.

Synthetic audio proves the transport and observed states, not natural voice quality, accent robustness or human usability. Evaluate a fixed fictional corpus of at least 20 varied utterances, corrections, ambiguity, interruptions and unavailable-service requests; record model/config/version and pass/fail outcomes, with zero unauthorized effects or invented completion. A human listening evaluation is still required for perceived naturalness and a marketing recording.

## Visual and usability release rubric

Use the user's reference direction and the existing tokens, with one coherent design across all panels. [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) and [motion](https://developer.apple.com/design/human-interface-guidelines/motion) emphasize adaptable interaction and purposeful, optional feedback. Apply [WCAG 2.2](https://www.w3.org/TR/WCAG22/) to complete web processes; palette scores alone do not establish conformance.

Score each panel 1–5 with concrete defects/evidence in: hierarchy, typography/spacing, interaction clarity, state completeness, consistency, accessibility and performance. Require at least 4 in every dimension, no critical usability defect and independent QA agreement before M6. Treat this as an internal review rubric, not an award prediction.

Required evidence: opening + populated + empty + error + active state screenshots in both themes; keyboard/focus walkthrough; enlarged-text rendering; brief interaction recording; no clipped primary actions, placeholder copy or enabled-looking unavailable features. Use actual state/fixtures explicitly labeled. The primary call target should remain comfortably >=52 px/pt when layout permits; all native actions meet the 44 pt effective target floor. Aim for 7:1 body-text contrast while preserving full AA behavior.

Measure performance on a named representative iPhone release build and a stated browser/network profile. Initial project targets: visible feedback within 100 ms after tap, main-thread interaction without >100 ms stalls, useful local opening within 2 seconds after warm launch, stable list scrolling at device refresh target, and no retained session/audio resource growth over 20 start/end cycles. Treat provider time-to-first-audio separately: record 20-run median/p95 and choose a disclosed product budget (initial target p95 <=3 seconds after a completed ordinary utterance). Do not confuse greeting startup latency with response latency. If targets fail, profile, fix and rerun; do not change thresholds merely to turn a report green.

Real users must be able to complete the principal tasks without explanation. Obtain representative usability feedback before claiming ease of use, identify the actual confusing steps and repair them. Do not label an agent self-review as user research.

