import { describe, expect, it, vi } from 'vitest';
import { VoiceWorkspaceController, type OwnerReply, type VoiceApi } from '../src/features/voice/controller';
const reply=(patch:Partial<OwnerReply>={}):OwnerReply=>({sessionId:'session-1',turnId:'turn-1',transcript:'Fictional fixture message',text:'Prepared fixture response.',status:'reply',needsReply:false,mode:'simulator',voiceMode:'unavailable',...patch});
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};};
const service=(fn:ReturnType<typeof vi.fn>)=>fn as unknown as VoiceApi;
describe('in-memory voice workspace request lifetime',()=>{
  it('preserves a typed draft and request across navigation, clearing only the submitted draft on success',async()=>{
    const pending=deferred<OwnerReply>(),api=vi.fn(()=>pending.promise),controller=new VoiceWorkspaceController(service(api),()=> 'request-1');
    controller.activate();controller.setDraft('Fictional fixture message');const sending=controller.submit({text:controller.getSnapshot().draft});
    controller.deactivate();expect(controller.getSnapshot()).toMatchObject({draft:'Fictional fixture message',busy:true,pending:{id:'request-1'}});
    controller.setDraft('A newer draft');pending.resolve(reply({status:'queued',missionId:'mission-1'}));await sending;
    expect(controller.getSnapshot()).toMatchObject({draft:'A newer draft',sessionId:'session-1',missionId:'mission-1',canAutoReport:false,busy:false,pending:null});
    controller.activate();expect(controller.getSnapshot().turns).toHaveLength(2);expect(api).toHaveBeenCalledTimes(1);
  });
  it('keeps the typed draft after a definite failure without claiming a response',async()=>{
    const api=vi.fn().mockRejectedValue(Object.assign(new Error('Not authorized'),{status:403})),controller=new VoiceWorkspaceController(service(api));controller.setDraft('Fixture draft');
    await controller.submit({text:'Fixture draft'});expect(controller.getSnapshot()).toMatchObject({draft:'Fixture draft',pending:null,last:null,error:'Not authorized'});
  });
  it('checks a processing receipt without issuing a replacement command',async()=>{
    const api=vi.fn().mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValueOnce({status:'prepared',missionId:'existing-mission'}),controller=new VoiceWorkspaceController(service(api),()=> 'original-id');
    controller.setDraft('Fixture');await controller.submit({text:'Fixture'});await controller.recover();
    expect(api.mock.calls.map(args=>args[0])).toEqual(['/voice/turn','/voice/turns/original-id']);expect(controller.getSnapshot()).toMatchObject({draft:'Fixture',pending:{id:'original-id'},missionId:'existing-mission'});
  });
  it('uses a cached receipt response and never reissues its command',async()=>{
    const api=vi.fn().mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValueOnce({status:'done',response:reply()}),controller=new VoiceWorkspaceController(service(api),()=> 'original-id');
    controller.setDraft('Fixture');await controller.submit({text:'Fixture'});await controller.recover();expect(api).toHaveBeenCalledTimes(2);expect(controller.getSnapshot()).toMatchObject({draft:'',pending:null,last:{turnId:'turn-1'}});expect(controller.getSnapshot().turns).toHaveLength(2);
  });
  it('retries only an absent receipt using the original ID, session and body',async()=>{
    const api=vi.fn().mockRejectedValueOnce(new Error('Disconnected')).mockRejectedValueOnce(Object.assign(new Error('Absent'),{status:404})).mockResolvedValueOnce(reply()),controller=new VoiceWorkspaceController(service(api),()=> 'original-id');
    await controller.submit({text:'Fixture'});await controller.recover();expect(api.mock.calls[0]).toEqual(api.mock.calls[2]);expect(api.mock.calls.filter(args=>args[0]==='/voice/turn')).toHaveLength(2);expect(controller.getSnapshot().turns).toHaveLength(2);
  });
  it('does not retry an unknown receipt state',async()=>{
    const api=vi.fn().mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValueOnce({status:'future-state'}),controller=new VoiceWorkspaceController(service(api));await controller.submit({text:'Fixture'});await controller.recover();expect(api).toHaveBeenCalledTimes(2);expect(controller.getSnapshot().pending).not.toBeNull();
  });
  it('ignores late replies after the owner lifetime is reset',async()=>{
    const pending=deferred<OwnerReply>(),api=vi.fn(()=>pending.promise),controller=new VoiceWorkspaceController(service(api));const sending=controller.submit({text:'Fixture'});controller.reset();pending.resolve(reply());await sending;expect(controller.getSnapshot()).toMatchObject({turns:[],last:null,busy:false});expect(controller.getSnapshot().sessionId).toBeUndefined();
  });
  it('blocks concurrent submissions and preserves every earlier message',async()=>{
    let id=0;const api=vi.fn(async()=>reply({turnId:`turn-${id}`})),controller=new VoiceWorkspaceController(service(api),()=>`request-${++id}`);
    await Promise.all([controller.submit({text:'One'}),controller.submit({text:'Duplicate'})]);for(let i=0;i<5;i++)await controller.submit({text:`Fixture ${i}`});expect(api).toHaveBeenCalledTimes(6);expect(controller.getSnapshot().turns).toHaveLength(12);
  });
});
