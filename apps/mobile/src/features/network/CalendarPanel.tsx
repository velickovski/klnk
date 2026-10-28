import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Text,View} from 'react-native';
import type {NetworkAcceptance,NetworkEvent,NetworkReminder} from '@personal-agent/domain';
import {getSessionSnapshot,isSessionCurrent} from '../../api';
import {Badge,Button,Card,Disclosure,Empty,Notice,useUI} from '../../ui';
import {networkApi} from './api';

type CalendarView={events:NetworkEvent[];reminders:NetworkReminder[];scope:'klnk_only'};
function dateTime(value:string,timezone:string) {
  return new Intl.DateTimeFormat(undefined,{timeZone:timezone,year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));
}
function acceptanceLabel(source:NetworkAcceptance['source']) {
  return source==='owner_approval'?'Owner approved these exact terms':source==='owner_request'?'Accepted through the owner’s original request':'Accepted under a current delegation rule';
}

export function CalendarPanel({ownerId,onConversation}:{ownerId:string;onConversation?:(id:string)=>void}) {
  const {styles}=useUI();
  const [data,setData]=useState<CalendarView>(),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [working,setWorking]=useState(false),[confirmId,setConfirmId]=useState<string>();
  const lifetime=useRef(0),request=useRef(0),busy=useRef(false);
  const load=useCallback(async()=>{
    const identity=lifetime.current,sequence=++request.current,snapshot=getSessionSnapshot();
    const current=()=>identity===lifetime.current&&sequence===request.current&&isSessionCurrent(snapshot);
    setWorking(true);setError('');
    try {const value=await networkApi.request<CalendarView>('/network/calendar');if(current())setData(value);}
    catch(cause) {if(current())setError(cause instanceof Error?cause.message:'Calendar could not be loaded. Try again.');}
    finally {if(current())setWorking(false);}
  },[ownerId]);
  useEffect(()=>{
    lifetime.current++;busy.current=false;setData(undefined);setError('');setNotice('');setConfirmId(undefined);void load();
    return()=>{lifetime.current++;request.current++;};
  },[load]);

  const mutate=async(path:string,body:unknown,message:string)=>{
    if(busy.current||working)return;
    busy.current=true;setWorking(true);setError('');setNotice('');
    const identity=lifetime.current,sequence=++request.current,snapshot=getSessionSnapshot();
    const current=()=>identity===lifetime.current&&sequence===request.current&&isSessionCurrent(snapshot);
    let applied=false;
    try {
      await networkApi.request(path,'POST',body);if(!current())return;
      applied=true;setConfirmId(undefined);setNotice(message);
      const next=await networkApi.request<CalendarView>('/network/calendar');
      if(current())setData(next);
    } catch(cause) {
      if(current()){setError(applied?'The change was saved, but the refreshed calendar could not be loaded. Refresh calendar to see the current details.':cause instanceof Error?cause.message:'This change could not be confirmed. Refresh the calendar before trying again.');setConfirmId(undefined);}
    } finally {if(current()){busy.current=false;setWorking(false);}}
  };

  return <>
    <View style={{gap:8}}><Text style={styles.label}>IN-APP AGREEMENTS</Text><Text accessibilityRole="header" style={styles.title}>Your calendar.</Text><Text style={styles.subtitle}>Meetings accepted by both representatives, with your own reminders.</Text></View>
    <Notice>This calendar covers klnk meetings only. Reminders appear in the app; a scheduled or due reminder does not confirm that a push notification was delivered.</Notice>
    {error?<Notice tone="error">{error}</Notice>:null}
    {notice?<Text accessibilityLiveRegion="polite" style={styles.text}>{notice}</Text>:null}
    <Button label={working?'Loading calendar':'Refresh calendar'} secondary loading={working} onPress={()=>{if(!busy.current)void load();}}/>
    {!data&&!working?<Card><Empty icon="calendar-outline" title="Calendar unavailable" detail="Refresh to load current meetings and reminders."/></Card>:null}
    {data&&!data.events.length?<Card><Empty icon="calendar-outline" title="No shared meetings yet" detail="A meeting appears after both participants accept the same terms. Your other calendars are not connected here."/></Card>:null}
    {data?.events.map(event=>{
      const slot=event.terms.slot,own=event.acceptances.find(value=>value.ownerId===ownerId),other=event.acceptances.find(value=>value.ownerId!==ownerId);
      return <Card key={event.id}>
        <Text accessibilityRole="header" style={styles.h3}>{event.terms.purpose}</Text>
        <Badge text={event.status==='confirmed'?'Confirmed by both participants':'Cancelled'} tone={event.status==='confirmed'?'green':'neutral'}/>
        <Text style={styles.text}>{dateTime(slot.startAt,slot.timezone)}{ '\n'}to {dateTime(slot.endAt,slot.timezone)}</Text>
        <Text style={styles.small}>Meeting timezone: {slot.timezone}</Text>
        <Disclosure title={`Meeting details: ${event.terms.purpose}`}>
          <View style={{gap:12}}>
            <Text style={styles.text}>{event.terms.location?`Location: ${event.terms.location}`:'No location was included in the agreement.'}</Text>
            <Text style={styles.small}>Topic: {event.terms.topic}</Text>
            {own?<Text style={styles.small}>Your acceptance: {acceptanceLabel(own.source)}</Text>:null}
            {other?<Text style={styles.small}>Other participant: {acceptanceLabel(other.source)}</Text>:null}
            <Text style={styles.small}>Agreement revision {event.revision}. Changing the time, location or purpose requires a new request and fresh matching acceptances.</Text>
          </View>
        </Disclosure>
        {onConversation?<Button label={`Open conversation: ${event.terms.purpose}`} secondary disabled={working} onPress={()=>onConversation(event.conversationId)}/>:null}
        {event.status==='confirmed'?confirmId===event.id?<View style={{gap:12}}>
          <Notice tone="warning">Cancel this meeting for both participants and cancel both participants’ in-app reminders. The agreement history will remain visible.</Notice>
          <Button label={`Confirm cancel meeting: ${event.terms.purpose}`} danger loading={working} onPress={()=>void mutate(`/network/calendar/${event.id}/cancel`,{revision:event.revision},'Meeting cancelled for both participants. In-app reminders are cancelled.')}/>
          <Button label="Keep meeting" secondary disabled={working} onPress={()=>setConfirmId(undefined)}/>
        </View>:<Button label={`Cancel meeting: ${event.terms.purpose}`} danger secondary disabled={working} onPress={()=>setConfirmId(event.id)}/>:null}
      </Card>;
    })}
    {data?<View style={{gap:16}}>
      <Text accessibilityRole="header" style={styles.h3}>Your in-app reminders</Text>
      {!data.reminders.length?<Text style={styles.text}>No reminders are scheduled for your shared meetings.</Text>:null}
      {data.reminders.map(reminder=><Reminder key={reminder.id} reminder={reminder} working={working} onDismiss={()=>void mutate(`/network/reminders/${reminder.id}/dismiss`,{},'Your in-app reminder was dismissed.')}/>)}
    </View>:null}
  </>;
}

function Reminder({reminder,working,onDismiss}:{reminder:NetworkReminder;working:boolean;onDismiss:()=>void}) {
  const {styles}=useUI();
  return <Card>
    <Text style={styles.text}>{reminder.text}</Text>
    <Badge text={{scheduled:'Scheduled in app',due:'Due in app',dismissed:'Dismissed',cancelled:'Cancelled'}[reminder.status]} tone={reminder.status==='due'?'amber':'neutral'}/>
    <Text style={styles.small}>{dateTime(reminder.dueAt,reminder.timezone)} · {reminder.timezone}</Text>
    {['scheduled','due'].includes(reminder.status)?<Button label={`Dismiss my reminder: ${reminder.text}`} secondary disabled={working} onPress={onDismiss}/>:null}
  </Card>;
}
