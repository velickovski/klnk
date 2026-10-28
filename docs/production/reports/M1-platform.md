# Platform / M1 / implemented; parent integration pending

Task and owned files: `apps/mobile/src/api.ts`, new `api-contracts.ts`, `apps/mobile/test/connection.test.ts`, new `apps/mobile/test/api-lifecycle.test.ts`, new `tests/api-lifecycle-server.test.ts` (explicitly transferred out of mobile tests), and this report. No server runtime, domain, package, credentials, provider configuration or calling-gate edits.

Implemented behavior:

- Identity epochs invalidate pending HTTP requests on same-origin account changes as well as origin changes. Acceptance is guarded after both fetch and asynchronous JSON decoding. A stale success cannot reach the caller; a stale 401 cannot revoke the current account.
- `getSessionSnapshot()` / `isSessionCurrent(snapshot)` let the shell protect post-request UI work. The parent owns shell guards and component lifetime; Voice owns audio lifetime.
- SecureStore operations are serialized. Credentials are published only after native persistence succeeds. A late restore/save cannot override a newer sign-in. Logout first writes a null-token tombstone, then deletes the record. Storage errors are sanitized and disable restoration for the current runtime.
- Successful responses are checked against endpoint contracts before reaching consumers. Invalid JSON, missing tokens, incorrect domain shapes and silently defaulted required fields are rejected with `invalid_response`; mutation recovery copy points to the existing receipt rather than automatic replay. Unknown fields are preserved.
- Actual server shapes remain supported: fresh templates have no recipient, and reports have an empty voice-session ID. These exceptions apply to their specific response contracts.

Shared contracts requested: parent adopts exported identity snapshots for authentication, bootstrap, detail refresh and component scope; parent repairs Metro resolution now that domain schemas have a runtime mobile import. API public call signature remains compatible. Session listeners receive immediate null invalidation, then the successfully persisted credential.

Scenario IDs: AUTH-01, AUTH-02, AUTH-03, NET-01, NET-02.

Commands actually run on Windows / Node v24.15.0, 27 October 2026:

```powershell
npm exec -- vitest run tests/storage.test.ts tests/api.test.ts tests/engine.test.ts
npm exec -- vitest run tests/api-lifecycle-server.test.ts apps/mobile/test/api-lifecycle.test.ts apps/mobile/test/connection.test.ts
npm run typecheck
```

Results: initial storage/API/engine audit baseline **26 tests passed in 3 files**. Final API lifetime/connection/actual local-server contract checks **36 tests passed in 3 files**. Final root and mobile typecheck **passed**. Earlier test iterations found and fixed a fixture mutation and a report-shape mismatch; the server contract test was moved outside the mobile TypeScript project to avoid importing Node server compilation into Expo's type environment.

Evidence: deterministic tests named above are executable evidence. The server contract test explicitly constructs a credential-free simulator configuration and an isolated in-memory database; it covers registration, empty bootstrap, settings, export, health, request creation/authorization/simulated completion, reports and turn receipts. No network provider session, microphone, real calendar or telephone call was used. No screenshots or device evidence were produced by Platform.

Limitations and open gates:

- These checks do not establish native Keychain behavior, device lifecycle or whole-product accessibility. Physical iPhone verification remains required.
- If every SecureStore mutation fails, this process can prevent credential use and restoration but cannot prove that inaccessible platform storage was erased across an abrupt process loss. The error does not claim durable deletion; successful tombstone/delete and server revocation are the recovery paths. The parent must retain this failure as an explicit release limitation until device/operational policy is assessed.
- Server account recovery, device-session management, production migrations, worker renewal/fencing, durable Live receipt storage and restore remain M3 work; none was edited in this lease.
- Parent App guards and browser export must pass before M1 is closed. Parent performs independent review and full-suite rerun; worker does not certify release.

Skills applied: [authentication](C:/Users/andre/.codex/skills/authentication/SKILL.md), [ios-networking](C:/Users/andre/.codex/skills/ios-networking/SKILL.md), [swift-security](C:/Users/andre/.codex/skills/swift-security/SKILL.md). Their boundary validation, cancellation, server identity and credential error principles were translated into the existing Expo/TypeScript architecture.

Reference files: security [credential storage patterns](C:/Users/andre/.codex/skills/swift-security/references/credential-storage-patterns.md) for cleanup and failure handling, [security testing](C:/Users/andre/.codex/skills/swift-security/references/testing-security-code.md) for mocked-vs-device evidence. No Swift framework or dependency was added.
