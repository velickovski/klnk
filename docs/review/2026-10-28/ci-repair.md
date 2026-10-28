# M0 CI environment repair

The first remote improvement run passed clean npm installation, lint, formatting, TypeScript and the default unit suite, then failed credential-clock's preflight assertion: PostgreSQL inside Docker reports its bridge address although the client URL is loopback. This assertion did not represent the fixture's trust boundary.

The fixture still requires the explicitly approved loopback client URL and dedicated klnk_qa database. It now validates the backend's reported IP/port without requiring the backend to share the host endpoint. No application security guard was relaxed.

A clean isolated Windows checkout additionally exposed two reproducibility issues: global Git CRLF checkout conflicted with Prettier's default LF rule, and E2E fixture startup inherited missing NODE_ENV as production. The formatter now preserves the checked-out file's line-ending convention; the disposable E2E fixture supplies explicit test configuration and never inherits provider credentials.

Executed from an isolated checkout of 14e706c plus this repair, with its own npm ci dependency installation:

- Root/mobile and E2E TypeScript checks passed.
- Lint passed; formatting passed after the explicit line-ending setting.
- Default suite: 711 passed, 22 opt-in tests skipped, zero failures.
- Actual PostgreSQL: 22/22 passed through test:pg using isolated namespaces in the dedicated disposable fixture.
- Expo E2E export: 432 modules, bundle index-389ef79486d6d19ea3ec1bdf87dc3639.js.
- Browser: 45/45 passed, zero retries. No NODE_ENV file was supplied to the isolated E2E fixture.
- Legacy demonstration passed with explicit simulation-only fixture configuration.
- npm audit --audit-level=high passed; seven low findings remain.

Remote CI remains a separate post-push observation. No paid provider, native iPhone, real microphone, deployment or external delivery was tested.
