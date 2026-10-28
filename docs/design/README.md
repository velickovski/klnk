# klnk UI and UX handoff

**Status, 27 October 2026: browser demo and shared Expo workspace design implemented; real synthetic-audio/browser OpenAI checks passed. Native iPhone and full production acceptance remain open.** Read [the current brief](00-current-brief.md) first: the user chose a navy, pale lavender and coral design with one opening Call klnk button. Continue production work through [the multi-agent Sol handoff](../production/README.md), with [actual test evidence](../production/05-evidence.md).

Build a calm, futuristic personal representative: an interface with the restraint, hierarchy, familiar interaction and accessibility expected of an excellent iPhone app. This is an original klnk design informed by Apple's public guidance, not an Apple product or a claim to reproduce Apple's private process.

“AAA” has two meanings here: an ambitious level of craft, and specific accessibility criteria. Pursue both. WCAG 2.2 AA is the web release baseline; target AAA text contrast and stronger interaction requirements where feasible. Full AAA conformance is not promised. Native iOS requires its own assistive-technology validation.

## File structure and reading order

```text
AGENTS.md                              Repository working rules
README.md                              Existing setup and product overview
docs/
  README.md                            Navigation across existing documentation
  design/
    README.md                          This entry point and scope
    00-current-brief.md                 Latest reference and one-button scope
    01-product-and-direction.md        Product promise and visual intent
    02-experience-and-navigation.md    Journeys, authority and state behavior
    03-design-system.md                Tokens, layout, components and motion
    04-screen-specifications.md        Concrete layouts and recovery states
    05-accessibility-and-quality.md    Accessibility criteria and release evidence
    06-implementation-plan.md          File map, staged tasks and verification
    07-sol-build-prompt.md             Copyable implementation instruction
    08-sources-and-decisions.md        Official references and decision record
    09-live-demo.md                    Setup, recording and live verification
    10-validation.md                   Actual test results and remaining gaps
    preview/
      ASSETS.md                       Generated artwork and exact prompt
      klnk-demo.png                    Browser screenshot, setup state
apps/voice-demo/                       Implemented browser demo and artwork
```

Read 00 first, then relevant sections of 01–05; execute 06. Use 07 as the next agent's opening prompt. Consult 08 for decisions, 09 for recording, and [10](10-validation.md) for actual validation. Each concern has one owning document: avoid repeating token values, acceptance rules or API definitions elsewhere.

## What to review

Run `npm run demo:voice` and open [the one-button demo](http://localhost:4100/demo). Its code lives in `apps/voice-demo/`. The opening design can be reviewed before adding a key. Connecting requires an OpenAI API key and microphone permission. The existing Expo text workspace is a separate alternative. Follow [demo setup](09-live-demo.md).

The Markdown screen specifications also cover the advanced workspace. They do not authorize adding more buttons to the one-button opening. Runtime contracts govern behavior. If a visual specification conflicts with supported behavior, preserve the supported behavior and record the gap.

## Scope

- Redesign the existing Expo client and its web preview; keep the server and eight mission kinds intact.
- Keep Home, People, Memory and Settings in the separate advanced Expo workspace. The new demo opens directly on its single call action.
- Add a reactive theme system, consistent components, clear status and recovery, and accessible motion.
- Keep operating-mode, evidence and authorization distinctions visible.
- Treat native glass as an optional, verified platform enhancement. The opaque design is a complete first release.

The user subsequently authorized a real OpenAI owner-to-agent voice demo and original imagery. Third-party calling, a SwiftUI rewrite, production deployment and publication remain outside this scope. No marketing message is sent by this work.
