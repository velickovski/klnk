import type { Attempt, FollowUpAction, Outcome } from '@personal-agent/domain';
type Tone='neutral'|'green'|'amber'|'red'|'blue';
const missionLabels:Record<string,string>={draft:'Ready to review',authorized:'Authorized',queued:'Waiting to start',calling:'Conversation in progress',awaiting_owner:'Your decision needed',completed:'Conversation complete',partial:'Partly completed',unresolved:'Not resolved',cancelled:'Request cancelled'};
export function presentMission(status:string,attempts:Pick<Attempt,'status'|'endedAt'>[]=[]){
 const pendingEnd=status==='cancelled'&&attempts.some(a=>!a.endedAt&&!['ended','busy','no_answer','voicemail','wrong_person','refused','dropped','cancelled'].includes(a.status));
 return {known:Object.hasOwn(missionLabels,status),label:pendingEnd?'End requested':missionLabels[status]??'Status unavailable',tone:status==='awaiting_owner'||status==='partial'||status==='unresolved'?'amber' as Tone:'neutral' as Tone,group:status==='awaiting_owner'?'decision': ['authorized','queued','calling'].includes(status)?'progress':'recent',pendingEnd};
}
export function presentOutcome(outcome?:Pick<Outcome,'status'>,demo=false){return {label:demo?'Simulated result · No one was contacted':outcome?'Provider account · verify the evidence':'No outcome available',tone:'neutral' as Tone,verified:false};}
export function presentAction(action:Pick<FollowUpAction,'status'>){const labels:Record<string,string>={proposed:'Proposed',pending:'Pending',succeeded:'Completed',failed:'Failed',blocked:'Blocked',cancelled:'Cancelled'};return {label:labels[action.status]??'Status unavailable',tone:action.status==='failed'?'red' as Tone:['pending','blocked'].includes(action.status)?'amber' as Tone:'neutral' as Tone};}
