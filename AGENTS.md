# Working on klnk

klnk is an iPhone-first personal voice agent built with React Native and Expo. Keep the existing TypeScript server and shared domain contracts.

## Start here

Read [README.md](README.md), [the documentation map](docs/README.md), and [the current design brief](docs/design/00-current-brief.md). The user-selected one-button live demo takes precedence over earlier full-workspace concepts. For further UI work, follow [the implementation plan](docs/design/06-implementation-plan.md). The ready-to-use implementation prompt is [here](docs/design/07-sol-build-prompt.md).

## Working rules

- For production implementation, use [the multi-agent handoff](docs/production/README.md) and [orchestrator prompt](docs/production/00-sol-orchestrator-prompt.md). Follow its file ownership and milestone gates; it extends the earlier visual plan without enabling tools or deployment automatically.

- Inspect the actual files before editing. The design package describes the target UI; it does not mean the target is already implemented.
- Server schemas, capability responses, authorization checks and persisted state govern behavior. If an older document disagrees with code, preserve the working contract and record the discrepancy.
- Keep simulation visibly labeled. Never invent call progress, transcripts, outcomes, verified agreements or enabled integrations to match a mockup.
- Preserve exact-message voice delegation and full typed access. Keep microphone capture distinct from telephone execution and spoken playback.
- Do not change calling gates, provider configuration, credentials, retention or external resources as part of visual work. Tests and previews use fictional fixtures and local simulation.
- Make small, verifiable changes. Reuse installed dependencies; verify compatibility before adding a package. React Native views do not automatically gain native Liquid Glass by changing colors.
- Use semantic design tokens and shared components. Do not add another global mutable theme object or duplicate presentation logic across screens.
- After code changes, run the appropriate checks in the implementation plan. For documentation-only edits, validate links and consistency. Report checks actually run and any device verification still needed.
- Update the design decision record when an implemented design choice changes. Update existing progress/acceptance documents with evidence, not aspirational claims.

The UI may aspire to WCAG AAA, but AA is the release baseline for the web surface. Apply corresponding accessibility practices to native iOS and validate on a device. Do not claim conformance from colors or screenshots alone.
