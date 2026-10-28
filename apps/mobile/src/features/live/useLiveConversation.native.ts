import { useState } from 'react';
import { nativeLiveSnapshot, type LiveConversation, type LiveSnapshot } from './types';
/** Expo's browser WebRTC globals are not a native iPhone transport. No capture occurs here. */
export function useLiveConversation():LiveConversation{
  const [snapshot,setSnapshot]=useState<LiveSnapshot>(nativeLiveSnapshot);
  return {...snapshot,start:async()=>setSnapshot(value=>({...value,state:'error',error:'Native live voice is not implemented in this build. Open the advanced workspace for bounded recorded turns or Type. A compatible native transport and iPhone verification are still required.'})),end:async()=>setSnapshot(value=>({...value,state:'ended',statusText:'Microphone off.'})),toggleMute:()=>{},toggleCaptions:()=>setSnapshot(value=>({...value,captionsOpen:!value.captionsOpen})),enableAudio:async()=>{}};
}
