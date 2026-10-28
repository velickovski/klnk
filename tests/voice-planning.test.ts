import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../apps/server/src/db.js';
import { Engine } from '../apps/server/src/engine.js';
import { getConfig } from '../apps/server/src/config.js';
import { newUser } from '../apps/server/src/auth.js';
import { seedOwner } from '../apps/server/src/seed.js';
import { VoiceService, anchorVoiceTiming } from '../apps/server/src/voice.js';
import type { Contact } from '../packages/domain/src/index.js';

const databases:Database[]=[];
afterEach(async()=>{await Promise.all(databases.splice(0).map(db=>db.close()));vi.unstubAllGlobals();});
async function fixture(provider:'simulator'|'elevenlabs'='simulator') {
  const network=vi.fn(async()=>{throw new Error('Unmocked provider network is forbidden');});vi.stubGlobal('fetch',network);
  const db=await new Database({dataDir:'memory://'}).open();databases.push(db);
  const engine=new Engine(db,{...getConfig(),provider,liveEnabled:false,elevenKey:undefined,ownerAgentId:undefined,embeddedWorker:false,standardVoice:undefined});
  const user=await newUser(db,`${randomUUID()}@example.invalid`,'A mock owner voice password 2026');await seedOwner(engine.repo,user.id,'Alex Test',true);
  engine.config.liveOwnerId=user.id;
  const voice=new VoiceService(engine),contacts=await engine.repo.list<Contact>(user.id,'contact');
  const say=(text:string,sessionId?:string,requestId=randomUUID())=>voice.turn(user.id,{text,sessionId,requestId});
  return {db,engine,voice,owner:user.id,contacts,say,network};
}
const message='I will meet you at the fountain in ten minutes.';
const direct=`Call Jordan Lee and tell him ${message}`;

describe('spoken owner planning and authority',()=>{
  it('spoken number readback invalidates older typed reviews instead of silently approving a new recipient number',async()=>{
    const f=await fixture(),first=await f.say(direct),base=await f.engine.mission(f.owner,first.missionId!);
    const draft={...base,id:randomUUID(),status:'draft',authorization:undefined,reviewVersion:1};await f.engine.repo.put(f.owner,'mission',draft);
    const saved=f.contacts.find(c=>c.id===base.contactId)!;await f.engine.repo.put(f.owner,'contact',{...saved,verified:false});
    const question=await f.say(direct);expect(question.status).toBe('needs_reply');
    const corrected=await f.say('plus one two zero two five five five zero nine eight eight',question.sessionId);expect(corrected.status).toBe('needs_reply');
    const accepted=await f.say('Correct',question.sessionId);expect(accepted.status).toBe('queued');
    expect((await f.engine.repo.get<any>(f.owner,'mission',draft.id)).reviewVersion).toBe(2);
    await expect(f.engine.authorize(f.owner,draft.id,1,'normal')).rejects.toMatchObject({code:'stale_authorization'});expect(f.network).not.toHaveBeenCalled();
  });
  it('keeps an exact direct message in a generic message mission and returns a truthful simulated report',async()=>{
    const f=await fixture(),reply=await f.say(direct);
    expect(reply.status).toBe('queued');expect(reply.mode).toBe('simulator');expect(reply.text).toContain('nobody will be contacted');
    const m=await f.engine.mission(f.owner,reply.missionId!);
    expect(m.kind).toBe('message');expect(m.requiredTalkingPoints[0]).toContain('I will meet you at the fountain');expect(m.requiredTalkingPoints[0]).not.toContain('in ten minutes');expect(m.requiredTalkingPoints[0]).toContain('America/New_York');expect(m.followUpActions).toEqual([]);
    expect(m.requiredTalkingPoints[0]).toMatch(/^Alex Test asked me to pass on this message: “I will meet you/);
    expect((m as any).voiceAuthorization.originalMessage).toBe(message);expect((m as any).voiceAuthorization.utterance).toBe(direct);expect(m.schedule.callingWindowEnd).toBeTruthy();
    expect(m.schedule.maxDurationSeconds).toBe(180);expect(m.schedule.retryLimit).toBe(0);expect(m.authorization?.snapshot.executionProvider).toBe('simulator');
    for(let n=0;n<3;n++)await f.engine.tick(true);
    const report=await f.say('What happened?',reply.sessionId);
    expect(report.status).toBe('completed');expect(report.text).toContain('simulated call');expect(report.text).toContain('No new commitment');expect(f.network).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent and lost first-turn responses before the client knows a session ID',async()=>{
    const f=await fixture(),synthesize=vi.fn(async()=>({audio:new Uint8Array([1,2,3]),contentType:'audio/mpeg'}));
    f.engine.config.standardVoice='mock-standard';f.voice.speech={synthesizeReply:synthesize} as any;
    const requestId=randomUUID(),body={requestId,text:direct};
    const [a,b]=await Promise.all([f.voice.turn(f.owner,body),f.voice.turn(f.owner,body)]);
    expect(a).toEqual(b);expect(synthesize).toHaveBeenCalledTimes(1);
    const restarted=new VoiceService(f.engine);restarted.speech={synthesizeReply:synthesize} as any;
    const replay=await restarted.turn(f.owner,body);
    expect(replay).toEqual(a);expect(await f.engine.repo.list(f.owner,'mission')).toHaveLength(1);expect(synthesize).toHaveBeenCalledTimes(1);expect(f.network).not.toHaveBeenCalled();
    const receipt=await restarted.readTurn(f.owner,requestId);
    expect(receipt.response).toEqual(a);
    expect(receipt.missionId).toBe(a.missionId);
    await expect(restarted.readTurn('another-owner',requestId)).rejects.toMatchObject({statusCode:404});
    await expect(restarted.readTurn(f.owner,randomUUID())).rejects.toMatchObject({statusCode:404});
    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it('blocks cross-owner conversation sessions and spoken reports',async()=>{
    const f=await fixture(),first=await f.say(direct),other=await newUser(f.db,`${randomUUID()}@example.invalid`,'Another mock voice password 2026');await seedOwner(f.engine.repo,other.id,'Other owner',false);
    await expect(f.voice.turn(other.id,{requestId:randomUUID(),sessionId:first.sessionId,text:'What happened?'})).rejects.toMatchObject({statusCode:404});
    await expect(f.voice.report(other.id,{requestId:randomUUID(),missionId:first.missionId})).rejects.toMatchObject({statusCode:404});
    await expect(f.voice.clearSession(other.id,first.sessionId)).rejects.toMatchObject({statusCode:404});
    expect(await f.engine.repo.list(other.id,'mission')).toEqual([]);expect(f.network).not.toHaveBeenCalled();
  });

  it('asks which relationship was intended rather than choosing the first matching name',async()=>{
    const f=await fixture();
    await f.engine.repo.put(f.owner,'contact',{...f.contacts.find(c=>c.name==='Jordan Lee')!,id:randomUUID(),name:'Jordan Morgan',phone:'+12025550129'});
    const ambiguous=await f.say('Call Jordan and tell them I will be there in ten minutes.');
    expect(ambiguous.status).toBe('needs_reply');expect(ambiguous.text).toContain('Jordan Lee');expect(ambiguous.text).toContain('Jordan Morgan');expect(await f.engine.repo.list(f.owner,'mission')).toEqual([]);
    const selected=await f.say('Jordan Lee',ambiguous.sessionId);
    expect(selected.status).toBe('queued');expect((await f.engine.mission(f.owner,selected.missionId!)).contactId).toBe(f.contacts.find(c=>c.name==='Jordan Lee')!.id);
  });

  it('adds a missing number only after spoken read-back, and verifies a saved number without duplicating its contact',async()=>{
    const f=await fixture(),before=(await f.engine.repo.list(f.owner,'contact')).length;
    const request=await f.say('Call Taylor and tell them I have a short update.');expect(request.status).toBe('needs_reply');
    const number=await f.say('plus one two zero two five five five zero one two three',request.sessionId);
    expect(number.status).toBe('needs_reply');expect(await f.engine.repo.list(f.owner,'contact')).toHaveLength(before);expect(await f.engine.repo.list(f.owner,'mission')).toHaveLength(0);
    const confirmed=await f.say('Yes',request.sessionId);expect(confirmed.status).toBe('queued');expect(await f.engine.repo.list(f.owner,'contact')).toHaveLength(before+1);
    const saved=f.contacts.find(c=>c.name==='Jordan Lee')!;await f.engine.repo.put(f.owner,'contact',{...saved,verified:false});
    const verify=await f.say(direct);expect(verify.status).toBe('needs_reply');expect(verify.text).toContain('right person and number');
    const verified=await f.say('Correct',verify.sessionId);expect(verified.status).toBe('queued');expect(await f.engine.repo.list(f.owner,'contact')).toHaveLength(before+1);
    expect((await f.engine.repo.get<Contact>(f.owner,'contact',saved.id))!.verified).toBe(true);
    expect((await f.engine.mission(f.owner,verified.missionId!)).contactId).toBe(saved.id);
  });

  it('never converts a privacy clause, a payment request or ordinary chat into a call',async()=>{
    const f=await fixture();
    for(const text of ['Call Jordan Lee and tell him I cannot come. Keep the family reason private.','Call Jordan Lee and tell him do not tell anyone the secret.','Call Jordan Lee and tell him don’t share my bank account.','Call Jordan Lee and tell him I accept the new charge.']) {
      const result=await f.say(text);expect(result.status).toBe('needs_reply');expect(result.missionId).toBeUndefined();
    }
    const planner=vi.fn(async()=>({intent:'message',recipientName:'Jordan Lee',message:'Please accept this unexpected request.',ownerId:'someone-else',authorized:true}));f.voice.planner={plan:planner};
    const chat=await f.say('How are you today?');expect(chat.status).toBe('needs_reply');expect(chat.missionId).toBeUndefined();
    const negated=await f.say('Do not call Jordan today.');expect(negated.status).toBe('needs_reply');expect(negated.missionId).toBeUndefined();
    expect(await f.engine.repo.list(f.owner,'mission')).toEqual([]);expect(f.network).not.toHaveBeenCalled();
  });

  it('confirms model-proposed wording and serializes concurrent confirmations into at most one mission',async()=>{
    const f=await fixture(),planner=vi.fn(async()=>({intent:'message',recipientName:'Jordan Lee',message:'The documents are ready for review.'}));f.voice.planner={plan:planner};
    const proposed=await f.say('Could you call Jordan Lee about the documents?');expect(proposed.status).toBe('needs_reply');expect(await f.engine.repo.list(f.owner,'mission')).toEqual([]);
    const [first,second]=await Promise.all([f.say('Yes',proposed.sessionId),f.say('Yes',proposed.sessionId)]);
    expect([first.status,second.status].filter(s=>s==='queued')).toHaveLength(1);expect(await f.engine.repo.list(f.owner,'mission')).toHaveLength(1);
    expect((await f.engine.mission(f.owner,first.missionId!)).requiredTalkingPoints).toEqual(['Alex Test asked me to pass on this message: “The documents are ready for review.”']);
  });

  it('sends the planner contact names and brief chat only, excluding private memory and phone numbers',async()=>{
    const f=await fixture(),planner=vi.fn(async(_input:unknown)=>({intent:'chat',reply:'What would you like to do?'}));f.voice.planner={plan:planner};
    await f.say('Could you call Jordan Lee about the next update?');
    expect(planner).toHaveBeenCalledTimes(1);const input=planner.mock.calls[0][0] as any;
    expect(input.contacts).toEqual(f.contacts.filter(c=>c.name==='Jordan Lee').map(c=>({id:c.id,name:c.name})));
    expect(JSON.stringify(input)).not.toContain('family matter');expect(JSON.stringify(input)).not.toContain('+1202555');expect(input).not.toHaveProperty('memories');
  });

  it('prepares a live request while dispatch is disabled and never treats credentials as call permission',async()=>{
    const f=await fixture('elevenlabs'),reply=await f.say(direct);
    expect(reply.status).toBe('calling_disabled');expect(reply.text).toContain('have not called anyone');
    const m=await f.engine.mission(f.owner,reply.missionId!);expect(m.status).toBe('draft');expect(m.authorization).toBeUndefined();
    await f.engine.tick(true);expect(await f.engine.repo.list(f.owner,'attempt')).toEqual([]);expect(f.network).not.toHaveBeenCalled();
  });

  it('caches report audio once across concurrent retries and a service restart',async()=>{
    const f=await fixture(),request=await f.say(direct);for(let n=0;n<3;n++)await f.engine.tick(true);
    const synthesize=vi.fn(async()=>({audio:new Uint8Array([4,5,6]),contentType:'audio/mpeg'}));f.engine.config.standardVoice='mock-standard';f.voice.speech={synthesizeReply:synthesize} as any;
    const body={missionId:request.missionId!,requestId:randomUUID()},[a,b]=await Promise.all([f.voice.report(f.owner,body),f.voice.report(f.owner,body)]);
    expect(a).toEqual(b);expect(a.voiceMode).toBe('provider');expect(synthesize).toHaveBeenCalledTimes(1);
    const restarted=new VoiceService(f.engine);restarted.speech={synthesizeReply:synthesize} as any;expect(await restarted.report(f.owner,body)).toEqual(a);expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it('anchors simple relative timing to the original utterance and asks about unsupported timing',()=>{
    const anchored=anchorVoiceTiming('I will arrive in ten minutes.','2026-10-26T14:00:00.000Z','America/New_York');
    expect(anchored.deadlineAt).toBe('2026-10-26T14:10:00.000Z');expect(anchored.message).toContain('October 26, 2026');expect(anchored.message).toContain('10:10 AM');expect(anchored.message).toContain('America/New_York');
    expect(anchorVoiceTiming('I will arrive in a few minutes.','2026-10-26T14:00:00.000Z','America/New_York').needsClarification).toBe(true);
    expect(anchorVoiceTiming('I will arrive in an hour.','2026-10-26T14:00:00.000Z','America/New_York').needsClarification).toBe(true);
  });

  it('returns a voice clarification on planner failure and does not send contacts for ordinary chat',async()=>{
    const f=await fixture(),planner=vi.fn(async(_input:unknown)=>{throw new Error('Mock provider unavailable');});f.voice.planner={plan:planner};
    const result=await f.say('Hello, how are you?');expect(result.status).toBe('needs_reply');expect(result.text).toContain('No call has been placed');
    expect((planner.mock.calls[0][0] as any).contacts).toEqual([]);expect(await f.engine.repo.list(f.owner,'mission')).toEqual([]);expect(f.network).not.toHaveBeenCalled();
  });

  it('clears a spoken chat without deleting memories or effect receipts and blocks first-turn replay',async()=>{
    const f=await fixture(),requestId=randomUUID(),body={requestId,text:direct},before=await f.engine.repo.list(f.owner,'memory');
    const first=await f.voice.turn(f.owner,body),cleared=await f.say('Please forget this conversation',first.sessionId);
    expect(cleared.text).toContain('cleared this chat');
    const session=await f.engine.repo.get<any>(f.owner,'voice_session',first.sessionId);
    expect(session.history).toHaveLength(2);expect(JSON.stringify(session.history)).not.toContain('fountain');expect(session.pending).toBeUndefined();expect(session.lastMissionId).toBeUndefined();
    const receipts=await f.engine.repo.list<any>(f.owner,'voice_turn'),prior=receipts.find(r=>r.id===first.turnId);
    expect(prior.status).toBe('deleted');expect(prior.missionId).toBe(first.missionId);expect(prior).not.toHaveProperty('response');
    await expect(new VoiceService(f.engine).turn(f.owner,body)).rejects.toMatchObject({statusCode:409,code:'voice_request_expired'});
    expect(await f.engine.repo.list(f.owner,'mission')).toHaveLength(1);expect((await f.engine.mission(f.owner,first.missionId!)).status).toBe('queued');
    expect(await f.engine.repo.list(f.owner,'memory')).toEqual(before);expect(f.network).not.toHaveBeenCalled();
  });

  it('does not resurrect cleared chat content when an in-flight voice reply finishes synthesizing',async()=>{
    const f=await fixture(),hello=await f.say('Hello');let release!:()=>void,started!:()=>void;
    const began=new Promise<void>(resolve=>{started=resolve;}),ready=new Promise<void>(resolve=>{release=resolve;});
    f.engine.config.standardVoice='mock-standard';f.voice.speech={synthesizeReply:vi.fn(async()=>{started();await ready;return {audio:new Uint8Array([7,8]),contentType:'audio/mpeg'};})} as any;
    const pending=f.say(direct,hello.sessionId);await began;
    await f.voice.clearSession(f.owner,hello.sessionId);release();
    await expect(pending).rejects.toMatchObject({statusCode:409,code:'voice_request_expired'});
    const session=await f.engine.repo.get<any>(f.owner,'voice_session',hello.sessionId);expect(session.history).toEqual([]);
    expect((await f.engine.repo.list<any>(f.owner,'voice_turn')).every(t=>t.status==='deleted'&&!t.response)).toBe(true);
    expect(await f.engine.repo.list(f.owner,'mission')).toHaveLength(1);
  });

  it('tombstones report audio too, including a paid reply already in flight',async()=>{
    const f=await fixture(),first=await f.say(direct);let release!:()=>void,started!:()=>void;
    const began=new Promise<void>(resolve=>{started=resolve;}),ready=new Promise<void>(resolve=>{release=resolve;});
    f.engine.config.standardVoice='mock-standard';f.voice.speech={synthesizeReply:vi.fn(async()=>{started();await ready;return {audio:new Uint8Array([9]),contentType:'audio/mpeg'};})} as any;
    const body={requestId:randomUUID(),missionId:first.missionId!},pending=f.voice.report(f.owner,body);await began;
    await f.voice.clearSession(f.owner,first.sessionId);release();await expect(pending).rejects.toMatchObject({statusCode:409,code:'voice_request_expired'});
    await expect(f.voice.report(f.owner,body)).rejects.toMatchObject({statusCode:409,code:'voice_request_expired'});
    expect((await f.engine.repo.list<any>(f.owner,'voice_turn')).every(t=>t.status==='deleted'&&!t.response)).toBe(true);
  });

  it('handles clear on an empty chat and never interprets it as permission to delete memories',async()=>{
    const f=await fixture(),before=await f.engine.repo.list(f.owner,'memory'),result=await f.say('Clear this chat');
    expect(result.text).toContain('cleared this chat');expect(await f.engine.repo.list(f.owner,'memory')).toEqual(before);expect(await f.engine.repo.list(f.owner,'mission')).toEqual([]);
  });

  it('allows unbound users to rehearse in text but blocks every shared paid voice service',async()=>{
    const f=await fixture(),other=await newUser(f.db,`${randomUUID()}@example.invalid`,'Unbound mock voice password 2026');await seedOwner(f.engine.repo,other.id,'Unbound owner',true);
    const transcribe=vi.fn(),synthesize=vi.fn(),plan=vi.fn();f.engine.config.standardVoice='mock-standard';f.voice.speech={transcribeAudio:transcribe,synthesizeReply:synthesize} as any;f.voice.planner={plan};
    const first=await f.voice.turn(other.id,{requestId:randomUUID(),text:direct});expect(first.status).toBe('queued');expect(first.voiceMode).toBe('device');
    await f.voice.turn(other.id,{requestId:randomUUID(),text:'Can we talk about tomorrow?'});
    const report=await f.voice.report(other.id,{requestId:randomUUID(),missionId:first.missionId});expect(report.voiceMode).toBe('device');
    await expect(f.voice.turn(other.id,{requestId:randomUUID(),audioBase64:'AQID',mimeType:'audio/wav'})).rejects.toMatchObject({statusCode:403,code:'provider_owner_required'});
    expect(transcribe).not.toHaveBeenCalled();expect(synthesize).not.toHaveBeenCalled();expect(plan).not.toHaveBeenCalled();expect(f.network).not.toHaveBeenCalled();
  });

  it('caps bound-owner paid turns and reports before provider calls while allowing free cached replay',async()=>{
    const f=await fixture(),requestId=randomUUID(),first=await f.say(direct,undefined,requestId);
    await f.db.transaction(async sql=>{const r=f.engine.repo.in(sql);for(let n=0;n<99;n++)await r.put(f.owner,'voice_turn',{id:`quota-${f.owner}-${n}`,status:'expired'});});
    const synthesize=vi.fn(),plan=vi.fn();f.engine.config.standardVoice='mock-standard';f.voice.speech={synthesizeReply:synthesize} as any;f.voice.planner={plan};
    await expect(f.say('Call Jordan Lee and tell him the documents are ready.')).rejects.toMatchObject({statusCode:429,code:'voice_usage_limit'});
    await expect(f.voice.report(f.owner,{requestId:randomUUID(),missionId:first.missionId})).rejects.toMatchObject({statusCode:429,code:'voice_usage_limit'});
    expect(await f.voice.turn(f.owner,{requestId,text:direct})).toEqual(first);expect(synthesize).not.toHaveBeenCalled();expect(plan).not.toHaveBeenCalled();expect(await f.engine.repo.list(f.owner,'mission')).toHaveLength(1);
    const stopped=await f.say('Stop',first.sessionId);expect(stopped.status).toBe('cancelled');expect(stopped.voiceMode).toBe('device');
    const cleared=await f.say('Clear this chat',first.sessionId);expect(cleared.text).toContain('cleared this chat');expect(cleared.voiceMode).toBe('device');
    expect(synthesize).not.toHaveBeenCalled();expect(plan).not.toHaveBeenCalled();
  });
});
