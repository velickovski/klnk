import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import type {NetworkAcceptance,NetworkConnection,NetworkConversation,NetworkPolicy,NetworkProposal,NetworkTerms} from '../packages/domain/src/network.js';
import {Database,type SQL} from '../apps/server/src/db.js';
import {InternalCalendar} from '../apps/server/src/network/calendar.js';
import {canonicalProposalHash,defaultNetworkPolicy,meetingRuleAllows,networkReceiptId} from '../apps/server/src/network/policy.js';
import {lockNetworkOwners,NetworkStore} from '../apps/server/src/network/store.js';

describe('internal calendar authority and durable effects',()=>{
  let db:Database,calendar:InternalCalendar,store:NetworkStore;
  let a:string,b:string,stranger:string,policies:NetworkPolicy[],connection:NetworkConnection,conversation:NetworkConversation;
  beforeEach(async()=>{
    db=await new Database({dataDir:'memory://'}).open();calendar=new InternalCalendar(db);store=new NetworkStore(db);
    [a,b,stranger]=[randomUUID(),randomUUID(),randomUUID()];
    for(const [index,id] of [a,b,stranger].entries())await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[id,`calendar-${index}@example.invalid`,'fictional-fixture-no-login']);
    const now=Date.now(),at=new Date(now-1000).toISOString(),expiry=new Date(now+7*86400000).toISOString();
    policies=[a,b].map((ownerId,index)=>({...defaultNetworkPolicy(ownerId),enabled:true,trustedMemberIds:[index?a:b],topics:['planning'],allowMeetings:true,autoAcceptMeetings:true,weekdays:[0,1,2,3,4,5,6],workStartMinute:0,workEndMinute:1440,minNoticeMinutes:0,expiresAt:expiry,updatedAt:at,reminderMinutes:[15]}));
    connection={id:randomUUID(),fromId:a,toId:b,status:'accepted',version:1,inbound:{[a]:true,[b]:true},mutedBy:[],createdAt:at,updatedAt:at};
    const start=now+86400000,slot={startAt:new Date(start).toISOString(),endAt:new Date(start+1800000).toISOString(),timezone:'UTC'};
    const terms:NetworkTerms={version:1,participants:[a,b],purpose:'Plan the fictional community garden',topic:'planning',slot,location:'In-app discussion',obligations:[]};
    const proposal:NetworkProposal={id:randomUUID(),version:1,hash:canonicalProposalHash(terms),terms,expiresAt:expiry};
    const acceptances:NetworkAcceptance[]=[{ownerId:a,proposalHash:proposal.hash,proposalVersion:1,source:'owner_request',policyVersion:1,at},{ownerId:b,proposalHash:proposal.hash,proposalVersion:1,source:'delegation_rule',policyVersion:1,at}];
    conversation={id:randomUUID(),protocolVersion:1,initiatorId:a,recipientId:b,connectionId:connection.id,request:{requestId:randomUUID(),connectionId:connection.id,kind:'meeting',purpose:terms.purpose,topic:terms.topic,message:'Coordinate this fictional meeting.',candidateSlots:[slot],location:terms.location,expiresAt:expiry},state:'processing',version:1,connectionVersion:1,policyVersions:{[a]:1,[b]:1},messages:[],proposal,acceptances,decisionOwnerIds:[],summary:'Checking the proposed meeting.',nextAction:'Check authority.',turns:1,createdAt:at,updatedAt:at,readBy:[a]};
    await persist();
  });
  afterEach(async()=>{await db.close();});
  async function persist() {
    await db.transaction(async sql=>{
      await lockNetworkOwners(sql,[a,b]);const tx=store.in(sql);
      for(const policy of policies)await tx.put({id:policy.ownerId,kind:'policy',ownerA:policy.ownerId,status:'enabled',version:policy.version,value:policy});
      await tx.put({id:connection.id,kind:'connection',ownerA:a,ownerB:b,status:connection.status,version:connection.version,value:connection});
      await tx.put({id:conversation.id,kind:'conversation',ownerA:a,ownerB:b,status:conversation.state,version:conversation.version,value:conversation});
    });
  }
  async function commit(value=conversation,sqlWrapper?:(sql:SQL)=>SQL) {
    return db.transaction(async sql=>{await lockNetworkOwners(sql,[a,b]);return calendar.commit(sqlWrapper?.(sql)??sql,value,value.proposal!,value.acceptances,policies,connection);});
  }
  async function count(kind:string) {return (await db.query('SELECT count(*)::int AS count FROM network_records WHERE kind=$1',[kind]))[0]!.count;}

  it('commits one shared event with private reminders and durable outbox; duplicate delivery has no duplicate effects',async()=>{
    const event=await commit(),again=await commit();expect(again).toEqual(event);
    expect(await count('event')).toBe(1);expect(await count('reminder')).toBe(2);expect(await count('outbox')).toBe(2);
    const own=await calendar.list(a),peer=await calendar.list(b);
    expect(own.events[0]!.id).toBe(peer.events[0]!.id);expect(own.reminders).toHaveLength(1);expect(own.reminders[0]!.ownerId).toBe(a);
    expect((await calendar.list(stranger)).events).toEqual([]);expect((await calendar.list(stranger)).reminders).toEqual([]);
    expect(own.scope).toBe('klnk_only');
    const [row]=await db.query("SELECT payload FROM network_records WHERE kind='event'");expect(row!.payload).not.toContain('community garden');
  });
  it('serializes competing commits with sorted owner database locks and rejects overlap',async()=>{
    const second:NetworkConversation={...structuredClone(conversation),id:randomUUID()};
    await store.put({id:second.id,kind:'conversation',ownerA:a,ownerB:b,status:second.state,version:second.version,value:second});
    const locked:string[]=[];
    const first=commit(conversation,sql=>({query:async(source,params)=>{if(source.includes('FOR UPDATE'))locked.push(params![0]);return sql.query(source,params);}}));
    const results=await Promise.allSettled([first,commit(second)]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
    expect(locked).toEqual([a,b].sort());expect(await count('event')).toBe(1);expect(await count('outbox')).toBe(2);
    const slot=conversation.proposal!.terms.slot;
    await db.transaction(async sql=>{
      expect(await calendar.available(sql,[b],slot)).toBe(false);
      expect(await calendar.available(sql,[b],{...slot,startAt:slot.endAt,endAt:new Date(Date.parse(slot.endAt)+60000).toISOString()})).toBe(true);
    });
  });
  it.each(['hash','changed_terms','acceptance_hash','missing_acceptance','duplicate_owner','prose_only','unpersisted_acceptance','outside_request','unapproved_obligation','foreign_participant'] as const)('rejects %s without creating effects',async kind=>{
    const supplied=structuredClone(conversation);
    if(kind==='hash')supplied.proposal!.hash='a'.repeat(64);
    if(kind==='changed_terms')supplied.proposal!.terms.location='A different location';
    if(kind==='acceptance_hash')supplied.acceptances[1]!.proposalHash='b'.repeat(64);
    if(kind==='missing_acceptance')supplied.acceptances.pop();
    if(kind==='duplicate_owner')supplied.acceptances[1]!.ownerId=a;
    if(kind==='prose_only'){supplied.acceptances=[];supplied.summary='Both agents said yes, so it is confirmed.';}
    if(kind==='unpersisted_acceptance')supplied.acceptances[1]!.source='owner_approval';
    if(kind==='unapproved_obligation')supplied.proposal!.terms.obligations.push({assigneeId:b,text:'Do an unauthorized task',dueAt:supplied.proposal!.terms.slot.endAt,timezone:'UTC'});
    if(kind==='foreign_participant')supplied.proposal!.terms.participants[1]=stranger;
    if(kind==='outside_request') {
      conversation.proposal!.terms.location='A different location';conversation.proposal!.hash=canonicalProposalHash(conversation.proposal!.terms);
      conversation.acceptances.forEach(value=>{value.proposalHash=conversation.proposal!.hash;});await persist();Object.assign(supplied,structuredClone(conversation));
    }
    await expect(commit(supplied)).rejects.toBeTruthy();expect(await count('event')).toBe(0);expect(await count('reminder')).toBe(0);
  });
  it.each(['policy_version','policy_disabled','expired_policy','expired_proposal','expired_request','blocked','connection_version','rule_revoked','deleted_member'] as const)('rechecks %s at commit',async kind=>{
    if(kind==='policy_version')policies[1]!.version++;
    if(kind==='policy_disabled')policies[1]!.enabled=false;
    if(kind==='expired_policy')policies[1]!.expiresAt=new Date(Date.now()-1).toISOString();
    if(kind==='expired_proposal')conversation.proposal!.expiresAt=new Date(Date.now()-1).toISOString();
    if(kind==='expired_request')conversation.request.expiresAt=new Date(Date.now()-1).toISOString();
    if(kind==='blocked')connection.status='blocked';
    if(kind==='connection_version')connection.version++;
    if(kind==='rule_revoked')policies[1]!.autoAcceptMeetings=false;
    await persist();
    if(kind==='deleted_member')await db.query('UPDATE users SET deleted_at=now() WHERE id=$1',[b]);
    await expect(commit()).rejects.toBeTruthy();expect(await count('event')).toBe(0);
  });
  it('requires an exact durable owner approval receipt when autonomous acceptance is off',async()=>{
    policies[1]!.autoAcceptMeetings=false;policies[1]!.maxDurationMinutes=5;policies[1]!.workStartMinute=0;policies[1]!.workEndMinute=1;conversation.acceptances[1]!.source='owner_approval';await persist();
    await expect(commit()).rejects.toMatchObject({code:'network_approval_missing'});
    const approval=conversation.acceptances[1]!,proposal=conversation.proposal!;
    await store.put({id:networkReceiptId(conversation.id,b,proposal.hash),kind:'receipt',ownerA:b,status:'approved',version:1,value:{kind:'network_approval',ownerId:b,conversationId:conversation.id,proposalHash:proposal.hash,proposalVersion:proposal.version,policyVersion:1,at:approval.at}});
    expect((await commit()).status).toBe('confirmed');
  });
  it('does not use delegation-rule acceptance outside routine scheduling bounds',async()=>{
    policies[1]!.maxDurationMinutes=5;await persist();
    await expect(commit()).rejects.toMatchObject({code:'network_schedule_denied'});expect(await count('event')).toBe(0);
  });
  it('rolls back event, reminders and outbox together on a write failure',async()=>{
    await expect(commit(conversation,sql=>({query:async(source,params)=>{if(source.includes('INSERT INTO network_records')&&params?.[1]==='outbox')throw new Error('fictional outbox failure');return sql.query(source,params);}}))).rejects.toThrow('fictional outbox failure');
    expect(await count('event')).toBe(0);expect(await count('reminder')).toBe(0);expect(await count('outbox')).toBe(0);
  });
  it('cancels with a current revision, both owner reminders and summaries atomically',async()=>{
    const event=await commit();await expect(calendar.cancel(stranger,event.id,1)).rejects.toMatchObject({statusCode:404});
    await expect(calendar.cancel(a,event.id,2)).rejects.toMatchObject({code:'network_event_changed'});
    const cancelled=await calendar.cancel(a,event.id,1);expect(cancelled).toMatchObject({status:'cancelled',revision:2,cancelledBy:a});
    expect((await calendar.list(a)).reminders.every(value=>value.status==='cancelled')).toBe(true);
    expect((await calendar.list(b)).reminders.every(value=>value.status==='cancelled')).toBe(true);
    expect((await store.get<NetworkConversation>('conversation',conversation.id))!.value).toMatchObject({state:'cancelled',readBy:[a],decisionOwnerIds:[]});
    expect(await count('outbox')).toBe(4);expect(await calendar.cancel(a,event.id,2)).toEqual(cancelled);expect(await count('outbox')).toBe(4);
    await expect(calendar.cancel(b,event.id,1)).rejects.toMatchObject({code:'network_event_changed'});
  });
  it('projects due reminders without asserting push delivery; dismissal is owner-only',async()=>{
    policies[0]!.reminderMinutes=[10080,10080];await persist();await commit();
    const reminder=(await calendar.list(a)).reminders[0]!;expect(reminder.status).toBe('due');expect(await count('reminder')).toBe(2);
    await expect(calendar.dismissReminder(b,reminder.id)).rejects.toMatchObject({statusCode:404});
    expect((await calendar.dismissReminder(a,reminder.id)).status).toBe('dismissed');expect((await calendar.list(b)).reminders[0]!.status).toBe('scheduled');
  });
  it('keeps UTC interval checks correct at DST transitions and rejects overnight policy windows',()=>{
    const policy={...policies[0]!,timezone:'America/New_York',expiresAt:'2027-01-01T00:00:00Z',workStartMinute:60,workEndMinute:120,schedulingWindowDays:90};
    const now=Date.parse('2026-10-31T00:00:00Z');
    expect(meetingRuleAllows(policy,b,'planning',{startAt:'2026-11-01T05:15:00Z',endAt:'2026-11-01T05:45:00Z',timezone:'America/New_York'},now)).toBe(true);
    expect(meetingRuleAllows(policy,b,'planning',{startAt:'2026-11-01T06:15:00Z',endAt:'2026-11-01T06:45:00Z',timezone:'America/New_York'},now)).toBe(true);
    expect(meetingRuleAllows(policy,b,'planning',{startAt:'2026-11-01T06:59:59Z',endAt:'2026-11-01T07:00:01Z',timezone:'America/New_York'},now)).toBe(false);
    expect(meetingRuleAllows({...policy,workStartMinute:1380,workEndMinute:60},b,'planning',{startAt:'2026-11-01T03:15:00Z',endAt:'2026-11-01T03:45:00Z',timezone:'America/New_York'},now)).toBe(false);
  });
  it('recovers the same encrypted agreement after a database close and reopen',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'klnk-calendar-test-'));let persistent:Database|undefined;
    try {
      persistent=await new Database({dataDir:dir,key:'da'.repeat(32)}).open();
      for(const [index,id] of [a,b].entries())await persistent.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[id,`persist-${index}@example.invalid`,'fixture']);
      const target=new NetworkStore(persistent);
      for(const kind of ['policy','connection','conversation'] as const)for(const row of await store.list(a,kind))await target.put(row);
      for(const row of await store.list(b,'policy'))await target.put(row);
      const event=await persistent.transaction(sql=>new InternalCalendar(persistent!).commit(sql,conversation,conversation.proposal!,conversation.acceptances,policies,connection));
      await persistent.close();persistent=await new Database({dataDir:dir,key:'da'.repeat(32)}).open();
      const duplicate=await persistent.transaction(sql=>new InternalCalendar(persistent!).commit(sql,conversation,conversation.proposal!,conversation.acceptances,policies,connection));
      expect(duplicate).toEqual(event);expect((await new InternalCalendar(persistent).list(b)).events).toHaveLength(1);
    } finally {await persistent?.close();if(!dir.startsWith(join(tmpdir(),'klnk-calendar-test-')))throw new Error('Unexpected test directory');await rm(dir,{recursive:true,force:true});}
  });
});
