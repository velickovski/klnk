import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ApplicationToolArguments, ApplicationToolNameSchema } from '../packages/domain/src/index.js';
import { Database } from '../apps/server/src/db.js';
import { Engine } from '../apps/server/src/engine.js';
import type { Config } from '../apps/server/src/config.js';
import { createSession, hashToken, newUser } from '../apps/server/src/auth.js';
import { LiveSessionStore } from '../apps/server/src/live-session-store.js';
import { ApplicationToolGateway } from '../apps/server/src/integrations/gateway.js';
import { toolRequestId, type ToolActorContext, type ToolOutcome } from '../apps/server/src/integrations/tool-contract.js';
import { seedOwner } from '../apps/server/src/seed.js';

// Explicit credential-free configuration. This does not load the application's environment.
const config: Config = { production: false, port: 4000, host: '127.0.0.1', databaseUrl: undefined, dataDir: 'memory://', key: undefined, demoEnabled: true, openaiKey: undefined, provider: 'simulator', liveEnabled: false, liveOwnerId: undefined, publicBaseUrl: undefined, recipients: [], origins: [], embeddedWorker: false, elevenKey: undefined, agentId: undefined, phoneId: undefined, webhookSecret: undefined, twilioSid: undefined, twilioToken: undefined, standardVoice: undefined, retentionVerified: false, llmProvider: undefined, retentionDisclosure: undefined, ownerAgentId: undefined, googleClientId: undefined, googleClientSecret: undefined, googleRedirectUri: undefined };
const db = await new Database({ dataDir: 'memory://' }).open();
try {
  const user = await newUser(db,'tools-smoke@example.invalid','A fictional application tool password'); const session = await createSession(db,user.id);
  const engine = new Engine(db,config); await seedOwner(engine.repo,user.id,'Fictional Tool Owner',true);
  const contact = (await engine.repo.list<any>(user.id,'contact'))[0]; const live = new LiveSessionStore(db);
  let { receipt } = await live.reserve(user.id,randomUUID()); receipt = await live.attachProvider(user.id,receipt.id,receipt.version,'fictional-tool-smoke-provider');
  const gateway = new ApplicationToolGateway(engine,live), context: ToolActorContext = { ownerId: user.id, liveReceiptId: receipt.id, authSessionHash: hashToken(session), callId: 'fictional-success-call' };
  const grant = { id: `tool-access:${user.id}`, ownerId: user.id, version: 1, enabled: true, tools: [...ApplicationToolNameSchema.options], updatedAt: new Date().toISOString() };
  await engine.repo.put(user.id,'tool_access',grant);
  const privateFixture = 'Fictional confidential fixture content';
  const success = await gateway.invoke(context,'request_prepare',JSON.stringify({ contactId: contact.id, title: 'Fictional review draft', goal: privateFixture, statements: ['Fictional approved message'], privateFacts: ['fictional-secret-shaped-note'] }));
  assert.equal(success.status,'proposed');
  const draft = await engine.repo.get<any>(user.id,'mission',success.data!.missionId as string); assert.equal(draft.status,'draft'); assert.equal(draft.authorization,undefined);
  await engine.repo.put(user.id,'tool_access',{ ...grant, enabled: false });
  const deniedContext = { ...context, callId: 'fictional-denied-call' }, denied = await gateway.invoke(deniedContext,'request_dispatch',JSON.stringify({ missionId: draft.id })); assert.equal(denied.status,'blocked');
  await engine.repo.put(user.id,'tool_access',grant);
  const unknownContext = { ...context, callId: 'fictional-unknown-call' }, requestId = toolRequestId(unknownContext), args = ApplicationToolArguments.contacts_lookup.parse({ query: '', limit: 1 });
  await engine.repo.put(user.id,'tool_receipt',{ id: `tool-receipt:${requestId}`, schemaVersion: 1, requestId, toolName: 'contacts_lookup', liveReceiptId: receipt.id, callId: unknownContext.callId, status: 'running', argumentDigest: db.keyedDigest('tool-arguments',JSON.stringify([requestId,'contacts_lookup',args])), argumentExpiresAt: Date.now()+86400000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const unknown = await gateway.invoke(unknownContext,'contacts_lookup',JSON.stringify(args)); assert.equal(unknown.status,'unknown');
  const summary = (outcome: ToolOutcome) => ({ toolName: outcome.toolName, status: outcome.status, reasonCode: outcome.reasonCode, verification: outcome.verification });
  const scenarios = await Promise.all([{ scenario: 'draft_prepared_for_review', outcome: success }, { scenario: 'explicit_grant_denied', outcome: denied }, { scenario: 'interrupted_receipt_not_replayed', outcome: unknown }].map(async ({ scenario, outcome }) => ({ scenario, outcome: summary(outcome), trace: await gateway.traces(user.id,outcome.requestId) })));
  const text = JSON.stringify(scenarios); for (const secret of [session,hashToken(session),privateFixture,'fictional-secret-shaped-note','tools-smoke@example.invalid','fictional-tool-smoke-provider']) assert(!text.includes(secret),'Trace redaction assertion failed');
  assert.equal((await db.query('SELECT count(*)::int AS total FROM jobs'))[0].total,0);
  const report = { schemaVersion: 1, at: new Date().toISOString(), environment: 'isolated PGlite / fictional fixtures', providersContacted: false, liveToolsEnabled: false, assertions: { draftRequiresReview: true, deniedWithoutEffect: true, unknownNotReplayed: true, privateTraceRedaction: true }, scenarios };
  const directory = resolve('docs/production/evidence'); await mkdir(directory,{ recursive: true }); await writeFile(resolve(directory,'application-tools.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({ scenarios: scenarios.map(value => ({ scenario: value.scenario, ...value.outcome, traceEvents: value.trace.length })), assertions: report.assertions, providersContacted: false },null,2));
} finally { await db.close(); }
