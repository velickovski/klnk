# Codebase review — 2026-10-28

The 2026-10-28 review covers the whole codebase. Five reviewer agents worked in parallel under one orchestrator, and no source files were changed. Each report cites file:line evidence.

| Report | Scope |
| --- | --- |
| [00-sol-improvement-prompt.md](00-sol-improvement-prompt.md) | **Prompt ready to paste into Sol / Codex** (milestones M0–M5) |
| [review-functionality.md](review-functionality.md) | Product coherence, user journeys, docs vs code |
| [review-backend.md](review-backend.md) | Server architecture, concurrency, data model, confirmed bugs |
| [review-frontend.md](review-frontend.md) | Mobile architecture, design system, UX, accessibility |
| [review-security.md](review-security.md) | Auth, authorization, OAuth, prompt injection, deployment |
| [review-quality.md](review-quality.md) | Build/test baseline results, CI, tooling, repo hygiene |

## Headline findings
1. **Call klnk cannot work for a real user.** The Live routes are localhost-only and disabled in production. On a native iPhone the only opening button always errors.
2. **New users get stuck before their first message.** Even a plain message needs mutual trust plus an exact topic-string match in both members' policies. Members connect by swapping opaque codes. There is no password reset, email verification, or account delete/export in the network UI.
3. **Confirmed backend bugs:**
   - The standalone worker lacks the Google revoke and retention hooks.
   - The rate limiter keys on IP only, because it runs before auth, and it breaks behind a proxy.
   - One bad task silently stalls the worker queues.
4. **Security:** the Google OAuth callback can bind a victim's calendar to an attacker's account. Unbounded peer display names reach the owner's tool-calling model.
5. **Two products in one bundle:** legacy telephone/missions and the agent network. The docs contradict each other.
6. **CI is red** on `npm audit` (zod nested in `@expo/cli`). There is no lint or formatter, the source is hand-minified, and there is no deploy path. Locally the gates pass: 662 unit tests and 45 e2e tests, plus typecheck and demo.
