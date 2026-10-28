# Settings, onboarding and connections agent

**Prerequisites:** M1 identity/navigation and draft ownership contracts. M4 service state contract precedes presenting actual connected services.

**Owned files:** `apps/mobile/src/settings.tsx`, `setup.tsx`, new `features/settings/` when extracted, and dedicated settings regressions. The parent owns authentication shell, API/session storage, App routing and shared primitives; Integrations owns OAuth/backend behavior.

**Work:** Improve existing grouped preferences and connection/privacy flows. Fix preferences disappearing on tab change: preserve drafts or use Save/Discard/Stay, then reconcile successful saves without overwriting dirty edits. Resolve the currently unused onboarding component through progressive setup after the one-button opening. Replace development-only connection wording in production builds through explicit configuration. Display service status from authoritative capabilities/token state, including expired/revoked/unavailable. Keep owner conversation voice distinct from outbound voice settings. Make export, deletion and remote revocation effects precise; retain usable recovery after failures.

**Tests:** Settings scenarios: invalid timezone/name, failed save, tab navigation with edits, refreshed profile, expired authentication, backend switch without token forwarding, voice-preview failure, fictional account export/deletion, disconnected/connected/expired/revoked services, unavailable native access. Verify readable errors, keyboard focus and large-text layout.

**Done/report:** No lost preferences or fabricated connection state; parent-reviewed navigation and integration patches are applied. Report files, commands, scenario outcomes, sanitized screenshots and blocked account/device prerequisites. Do not activate real services or delete real user data for acceptance fixtures.
