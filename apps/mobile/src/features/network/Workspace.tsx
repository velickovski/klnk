import React,{useState} from 'react';
import {Platform,Pressable,ScrollView,Text,View,useWindowDimensions} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {a11yState,Button,Card,IconButton,Notice,useUI} from '../../ui';
import {InboxPanel} from './InboxPanel';
import {PeoplePanel} from './PeoplePanel';
import {MemoryPanel} from './MemoryPanel';
import {AutonomyPanel} from './AutonomyPanel';
import {CalendarPanel} from './CalendarPanel';
import {VoiceAccessPanel} from './VoiceAccessPanel';
import {PreferencesPanel} from './PreferencesPanel';
import {NotificationsPanel} from './NotificationsPanel';
import {OwnerIntentPanel} from './OwnerIntentPanel';

type Panel='Inbox'|'Calendar'|'People'|'Memory'|'Settings';
export function NetworkWorkspace({ownerId,onVoiceHome,onLegacy,onSignOut}:{ownerId:string;onVoiceHome:()=>void;onLegacy:()=>void;onSignOut:()=>void}){
  const {colors,styles}=useUI(),[panel,setPanel]=useState<Panel>('Inbox'),dimensions=useWindowDimensions();
  // CSS intrinsic width responds to browser text/spacing overrides; native uses
  // Dynamic Type's scale. Fixed percentage columns would overlap enlarged text.
  const tabMinimum=Platform.OS==='web'?'max-content' as unknown as number:Math.min(dimensions.width-48,84*Math.max(1,dimensions.fontScale));
  const names:Panel[]=['Inbox','Calendar','People','Memory','Settings'];
  return <SafeAreaView style={{flex:1,width:'100%',maxWidth:720,alignSelf:'center',backgroundColor:colors.paper}}>
    <View style={{padding:16,gap:16,flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderColor:colors.line}}><IconButton name="arrow-back" label="Back to voice home" onPress={onVoiceHome}/><View style={{flex:1}}><Text style={styles.h2}>klnk</Text><Text style={styles.small}>Your agent network</Text></View></View>
    <ScrollView style={{flex:1}} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
      {names.map(name=><View key={name} style={{display:panel===name?'flex':'none',gap:20}} accessibilityElementsHidden={panel!==name} importantForAccessibility={panel!==name?'no-hide-descendants':'auto'} {...(Platform.OS==='web'?{'aria-hidden':panel!==name}: {})}>
        {name==='Inbox'?<><OwnerIntentPanel ownerId={ownerId}/><InboxPanel ownerId={ownerId} onCalendar={()=>setPanel('Calendar')}/><NotificationsPanel ownerId={ownerId}/></>:null}
        {name==='Calendar'?<CalendarPanel ownerId={ownerId}/>:null}
        {name==='People'?<PeoplePanel ownerId={ownerId}/>:null}
        {name==='Memory'?<MemoryPanel ownerId={ownerId}/>:null}
        {name==='Settings'?<><AutonomyPanel ownerId={ownerId}/><VoiceAccessPanel ownerId={ownerId}/><PreferencesPanel ownerId={ownerId}/><Card><Text accessibilityRole="header" style={styles.h2}>Privacy & account</Text><Notice>Messages, meetings and reminders stay inside klnk. Owner voice and optional model reasoning use OpenAI’s cloud. klnk’s server reads permitted content; this is not end-to-end encrypted processing.</Notice><Text style={styles.text}>Only the klnk calendar is checked. In-app reminders are available when you return; phone notifications are not enabled.</Text><Button label="Account settings & earlier requests" secondary onPress={onLegacy}/><Text style={styles.small}>Earlier telephone simulations, manual contacts and external adapter settings remain separate. They do not deliver requests in your agent network.</Text><Button label="Sign out" secondary onPress={onSignOut}/></Card></>:null}
      </View>)}
    </ScrollView>
    <View accessibilityRole="tablist" style={{flexDirection:'row',flexWrap:'wrap',justifyContent:'center',padding:8,gap:6,borderTopWidth:1,borderColor:colors.line}}>{names.map(name=><Pressable key={name} accessibilityRole="tab" accessibilityLabel={name} {...a11yState({selected:panel===name})} onPress={()=>setPanel(name)} style={({pressed})=>({flexBasis:'auto',flexGrow:1,minWidth:tabMinimum,maxWidth:'100%',minHeight:48,paddingHorizontal:12,paddingVertical:12,borderRadius:16,backgroundColor:panel===name?colors.action:pressed?colors.lightGreen:colors.paper,borderWidth:1,borderColor:panel===name?colors.line:colors.paper,justifyContent:'center',alignItems:'center'})}><Text style={[styles.text,{fontWeight:panel===name?'600':'400',color:panel===name?colors.onAction:colors.ink,textAlign:'center',flexShrink:Platform.OS==='web'?0:1}]}>{name}</Text></Pressable>)}</View>
  </SafeAreaView>;
}
