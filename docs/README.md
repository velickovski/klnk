# klnk documentation

The application is implemented; the new visual direction is specified separately under `design/`. Start with the relevant group rather than reading every file on every task.

| Purpose | Documents |
| --- | --- |
| Build/use the current internal agent network | [Network contract](agent-network/01-product-contract.md), [milestones](agent-network/02-milestones-tests.md), [walkthrough](agent-network/04-walkthrough.md), [current evidence](agent-network/reports/STATUS.md) |
| Build the production application with agents | [Production handoff](production/README.md), [Sol orchestrator prompt](production/00-sol-orchestrator-prompt.md), [milestones](production/02-milestones-and-ownership.md), [actual live evidence](production/05-evidence.md) |
| Build the new interface | [Design entry point](design/README.md), [implementation stages](design/06-implementation-plan.md), [6.1 Sol prompt](design/07-sol-build-prompt.md) |
| Record a real voice demo | [Current one-button brief](design/00-current-brief.md), [OpenAI demo setup and recording](design/09-live-demo.md), [generated artwork](design/preview/ASSETS.md) |
| Understand behavior | [Architecture](ARCHITECTURE.md), [API](API.md), [capabilities](CAPABILITIES.md), [domain model](../packages/domain/README.md) |
| Run and connect | [Project README](../README.md), [iPhone setup](IPHONE_SETUP.md), [providers](PROVIDERS.md), [live provider setup](LIVE_PROVIDER_SETUP.md) |
| Assess current evidence | [Acceptance](ACCEPTANCE.md), [local validation](LOCAL_VALIDATION.md), [progress](PROGRESS.md), [live test plan](LIVE_TEST_PLAN.md) |
| Security and platform work | [Security](SECURITY.md), [iOS skills](IOS_SKILLS.md) |

Keep operational documentation at its existing paths so references remain valid. Put visual specifications in `design/`, design reference assets in `design/preview/`, and actual application code in `apps/mobile/`. Do not turn preview fixtures into production data.

Documentation discrepancy identified on 2026-10-26: architecture prose mentions general schema limits of 600 seconds and two retries. Current live-pilot code and bootstrap constrain calls to 180 seconds and zero retries. Read the returned limits and server checks; never hardcode either set of numbers into a UI based on prose.
