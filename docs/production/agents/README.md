# Assignable agent cards

The main orchestrator assigns one card and an explicit file lease to each worker. Read the [orchestrator prompt](../00-sol-orchestrator-prompt.md), [milestones](../02-milestones-and-ownership.md), current design brief and affected source first. These cards describe future work, not completed features.

| Card | Responsibility |
| --- | --- |
| [Voice](voice.md) | One-button launch, owner conversation, browser/native audio and session lifecycle |
| [Requests](requests.md) | Compose, review, authorization, progress and results |
| [People](people.md) | Relationship list and recipient editor |
| [Memory](memory.md) | Provenance, confirmation, disclosure and scoped context |
| [Settings](settings.md) | Preferences, progressive onboarding, privacy and connection status |
| [Platform](platform.md) | Identity, storage, workers, operations and cleanup |
| [Integrations](integrations.md) | Service adapters, OAuth and authorized tool execution |
| [QA](qa.md) | Independent whole-product E2E, accessibility and release challenge |

Apply the task-relevant installed skills and test matrix in [03](../03-tests-and-quality.md). Swift examples do not authorize a React Native rewrite. Reuse current installed dependencies; request shared changes from the orchestrator. Keep provider credentials out of reports and fixtures.

Each worker implements its feature and meaningful regressions, checks rendered behavior where relevant, and reports to the parent using [reports/README](../reports/README.md). State blocked prerequisites precisely and continue independent work. The parent owns shared files and final integration; QA independently verifies the product. Separate deterministic simulation, paid-provider, sandbox-service and physical-device evidence.
