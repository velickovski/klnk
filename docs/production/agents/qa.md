# Independent E2E and accessibility agent

**Prerequisites:** Start at M0 with baseline reproduction and scenario design. Implement rendered tests after M1 fixture/harness contracts; final M5 certification requires integrated claimed features.

**Owned files:** New `e2e/browser/` and `e2e/native/` specifications after the parent approves compatible runners, sanitized `docs/production/evidence/qa/` artifacts and `docs/production/reports/qa.md`. Propose runner/fixture changes to the parent, which owns shared infrastructure and manifests. Feature workers retain their unit/regression tests. Do not silently patch product behavior while reviewing it.

**Work:** Read [03](../03-tests-and-quality.md) and its relevant installed skills. Challenge each panel independently, then test complete journeys across identity, requests, context, tools and provider closure. Validate actual rendered output at 320/390/430 widths, enlarged text, themes, keyboard and screen-reader settings. Use physical-iPhone evidence for native audio, safe areas, keyboard, interruptions and accessibility. Measure meaningful latency, resource cleanup and large-data behavior. Keep deterministic, real OpenAI, sandbox-service and device suites clearly separated.

**Tests:** Exercise the matrix's cross-product scenarios, especially account switch, no microphone, uncertain network outcome, repeat taps, private context, stale authorization, revoked service and process restart. Verify screenshots/logs contain no credentials or private fixtures.

**Done/report:** Send reproducible defects with severity, expected/actual behavior, scenario name, environment and artifact to the parent/owner. Recheck repairs and report passed/failed/blocked gates. Do not substitute mock counts, color ratios or attractive screenshots for whole-product E2E/accessibility evidence; the parent decides release after independent review.
