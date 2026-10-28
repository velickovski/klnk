import { describe, expect, it } from 'vitest';
import type { Contact, Memory, Mission, MissionInput } from '@personal-agent/domain';
import { guidanceAfterSave, requestChoices, requestLimitError, reviewIdentity } from '../src/features/missions/request-state';

const limits={dailyAttempts:5,maxDurationSeconds:180,maxRetries:0};
const schedule=(duration=180,retries=0)=>({timezone:'Europe/Skopje',maxDurationSeconds:duration,retryLimit:retries}) as MissionInput['schedule'];
const mission={id:'fictional-request',reviewVersion:1,updatedAt:'2026-10-27T00:00:00Z',title:'Fictional message',contactId:'fictional-contact',goal:'Deliver the approved fixture message',schedule:schedule(),boundaries:{privateFacts:['Private fixture'],disclosableFacts:['Approved fixture']}} as unknown as Mission & {reviewVersion:number};
const contact={id:'fictional-contact',name:'Fictional person',phone:'+12025550199',verified:true,optedOut:false,language:'en'} as Contact;

describe('request limit and review boundaries',()=>{
  it('offers no redial and no duration beyond the returned live 180/0 limits',()=>{
    const choices=requestChoices(limits);expect(choices.retries).toEqual([{label:'No retry',value:'0'}]);expect(choices.durations.map(option=>Number(option.value))).toEqual([30,60,120,180]);expect(choices.defaultDuration).toBe(180);
    expect(requestLimitError(schedule(180,0),limits)).toBe('');expect(requestLimitError(schedule(300,0),limits)).toContain('at most 3 minutes');expect(requestLimitError(schedule(180,1),limits)).toContain('0 retries');
  });
  it('uses stricter arbitrary server bounds, retaining compatible nonpreset draft values',()=>{
    const strict={...limits,maxDurationSeconds:45};expect(requestChoices(strict).durations.map(option=>option.value)).toEqual(['30','45']);expect(requestChoices(strict).defaultDuration).toBe(45);
    expect(requestLimitError(schedule(45),strict)).toBe('');expect(requestLimitError(schedule(60),strict)).toContain('45 seconds');expect(requestChoices(limits,90).durations.some(option=>option.value==='90')).toBe(true);
  });
  it('supports simulator bounds while preserving the domain maximum and retry ceiling',()=>{
    expect(requestChoices({...limits,maxDurationSeconds:600,maxRetries:2}).retries).toHaveLength(3);expect(requestChoices({...limits,maxDurationSeconds:600,maxRetries:2}).defaultDuration).toBe(600);
    expect(requestChoices({...limits,maxDurationSeconds:1000,maxRetries:9}).defaultDuration).toBe(600);expect(requestChoices({...limits,maxRetries:9}).retries).toHaveLength(3);
  });
  it.each([{...limits,maxDurationSeconds:20},{...limits,maxDurationSeconds:NaN},{...limits,maxRetries:-1},{...limits,dailyAttempts:0}])('fails closed when no compatible calling limits exist: %j',unavailable=>{
    expect(requestLimitError(schedule(),unavailable)).toContain('limits are unavailable');
  });
  it('does not silently mutate a template or edited draft when limits tighten',()=>{
    const draft=schedule(300,2),before=JSON.stringify(draft);expect(requestLimitError(draft,limits)).not.toBe('');expect(JSON.stringify(draft)).toBe(before);
  });
  it('invalidates recipient confirmation for number, verification, review version, brief or boundary changes even with the same timestamp',()=>{
    const original=reviewIdentity(mission,contact,limits);
    expect(reviewIdentity({...mission,reviewVersion:2},contact,limits)).not.toBe(original);
    expect(reviewIdentity({...mission,goal:'Different approved goal'},contact,limits)).not.toBe(original);
    expect(reviewIdentity({...mission,boundaries:{...mission.boundaries,disclosableFacts:['Different authority']}},contact,limits)).not.toBe(original);
    expect(reviewIdentity(mission,{...contact,phone:'+12025550198'},limits)).not.toBe(original);expect(reviewIdentity(mission,{...contact,verified:false},limits)).not.toBe(original);
    expect(reviewIdentity(mission,contact,{...limits,maxDurationSeconds:60})).not.toBe(original);
  });
  it('invalidates confirmation for changed selected context and keeps identical reviews stable',()=>{
    const context=[{id:'context-fixture',text:'Approved fixture context'}] as Memory[];
    expect(reviewIdentity(mission,contact,limits,context)).toBe(reviewIdentity(structuredClone(mission),structuredClone(contact),{...limits},structuredClone(context)));
    expect(reviewIdentity(mission,contact,limits,context)).not.toBe(reviewIdentity(mission,contact,limits,[{...context[0],text:'Changed fixture context'}]));
  });
  it('keeps failed guidance and a newly edited instruction while an older save completes',()=>{
    expect(guidanceAfterSave('Original fixture','Original fixture',false)).toBe('Original fixture');expect(guidanceAfterSave('New fixture correction','Original fixture',true)).toBe('New fixture correction');expect(guidanceAfterSave('Original fixture','Original fixture',true)).toBe('');
  });
});
