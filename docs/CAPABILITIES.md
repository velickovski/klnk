# klnk network capabilities

| Capability | Implemented boundary |
| --- | --- |
| Owner conversation | Authenticated browser GPT-Live broker; server key, recovery and caps. Availability depends on credentials/model access/microphone. |
| Native voice | Foreground recorded input, OpenAI transcription, exact-term review and device speech. Not verified on a physical iPhone. Continuous native Live remains unavailable. |
| Member connections | Share/deep links, explicit acceptance, decline/re-invite, mute/unmute, block/unblock and removal. No address-book import. |
| Messages | Accepted members can exchange plain inform requests by default, with current delivery opt-outs respected. |
| Questions | Scoped automatic memory answers or authenticated recipient human answers. |
| Meetings | Versioned proposals, counterproposals, separate approvals and one canonical internal calendar event visible to both owners. |
| Availability | Private manual busy blocks and explicitly maintained availability; no external calendar sync or free/busy claim. |
| Memory | Owner-managed facts, confirmation and disclosure scopes; no invented source/provenance. |
| Freshness | Shared query cache, mutation invalidation, foreground refresh, active polling, linked notices and unread counts. |
| Native local reminders | Explicit device opt-in; silent generic local alerts for synchronized canonical reminders, quiet controls and session cleanup. No physical delivery verification or APNs. |
| Accounts | Generic registration, optional SMTP verification/reset, email/password changes, session revocation/idle expiry and reauthenticated export/delete. Delivery is off until configured. |
| External effects | Telephone, SMS, email to peers, external calendar writes and APNs are not enabled. Account SMTP is separate and opt-in. |

The opening remains exactly one Call klnk action. Account forms and controls appear only on subsequent screens; typed access remains available. Browser Live inform/ask tools currently require Inbox review rather than accepting model confirmation as authority. Native recorded turns have a separate authenticated spoken confirmation path.

Evidence from deterministic local HTTP, browser, component and PostgreSQL tests must not be described as real OpenAI, native audio, assistive-technology or physical-device evidence. [Review status](review/2026-10-28/STATUS.md) and [operations](OPERATIONS.md) list actual checks and release blockers. No WCAG conformance is claimed from token contrast alone.

Earlier telephone/mission capabilities and Apple-platform research are preserved as [historical documentation](legacy/capabilities-telephone.md). Their presence does not enable those adapters in the default network product.
