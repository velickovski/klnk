import { randomUUID } from 'node:crypto';
import { expect,it } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import { getConfig } from '../apps/server/src/config.js';
import { Database } from '../apps/server/src/db.js';
import { LiveSessionStore } from '../apps/server/src/live-session-store.js';

it('does not delete an owner with unresolved paid-start control metadata or block another owner',async()=>{
  const db=await new Database({dataDir:'memory://'}).open(),store=new LiveSessionStore(db);
  const service=await createApp({db,worker:false,config:{...getConfig(),production:false,demoEnabled:true,provider:'simulator',liveEnabled:false,openaiKey:undefined,elevenKey:undefined},openaiLiveDependencies:{store}});
  try{
    const alice=(await service.app.inject({method:'POST',url:'/auth/demo'})).json(),bob=(await service.app.inject({method:'POST',url:'/auth/demo'})).json();
    const {receipt}=await store.reserve(alice.user.id,randomUUID());
    const blocked=await service.app.inject({method:'DELETE',url:'/account',headers:{authorization:`Bearer ${alice.token}`}});
    expect(blocked.statusCode).toBe(409);expect(blocked.json().error).toBe('voice_termination_pending');
    expect((await service.app.inject({url:'/profile',headers:{authorization:`Bearer ${alice.token}`}})).statusCode).toBe(200);
    expect((await service.app.inject({method:'DELETE',url:'/account',headers:{authorization:`Bearer ${bob.token}`}})).statusCode).toBe(200);
    await store.transition(alice.user.id,receipt.id,receipt.version,'rejected',undefined,'fixture_not_dispatched');
    expect((await service.app.inject({method:'DELETE',url:'/account',headers:{authorization:`Bearer ${alice.token}`}})).statusCode).toBe(200);
    const ready=await service.app.inject({url:'/ready'});expect(ready.statusCode).toBe(200);expect(ready.headers['cache-control']).toBe('no-store');
  }finally{await service.app.close();await db.close();}
});

it('revokes logout credentials while keeping uncertain cleanup durable and truthful',async()=>{
  const db=await new Database({dataDir:'memory://'}).open(),store=new LiveSessionStore(db);
  const service=await createApp({db,worker:false,config:{...getConfig(),production:false,demoEnabled:true,provider:'simulator',liveEnabled:false,openaiKey:undefined,elevenKey:undefined},openaiLiveDependencies:{store}});
  try{
    const alice=(await service.app.inject({method:'POST',url:'/auth/demo'})).json();
    const {receipt}=await store.reserve(alice.user.id,randomUUID());
    const result=await service.app.inject({method:'POST',url:'/logout',headers:{authorization:`Bearer ${alice.token}`},payload:{}});
    expect(result.statusCode).toBe(200);expect(result.json()).toEqual({ok:true,voiceCleanup:{pending:true}});
    expect((await service.app.inject({url:'/profile',headers:{authorization:`Bearer ${alice.token}`}})).statusCode).toBe(401);
    expect((await store.listUnresolved(alice.user.id)).map(item=>item.id)).toEqual([receipt.id]);
  }finally{await service.app.close();await db.close();}
});
