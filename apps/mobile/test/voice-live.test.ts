import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserLiveController, type LiveEnvironment } from '../src/features/live/browser-live';
import { appendLiveDelta, nativeLiveSnapshot } from '../src/features/live/types';
import { browserFetch } from '../src/features/live/browser-fetch';
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};};
class Track extends EventTarget{enabled=true;readyState='live';stop=vi.fn(()=>{this.readyState='ended';});}
class Channel extends EventTarget{readyState='open';sent:string[]=[];send=(value:string)=>this.sent.push(value);close=vi.fn(()=>{this.readyState='closed';this.dispatchEvent(new Event('close'));});emit(event:unknown){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(event)}));}}
class Peer extends EventTarget{iceGatheringState='complete';connectionState='new';localDescription:{sdp:string}|null=null;channel=new Channel();addTrack=vi.fn();createDataChannel=()=>this.channel;createOffer=async()=>({type:'offer',sdp:'v=0\r\nm=audio fixture'});setLocalDescription=async(offer:{sdp:string})=>{this.localDescription=offer;};setRemoteDescription=vi.fn(async()=>{});close=vi.fn(()=>{this.connectionState='closed';});}
const response=(data:unknown)=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
function fixture(){
  const track=new Track(),stream={getTracks:()=>[track],getAudioTracks:()=>[track]} as unknown as MediaStream,peer=new Peer();
  let address='http://localhost:4000',authorization:string|undefined='Bearer owner-fixture',epoch=0;
  const request=vi.fn(async(path:string):Promise<unknown>=>path==='/demo/status'?{configured:true}:path==='/voice/live/recovery'?{requests:[]}:{token:'fixture-token'});
  const fetcher=vi.fn(async(url:string|URL|Request,options?:RequestInit)=>String(url).endsWith('/voice/live/session')?response({session:{id:'session-fixture'},transport:{type:'webrtc',sdp:'fixture answer'},maxDurationSeconds:300}):response({status:'closed'}));
  const capture=vi.fn(async()=>stream),audio={play:vi.fn(async()=>{}),pause:vi.fn(),srcObject:null};
  const env:LiveEnvironment={supported:true,request:request as LiveEnvironment['request'],connection:()=>({address,authorization}),identity:()=>({generation:epoch,url:address,token:authorization?.slice(7)??null}),saveToken:vi.fn(async(token:string)=>{epoch++;authorization=undefined;controller.identityChanged();authorization=`Bearer ${token}`;controller.identityChanged();}),fetcher:fetcher as typeof fetch,capture,peer:()=>peer as unknown as RTCPeerConnection,audio:()=>audio as unknown as HTMLAudioElement};
  const controller=new BrowserLiveController(env);return {controller,env,track,stream,peer,request,fetcher,capture,audio,setConnection:(next:string)=>{address=next;authorization='Bearer different-owner';epoch++;},setIdentity:(token:string|null,next=address)=>{epoch++;address=next;authorization=token?`Bearer ${token}`:undefined;controller.identityChanged();}};
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('Expo browser live transport without a microphone or provider',()=>{
  it('readiness never starts media and native capability remains unavailable',async()=>{const f=fixture();await f.controller.refresh();expect(f.capture).not.toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled();expect(nativeLiveSnapshot.supported).toBe(false);});
  it('leaves a never-started controller idle during disposal without capture or close requests',async()=>{const f=fixture();f.controller.dispose();await Promise.resolve();expect(f.controller.getSnapshot()).toMatchObject({state:'idle',error:'',closureUnconfirmed:false});expect(f.capture).not.toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled();});
  it('preserves a setup failure when cleanup has no session to close',async()=>{const f=fixture();f.request.mockResolvedValueOnce({configured:false});await f.controller.start();const error=f.controller.getSnapshot().error;f.controller.dispose();await Promise.resolve();expect(f.controller.getSnapshot()).toMatchObject({state:'error',error});expect(f.capture).not.toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled();});
  it('preserves broker startup uncertainty when retrying End without a known session ID',async()=>{const f=fixture();f.request.mockResolvedValueOnce({configured:true,startupUnconfirmed:true} as never);await f.controller.refresh();await f.controller.end();expect(f.controller.getSnapshot().closureUnconfirmed).toBe(true);await f.controller.start();expect(f.capture).not.toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled();});
  it('waits for session.started rather than inventing a connected state or replies',async()=>{const f=fixture();await f.controller.start();expect(f.controller.getSnapshot()).toMatchObject({state:'connecting',turns:[]});f.peer.channel.emit({type:'session.started'});expect(f.controller.getSnapshot().state).toBe('connected');await f.controller.end();expect(f.track.stop).toHaveBeenCalled();expect(f.peer.close).toHaveBeenCalled();});
  it('preserves the browser fetch receiver for create, close and closure readback',async()=>{
    const f=fixture();
    const browserRequest=vi.fn(function(this:unknown,input:RequestInfo|URL){
      if(this!==globalThis)throw new TypeError('Illegal invocation');
      const url=String(input);
      return Promise.resolve(response(url.endsWith('/voice/live/session')?{session:{id:'session-fixture'},transport:{type:'webrtc',sdp:'fixture answer'}}:url.endsWith('/close')?{status:'closing'}:{sessionId:'session-fixture',status:'closed'}));
    });
    vi.stubGlobal('fetch',browserRequest);f.env.fetcher=browserFetch;
    await f.controller.start();expect(f.controller.getSnapshot()).toMatchObject({state:'connecting',closureUnconfirmed:false});
    await f.controller.end();expect(f.controller.getSnapshot()).toMatchObject({state:'ended',closureUnconfirmed:false});
    expect(browserRequest).toHaveBeenCalledTimes(3);expect(browserRequest.mock.contexts.every(receiver=>receiver===globalThis)).toBe(true);
  });
  it('sends a small authenticated keepalive close request after immediately stopping capture',async()=>{const f=fixture();await f.controller.start();f.fetcher.mockImplementationOnce(async(_url:string|URL|Request,options?:RequestInit)=>{expect(f.track.stop).toHaveBeenCalled();expect(options).toMatchObject({method:'POST',keepalive:true,body:'{}',headers:{Authorization:'Bearer owner-fixture'}});return response({status:'closed'});});await f.controller.end();expect(f.controller.getSnapshot().closureUnconfirmed).toBe(false);});
  it('blocks duplicate starts while capture is pending and releases a late stream after End',async()=>{const f=fixture(),capture=deferred<MediaStream>();f.env.capture=vi.fn(()=>capture.promise);const starting=f.controller.start();await vi.waitFor(()=>expect(f.env.capture).toHaveBeenCalledTimes(1));await f.controller.start();await f.controller.end();capture.resolve(f.stream);await starting;expect(f.track.stop).toHaveBeenCalledTimes(1);expect(f.fetcher).not.toHaveBeenCalled();expect(f.controller.getSnapshot()).toMatchObject({state:'ended',closureUnconfirmed:false});});
  it('shows a permission failure with no audio, transcript or provider creation',async()=>{const f=fixture();f.env.capture=vi.fn().mockRejectedValue(Object.assign(new Error('Denied'),{name:'NotAllowedError'}));await f.controller.start();expect(f.controller.getSnapshot()).toMatchObject({state:'error',turns:[],closureUnconfirmed:false});expect(f.controller.getSnapshot().error).toContain('Microphone access is off');expect(f.fetcher).not.toHaveBeenCalled();});
  it('closes a late creation result with its original server and owner',async()=>{const f=fixture(),creation=deferred<Response>();f.fetcher.mockImplementationOnce(()=>creation.promise);const starting=f.controller.start();await vi.waitFor(()=>expect(f.fetcher).toHaveBeenCalledTimes(1));await f.controller.end();expect(f.controller.getSnapshot().closureUnconfirmed).toBe(true);await f.controller.start();expect(f.capture).toHaveBeenCalledTimes(1);f.setConnection('https://different.example');creation.resolve(response({session:{id:'late-session'},transport:{type:'webrtc',sdp:'answer'}}));await starting;expect(f.fetcher.mock.calls.at(-1)![0]).toBe('http://localhost:4000/voice/live/session/late-session/close');expect(f.fetcher.mock.calls.at(-1)![1]?.headers).toMatchObject({Authorization:'Bearer owner-fixture'});expect(f.controller.getSnapshot()).toMatchObject({state:'ended',closureUnconfirmed:false});});
  it('blocks another session after an ambiguous creation response',async()=>{const f=fixture();f.fetcher.mockRejectedValueOnce(new TypeError('Connection lost'));await f.controller.start();expect(f.controller.getSnapshot()).toMatchObject({state:'error',closureUnconfirmed:true,turns:[]});await f.controller.start();expect(f.capture).toHaveBeenCalledTimes(1);expect(f.track.stop).toHaveBeenCalled();});
  it('does not claim uncertain provider creation when fetch throws before returning a request',async()=>{
    const f=fixture();f.env.fetcher=(()=>{throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");}) as typeof fetch;
    await f.controller.start();expect(f.controller.getSnapshot()).toMatchObject({state:'error',closureUnconfirmed:false,turns:[]});expect(f.track.stop).toHaveBeenCalled();
    f.env.fetcher=f.fetcher as typeof fetch;await f.controller.start();expect(f.fetcher).toHaveBeenCalledTimes(1);await f.controller.end();
  });
  it('permits an explicit retry after a definite provider rejection without pretending a session needs closure',async()=>{const f=fixture();f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({error:'openai_session_failed',message:'Check model access.'}),{status:502}));await f.controller.start();expect(f.controller.getSnapshot()).toMatchObject({state:'error',closureUnconfirmed:false,turns:[]});await f.controller.start();expect(f.capture).toHaveBeenCalledTimes(2);await f.controller.end();});
  it('keeps an unconfirmed close distinct from service-confirmed closure and retries the same ID',async()=>{const f=fixture();await f.controller.start();f.peer.channel.emit({type:'session.started'});f.fetcher.mockRejectedValueOnce(new Error('Offline'));await f.controller.end();expect(f.controller.getSnapshot()).toMatchObject({state:'ended',closureUnconfirmed:true});expect(f.track.stop).toHaveBeenCalled();await f.controller.end();expect(f.controller.getSnapshot().closureUnconfirmed).toBe(false);expect(f.fetcher.mock.calls.slice(1).every(call=>String(call[0]).includes('session-fixture/close'))).toBe(true);});
  it('does not accept another session identity as closure evidence',async()=>{vi.useFakeTimers();const f=fixture();await f.controller.start();f.fetcher.mockImplementation(async(url:string|URL|Request)=>response(String(url).endsWith('/close')?{status:'closing'}:{sessionId:'different-session',status:'closed'}));const ending=f.controller.end();await vi.advanceTimersByTimeAsync(5000);await ending;expect(f.controller.getSnapshot().closureUnconfirmed).toBe(true);f.fetcher.mockResolvedValue(response({status:'closed'}));await f.controller.end();});
  it.each(['owner end','service closure'])('ignores a stale remote SDP completion after %s and a new session',async(reason)=>{
    vi.useFakeTimers();const f=fixture(),remote=deferred<void>();f.peer.setRemoteDescription=vi.fn(()=>remote.promise);f.fetcher.mockResolvedValueOnce(response({session:{id:'old-session'},transport:{type:'webrtc',sdp:'answer'},maxDurationSeconds:1}));const first=f.controller.start();await vi.waitFor(()=>expect(f.peer.setRemoteDescription).toHaveBeenCalled());
    if(reason==='owner end')await f.controller.end();else f.peer.channel.emit({type:'session.closed'});
    const nextPeer=new Peer(),nextTrack=new Track(),nextStream={getTracks:()=>[nextTrack],getAudioTracks:()=>[nextTrack]} as unknown as MediaStream;f.env.peer=()=>nextPeer as unknown as RTCPeerConnection;f.env.capture=async()=>nextStream;await f.controller.start();nextPeer.channel.emit({type:'session.started'});remote.resolve();await first;await vi.advanceTimersByTimeAsync(1000);expect(f.controller.getSnapshot().state).toBe('connected');await f.controller.end();
  });
  it('requires a matching service acknowledgement before reopening the microphone',async()=>{vi.useFakeTimers();const f=fixture();await f.controller.start();f.peer.channel.emit({type:'session.started'});f.controller.toggleMute();const mute=JSON.parse(f.peer.channel.sent.at(-1)!);expect(f.track.enabled).toBe(false);f.peer.channel.emit({type:'session.input_audio.muted',client_event_id:mute.event_id});expect(f.controller.getSnapshot().mutePending).toBe(false);f.controller.toggleMute();const unmute=JSON.parse(f.peer.channel.sent.at(-1)!);f.peer.channel.emit({type:'session.input_audio.unmuted',client_event_id:'wrong'});expect(f.track.enabled).toBe(false);await vi.advanceTimersByTimeAsync(5000);expect(f.controller.getSnapshot()).toMatchObject({muted:true,mutePending:false});f.controller.toggleMute();const retry=JSON.parse(f.peer.channel.sent.at(-1)!);f.peer.channel.emit({type:'session.input_audio.unmuted',client_event_id:retry.event_id});expect(retry.event_id).not.toBe(unmute.event_id);expect(f.track.enabled).toBe(true);await f.controller.end();});
  it('preserves overlapping caption deltas and significant spaces',()=>{let turns=appendLiveDelta([],'You','Meet ',0,500);turns=appendLiveDelta(turns,'klnk','Okay.',0,100);turns=appendLiveDelta(turns,'You','near the fountain.',500,1500);expect(turns).toHaveLength(2);expect(turns[0].text).toBe('Meet near the fountain.');turns=appendLiveDelta(turns,'You','Next turn.',4000,4500);expect(turns).toHaveLength(3);});
  it.each([null,{},[],{configured:'true'},{configured:true,startupUnconfirmed:'false'}])('rejects malformed readiness before microphone access: %j',async(value)=>{
    const f=fixture();f.request.mockResolvedValueOnce(value as never);await f.controller.start();
    expect(f.capture).not.toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled();expect(f.controller.getSnapshot()).toMatchObject({state:'error',closureUnconfirmed:false});
  });
  it.each([null,[],{},'not an object'])('keeps malformed creation uncertain and prohibits another paid start: %j',async(value)=>{
    const f=fixture();f.fetcher.mockResolvedValueOnce(response(value));await f.controller.start();await f.controller.start();
    expect(f.fetcher).toHaveBeenCalledTimes(1);expect(f.track.stop).toHaveBeenCalled();expect(f.controller.getSnapshot().closureUnconfirmed).toBe(true);
  });
  it('retains an identified malformed creation for cleanup before checking its answer',async()=>{
    const f=fixture();f.fetcher.mockResolvedValueOnce(response({session:{id:'malformed-owned'},transport:{type:'webrtc',sdp:123}}));await f.controller.start();
    expect(f.fetcher.mock.calls[1][0]).toBe('http://localhost:4000/voice/live/session/malformed-owned/close');expect(f.peer.setRemoteDescription).not.toHaveBeenCalled();expect(f.controller.getSnapshot().closureUnconfirmed).toBe(false);
  });
  it.each([null,[],{},'closed',{status:true}])('never treats a malformed close payload as terminal evidence: %j',async(value)=>{
    const f=fixture();await f.controller.start();f.fetcher.mockResolvedValueOnce(response(value));await f.controller.end();
    expect(f.controller.getSnapshot().closureUnconfirmed).toBe(true);expect(f.track.stop).toHaveBeenCalled();f.fetcher.mockResolvedValueOnce(response({status:'closed'}));await f.controller.end();
  });
  it('stops media and removes old captions immediately on same-origin account replacement',async()=>{
    const f=fixture();await f.controller.start();f.peer.channel.emit({type:'session.started'});f.peer.channel.emit({type:'session.input_transcript.delta',delta:'Private fictional owner A text'});
    f.controller.toggleCaptions();const close=deferred<Response>();f.fetcher.mockImplementationOnce(()=>close.promise);f.setIdentity('owner-B');
    expect(f.track.stop).toHaveBeenCalled();expect(f.controller.getSnapshot()).toMatchObject({turns:[],captionsOpen:false,muted:true});
    f.peer.channel.emit({type:'session.output_transcript.delta',delta:'Late A answer'});expect(f.controller.getSnapshot().turns).toEqual([]);
    expect(f.fetcher.mock.calls[1][1]?.headers).toMatchObject({Authorization:'Bearer owner-fixture'});close.resolve(response({status:'closed'}));await f.controller.end();
  });
  it.each(['owner-B',null])('discards late permission after an identity change to %s',async(token)=>{
    const f=fixture(),capture=deferred<MediaStream>();f.env.capture=vi.fn(()=>capture.promise);const starting=f.controller.start();await vi.waitFor(()=>expect(f.env.capture).toHaveBeenCalled());
    f.setIdentity(token);capture.resolve(f.stream);await starting;expect(f.track.stop).toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled();expect(f.controller.getSnapshot().turns).toEqual([]);
  });
  it('reconciles a session created during an account change using only its original authorization',async()=>{
    const f=fixture(),creation=deferred<Response>();f.fetcher.mockImplementationOnce(()=>creation.promise);const starting=f.controller.start();await vi.waitFor(()=>expect(f.fetcher).toHaveBeenCalledTimes(1));
    f.setIdentity('owner-B','https://other.example');await f.controller.start();expect(f.capture).toHaveBeenCalledTimes(1);
    creation.resolve(response({session:{id:'late-owner-A'},transport:{type:'webrtc',sdp:'answer'}}));await starting;
    expect(f.fetcher.mock.calls.at(-1)![0]).toBe('http://localhost:4000/voice/live/session/late-owner-A/close');expect(f.fetcher.mock.calls.at(-1)![1]?.headers).toMatchObject({Authorization:'Bearer owner-fixture'});expect(f.peer.setRemoteDescription).not.toHaveBeenCalled();
  });
  it('adopts its own anonymous demo sign-in without cancelling capture',async()=>{
    const f=fixture();f.setIdentity(null);await f.controller.start();expect(f.env.saveToken).toHaveBeenCalledWith('fixture-token');expect(f.capture).toHaveBeenCalledTimes(1);expect(f.track.stop).not.toHaveBeenCalled();expect(f.fetcher.mock.calls[0][1]?.headers).toMatchObject({Authorization:'Bearer fixture-token'});await f.controller.end();
  });
  it('does not overwrite an account selected while anonymous authorization was pending',async()=>{
    const f=fixture(),auth=deferred<{token:string}>();f.setIdentity(null);f.request.mockImplementation(async path=>path==='/auth/demo'?auth.promise:{configured:true});const starting=f.controller.start();await vi.waitFor(()=>expect(f.request).toHaveBeenCalledWith('/auth/demo','POST',{}));
    f.setIdentity('owner-B');auth.resolve({token:'stale-demo-token'});await starting;expect(f.env.saveToken).not.toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled();expect(f.track.stop).toHaveBeenCalled();
  });
  it('rejects a competing epoch during its own demo credential save',async()=>{
    const f=fixture(),saved=deferred<void>();f.setIdentity(null);f.env.saveToken=vi.fn(()=>saved.promise);const starting=f.controller.start();await vi.waitFor(()=>expect(f.env.saveToken).toHaveBeenCalled());
    f.setIdentity('owner-B');saved.resolve();await starting;expect(f.fetcher).not.toHaveBeenCalled();expect(f.track.stop).toHaveBeenCalled();
  });
  it('rejects invalid JSON success without creating a replacement session',async()=>{
    const f=fixture();f.fetcher.mockResolvedValueOnce(new Response('{invalid',{status:200}));await f.controller.start();await f.controller.start();expect(f.fetcher).toHaveBeenCalledTimes(1);expect(f.controller.getSnapshot().closureUnconfirmed).toBe(true);
  });
  it('reconciles a lost creation response by its retained UUID and closes only the recovered session',async()=>{
    const f=fixture();f.fetcher.mockRejectedValueOnce(new TypeError('Lost response'));await f.controller.start();const sent=JSON.parse(f.fetcher.mock.calls[0][1]!.body as string);
    expect(sent.requestId).toMatch(/^[0-9a-f-]{36}$/);f.fetcher.mockImplementation(async(url)=>String(url).includes('/requests/')?response({requestId:sent.requestId,receiptId:'receipt-fixture',status:'active',sessionId:'recovered-session',expiresAt:Date.now()+300000}):response({status:'closed'}));
    await f.controller.end();expect(f.fetcher.mock.calls[1][0]).toBe(`http://localhost:4000/voice/live/requests/${sent.requestId}`);expect(f.fetcher.mock.calls[2][0]).toBe('http://localhost:4000/voice/live/session/recovered-session/close');
    expect(f.fetcher.mock.calls.filter(call=>String(call[0]).endsWith('/voice/live/session'))).toHaveLength(1);expect(f.controller.getSnapshot().closureUnconfirmed).toBe(false);
  });
  it('does not release a lost creation from a different request receipt or an unknown receipt',async()=>{
    const f=fixture();f.fetcher.mockRejectedValueOnce(new TypeError('Lost response'));await f.controller.start();
    f.fetcher.mockResolvedValue(response({requestId:'different',receiptId:'receipt',status:'closed',expiresAt:Date.now()}));await f.controller.end();await f.controller.start();
    expect(f.controller.getSnapshot().closureUnconfirmed).toBe(true);expect(f.capture).toHaveBeenCalledTimes(1);
  });
  it('warns one minute before the actual cap without inventing closure or resuming media',async()=>{
    vi.useFakeTimers();const f=fixture();await f.controller.start();f.peer.channel.emit({type:'session.started'});await vi.advanceTimersByTimeAsync(240000);
    expect(f.controller.getSnapshot().durationWarning).toContain('one minute');expect(f.controller.getSnapshot().state).toBe('connected');expect(f.track.stop).not.toHaveBeenCalled();await f.controller.end();expect(f.controller.getSnapshot().durationWarning).toBe('');
  });
  it('recovers a known owner session on mount without capture or a new creation',async()=>{
    const f=fixture(),saved={requestId:crypto.randomUUID(),receiptId:crypto.randomUUID(),status:'active',sessionId:'saved-provider',expiresAt:Date.now()+300000};
    f.request.mockImplementation(async path=>path==='/voice/live/recovery'?{requests:[saved]}:{configured:true});await f.controller.refresh();expect(f.controller.getSnapshot()).toMatchObject({state:'ended',closureUnconfirmed:true,muted:true,turns:[]});expect(f.capture).not.toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled();
    await f.controller.end();expect(f.fetcher.mock.calls[0][0]).toBe('http://localhost:4000/voice/live/session/saved-provider/close');expect(f.controller.getSnapshot().closureUnconfirmed).toBe(false);
  });
  it('keeps a recovered no-ID request blocked across repeated End and Start',async()=>{
    const f=fixture(),saved={requestId:crypto.randomUUID(),receiptId:crypto.randomUUID(),status:'unconfirmed',expiresAt:Date.now()+300000};f.request.mockImplementation(async path=>path==='/voice/live/recovery'?{requests:[saved]}:{configured:true});f.fetcher.mockResolvedValue(response(saved));
    await f.controller.start();expect(f.controller.getSnapshot()).toMatchObject({state:'ended',closureUnconfirmed:true});expect(f.controller.getSnapshot().error).toContain('no confirmed provider identity');await f.controller.end();await f.controller.start();expect(f.capture).not.toHaveBeenCalled();expect(f.fetcher.mock.calls.every(call=>String(call[0]).includes('/requests/'))).toBe(true);
  });
  it('never asks for owner recovery anonymously during readiness',async()=>{
    const f=fixture();f.setIdentity(null);f.request.mockClear();await f.controller.refresh();expect(f.request.mock.calls.map(call=>call[0])).toEqual(['/demo/status']);expect(f.capture).not.toHaveBeenCalled();
  });
  it.each(['same origin','different origin'])('ignores late recovery from a previous identity on %s',async(origin)=>{
    const f=fixture(),saved=deferred<unknown>();f.request.mockImplementation(async path=>path==='/voice/live/recovery'?saved.promise:{configured:true});const refreshing=f.controller.refresh();await vi.waitFor(()=>expect(f.request).toHaveBeenCalledWith('/voice/live/recovery'));
    f.setIdentity('next-owner',origin==='different origin'?'https://other.example':'http://localhost:4000');saved.resolve({requests:[{requestId:crypto.randomUUID(),receiptId:crypto.randomUUID(),status:'active',sessionId:'previous-owner',expiresAt:Date.now()}]});await refreshing;expect(f.controller.getSnapshot()).toMatchObject({state:'idle',closureUnconfirmed:false,turns:[]});expect(f.fetcher).not.toHaveBeenCalled();expect(f.capture).not.toHaveBeenCalled();
  });
  it('does not disturb a connected session or captions during a normal readiness refresh',async()=>{
    const f=fixture();await f.controller.start();f.peer.channel.emit({type:'session.started'});f.peer.channel.emit({type:'session.output_transcript.delta',delta:'Fictional current caption'});f.request.mockClear();await f.controller.refresh();expect(f.request.mock.calls.map(call=>call[0])).toEqual(['/demo/status']);expect(f.controller.getSnapshot()).toMatchObject({state:'connected',closureUnconfirmed:false,turns:[{id:'1',speaker:'klnk',text:'Fictional current caption'}]});expect(f.track.stop).not.toHaveBeenCalled();await f.controller.end();
  });
  it('does not cancel a starting recovery check when an ordinary refresh completes',async()=>{
    const f=fixture(),recovery=deferred<unknown>();f.request.mockImplementation(async path=>path==='/voice/live/recovery'?recovery.promise:{configured:true});const starting=f.controller.start();await vi.waitFor(()=>expect(f.request).toHaveBeenCalledWith('/voice/live/recovery'));await f.controller.refresh();recovery.resolve({requests:[]});await starting;expect(f.fetcher).toHaveBeenCalledTimes(1);expect(f.controller.getSnapshot().state).toBe('connecting');await f.controller.end();
  });
  it('adopts a refreshed credential only after the server lists the same owner-bound receipt',async()=>{
    const f=fixture(),saved={requestId:crypto.randomUUID(),receiptId:crypto.randomUUID(),status:'active',sessionId:'saved-provider',expiresAt:Date.now()+300000};f.request.mockImplementation(async path=>path==='/voice/live/recovery'?{requests:[saved]}:{configured:true});await f.controller.refresh();f.fetcher.mockRejectedValueOnce(new Error('Old credential revoked'));f.setIdentity('refreshed-owner-credential');
    await vi.waitFor(()=>expect(f.request.mock.calls.filter(call=>call[0]==='/voice/live/recovery')).toHaveLength(2));await f.controller.end();expect(f.fetcher.mock.calls.at(-1)![1]?.headers).toMatchObject({Authorization:'Bearer refreshed-owner-credential'});expect(f.capture).not.toHaveBeenCalled();expect(f.controller.getSnapshot().closureUnconfirmed).toBe(false);
  });
  it('reconciles a concurrent-device reservation denial by its actual saved UUID',async()=>{
    const f=fixture(),saved={requestId:crypto.randomUUID(),receiptId:crypto.randomUUID(),status:'active',sessionId:'other-device-session',expiresAt:Date.now()+300000};let reads=0;f.request.mockImplementation(async path=>path==='/voice/live/recovery'?{requests:reads++?[saved]:[]}:{configured:true});f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({error:'voice_session_unresolved',message:'An existing fixture needs reconciliation.'}),{status:409}));
    await f.controller.start();expect(f.controller.getSnapshot()).toMatchObject({state:'ended',closureUnconfirmed:true});expect(f.track.stop).toHaveBeenCalled();await f.controller.end();expect(f.fetcher.mock.calls.at(-1)![0]).toBe('http://localhost:4000/voice/live/session/other-device-session/close');expect(f.fetcher.mock.calls.filter(call=>String(call[0]).endsWith('/voice/live/session'))).toHaveLength(1);
  });
  it('does not replace an old owner unknown receipt with another owner using the same request UUID',async()=>{
    const f=fixture(),requestId=crypto.randomUUID(),original={requestId,receiptId:crypto.randomUUID(),status:'unconfirmed',expiresAt:Date.now()+300000},other={...original,receiptId:crypto.randomUUID()};let changed=false;
    f.request.mockImplementation(async path=>path==='/voice/live/recovery'?{requests:[changed?other:original]}:path.startsWith('/voice/live/requests/')?{...other,status:'closed'}:{configured:true});await f.controller.refresh();f.fetcher.mockRejectedValue(new Error('Original credential expired'));changed=true;f.setIdentity('different-owner');
    await vi.waitFor(()=>expect(f.request.mock.calls.filter(call=>call[0]==='/voice/live/recovery')).toHaveLength(2));await vi.waitFor(()=>expect(f.request.mock.calls.some(call=>call[0].startsWith('/voice/live/requests/'))).toBe(true));expect(f.controller.getSnapshot().closureUnconfirmed).toBe(true);await f.controller.start();expect(f.capture).not.toHaveBeenCalled();
  });
  it.each([null,{}, {requests:null},{requests:[{requestId:'wrong'}]}])('rejects malformed owner recovery before capture: %j',async(value)=>{
    const f=fixture();f.request.mockImplementation(async path=>path==='/voice/live/recovery'?value:{configured:true});await f.controller.start();expect(f.controller.getSnapshot()).toMatchObject({state:'error',closureUnconfirmed:false});expect(f.capture).not.toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('ignores an owner recovery response after controller disposal',async()=>{
    const f=fixture(),saved=deferred<unknown>();f.request.mockImplementation(async path=>path==='/voice/live/recovery'?saved.promise:{configured:true});const refreshing=f.controller.refresh();await vi.waitFor(()=>expect(f.request).toHaveBeenCalledWith('/voice/live/recovery'));f.controller.dispose();saved.resolve({requests:[{requestId:crypto.randomUUID(),receiptId:crypto.randomUUID(),status:'unconfirmed',expiresAt:Date.now()}]});await refreshing;expect(f.controller.getSnapshot().closureUnconfirmed).toBe(false);expect(f.fetcher).not.toHaveBeenCalled();
  });
});
