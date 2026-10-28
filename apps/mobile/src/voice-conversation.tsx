import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Text, View } from 'react-native';
import { useVoiceIO } from './voice-io';
import type { VoiceInput, VoiceIO } from './voice-types';
import { Badge, Button, Card, Choice, Disclosure, Field, Notice, useUI } from './ui';
import { useVoiceWorkspace } from './features/voice/VoiceWorkspaceProvider';

/** Advanced workspace voice turns. Live owner conversation has a separate transport and lifetime. */
export function VoiceConversation({onMission,mode='simulator',onFirstReply}:{onMission?:(id:string)=>void;mode?:string;onFirstReply?:()=>void}){
  const {colors,styles}=useUI(),{controller,state}=useVoiceWorkspace();
  const [inputMode,setInputMode]=useState<'talk'|'type'>('talk'),[manualSend,setManualSend]=useState(false);
  const mounted=useRef(true),foreground=useRef(AppState.currentState==='active'),voiceRef=useRef<VoiceIO|null>(null);
  const submit=async(input:VoiceInput)=>{const reply=await controller.submit(input);if(reply&&mounted.current&&foreground.current){onFirstReply?.();await voiceRef.current?.speak(reply);}};
  const voice=useVoiceIO({onInput:submit,onError:controller.setError,manualSend});voiceRef.current=voice;
  useEffect(()=>{
    mounted.current=true;controller.activate();
    const subscription=AppState.addEventListener('change',next=>{foreground.current=next==='active';if(!foreground.current){controller.deactivate();voiceRef.current?.silence();void voiceRef.current?.cancel();}});
    return()=>{mounted.current=false;controller.deactivate();voiceRef.current?.silence();void voiceRef.current?.cancel();subscription.remove();};
  },[controller]);
  useEffect(()=>{
    if(!state.canAutoReport||!state.missionId)return;let cancelled=false;
    const poll=async()=>{const reply=await controller.report();if(reply&&!cancelled&&mounted.current&&foreground.current&&!voiceRef.current?.listening&&!voiceRef.current?.pending)await voiceRef.current?.speak(reply);};
    const timer=setInterval(()=>{void poll();},2000);return()=>{cancelled=true;clearInterval(timer);};
  },[state.canAutoReport,state.missionId,controller]);
  const blocked=state.busy||!!state.pending;
  const status=state.busy?'Checking your request…':voice.listening?manualSend?'Listening. Finish when you are ready.':'Listening. Pause to send, or finish now.':voice.pending?'Message held. Send or discard when ready.':voice.speaking?'Your agent is speaking':'Ready when you are';
  return <View style={{gap:24}}>
    <View style={{gap:12}}><Text accessibilityRole="header" style={styles.title}>Your space to talk.</Text><Text style={styles.subtitle}>Speak or type a request. Calls and external actions follow the permissions you review.</Text></View>
    <Choice label="Message input" options={[{label:'Talk',value:'talk'},{label:'Type',value:'type'}]} value={inputMode} onChange={value=>{voice.silence();void voice.cancel();setInputMode(value);}}/>
    {inputMode==='talk'?<Card>
      <Text accessibilityLiveRegion="polite" style={styles.h3}>{status}</Text>
      <Button label={voice.listening?'Finish message':'Talk to klnk'} icon={voice.listening?'stop':'mic-outline'} disabled={blocked||voice.pending||!voice.available} onPress={()=>{controller.setError('');if(voice.listening)void voice.stop();else void voice.start();}}/>
      {voice.pending?<><Notice>The microphone is off. This message has not been sent. Each recording is limited to 30 seconds; send it before starting another.</Notice><Button label="Send held message" disabled={blocked} onPress={()=>{void voice.send();}}/></>:null}
      {voice.listening||voice.pending?<Button label="Discard recording" secondary onPress={()=>{void voice.cancel().catch(error=>controller.setError(error.message));}}/>:null}
      <Choice label="When to send" options={[{label:'After a pause',value:'automatic'},{label:'Manual send',value:'manual'}]} value={manualSend?'manual':'automatic'} onChange={value=>setManualSend(value==='manual')}/>
      <Text style={styles.small}>{manualSend?'Pause as long as you need within each 30-second recording. Finish, then choose Send held message.':'Measured speech on iPhone sends after two seconds of quiet. A silent recording is discarded after eight seconds. Browser speech service timing can vary.'} At the 30-second limit, capture stops and the message waits for your decision.</Text>
      {!voice.available?<Notice>Speech recognition is unavailable here. Choose Type for the same request and review flow.</Notice>:null}
    </Card>:<Card><Field label="Message to klnk" value={state.draft} onChangeText={controller.setDraft} multiline placeholder="Tell your agent what you need…" hint="Your draft stays here if the connection fails or you leave this tab."/><Button label="Send message" disabled={!state.draft.trim()||blocked} onPress={()=>{voice.silence();void submit({text:state.draft});}}/></Card>}
    {voice.speaking?<Button label="Stop playback" secondary onPress={voice.silence}/>:null}
    {state.error?<Notice tone="error">{state.error}</Notice>:null}
    {state.pending?<><Notice>The previous request may still be running. Check its existing receipt before sending another request.</Notice><Button label="Check existing request" secondary loading={state.busy} onPress={()=>{void controller.recover();}}/></>:null}
    {state.turns.length?<View style={{gap:16}}>
      {state.turns.length>2?<Disclosure title={`Earlier messages (${state.turns.length-2})`}><View style={{gap:16}}>{state.turns.slice(0,-2).map(turn=><Turn key={`${turn.role}-${turn.id}`} turn={turn}/>)}</View></Disclosure>:null}
      {state.turns.slice(-2).map(turn=><Turn key={`${turn.role}-${turn.id}`} turn={turn}/>)}
    </View>:<Text style={[styles.text,{color:colors.muted}]}>Your messages and actual replies will appear here.</Text>}
    {state.last?<Button label="Hear that again" icon="volume-high-outline" secondary disabled={voice.listening||voice.pending||Platform.OS!=='web'&&!state.last.audioBase64} onPress={()=>{void voice.speak(state.last!);}}/>:null}
    {state.last&&(state.last.voiceMode==='unavailable'||Platform.OS!=='web'&&!state.last.audioBase64)?<Notice>This reply has no provider audio. The actual text remains available above.</Notice>:null}
    {state.last?.status==='calling_disabled'?<Notice>Calling is disabled. This request did not contact anyone.</Notice>:null}
    {state.missionId&&state.last?.status==='queued'?<Button label="End request" danger secondary onPress={()=>{voice.silence();void voice.cancel();void controller.endRequest();}}/>:null}
    {state.reportFailed&&state.missionId?<Button label="Check report" secondary onPress={()=>{void controller.report(true);}}/>:null}
    {state.missionId&&onMission?<Button label="Request details" secondary onPress={()=>onMission(state.missionId!)}/>:null}
    <Disclosure title="Voice and calling status"><Card><Badge text={mode==='simulator'?'SIMULATED CALLING':'Provider calling configuration'} tone="blue"/><Text style={styles.small}>{voice.source}</Text><Text style={styles.small}>{Platform.OS==='web'?'This workspace uses the browser speech service and may use its device voice. Call klnk uses a separate live OpenAI connection.':'These are bounded recorded voice turns. Native GPT-Live transport still requires a documented compatible implementation and a device test.'}</Text><Text style={styles.small}>Leaving this screen or backgrounding stops capture and playback. Returning never resumes the microphone. Outbound calling remains separate from talking to your agent.</Text></Card></Disclosure>
  </View>;
}
function Turn({turn}:{turn:{role:'owner'|'agent';text:string}}){const {colors,styles}=useUI();return <View style={{alignSelf:turn.role==='owner'?'flex-end':'flex-start',maxWidth:'96%',padding:18,borderRadius:24,backgroundColor:turn.role==='owner'?colors.lightGreen:colors.white,gap:8,borderWidth:1,borderColor:colors.line}}><Text style={styles.small}>{turn.role==='owner'?'You':'klnk'}</Text><Text selectable style={styles.text}>{turn.text}</Text></View>;}
