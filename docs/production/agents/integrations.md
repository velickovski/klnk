# Service integrations and authorized tools agent

**Prerequisites:** Read [04](../04-services-and-tool-tracing.md). M1 validated contracts and applicable M3 durable identity/session/action gates precede tool execution. Contract design and deterministic fixtures may begin earlier.

**Owned files:** `packages/providers/src/index.ts`, `owner-planner.ts`, `readiness.ts`, provider regressions, new service/tool gateway modules under `apps/server/src/integrations/` and dedicated integration tests. Parent owns `app.ts` registration, config, domain/API schemas and manifests; Platform owns engine/storage; Voice owns Live broker. Submit shared patches instead of editing those files.

**Work:** Inventory actual adapters and implement only the agreed service scope. Build server-authorized, schema-validated tools with per-owner credentials, capability checks, idempotency, redacted traces and explicit unavailable outcomes. Complete Google OAuth refresh/revoke and accurate connection states. Treat provider content as untrusted data. Preserve review versions, exact-message authority and immutable execution snapshots. Do not interpret a key, memory, model-generated text or integration connection as permission for arbitrary external writes.

**Tests:** Service/Tool scenarios: valid and malformed arguments, denied scope/owner, expired/revoked credentials, prompt injection, duplicate effects, provider timeout/rate limit, ambiguous completion, refresh races, OAuth state validation and remote revoke. Separate deterministic fixtures from authorized sandbox outcomes and never claim them interchangeable.

**Done/report:** Report actual tool names/status, safe trace artifacts, requested shared patches, command results and unavailable accounts. Connect Live only through approved contracts; no real third-party communication/calendar mutation beyond explicit test scope.
