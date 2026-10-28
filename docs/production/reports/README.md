# Worker reports

Each worker writes one Markdown report named `<milestone>-<agent>.md` here. Do not include secrets, raw personal transcripts, tokens or real contact details. The orchestrator owns [STATUS.md](STATUS.md).

Use this template:

```text
Agent / milestone / status:
Task and owned files:
Implemented behavior:
Shared contracts changed or requested:
Scenario IDs from the test matrix:
Exact commands, environment, artifact/build identity:
Results: passed / failed / blocked / not run:
Evidence links (sanitized):
Mocked vs real-provider vs browser vs native:
Known defects and reproducible steps:
Dependencies / next action:
Independent reviewer and review result:
```

A passing screenshot is not a passing journey. A blocked credential/device test is not a pass. Summarize failure cause and the smallest missing prerequisite; continue independent work.

