import { readFile } from 'node:fs/promises';
import { Database } from '../apps/server/src/db.js';
import { LiveSessionStore } from '../apps/server/src/live-session-store.js';
import { Engine } from '../apps/server/src/engine.js';
import type { Config } from '../apps/server/src/config.js';

// Child messages/arguments contain fixture UUIDs only. Credentials never cross IPC.
const simulator: Config = { production:false,port:4000,host:'127.0.0.1',databaseUrl:undefined,dataDir:'memory://',key:undefined,demoEnabled:true,openaiKey:undefined,provider:'simulator',liveEnabled:false,liveOwnerId:undefined,publicBaseUrl:undefined,recipients:[],origins:[],embeddedWorker:false,elevenKey:undefined,agentId:undefined,phoneId:undefined,webhookSecret:undefined,twilioSid:undefined,twilioToken:undefined,standardVoice:undefined,retentionVerified:false,llmProvider:undefined,retentionDisclosure:undefined,ownerAgentId:undefined };
const send = (value: Record<string, unknown>) => { if (process.connected) process.send?.(value); };
let db: Database | undefined;
let result: Record<string, unknown>;
try {
  const options = JSON.parse(process.argv[2] ?? '{}') as { operation:string;schema:string;owner?:string;requestId?:string;maxConcurrent?:number };
  if (!/^qa_[a-f0-9]{32}$/.test(options.schema)) throw new Error('invalid_fixture');
  const path = process.env.KLNK_POSTGRES_TEST_CONNECTION_FILE;
  if (!path) throw new Error('missing_fixture');
  const connection = JSON.parse(await readFile(path,'utf8')) as {url:string;key:string};
  const url = new URL(connection.url);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/klnk_qa' || !/^[a-f0-9]{64}$/i.test(connection.key)) throw new Error('unsafe_fixture');
  url.searchParams.set('options',`-c search_path=${options.schema}`);
  url.searchParams.set('application_name',`child_${options.schema}`);
  db = await new Database({url:url.toString(),key:connection.key,production:true}).open();
  if (options.operation === 'migrate') {
    const [row] = await db.query('SELECT count(*)::int AS total FROM schema_migrations');
    result = {type:'result',ok:true,migrations:row.total};
  } else if (options.operation === 'reserve') {
    const store = new LiveSessionStore(db,{maxConcurrent:options.maxConcurrent??4,maxPerOwnerDay:20,maxDurationSeconds:300});
    const reserved = await store.reserve(options.owner!,options.requestId!);
    result = {type:'result',ok:true,created:reserved.created,receiptId:reserved.receipt.id,status:reserved.receipt.status};
  } else if (options.operation === 'controller') {
    const store=new LiveSessionStore(db);
    let {receipt}=await store.reserve(options.owner!,options.requestId!);
    receipt=await store.attachProvider(options.owner!,receipt.id,receipt.version,'fictional-provider-'+options.requestId!);
    const continued=new Promise<void>((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('fixture_timeout')),15000);
      process.on('message',message=>{if(message&&typeof message==='object'&&(message as {type?:string}).type==='continue'){clearTimeout(timeout);resolve();}});
    });
    send({type:'controller_ready',receiptId:receipt.id});await continued;
    let terminalAccepted=false,failureCode='';
    try{await store.transition(options.owner!,receipt.id,receipt.version,'closed',{source:'provider_event',event:'session.closed'});terminalAccepted=true;}
    catch(error){const code=error&&typeof error==='object'&&'code'in error?String(error.code):'qa_transition_failed';failureCode=/^[a-z_]{1,64}$/.test(code)?code:'qa_transition_failed';}
    result={type:'result',ok:true,terminalAccepted,failureCode,renewed:(await store.renewControllerLeases()).length};
  } else if (options.operation === 'worker') {
    const engine = new Engine(db,simulator,{leaseMs:1000,heartbeatMs:200});
    let first = 0, second = 0;
    const continued = new Promise<void>((resolve,reject) => {
      const timeout = setTimeout(()=>reject(new Error('fixture_timeout')),15000);
      process.on('message',message=>{if(message&&typeof message==='object'&&(message as {type?:string}).type==='continue'){clearTimeout(timeout);resolve();}});
    });
    engine.eleven = {deleteConversation:async()=>{first++;send({type:'effect_started'});await continued;},deleteVoice:async()=>{second++;}} as any;
    const completed = await engine.tick(true);
    result = {type:'result',ok:true,firstEffects:first,secondEffects:second,completed};
  } else throw new Error('invalid_operation');
} catch (error) {
  const rawCode = error&&typeof error==='object'?'code' in error?String(error.code):'qa_child_failed':'qa_child_failed';
  result = {type:'result',ok:false,code:/^[a-zA-Z0-9_]{1,64}$/.test(rawCode)?rawCode:'qa_child_failed'};
} finally { await db?.close().catch(()=>undefined); }
send(result!);
process.disconnect?.();
