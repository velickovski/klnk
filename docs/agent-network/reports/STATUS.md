# Internal network implementation status

27 October 2026. Work implemented directly in klnk by root and real GPT-6.1 Sol workers. The local network candidate is verified within the documented scopes; production/native release remains blocked. See the [final handoff](FINAL-HANDOFF.md).

| Stage | Current state | Evidence |
| --- | --- | --- |
| I0 contracts/baseline | Implemented | Existing source inspected; missing referenced milestone file supplied from the attached prompt; v1 schemas, migration007/008 and sorted database owner-lock contract frozen before parallel work. TypeScript baseline reproduced. |
| I1 internal delivery | Implemented, local tests passed | Immutable member linkage, invitations/acceptance/block/mute/inbound scope; distinct internal requests and exact information path. [Coordination](coordination.md), [independent QA](qa.md). |
| I2 private background coordination | Implemented, local tests passed | Versioned explicit grants, separately scoped recipient, permitted projections, six-exchange/three-slot/deadline/rate bounds, offline decisions, revocation and expiry. No browser bearer fabricates a recipient actor. |
| I3 internal agreements | Implemented, local concurrency tests passed | Canonical proposal/hash/acceptance receipts; one atomic shared event/reminders/outbox, conflicts/cancellation and recovery. [Calendar](calendar.md); nine separate-process PostgreSQL cases in independent QA. |
| I4 panels/privacy | Implemented; independent browser checks passed | Retained Inbox/Calendar/People/Memory/Settings panels, typed access, explicit preferences, own notifications and hourly shared retention. [Panel report](panels.md), [QA](qa.md). Enlarged navigation and cached source/plan deletion were repaired and independently rechecked. Native/manual accessibility remains open. |
| I5 owner bridge | Implemented; bounded model checks passed | Strict internal voice tools, server-held key, own-current authority guard, durable command/model receipts, exact draft confirmation and actual status. [Voice report](voice.md), [owner intent](owner-intent.md), [two real model calls](../evidence/model-smoke.json). New live audio/native behavior is not verified. |
| I6 candidate | Local candidate verified; production release blocked | 662 default tests passed;20 PostgreSQL checks passed separately;45 Chrome journeys passed; root/mobile/E2E TypeScript and final Expo web export passed. Details and limits in [final handoff](FINAL-HANDOFF.md). |

No telephone, SMS, email, external calendar or marketing delivery is part of the network registry. OpenAI remains a disclosed cloud processor; deterministic agent coordination uses local rules and no separate synthetic phone sessions. Native transport/signing/device, assistive-technology/human evaluation, production onboarding/recovery, dependency triage and operations gates remain distinct. Historical production counts are not treated as new test evidence.
