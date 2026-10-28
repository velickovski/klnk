# Owner utterance corpus — M5 preparation

Agent / milestone / status: Settings/QA preparation worker / M5 / fixed local text/domain corpus implemented and final run passed; real voice, listening and native gates remain unverified.

Task and owned files:

- [Fixed 20 corpus and actual API runner](../../../scripts/owner-utterance-corpus.ts).
- [Sanitized evaluation metadata](../evidence/owner-utterance-corpus.json).
- [Corpus regressions](../../../tests/owner-utterance-corpus.test.ts).
- This report. This worker made no UI, application behavior, provider, configuration or external resource changes.

Implemented behavior:

- Exactly 20 fixed fictional target utterances cover exact messages, polite prefix, a direct question, relative timing, ambiguous names, recipient clarification, number correction/readback, a missing recipient, private clauses, a consequential commitment, negation, unavailable Calendar/messages, stop/cancel, clear chat, end-conversation intent, playback-interruption intent and actual simulated status.
- The runner invokes the real authenticated `/voice/turn` API and VoiceService/domain/Engine code against disposable in-memory PostgreSQL fixtures. Each target has its own fictional owner/account and virtual client address. Setup turns establish the required conversation state; they are not extra scored utterances.
- All provider keys/configuration are explicitly absent, live calling is false, the worker is disabled, no HTTP listener is opened, and a fetch guard rejects/counts any attempted external request.
- Checks actual response status, persisted mission count/state, owner/recipient-bound bounded authorization, exact-message preservation, relative timing anchored to the original instruction, no accidental contact/memory/calendar/integration/follow-up change, simulator-only attempts, no provider audio, preserved prior authority and clear-chat effect receipts.
- Supported exact-message instructions remain one-step authorized simulator requests. The corpus does not require a universal review form or change this existing path.
- Metadata contains case IDs/tags, expected/actual statuses, structural checks/counts, configuration scope and source hashes. It excludes raw utterances, replies, transcripts, account/session identifiers, tokens, passwords and provider payloads. Fictional target wording lives in the source corpus for later fixture generation/listening use.
- A finding causes the CLI to return exit1. The test suite does not convert generic fallback help into successful unavailable-service or audio-control handling.

Findings first / observed progression:

1. The first run observed 15 passes and 5 findings, with zero safety failures/network attempts. Four were real functional-feedback gaps. The fifth was a fixture issue: the final status sample's explicit Engine drain first consumed earlier fixture owners' queued work.
2. The fixture cleanup was corrected to cancel residual fictional queued work **after each target's observations**, outside the scored utterance. This isolated the completion sample without changing app behavior. Corrected baseline: **16 passed / 4 findings**, all safety checks passed.
3. OC-13 (Calendar), OC-14 (messages), OC-18 (end conversation) and OC-19 (stop speaking) initially received generic call help. They created no unauthorized effect, but did not acknowledge the unavailable service or relevant controls. Parent was notified before any application repair.
4. Parent owned and implemented `voice.ts` feedback changes. Calendar/messages now explain unavailability outside exact-call requests; conversation/audio intents point to actual controls without claiming capture/playback ended or cancelling a separately authorized request.
5. The first post-fix run was 19/20 because the acknowledgement grader omitted the word “voice” from its conversation-control vocabulary. The actual reply already gave End call guidance. The grader was corrected to accept voice/capture/playback concepts while still rejecting generic “say call…or stop” help. Target utterances, expected statuses and all authority/effect assertions stayed unchanged.
6. Final actual run: **20/20 passed; 0 findings; 0 safety failures; 0 network attempts**.

Shared contracts changed or requested:

- None changed by this worker. The four observed feedback gaps were sent to the parent; the parent alone edited application behavior.
- A recorded-turn text request cannot stop OpenAI Live microphone capture or audio playback. End/stop-speaking responses only explain the actual End call / Stop playback controls and preserve separate request authority. The result does not claim spoken barge-in or transport termination support.

Scenario IDs / result:

| Group | Corpus cases and evidence |
| --- | --- |
| REQ-01 | OC-01–04/06: exact messages/questions automatically queue one bounded authorized fictional request; relative time becomes explicit without changing the saved original instruction. |
| REQ-02 / PEOPLE-01 | OC-05–08: ambiguity/readback/missing person do not create authority or silently change a contact. Explicit full-name clarification selects the intended fictional recipient. |
| TOOL-02 / authority | OC-09–12: private clauses, sensitive information, commitments and negated calls create no mission or external effect. |
| TOOL-04 / unavailable services | OC-13–14: explicit local unavailability feedback; no Calendar or messaging action is created. |
| REQ-04 / DATA-01 | OC-15–17: stop/cancel changes queued request state; clear chat preserves saved memories, separate queued authority and durable effect receipts. |
| VOICE-03/06 intent preparation | OC-18–19: control intent is acknowledged in text; no actual audio/microphone interruption was exercised. |
| REQ-05 / truthful results | OC-20: actual simulator execution yields one simulator attempt and an explicitly simulated report. |

Exact commands / environment / artifact identity:

- Windows, installed Node, local PGlite in-memory database, authenticated API injection only. No provider model/planner/speech service is configured for this run.
- `npx tsx scripts/owner-utterance-corpus.ts` — final exit 0; 20 passed, 0 findings, 0 safety failures, 0 network attempts. Earlier exit 1 findings are described above rather than suppressed.
- `npx vitest run tests/owner-utterance-corpus.test.ts tests/voice-planning.test.ts` — **26 tests passed** after the parent feedback repair; root and mobile typechecks also passed with `npm run typecheck`.
- `npx vitest run tests/owner-utterance-corpus.test.ts` — final **7 passed**, tool timestamp 16:24:07, 27 October 2026.
- Final metadata `evaluatedAt`: **2026-10-27T15:24:06.066Z**; corpus version **owner-text-domain-v1**. [Metadata](../evidence/owner-utterance-corpus.json) includes exact SHA-256 identities for `voice.ts`, domain `core.ts` and `engine.ts`.
- `voice.ts` final observed SHA-256: `254df4e65a762cc1bcec4df6d9db31a979c90c72da9fa696fffa72dea014b9a8`.

Mocked vs real-provider vs browser vs native:

- Actual local application/API/domain routing and durable simulator records were exercised; target text and accounts are fictional fixtures.
- No model output, ASR, speech synthesis, OpenAI Live, provider delegation, browser microphone, physical device, native transport or human listening was evaluated. No new paid-provider or external HTTP test ran.
- No 20-run conversational latency, p95, accent score, perceived naturalness score or native accessibility claim is produced. Test-run duration is not voice latency evidence.

Use for later real voice/listening preparation:

- Import `OWNER_UTTERANCE_CORPUS` to obtain the 20 fixed target strings and intent tags; establish each source-defined setup before replaying its target. Preserve IDs to correlate later ASR, routing, transport and human observations separately.
- The legacy recorded-turn exact-message API may authorize a bounded simulator request directly. The OpenAI Live in-app gateway initially prepares drafts through a different permission/review contract. Do not copy these queue-status expectations into a Live tool evaluation without documenting that contract difference.
- No optional Windows SAPI audio batch was generated in this task. A later offline synthesis pass can use the fixed fictional strings; generated speech is still not representative human naturalness or native-microphone evidence.

Known limits / next action:

- The corpus is a fixed English fixture set with deterministic routing assertions, not a broad language or accessibility evaluation. Word variation, actual ASR errors, accents, real interruptions and human usability remain unverified.
- Feedback grading checks for intent/control concepts; it is not a model-based judgment of response meaning or conversational quality.
- Parent independently reviews the corpus and metadata, then uses separately authorized real voice/sandbox/device tests with truthful source-specific outcomes. This local pass does not close the production voice or M5 acceptance gates.

Independent reviewer and review result: parent received initial findings and owns the application repair; independent final corpus/release acceptance remains pending.
