import React,{useEffect,useRef,useState} from 'react';
import {Text,View} from 'react-native';
import type {OwnerIntentResult} from '@personal-agent/domain';
import {Badge,Button,Card,Disclosure,Field,Notice,useUI} from '../../ui';
import {networkApi} from './api';
import {usePanelTask} from './panel-hooks';
import {requestId} from './panel-state';

export function OwnerIntentPanel({ownerId}:{ownerId:string}){
  const {styles}=useUI(),task=usePanelTask(),[text,setText]=useState(''),[result,setResult]=useState<OwnerIntentResult>();
  const pending=useRef<{commandId:string;text:string}|undefined>(undefined),[uncertain,setUncertain]=useState(false);
  const adopt=(next:OwnerIntentResult)=>{setResult(next);setUncertain(false);};
  const send=()=>{
    if(!text.trim()||task.busy||uncertain)return;
    let command:{commandId:string;text:string};
    try{command=pending.current??{commandId:requestId(),text:text.trim()};}catch(error){task.setError((error as Error).message);return;}
    pending.current=command;
    setUncertain(true);
    void task.run(()=>networkApi.request<OwnerIntentResult>('/network/owner-intents','POST',command),adopt,'The response is unconfirmed. Check this same instruction before retrying. ');
  };
  const retrySame=()=>{const command=pending.current;if(!command||task.busy)return;setUncertain(true);void task.run(()=>networkApi.request<OwnerIntentResult>('/network/owner-intents','POST',command),adopt,'The same instruction remains unconfirmed. No new identifier was created. ');};
  const check=()=>{if(pending.current)void task.run(()=>networkApi.request<OwnerIntentResult>(`/network/owner-intents/${pending.current!.commandId}`),adopt,'Readback failed. Keep this instruction; no new model request was started. ');};
  useEffect(()=>{setText('');setResult(undefined);setUncertain(false);pending.current=undefined;},[ownerId]);
  return <Card><Text accessibilityRole="header" style={styles.h2}>Ask your personal agent.</Text><Text style={styles.text}>Speak from voice home, or type here. Your agent works with accepted members inside klnk, under your saved permissions.</Text>
    <Field label="Instruction to your agent" value={text} onChangeText={setText} multiline maxLength={1500} editable={!pending.current} placeholder="Arrange thirty minutes with Jordan Lee next week after 2 pm to discuss the launch." hint="Use the exact accepted member name. Routine meetings can proceed under your saved autonomy; other prepared terms need review."/>
    {!pending.current?<Button label="Send to my agent" disabled={!text.trim()} loading={task.busy} onPress={send}/>:null}
    {pending.current?<Button label="Check this instruction" secondary loading={task.busy} onPress={check}/>:null}
    {pending.current&&uncertain?<Button label="Retry this same instruction" secondary disabled={task.busy} onPress={retrySame}/>:null}
    {uncertain?<Notice tone="warning">The result has not been confirmed. This instruction keeps the same identifier. Check it before starting another.</Notice>:null}
    {result?<View style={{gap:16}}><Badge text={result.status==='submitted'?`Recorded · ${result.conversation!.state.replaceAll('_',' ')}`:result.status==='draft'?'Prepared · your review needed':result.status==='processing'?'Still processing':result.status==='uncertain'?'Model result unconfirmed':result.status==='failed'?'Could not prepare this instruction':'Clarification needed'} tone={['failed','uncertain'].includes(result.status)?'amber':'neutral'}/>
      {result.clarification?<Notice>{result.clarification}</Notice>:null}
      {result.conversation?<><Text style={styles.text}>{result.conversation.summary}</Text><Text style={styles.small}>{result.conversation.nextAction}</Text><Text style={styles.small}>Refresh Inbox below to inspect the exchange and exact agreement. Agent processing and owner reading are separate.</Text></>:null}
      {result.status==='failed'?<Notice tone="error">{result.reason==='model_unavailable'?'OpenAI planning is unavailable. Exact messages and structured requests remain available below.':'The server did not establish a permitted result. Review the current connection and delegation before giving new instructions.'}</Notice>:null}
      {result.plan?<Disclosure title="Inspect the exact prepared request" initiallyOpen={result.status==='draft'}><View style={{gap:12}}><Text style={styles.h3}>{result.plan.purpose}</Text><Text style={styles.text}>{result.plan.kind} · {result.plan.topic}</Text><Text style={styles.text}>{result.plan.message}</Text>{result.plan.candidateSlots.map(slot=><Text key={slot.startAt} style={styles.text}>{slot.startAt} – {slot.endAt}{'\n'}{slot.timezone}</Text>)}<Text style={styles.small}>Location: {result.plan.location||'Not specified'}. Deadline: {result.plan.expiresAt}. Confirming submits these exact terms; the other owner’s authority and calendar are checked separately.</Text></View></Disclosure>:null}
      {result.status==='draft'?<Button label="Confirm these exact terms" loading={task.busy} onPress={()=>void task.run(()=>networkApi.request<OwnerIntentResult>(`/network/owner-intents/${result.commandId}/confirm`,'POST',{planHash:result.planHash}),adopt,'Confirmation unconfirmed. Check the existing instruction before retrying. ')}/>:null}
      {!['processing','uncertain'].includes(result.status)&&!uncertain?<Button label={result.status==='clarification'?'Reply with a new instruction':'Give another instruction'} secondary disabled={task.busy} onPress={()=>{pending.current=undefined;setText('');setResult(undefined);setUncertain(false);}}/>:null}
    </View>:null}
    {task.error?<Notice tone="error">{task.error}</Notice>:null}<Text style={styles.small}>For natural-language planning, OpenAI receives this instruction, your limited delegation settings and accepted member identifiers. It receives no other member’s private rules, memory or schedule.</Text>
  </Card>;
}
