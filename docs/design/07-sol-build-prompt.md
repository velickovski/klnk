# Prompt for GPT-6.1 Sol

For the user's subsequent production-readiness request, use the newer [multi-agent orchestrator prompt](../production/00-sol-orchestrator-prompt.md). This document retains the earlier visual-only implementation scope.

Copy the following into a new implementation chat in this project. It describes the final direction rather than the earlier multi-screen concept.

```text
Continue implementing klnk from its actual current files.

Read AGENTS.md, README.md, docs/design/00-current-brief.md and
docs/design/README.md first. Follow docs/design/06-implementation-plan.md.
Inspect the implementation before deciding what remains.

The selected design is inspired by the user's navy, pale lavender and coral
mobile reference: sweeping asymmetric corners, system typography, generous
spacing, original sculptural artwork, and exactly one visible opening action,
"Call klnk". Do not add navigation tabs, a dashboard, scenario switches,
onboarding forms or competing opening buttons to the demo.

The browser demo at /demo must connect to a real OpenAI GPT-Live 1 conversation
using the documented API. Verify current official documentation before changing
the transport/model. Keep the API key server-side. Use an available documented
voice. Do not silently replace a failed live session with simulated audio or
fixture replies. Handle microphone denial, captions/text access, interruption,
mute, End, failure and cleanup. The demo talks to the user; it has no authority
or tools to call third parties, edit calendars or execute existing missions.

Use apps/voice-demo/ as the visual starting point. Preserve existing Expo,
server and domain behavior. The four-tab Expo workspace is a separate advanced
experience; its screens and constraints are specified in documents 01–05.
Do not rewrite the app in SwiftUI or change provider gates to achieve a mockup.

Work in small stages and finish each with relevant verification. Preserve
request identities, reviewVersion checks, capability gating, source labels,
uncertain results and follow-up-only retries. Improve the UI without weakening
these behaviors. Use shared semantic tokens and reactive theming.

Target excellent craft and AAA contrast, with complete WCAG 2.2 AA as the web
baseline. One-button simplicity must remain keyboard and screen-reader usable.
Do not claim AAA compliance from color ratios. Verify reflow, focus, large text,
motion alternatives and the voice/text process; record unresolved criteria.

Run typecheck and the appropriate tests after code changes. Check the browser
demo at phone and desktop widths; after Expo changes also export web. Separate
mocked transport evidence from a live test. If a key is missing, ask the user to
configure OPENAI_API_KEY privately in local .env, never to paste it into chat.
Do all independent work while waiting. Keep native iPhone verification explicit.

Update the design decisions and acceptance evidence as changes land. Return
what changed, actual checks, the demo URL, and any remaining live/device gap.
Do not deploy or send the recording to anyone.
```
