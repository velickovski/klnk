import type { VoiceInput, VoiceReply } from '../../voice-types';

export type OwnerReply = VoiceReply & { sessionId:string; turnId:string; transcript:string; missionId?:string; status:'reply'|'needs_reply'|'queued'|'calling_disabled'|'completed'|'cancelled'; needsReply:boolean; mode:'simulator'|'elevenlabs'; voiceMode:'provider'|'device'|'unavailable' };
export type OwnerTurn={id:string;role:'owner'|'agent';text:string};
export type PendingVoiceTurn={id:string;sessionId?:string;input:VoiceInput};
export type VoiceWorkspaceState={turns:OwnerTurn[];draft:string;sessionId?:string;last:OwnerReply|null;missionId?:string;busy:boolean;error:string;pending:PendingVoiceTurn|null;reportFailed:boolean;canAutoReport:boolean};
export type VoiceApi=<T=any>(path:string,method?:string,body?:unknown)=>Promise<T>;
const initial=():VoiceWorkspaceState=>({turns:[],draft:'',last:null,busy:false,error:'',pending:null,reportFailed:false,canAutoReport:false});
export function voiceRequestId() {
  const bytes=new Uint8Array(16);if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(bytes);else for(let i=0;i<16;i++)bytes[i]=Math.floor(Math.random()*256);
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
/** App-session memory only. Navigation does not reissue commands or discard typed drafts. */
export class VoiceWorkspaceController {
  private value=initial();private listeners=new Set<()=>void>();private generation=0;private active=false;private reports=new Map<string,string>();private reported=new Set<string>();
  constructor(private api:VoiceApi,private id=voiceRequestId){}
  getSnapshot=()=>this.value;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private update(patch:Partial<VoiceWorkspaceState>){this.value={...this.value,...patch};this.listeners.forEach(fn=>fn());}
  setDraft=(draft:string)=>this.update({draft});
  setError=(error:string)=>this.update({error});
  activate=()=>{this.active=true;};
  deactivate=()=>{this.active=false;this.update({canAutoReport:false});};
  reset=()=>{this.generation++;this.active=false;this.reports.clear();this.reported.clear();this.value=initial();this.listeners.forEach(fn=>fn());};
  async submit(input:VoiceInput,language='en',retry=false):Promise<OwnerReply|undefined>{
    if(this.value.busy)return;
    const request=retry?this.value.pending:{id:this.id(),sessionId:this.value.sessionId,input};if(!request)return;
    const generation=this.generation;
    this.update({busy:true,error:'',pending:request,...(!retry?{turns:[...this.value.turns,{id:request.id,role:'owner',text:input.text??'Voice message · awaiting transcription'}]}:{})});
    try {
      const reply=await this.api<OwnerReply>('/voice/turn','POST',{...request.input,sessionId:request.sessionId,requestId:request.id,language});
      if(generation!==this.generation)return;
      this.accept(reply,request);return reply;
    }catch(error){if(generation===this.generation){const e=error as {message?:string;status?:number;code?:string};const uncertain=e.status===undefined||e.status>=500||e.code==='voice_turn_in_progress';this.update({error:e.message??'The response is unavailable. No completed action is assumed.',pending:uncertain?request:null});}}
    finally {if(generation===this.generation)this.update({busy:false});}
  }
  private accept(reply:OwnerReply,request?:PendingVoiceTurn){
    const turns=request?this.value.turns.map(t=>t.id===request.id?{...t,text:reply.transcript||request.input.text||'Voice message'}:t):this.value.turns;
    const duplicate=turns.some(t=>t.id===reply.turnId&&t.role==='agent');
    this.update({sessionId:reply.sessionId||this.value.sessionId,last:reply,missionId:reply.missionId??this.value.missionId,pending:null,error:'',turns:duplicate?turns:[...turns,{id:reply.turnId,role:'agent',text:reply.text}],draft:request?.input.text===this.value.draft?'':this.value.draft,canAutoReport:this.active&&reply.status==='queued',reportFailed:false});
  }
  /** Inspect receipt/state before retrying the same identity; never create a replacement command. */
  async recover(language='en'){
    const pending=this.value.pending;if(!pending||this.value.busy)return;
    this.update({busy:true,error:''});const generation=this.generation;let missing=false;
    try {
      const receipt=await this.api<{status:string;response?:OwnerReply;missionId?:string}>(`/voice/turns/${pending.id}`);
      if(generation!==this.generation)return;
      if(receipt.response){this.accept(receipt.response,pending);return receipt.response;}
      if(receipt.missionId)this.update({missionId:receipt.missionId});
      if(['processing','prepared'].includes(receipt.status)){this.update({error:'Your request is still being checked. No new request was sent.'});return;}
      if(['expired','deleted','failed'].includes(receipt.status)){this.update({pending:null,error:receipt.missionId?'The response was unavailable. Open the existing request before deciding what to do next.':'The previous request did not produce a usable response. Your draft is still here.'});return;}
      this.update({error:'This request has no recoverable response yet. No replacement request was sent.'});
    }catch(error){const e=error as {status?:number;message?:string};if(e.status!==404){if(generation===this.generation)this.update({error:e.message??'Could not check the existing request. Try reconnecting.'});return;}missing=true;}
    finally{if(generation===this.generation)this.update({busy:false});}
    if(missing&&generation===this.generation)return this.submit(pending.input,language,true);
  }
  async report(manual=false):Promise<OwnerReply|undefined>{
    const missionId=this.value.missionId;if(!missionId||this.value.busy||this.value.pending||(!manual&&!this.value.canAutoReport)||(!manual&&this.reported.has(missionId)))return;
    const generation=this.generation;this.update({busy:true,error:''});
    try {
      const mission=await this.api<{status:string}>(`/missions/${missionId}`);
      if(generation!==this.generation)return;
      if(!['completed','partial','unresolved','cancelled'].includes(mission.status))return;
      if(!this.reports.has(missionId))this.reports.set(missionId,this.id());
      const reply=await this.api<OwnerReply>('/voice/report','POST',{missionId,requestId:this.reports.get(missionId)});
      if(generation!==this.generation)return;
      this.reported.add(missionId);this.accept(reply);this.update({canAutoReport:false});return reply;
    }catch(error){if(generation===this.generation)this.update({error:(error as Error).message,reportFailed:true,canAutoReport:false});}
    finally{if(generation===this.generation)this.update({busy:false});}
  }
  async endRequest(){
    const id=this.value.missionId;if(!id)return;const generation=this.generation;
    try{await this.api(`/missions/${id}/cancel`,'POST',{});if(generation!==this.generation)return;this.update({canAutoReport:false,last:this.value.last?{...this.value.last,status:'cancelled',audioBase64:undefined,text:'Queued work revoked. End requested for any supported active call.'}:null,turns:[...this.value.turns,{id:this.id(),role:'agent',text:'Queued work revoked. End requested for any supported active call. Completed actions remain recorded.'}]});}catch(error){if(generation===this.generation)this.update({error:(error as Error).message});}
  }
}
