import { useEffect, useRef, useSyncExternalStore } from 'react';
import { API_URL, api, authenticatedAudioHeaders, getSessionSnapshot, onSessionChange, setSession } from '../../api';
import { BrowserLiveController } from './browser-live';
import { browserFetch } from './browser-fetch';
import type { LiveConversation } from './types';
export function useLiveConversation():LiveConversation{
  const ref=useRef<BrowserLiveController|null>(null);
  if(!ref.current)ref.current=new BrowserLiveController({supported:typeof window!=='undefined'&&window.isSecureContext&&!!navigator.mediaDevices?.getUserMedia&&typeof RTCPeerConnection!=='undefined',request:api,identity:getSessionSnapshot,connection:()=>({address:API_URL,authorization:authenticatedAudioHeaders().Authorization}),saveToken:setSession,fetcher:browserFetch,capture:()=>navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false}),peer:()=>new RTCPeerConnection(),audio:()=>{const audio=new Audio();audio.autoplay=true;return audio;}});
  const controller=ref.current,snapshot=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
  useEffect(()=>{void controller.refresh();const hidden=()=>{if(document.visibilityState!=='visible'&&['checking','connecting','connected'].includes(controller.getSnapshot().state))void controller.end();};const offline=()=>{if(['checking','connecting','connected'].includes(controller.getSnapshot().state))void controller.end();};const session=onSessionChange(()=>{controller.identityChanged();void controller.refresh();});document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',offline);window.addEventListener('offline',offline);return()=>{session();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',offline);window.removeEventListener('offline',offline);controller.dispose();};},[controller]);
  return {...snapshot,start:()=>controller.start(),end:controller.end,toggleMute:controller.toggleMute,toggleCaptions:controller.toggleCaptions,enableAudio:controller.enableAudio};
}
