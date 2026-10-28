import { describe,it,expect,vi } from 'vitest';
import { ElevenOwnerPlanner,type OwnerSocket } from './owner-planner.js';

class Socket extends EventTarget {
  sent:any[]=[];closed=false;readyState=0;
  send(data:any){this.sent.push(JSON.parse(data));}
  close(){this.closed=true;this.readyState=3;this.dispatchEvent(new Event('close'));}
  open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
  message(value:any){this.dispatchEvent(new MessageEvent('message',{data:typeof value==='string'?value:JSON.stringify(value)}));}
}
const input={text:'Tell Jordan I will be late.',contacts:[{id:'contact-1',name:'Jordan Lee'}],language:'en',timezone:'Europe/Skopje',now:'2026-10-26T20:00:00Z',history:[{role:'owner',text:'Hello'}]};
const signed='wss://api.elevenlabs.io/v1/convai/conversation?agent_id=owner-agent&conversation_signature=SECRET';
const agent={agent_id:'owner-agent',conversation_config:{agent:{prompt:{tool_ids:[],knowledge_base:[],native_mcp_server_ids:[]}},conversation:{text_only:true,max_duration_seconds:60}},platform_settings:{auth:{enable_auth:true},privacy:{record_voice:false,retention_days:7},overrides:{conversation_config_override:{agent:{first_message:true,language:true,prompt:{prompt:true,tool_ids:true,knowledge_base:true,native_mcp_server_ids:true}},conversation:{text_only:true,max_duration_seconds:true}}}}};
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function fixture(){
  const socket=new Socket();
  const fetcher=vi.fn(async(url:string|URL|Request)=>json(String(url).includes('/convai/agents/')?agent:{signed_url:signed}));
  const factory=vi.fn(()=>socket as unknown as OwnerSocket);
  return {socket,fetcher,factory,planner:new ElevenOwnerPlanner({apiKey:'backend-only-key',agentId:'owner-agent',fetch:fetcher,webSocketFactory:factory})};
}
async function connected(f:ReturnType<typeof fixture>){for(let i=0;i<8&&!f.factory.mock.calls.length;i++)await new Promise(r=>setTimeout(r,0));f.socket.open();}
describe('private text-only owner planning transport',()=>{
  it('authenticates on the backend, initializes text-only strict empty tools, handles ping and returns JSON without acting',async()=>{
    const f=fixture(),result=f.planner.plan(input);await connected(f);
    const [metadataUrl]=f.fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(metadataUrl).toBe('https://api.elevenlabs.io/v1/convai/agents/owner-agent');
    const [url,request]=f.fetcher.mock.calls[1] as unknown as [string,RequestInit];
    expect(url).toContain('/v1/convai/conversation/get-signed-url?agent_id=owner-agent');expect(request.method).toBe('GET');expect(request.body).toBeUndefined();expect((request.headers as any)['xi-api-key']).toBe('backend-only-key');
    const config=f.socket.sent[0].conversation_config_override;
    expect(config.conversation).toEqual({text_only:true,max_duration_seconds:60});expect(config.agent.first_message).toBe('');expect(config.agent.prompt.tool_ids).toEqual([]);expect(config.agent.prompt.tool_ids_strict).toBe(true);
    f.socket.message({type:'ping',ping_event:{event_id:5}});expect(f.socket.sent.at(-1)).toEqual({type:'pong',event_id:5});
    f.socket.message({type:'conversation_initiation_metadata',conversation_initiation_metadata_event:{conversation_id:'conv-owner'}});
    const text=JSON.parse(f.socket.sent.at(-1).text);expect(text.utterance).toBe(input.text);expect(text.contactCandidates).toEqual(input.contacts);expect(text.contactCandidates[0]).not.toHaveProperty('phone');
    f.socket.message({type:'agent_response',agent_response_event:{agent_response:JSON.stringify({intent:'message',recipientName:'Jordan Lee',message:'I will be late.',reply:'I can pass that along.'})}});
    expect(await result).toMatchObject({intent:'message',recipientName:'Jordan Lee'});expect(f.socket.closed).toBe(true);expect(f.socket.sent.some(m=>m.type==='client_tool_result')).toBe(false);
  });
  it('rejects a tool request without invoking or acknowledging any tool',async()=>{
    const f=fixture(),result=f.planner.plan(input),check=expect(result).rejects.toThrow('unsupported tool');await connected(f);
    f.socket.message({type:'client_tool_call',client_tool_call:{tool_name:'call_recipient',parameters:{number:'+12025550101'}}});await check;
    expect(f.socket.closed).toBe(true);expect(f.socket.sent.some(m=>m.type==='client_tool_result')).toBe(false);
  });
  it('rejects invalid model JSON and oversized socket events rather than treating them as a plan',async()=>{
    for(const text of ['not a JSON plan','x'.repeat(40000)]) {
      const f=fixture(),result=f.planner.plan(input),check=expect(result).rejects.toThrow();await connected(f);
      f.socket.message({type:'conversation_initiation_metadata'});
      f.socket.message({type:'agent_response',agent_response_event:{agent_response:text}});await check;expect(f.socket.closed).toBe(true);
    }
  });
  it('rejects an untrusted signed URL before connecting, without disclosing its secret',async()=>{
    const f=fixture();f.fetcher.mockResolvedValueOnce(json(agent)).mockResolvedValueOnce(json({signed_url:'wss://evil.example/collect?secret=NEVERPRINT'}));
    await expect(f.planner.plan(input)).rejects.toThrow('untrusted signed URL');expect(f.factory).not.toHaveBeenCalled();
  });
  it('refuses inherited server tools or missing critical metadata before obtaining a signed session URL',async()=>{
    for(const unsafe of [{...agent,conversation_config:{...agent.conversation_config,agent:{prompt:{...agent.conversation_config.agent.prompt,tool_ids:['transfer-money']}}}},{agent_id:'owner-agent',conversation_config:{}},{...agent,platform_settings:{...agent.platform_settings,auth:{enable_auth:false}}}]) {
      const f=fixture();f.fetcher.mockResolvedValueOnce(json(unsafe));
      await expect(f.planner.plan(input)).rejects.toThrow('unsafe or unverified');expect(f.fetcher).toHaveBeenCalledTimes(1);expect(f.factory).not.toHaveBeenCalled();
    }
  });
  it('bounds a silent provider connection and closes it on timeout',async()=>{
    vi.useFakeTimers();
    try {
      const socket=new Socket(),planner=new ElevenOwnerPlanner({apiKey:'key',agentId:'owner-agent',fetch:vi.fn(async url=>json(String(url).includes('/convai/agents/')?agent:{signed_url:signed})),webSocketFactory:()=>socket as unknown as OwnerSocket,timeoutMs:50});
      const result=planner.plan(input),check=expect(result).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(51);await check;expect(socket.closed).toBe(true);
    } finally {vi.useRealTimers();}
  });
});
