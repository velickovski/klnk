import assert from 'node:assert/strict';
import { createApp } from '../apps/server/src/app.js';
import { Database } from '../apps/server/src/db.js';
import { getConfig } from '../apps/server/src/config.js';

// A self-contained API demonstration: no real provider calls, no listener, no credentials.
const db=await new Database({dataDir:'memory://'}).open();
const {app,engine}=await createApp({db,worker:false,config:{...getConfig(),provider:'simulator',demoEnabled:true}});
try {
  const auth=await app.inject({method:'POST',url:'/auth/demo',payload:{}});
  assert.equal(auth.statusCode,201);const {token}=auth.json();const headers={authorization:`Bearer ${token}`};
  const bootstrap=(await app.inject({url:'/bootstrap',headers})).json();
  const results=[];
  for(const template of bootstrap.templates) {
    const draft=await app.inject({method:'POST',url:'/missions',headers,payload:{templateId:template.id}});assert.equal(draft.statusCode,201,draft.body);
    const mission=draft.json();
    const authorized=await app.inject({method:'POST',url:`/missions/${mission.id}/authorize`,headers,payload:{version:mission.reviewVersion,scenario:template.id==='appointment'?'calendar_failure':'normal'}});
    assert.equal(authorized.statusCode,200,authorized.body);
    for(let step=0;step<15;step++)if(!await engine.tick(true)) {const jobs=await db.query("SELECT id FROM jobs WHERE status IN ('queued','running')");if(!jobs.length)break;}
    const detail=(await app.inject({url:`/missions/${mission.id}`,headers})).json();
    results.push({mission:template.title,status:detail.status,overview:detail.outcome?.overview,attempts:detail.attempts.length,actions:detail.actions.map((a:any)=>({kind:a.kind,status:a.status}))});
    assert.equal(detail.attempts.length,1);assert.ok(detail.outcome);
  }
  const calendar=(await app.inject({url:'/calendar',headers})).json();
  assert.equal(calendar.length,1);assert.equal(calendar[0].revision,2);
  console.log(JSON.stringify({mode:'SIMULATION — no real calls',results,calendarAssertions:'One existing event; updated once despite action retry.'},null,2));
} finally {await app.close();await db.close();}
