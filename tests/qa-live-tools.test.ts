import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createApp} from '../apps/server/src/app.js';
import {Database} from '../apps/server/src/db.js';
import {ApplicationToolGateway} from '../apps/server/src/integrations/gateway.js';
import {OpenAIToolDelegation} from '../apps/server/src/openai-tool-delegation.js';
import type {ToolOutcome} from '../apps/server/src/integrations/tool-contract.js';
import type {Config} from '../apps/server/src/config.js';

const config:Config={production:false,port:4000,host:'127.0.0.1',databaseUrl:undefined,dataDir:'memory://',key:undefined,demoEnabled:true,openaiKey:'fictional-qa-live-key',provider:'simulator',liveEnabled:false,liveOwnerId:undefined,publicBaseUrl:undefined,recipients:[],origins:['http://localhost:8081'],embeddedWorker:false,elevenKey:undefined,agentId:undefined,phoneId:undefined,webhookSecret:undefined,twilioSid:undefined,twilioToken:undefined,standardVoice:undefined,retentionVerified:false,llmProvider:undefined,retentionDisclosure:undefined,ownerAgentId:undefined};
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};};
class Socket extends EventEmitter{
  readyState=1;sent:any[]=[];
  constructor(){super();queueMicrotask(()=>{this.emit('open');this.event({type:'session.started'});});}
  event(value:unknown){this.emit('message',JSON.stringify(value));}
  send(raw:string){const value=JSON.parse(raw);this.sent.push(value);if(value.type==='session.close')queueMicrotask(()=>this.event({type:'session.closed'}));}
  close(){this.readyState=3;this.emit('close');}terminate(){this.close();}
}
const services:Awaited<ReturnType<typeof createApp>>[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const service of services.splice(0)){await service.app.close();await service.db.close();}});
async function fixture(){
  const db=await new Database({dataDir:'memory://'}).open(),bodies:any[]=[],sockets:Socket[]=[];
  const service=await createApp({db,config,worker:false,openaiLiveDependencies:{fetch:async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({session:{id:`fictional-qa-session-${bodies.length}`},transport:{type:'webrtc',sdp:'fictional-qa-answer'}}),{status:201});},socket:()=>{const socket=new Socket();sockets.push(socket);return socket;}}});services.push(service);
  const a=(await service.app.inject({method:'POST',url:'/auth/demo'})).json(),b=(await service.app.inject({method:'POST',url:'/auth/demo'})).json();
  const headers=(token=a.token)=>({host:'localhost:4000',origin:'http://localhost:8081',authorization:`Bearer ${token}`});
  const grant=(enabled:boolean,token=a.token)=>service.app.inject({method:'PUT',url:'/tools/access',headers:headers(token),payload:{enabled,tools:enabled?['contacts_lookup']:[]}});
  const start=(extra:Record<string,unknown>={})=>service.app.inject({method:'POST',url:'/voice/live/session',headers:headers(),payload:{requestId:randomUUID(),sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111',...extra}});
  return{...service,a,b,bodies,sockets,headers,grant,start};
}
function batch(socket:Socket,count=1){
  socket.event({type:'session.delegation.created',delegation:{id:'qa-delegation',target:'responses',response_id:'qa-response'}});
  socket.event({type:'response.event',delegation_id:'qa-delegation',event:{type:'response.created',response:{id:'qa-response'}}});
  for(let index=0;index<count;index++)socket.event({type:'response.event',delegation_id:'qa-delegation',event:{type:'response.output_item.done',response_id:'qa-response',item:{type:'function_call',call_id:`qa-call-${index}`,name:'contacts_lookup',arguments:'{"query":"Jordan","limit":2}'}}});
  socket.event({type:'response.event',delegation_id:'qa-delegation',event:{type:'response.completed',response:{id:'qa-response',status:'completed',output:[]}}});
}

describe('independent actual application-to-Live tool boundary',()=>{
  it('another owner grant and browser-supplied tool/context fields cannot enable this owner',async()=>{
    const f=await fixture();await f.grant(true,f.b.token);const first=await f.start();expect(first.statusCode).toBe(201);expect(f.bodies[0].session.delegation.responses.tools).toEqual([]);expect(f.bodies[0].session.delegation.responses.tool_choice).toBe('none');
    await f.app.inject({method:'POST',url:`/voice/live/session/${first.json().session.id}/close`,headers:f.headers(),payload:{}});
    const invalid=await f.start({tools:['contacts_lookup'],ownerId:f.b.user.id});expect(invalid.statusCode).toBe(400);expect(f.bodies).toHaveLength(1);
    expect(JSON.stringify(f.bodies[0])).not.toContain(f.a.token);expect(JSON.stringify(f.bodies[0])).not.toContain(f.b.token);
  });
  it('grant revocation before a finished callback closes the same session without a lookup',async()=>{
    const f=await fixture();await f.grant(true);const started=await f.start();expect(started.statusCode).toBe(201);await f.grant(false);batch(f.sockets[0]);
    await vi.waitFor(async()=>{const value=await f.openaiLive.read(f.a.user.id,started.json().session.id);expect(value.status).toBe('closed');});
    expect(f.sockets[0].sent.some(value=>value.type==='response.item.create')).toBe(false);expect(await f.repo.list(f.a.user.id,'tool_trace')).toEqual([]);expect(f.bodies).toHaveLength(1);
  });
  it('a result revoked after execution is not delivered or continued',async()=>{
    const f=await fixture();await f.grant(true);const entered=deferred<void>(),resume=deferred<void>();const original=ApplicationToolGateway.prototype.invoke;
    const spy=vi.spyOn(ApplicationToolGateway.prototype,'invoke').mockImplementation(async function(this:ApplicationToolGateway,...args){const result=await original.apply(this,args);entered.resolve();await resume.promise;return result;});
    try{const started=await f.start();expect(started.statusCode).toBe(201);batch(f.sockets[0]);await entered.promise;await f.grant(false);resume.resolve();await vi.waitFor(async()=>expect((await f.openaiLive.read(f.a.user.id,started.json().session.id)).status).toBe('closed'));
      expect(spy).toHaveBeenCalledTimes(1);expect(f.sockets[0].sent.some(value=>['response.item.create','response.create'].includes(value.type))).toBe(false);expect(await f.repo.list(f.a.user.id,'mission')).toEqual([]);
    }finally{resume.resolve();}
  });
  it('closure waits for an already-started callback and suppresses remaining calls and late output',async()=>{
    const f=await fixture();await f.grant(true);const entered=deferred<void>(),resume=deferred<void>();const original=ApplicationToolGateway.prototype.invoke;
    const spy=vi.spyOn(ApplicationToolGateway.prototype,'invoke').mockImplementation(async function(this:ApplicationToolGateway,...args){const result=await original.apply(this,args);entered.resolve();await resume.promise;return result;});
    try{const started=await f.start();batch(f.sockets[0],2);await entered.promise;const closing=f.app.inject({method:'POST',url:`/voice/live/session/${started.json().session.id}/close`,headers:f.headers(),payload:{}}).then(value=>value);
      await vi.waitFor(()=>expect(f.sockets[0].sent.some(value=>value.type==='session.close')).toBe(true));resume.resolve();expect((await closing).statusCode).toBe(200);expect(spy).toHaveBeenCalledTimes(1);expect(f.sockets[0].sent.some(value=>['response.item.create','response.create'].includes(value.type))).toBe(false);expect(f.bodies).toHaveLength(1);
    }finally{resume.resolve();}
  });
  it('an oversized function batch closes before executing any callback',async()=>{
    const f=await fixture();await f.grant(true);const started=await f.start();const spy=vi.spyOn(ApplicationToolGateway.prototype,'invoke');batch(f.sockets[0],5);
    await vi.waitFor(async()=>expect((await f.openaiLive.read(f.a.user.id,started.json().session.id)).status).toBe('closed'));expect(spy).not.toHaveBeenCalled();expect(f.sockets[0].sent.some(value=>value.type==='response.item.create')).toBe(false);
  });
  it('bounds orphan delegation announcements before they can accumulate without response-created events',async()=>{
    const failures:string[]=[],invoke=vi.fn<(...args:any[])=>Promise<ToolOutcome>>();const tools=new OpenAIToolDelegation({context:{ownerId:randomUUID(),liveReceiptId:randomUUID(),authSessionHash:'a'.repeat(64)},tools:['contacts_lookup'],gateway:{invoke},isCurrent:()=>true,accessCurrent:async()=>true,send:()=>{},onProtocolFailure:reason=>failures.push(reason)});
    for(let index=0;index<1000;index++)tools.receive({type:'session.delegation.created',delegation:{id:`orphan-${index}`,target:'responses',response_id:`orphan-response-${index}`}});
    await tools.idle();expect(failures).toEqual(['tool_budget_exceeded']);expect(invoke).not.toHaveBeenCalled();await tools.stop();
  });
});
