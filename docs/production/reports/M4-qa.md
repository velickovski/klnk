# Independent final Live tool and operations review

27 October 2026. Result: **nine local tests pass** across six independent Live callback/protocol cases and three operator guard/journal cases; `npx tsc --noEmit` passes. This is not final release certification. QA created no paid/provider session and did not use the browser/build ports during this review.

Owned change: [qa-live-tools.test.ts](../../../tests/qa-live-tools.test.ts), this report and [sanitized source-hash evidence](../evidence/qa/m4-live-tools.json). Root/Voice own the integration and repair. Earlier gateway and PostgreSQL checks remain in [M3-qa](M3-qa.md).

## Findings and independent repair result

**P2 / tool budget bypass, repaired:** `expectedResponses` accepted unlimited orphan `session.delegation.created` announcements before any response-created event. The independent 1,000-announcement fixture failed: no budget error was raised. Voice added a cap of 16 outstanding announcements and rejects conflicting/duplicate response correlations. The same test now passes; it invokes no gateway or effect. This was an actual failed regression, not an inferred release claim.

Five additional independent tests exercise the actual application/broker/gateway wiring with mocked provider creation and sideband sockets:

- Another owner's grant cannot enable the current owner; browser-provided tools/tenant context are rejected before provider creation.
- Grant revocation before a finished function callback closes the same session and creates no lookup or result output.
- Revocation after gateway execution suppresses the result and continuation rather than disclosing now-revoked output.
- Explicit closure waits for a started callback, suppresses late output and prevents the next queued callback.
- An oversized function batch closes before any callback.

The integration preserves fixed server owner/session/receipt/controller binding, strict argument/tool allowlists, immutable request authority and disabled external effects. Application data stays distinct from instructions. Model-completed work is not reported as heard speech. No concrete remaining authority bypass was found in the exercised paths; this is bounded evidence, not a proof against every possible input or race.

Current official [Live delegation documentation](https://developers.openai.com/api/docs/guides/live-delegation) was fetched before the protocol review. The implementation uses nested completed function items, correlates calls to response/delegation identity, sends matching result items and explicitly continues the backend. The documentation distinguishes backend completion from spoken delivery and provides no separate result-item success acknowledgement. No model or protocol configuration was changed by QA.

Actual commands:

```powershell
npx vitest run tests/qa-live-tools.test.ts
npx vitest run tests/qa-live-tools.test.ts tests/operations-rehearsal.test.ts
npx tsc --noEmit
```

The first run had 5 pass/1 fail, the repaired combined run had 9 pass/0 fail. Two implicit-this annotations in QA spy implementations were corrected without changing assertions; the subsequent typecheck passed.

## Smoke evidence review

QA reviewed the synthetic-speech fixture and diagnostic source without running a paid test. The fixture adds leading silence to preserve its fictional request during capture/SDP setup. The diagnostic requires configured lookup-only tools, a matching successful application lookup, observed function-call activity, locally forwarded result and backend continuation, a later caption, one provider creation and terminal closure. An absent tool fails the run. Fixed booleans/counters/statuses are persisted; bounded transcript text stays in process memory and is not copied into reports.

The review identified that gateway return alone did not establish forwarding; Root added trusted socket-send instrumentation and labels the later caption as temporal evidence. Root was also asked to count sends only after the underlying send invocation does not throw. The selected English completion-claim regex is a narrow check; `semanticSpokenResultVerified:false` correctly avoids claiming meaning, naturalness, human hearing or full truthfulness evaluation. Actual paid-attempt results and closure reconciliation belong to Root's evidence, not these local QA passes.

## M6 operations review

QA inspected `operations-rehearsal.ts`, its three tests, the [M6 report](M6-operations.md), the [runbook](../operations.md) and recorded 17-assertion evidence. The independently rerun guard/journal tests pass. QA did **not** independently rerun the entire 17-case CLI during this pass.

The source guards the loopback endpoint and allocated random database names, uses argument arrays and hidden subprocesses with a small environment allowlist, withholds raw utility diagnostics, restores into offline quarantine, requires independent tombstones to suppress post-snapshot deletion, fences restored auth/worker/controller authority and cleans only the databases/temp directory it allocated. Recorded evidence has 17 true assertions and zero remaining rehearsal databases. The report accurately leaves physical/WAL/PITR, remote failover, prior-artifact rollback, traffic switching, operator drills, least-privilege deployment roles, monitoring and continuous journal durability unrun. No new code blocker was found in this bounded source/evidence review.

Remaining release gates include final integrated browser/tool-permission and client-recovery verification, exact signed iPhone transport/audio/accessibility/performance, manual web assistive-technology/common-task evaluation, real authorized service sandbox writes/readback/revoke, human usability/voice quality, and the unrun production operating drills. Root owns the final acceptance and rollout decision.
