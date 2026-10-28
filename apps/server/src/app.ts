import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { MissionInputSchema, ContactSchema, MemorySchema, ProfileSchema, ScenarioSchema, GuidanceSchema, ApplicationToolNameSchema, validateGuidance, PolicyError, type Mission, type Attempt, type ApplicationToolName } from '../../../packages/domain/src/index.js';
import { verifyElevenLabsWebhook, webhookDeduplicationKey } from '../../../packages/providers/src/index.js';
import { Database, Repository } from './db.js';
import { Engine } from './engine.js';
import { getConfig, type Config } from './config.js';
import { createSession, newUser, checkPassword, ownerFromToken, hashToken } from './auth.js';
import { seedOwner, ownerTemplates } from './seed.js';
import { HttpError, requireValue } from './errors.js';
import { localReadiness, runtimeReadiness } from './readiness.js';
import { VoiceService } from './voice.js';
import { isPublicDemoRoute, registerOpenAILive, type LiveDependencies } from './openai-live.js';
import { LiveSessionStore } from './live-session-store.js';
import { GoogleCalendarConnections } from './integrations/google-calendar.js';
import { RecipientSuppression } from './integrations/recipient-suppression.js';
import { ApplicationToolGateway, ToolAccessSchema } from './integrations/gateway.js';
import {NetworkCoordinator} from './network/coordination.js';
import {InternalCalendar} from './network/calendar.js';
import {registerNetworkRoutes} from './network/routes.js';
import {deleteNetworkAccount,exportNetworkAccount,lockNetworkDeletion} from './network/data-lifecycle.js';
import {NetworkStore} from './network/store.js';
import {NetworkVoiceTools} from './network/voice-tools.js';
import {OwnerIntentService} from './network/owner-intent.js';
declare module 'fastify' { interface FastifyRequest { ownerId?: string; rawJson?: string } }
const owner = (r:FastifyRequest)=>requireValue(r.ownerId);
const credentials=z.object({email:z.email().max(254).transform(x=>x.toLowerCase()),password:z.string().min(12).max(128)});
const idParam=(r:FastifyRequest)=>(r.params as {id:string}).id;
export async function createApp(options:{db?:Database;config?:Config;worker?:boolean;openaiLiveDependencies?:LiveDependencies;googleDependencies?:{fetch?:typeof fetch};networkIntentDependencies?:{fetch?:typeof fetch};rateLimitKey?:(request:FastifyRequest)=>string}={}) {
  const config=options.config??getConfig();
  const db=options.db??await new Database({url:config.databaseUrl,dataDir:config.dataDir,key:config.key,production:config.production}).open();
  const repo=new Repository(db),engine=new Engine(db,config),voice=new VoiceService(engine);
  const google=new GoogleCalendarConnections(db,{clientId:config.googleClientId,clientSecret:config.googleClientSecret,redirectUri:config.googleRedirectUri,production:config.production},options.googleDependencies);
  const suppression=new RecipientSuppression(db);
  engine.googleRevoke=token=>google.cleanupToken(token);
  engine.googleCalendarAccess=async(o,id)=>{const access=await google.access(o);if(access.integrationId!==id)throw new HttpError(409,'integration_mismatch','This action belongs to a different Calendar connection.');return access;};
  const app=Fastify({logger:false,bodyLimit:256*1024,requestTimeout:30000});
  const internalCalendar=new InternalCalendar(db),network=new NetworkCoordinator(db,internalCalendar);
  const ownerIntents=new OwnerIntentService(db,network,{apiKey:config.openaiKey,...options.networkIntentDependencies});
  await app.register(cors,{origin:(origin,cb)=>cb(null,!origin||config.origins.includes(origin)),methods:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],allowedHeaders:['Content-Type','Authorization']});
  await app.register(rateLimit,{max:100,timeWindow:'1 minute',keyGenerator:options.rateLimitKey??(r=>r.ownerId??r.ip)});
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json',{parseAs:'string'},(req,body,done)=>{
    req.rawJson=body as string;
    // Authenticate provider bytes before interpreting even their JSON structure.
    if(req.url.split('?')[0]==='/webhooks/elevenlabs'){done(null,null);return;}
    try {done(null,JSON.parse(body as string||'{}'));}catch{done(new HttpError(400,'invalid_json','Invalid JSON'));}
  });
  app.addHook('preHandler',async(req)=>{
    if(req.method==='OPTIONS' || ['/health','/livez','/ready','/integrations/google-calendar/callback'].includes(req.url.split('?')[0]) || req.url.startsWith('/auth/') || req.url==='/webhooks/elevenlabs' || isPublicDemoRoute(req))return;
    req.ownerId=await ownerFromToken(db,req.headers.authorization);
    if(!req.ownerId)throw new HttpError(401,'unauthorized','Sign in to continue.');
  });
  app.setErrorHandler((error,req,reply)=>{
    if(error instanceof ZodError)return reply.status(400).send({error:'invalid_input',message:'Please check your entries.',fields:error.issues.map(i=>({path:i.path.join('.'),message:i.message}))});
    if(error instanceof PolicyError)return reply.status(409).send({error:error.code,message:error.message});
    if(error instanceof HttpError)return reply.status(error.statusCode).send({error:error.code,message:error.message});
    if((error as any).code==='23505')return reply.status(409).send({error:'conflict',message:'That record already exists.'});
    const code=(error as any).statusCode;
    return reply.status(code&&code>=400&&code<500?code:500).send({error:'request_failed',message:code===429?'Too many requests. Please try again shortly.':'The request could not be completed. No success has been assumed.'});
  });
  app.get('/health',async()=>({status:'ok',mode:config.provider,storage:config.databaseUrl?'postgresql':'pglite',liveCallsEnabled:config.liveEnabled,liveReadiness:localReadiness(config)}));
  app.get('/livez',async()=>({status:'ok'}));
  registerNetworkRoutes(app,network,internalCalendar,db,ownerIntents);
  app.get('/ready',async(_request,reply)=>{const readiness=await runtimeReadiness(db);return reply.code(readiness.ready?200:503).header('Cache-Control','no-store').send(readiness);});
  const liveSessions=options.openaiLiveDependencies?.store??new LiveSessionStore(db);
  const gateway=new ApplicationToolGateway(engine,liveSessions,{externalEffectsEnabled:false});
  const networkVoiceTools=new NetworkVoiceTools(db,liveSessions,network,gateway);
  engine.toolMaintenance=now=>gateway.sweepRetention(now);
  // Local in-app delivery passed the protocol and independent gateway checks.
  // Public/native delivery and external effects remain separately gated.
  const toolRuntimeAvailable=()=>!config.production&&config.demoEnabled&&!!config.openaiKey?.trim();
  async function resolveToolAccess(o:string,authorization?:string,authorizedMissionId?:string):Promise<{authSessionHash:string;tools:ApplicationToolName[];authorizedMissionId?:string}|undefined>{
    if(!toolRuntimeAvailable()||!authorization?.startsWith('Bearer '))return undefined;
    return db.transaction(async sql=>{
      await activeOwner(sql,o);const authSessionHash=hashToken(authorization.slice(7)),r=repo.in(sql);
      if(!(await sql.query('SELECT token_hash FROM sessions WHERE owner_id=$1 AND token_hash=$2 AND expires_at>clock_timestamp() FOR UPDATE',[o,authSessionHash])).length)throw new HttpError(401,'unauthorized','Sign in again before starting voice.');
      const parsed=ToolAccessSchema.safeParse(await r.get(o,'tool_access',`tool-access:${o}`));
      if(!parsed.success||!parsed.data.enabled||parsed.data.ownerId!==o){if(authorizedMissionId)throw new HttpError(403,'tool_access_required','Allow in-app voice tools before binding an authorized request.');return undefined;}
      let mission:Mission|undefined;
      if(authorizedMissionId){mission=await r.get<Mission>(o,'mission',authorizedMissionId);if(!mission?.authorization||mission.authorization.ownerId!==o||mission.authorization.recipientId!==mission.contactId)throw new HttpError(409,'review_required','Only an existing authorized request can be bound to voice.');}
      const ownPolicy=(await new NetworkStore(db,sql).list<any>(o,'policy')).find(record=>record.ownerA===o&&!record.ownerB)?.value;
      const tools=parsed.data.tools.filter(name=>name.startsWith('network_')?ownPolicy?.enabled===true&&Date.parse(ownPolicy.expiresAt)>Date.now():!['request_dispatch','request_cancel','calendar_update_existing'].includes(name)||!!mission&&(name==='request_cancel'||mission.executionProvider==='simulator'));
      return tools.length?{authSessionHash,tools,...(mission?{authorizedMissionId:mission.id}:{})}:undefined;
    });
  }
  const openaiLive=registerOpenAILive(app,config,{toolGateway:networkVoiceTools,resolveToolAccess,...options.openaiLiveDependencies,store:liveSessions});
  app.post('/auth/register',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req,reply)=>{
    const c=credentials.extend({name:z.string().trim().min(1).max(80)}).parse(req.body);
    const user=await newUser(db,c.email,c.password);await seedOwner(repo,user.id,c.name,false);
    return reply.status(201).send({token:await createSession(db,user.id),user});
  });
  app.post('/auth/login',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(req)=>{
    const c=credentials.parse(req.body),[u]=await db.query('SELECT * FROM users WHERE email=$1 AND deleted_at IS NULL',[c.email]);
    // Work factor is paid even for unknown accounts.
    if(!u) {await checkPassword(c.password,'00000000000000000000000000000000:'+ '00'.repeat(64));throw new HttpError(401,'invalid_credentials','Email or password is incorrect.');}
    if(!await checkPassword(c.password,u.password_hash))throw new HttpError(401,'invalid_credentials','Email or password is incorrect.');
    return {token:await createSession(db,u.id),user:{id:u.id,email:u.email}};
  });
  app.post('/auth/demo',{config:{rateLimit:{max:8,timeWindow:'1 minute'}}},async(req,reply)=>{
    if(!config.demoEnabled)throw new HttpError(404,'not_found','Demo accounts are disabled.');
    const user=await newUser(db,`demo-${randomUUID()}@example.invalid`,randomUUID()+randomUUID());await seedOwner(repo,user.id,'Alex Morgan',true);
    return reply.status(201).send({token:await createSession(db,user.id),user});
  });
  app.post('/logout',async(req)=>{
    // Trusted cleanup survives client credential revocation. Revocation itself
    // is not terminal provider evidence and never frees an uncertain receipt.
    const live=await liveSessions.listUnresolved(owner(req));
    for(const receipt of live)if(receipt.providerSessionId)await openaiLive.close(owner(req),receipt.providerSessionId).catch(()=>{});
    await db.query('DELETE FROM sessions WHERE token_hash=$1',[hashToken(req.headers.authorization!.slice(7))]);
    return {ok:true,voiceCleanup:{pending:(await liveSessions.listUnresolved(owner(req))).length>0}};
  });
  app.get('/bootstrap',async req=>{
    const o=owner(req),contacts=await repo.list(o,'contact');
    return {profile:await repo.get(o,'profile',o),contacts,memories:await repo.list(o,'memory'),missions:await repo.list(o,'mission'),templates:ownerTemplates(o,contacts),capabilities:engine.capabilities,mode:config.provider,liveCallsEnabled:config.liveEnabled,liveReadiness:localReadiness(config,o),limits:{dailyAttempts:5,maxDurationSeconds:config.provider==='elevenlabs'?180:600,maxRetries:config.provider==='elevenlabs'?0:2},integrations:[{id:'contacts',name:'iPhone contacts',status:'manual_entry',detail:'Add a contact manually or give your agent the name and number by voice. Native contact selection is a future adapter.'},await google.status(o)]};
  });
  app.get('/setup/readiness',async req=>({ownerId:owner(req),...localReadiness(config,owner(req))}));
  const defaultToolAccess=(o:string)=>({id:`tool-access:${o}`,ownerId:o,version:1 as const,enabled:false,tools:[],updatedAt:new Date().toISOString()});
  app.get('/tools/access',async(req,reply)=>reply.header('Cache-Control','no-store').send({grant:ToolAccessSchema.parse(await repo.get(owner(req),'tool_access',`tool-access:${owner(req)}`)??defaultToolAccess(owner(req))),runtimeAvailable:toolRuntimeAvailable(),externalEffectsEnabled:false}));
  app.put('/tools/access',async(req,reply)=>{
    const o=owner(req),body=z.object({enabled:z.boolean(),tools:z.array(ApplicationToolNameSchema).max(10).refine(names=>new Set(names).size===names.length,'Choose each tool once.')}).strict().parse(req.body);
    const grant=await db.transaction(async sql=>{await activeOwner(sql,o);if(!(await sql.query('SELECT token_hash FROM sessions WHERE owner_id=$1 AND token_hash=$2 AND expires_at>clock_timestamp() FOR UPDATE',[o,hashToken(req.headers.authorization!.slice(7))])).length)throw new HttpError(401,'unauthorized','Sign in before changing voice permissions.');return repo.in(sql).put(o,'tool_access',{...defaultToolAccess(o),...body});});
    return reply.header('Cache-Control','no-store').send({grant,runtimeAvailable:toolRuntimeAvailable(),externalEffectsEnabled:false});
  });
  app.get('/tools/traces',async(req,reply)=>reply.header('Cache-Control','no-store').send({events:await gateway.traces(owner(req))}));
  app.post('/voice/turn',{bodyLimit:15*1024*1024,config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async req=>voice.turn(owner(req),req.body));
  app.get('/voice/turns/:id',async(req,reply)=>reply.header('Cache-Control','no-store').send(await voice.readTurn(owner(req),idParam(req))));
  app.post('/voice/report',{config:{rateLimit:{max:20,timeWindow:'1 minute'}}},async req=>voice.report(owner(req),req.body));
  app.delete('/voice/sessions/:id',async req=>voice.clearSession(owner(req),idParam(req)));
  app.get('/profile',async req=>repo.get(owner(req),'profile',owner(req)));
  app.put('/profile',async req=>{
    const o=owner(req),old=await repo.get<any>(o,'profile',o),profile=ProfileSchema.parse({...old,...(req.body as object),id:o});
    try{new Intl.DateTimeFormat('en',{timeZone:profile.timezone});}catch{throw new HttpError(400,'invalid_timezone','Use a valid timezone such as Europe/Skopje.');}
    return repo.put(o,'profile',profile);
  });
  for(const [path,kind,schema] of [['contacts','contact',ContactSchema],['memories','memory',MemorySchema]] as const) {
    app.get(`/${path}`,async req=>repo.list(owner(req),kind));
    app.post(`/${path}`,async(req,reply)=>{
      const o=owner(req),now=new Date().toISOString(),body=req.body as any;
      const value:any=schema.parse({...body,id:randomUUID(),ownerId:o,createdAt:now,updatedAt:now,...(kind==='memory'?{source:{type:'owner',reference:'Owner-entered memory'}}:{})});
      const stored=await db.transaction(async sql=>{
        await activeOwner(sql,o);const r=repo.in(sql);
        await validateReferences(r,o,kind,value);
        if(kind==='contact')value.optedOut=await suppression.contactChanged(o,undefined,value,sql);
        await r.put(o,kind,value);await invalidateDraftReviews(r,o,kind==='contact'?value.id:undefined);return value;
      });
      return reply.status(201).send(stored);
    });
    app.patch(`/${path}/:id`,async req=>{
      const o=owner(req),body=req.body as any;
      return db.transaction(async sql=>{
      await activeOwner(sql,o);const r=repo.in(sql),old=requireValue(await r.get<any>(o,kind,idParam(req)));
      const value:any=schema.parse({...old,...body,id:old.id,ownerId:o,createdAt:old.createdAt,updatedAt:new Date().toISOString(),...(kind==='memory'?{source:{type:'owner',reference:`Edited by owner; previous source: ${old.source.type} (${old.source.reference})`}}:{})});
      if(kind==='contact' && body.phone && body.phone!==old.phone) {value.verified=body.verified===true;value.optedOut=old.optedOut;}
      if(kind==='contact' && old.optedOut)value.optedOut=true;
      await validateReferences(r,o,kind,value);
      if(kind==='contact')value.optedOut=await suppression.contactChanged(o,old,value,sql);
      await r.audit(o,old.id,'owner_edited');await r.put(o,kind,value);await invalidateDraftReviews(r,o,kind==='contact'?value.id:undefined);return value;
      });
    });
    app.delete(`/${path}/:id`,async req=>{const o=owner(req),id=idParam(req);return db.transaction(async sql=>{await activeOwner(sql,o);const r=repo.in(sql),old=requireValue(await r.get<any>(o,kind,id));if(kind==='contact')await suppression.contactChanged(o,old,undefined,sql);await r.remove(o,kind,id);await invalidateDraftReviews(r,o,kind==='contact'?id:undefined);return {ok:true};});});
  }
  async function activeOwner(sql:import('./db.js').SQL,o:string){const [account]=await sql.query('SELECT id,deleted_at FROM users WHERE id=$1 FOR UPDATE',[o]);if(!account||account.deleted_at)throw new HttpError(401,'owner_deleted','This account is no longer available.');}
  async function invalidateDraftReviews(r:Repository,o:string,contactId?:string){
    // Authorization locks this same owner row first. Context/recipient changes
    // cannot race an accepted review or silently alter an approved snapshot.
    for(const mission of await r.list<Mission & {reviewVersion?:number}>(o,'mission'))if(mission.status==='draft'&&(!contactId||mission.contactId===contactId))await r.put(o,'mission',{...mission,reviewVersion:(mission.reviewVersion??1)+1,updatedAt:new Date().toISOString()});
  }
  async function validateReferences(r:Repository,o:string,kind:string,v:any) {
    if(kind==='memory') {
      if(v.scope==='relationship')requireValue(await r.get(o,'contact',v.contactId),'Choose one of your own contacts for this memory.');
      if(v.scope==='mission')requireValue(await r.get(o,'mission',v.missionId),'Choose one of your own missions for this memory.');
      if(v.scope==='owner'){v.contactId=undefined;v.missionId=undefined;}
      if(v.kind==='permission' && v.confirmation==='confirmed') { /* Stored permission is inspectable but never auto-authorizes a mission. */ }
    }
  }
  app.post('/missions',async(req,reply)=>{
    const o=owner(req),b=req.body as any,requestId=z.uuid().parse(b.requestId??randomUUID());
    const result=await db.transaction(async sql=>{
      await activeOwner(sql,o);const r=repo.in(sql),contacts=await r.list(o,'contact');
      const template=b.templateId?ownerTemplates(o,contacts).find(t=>t.id===b.templateId):undefined;
      if(b.templateId&&!template)throw new HttpError(400,'unknown_template','Choose a known template.');
      const input=MissionInputSchema.parse({...template?.input,...b}),digest=db.keyedDigest('mission-submission',JSON.stringify(input)),receiptId=`mission-submission:${o}:${requestId}`;
      const previous=await r.get<any>(o,'mission_submission',receiptId);
      if(previous){
        if(previous.inputDigest!==digest)throw new HttpError(409,'submission_changed','An earlier save with this request identifier may already exist. Your changed draft is preserved. Reconnect and review the saved request before starting another.');
        const mission=await r.get(o,'mission',previous.missionId);
        if(!mission)throw new HttpError(410,'submission_deleted','This saved request was removed. It will not be recreated by retrying an old save.');
        return {mission,created:false};
      }
      requireValue(await r.get(o,'contact',input.contactId));for(const id of input.neededMemoryIds)requireValue(await r.get(o,'memory',id));
      const now=new Date().toISOString(),mission={...input,id:randomUUID(),ownerId:o,status:'draft',reviewVersion:1,createdAt:now,updatedAt:now,followUpActions:input.followUpActions.map(a=>({...a,status:'proposed',externalId:undefined,prerequisiteEvidenceIds:[]}))};
      await r.put(o,'mission',mission);
      await r.put(o,'mission_submission',{id:receiptId,requestId,missionId:mission.id,inputDigest:digest,createdAt:now,purpose:'draft_creation_idempotency',retention:'account_lifetime'});
      return {mission,created:true};
    });
    return reply.status(result.created?201:200).send(result.mission);
  });
  app.get('/missions/requests/:requestId',async req=>{const o=owner(req),requestId=z.uuid().parse((req.params as {requestId:string}).requestId),receipt=requireValue(await repo.get<any>(o,'mission_submission',`mission-submission:${o}:${requestId}`));const mission=await repo.get(o,'mission',receipt.missionId);if(!mission)throw new HttpError(410,'submission_deleted','This saved request was removed. An old save cannot recreate it.');return mission;});
  app.get('/missions',async req=>repo.list(owner(req),'mission'));
  app.get('/missions/:id',async req=>engine.detail(owner(req),idParam(req)));
  app.patch('/missions/:id',async req=>{
    const o=owner(req),id=idParam(req);
    return db.transaction(async sql=>{
      await activeOwner(sql,o);
      await sql.query('SELECT id FROM resources WHERE owner_id=$1 AND id=$2 FOR UPDATE',[o,id]);
      const r=repo.in(sql),m=requireValue(await r.get<any>(o,'mission',id));
      if(m.status!=='draft')throw new HttpError(409,'authorization_frozen','Authorized missions cannot be edited. Create a revised mission.');
      const input=MissionInputSchema.parse({...m,...(req.body as object)});requireValue(await r.get(o,'contact',input.contactId));
      for(const memory of input.neededMemoryIds)requireValue(await r.get(o,'memory',memory));
      return r.put(o,'mission',{...input,id,ownerId:o,status:'draft',createdAt:m.createdAt,updatedAt:new Date().toISOString(),reviewVersion:(m.reviewVersion??1)+1});
    });
  });
  app.post('/missions/:id/authorize',async req=>{
    const b=z.object({version:z.number().int().positive(),scenario:ScenarioSchema.default('normal')}).parse(req.body);
    return engine.authorize(owner(req),idParam(req),b.version,b.scenario);
  });
  app.post('/missions/:id/cancel',async req=>engine.cancel(owner(req),idParam(req)));
  app.post('/missions/:id/intervene',async req=>{
    const o=owner(req),id=idParam(req),g=GuidanceSchema.parse(req.body);
    if(g.kind==='end')return engine.cancel(o,id);
    return db.transaction(async sql=>{
      await activeOwner(sql,o);
      await sql.query('SELECT id FROM resources WHERE owner_id=$1 AND id=$2 FOR UPDATE',[o,id]);
      const r=repo.in(sql),m=requireValue(await r.get<Mission>(o,'mission',id));
      validateGuidance(m,g,{typedIntervention:m.executionProvider==='simulator'});
      const attempts=await r.list<Attempt>(o,'attempt',id),a=attempts.at(-1);if(!a)throw new HttpError(409,'not_active','No active conversation.');
      const entry={id:randomUUID(),speaker:'owner',text:g.text,language:m.ownerLanguage,at:new Date().toISOString()};
      await r.put(o,'attempt',{...a,transcript:[...a.transcript,entry],ownerGuidance:[...((a as any).ownerGuidance??[]),g]},id);
      if(g.kind==='tighten_boundary') {
        await r.put(o,'mission',{...m,activeBoundaryNotes:[...((m as any).activeBoundaryNotes??[]),g.text]});
        if(m.status==='awaiting_owner') {
          await r.put(o,'mission',{...m,status:'unresolved',activeBoundaryNotes:[g.text]});
          await r.put(o,'attempt',{...a,transcript:[...a.transcript,entry],outcome:a.outcome?{...a.outcome,status:'unresolved',overview:'Owner tightened the boundary. Conversation ended without a new agreement.',actions:[]}:undefined},id);
        }
      }
      return {accepted:true,applied:g.kind==='tighten_boundary',mode:'simulator',message:g.kind==='tighten_boundary'?'Boundary tightened. Simulation will end without a further commitment.':'Saved for review. This deterministic simulator does not reinterpret freeform guidance.'};
    });
  });
  app.post('/missions/:id/actions/retry',async req=>{
    const o=owner(req),id=idParam(req),m=await engine.mission(o,id);if(m.status==='cancelled')throw new HttpError(409,'revoked','Mission has been revoked.');
    const actions=await repo.list<any>(o,'action',id);let count=0;
    for(const a of actions.filter(a=>['failed','pending'].includes(a.status))) {
      await db.query("UPDATE jobs SET status='queued',attempts=0,run_at=now(),lease_until=NULL WHERE id=$1 AND owner_id=$2 AND status IN ('failed','queued')",[`${a.id}:execute`,o]);count++;
    }
    return {queued:count};
  });
  app.delete('/missions/:id',async req=>{
    const o=owner(req),id=idParam(req);await engine.cancel(o,id);
    const attempts=await repo.list<Attempt>(o,'attempt',id);
    // Queue cleanup before deleting local conversation records. Jobs survive conversation deletion.
    for(const a of attempts) if(a.providerConversationId)await repo.enqueue(o,null,'provider_delete',{conversationId:a.providerConversationId});
    const activeLive=attempts.some(a=>a.provider==='elevenlabs'&&!a.endedAt);
    if(activeLive)throw new HttpError(409,'termination_pending','End requested. Wait for provider termination before deleting the conversation.');
    await db.query('DELETE FROM resources WHERE owner_id=$1 AND (id=$2 OR parent_id=$2)',[o,id]);return {ok:true,providerDeletion:attempts.some(a=>a.providerConversationId)?'queued':'not_required'};
  });
  app.get('/calendar',async req=>repo.list(owner(req),'calendar'));
  app.get('/settings/voice',async req=>({voices:await repo.list(owner(req),'voice'),cloneEnrollment:{available:false,reason:'A customer-owned verified cloning arrangement, account quotas, consent onboarding and provider verification are not configured. The standard assistant works without a recording.'},previewAvailable:!!engine.eleven && !!config.standardVoice && config.liveOwnerId===owner(req)}));
  app.patch('/settings/voice',async req=>{
    const b=z.object({voiceId:z.string(),enabled:z.boolean().default(true)}).parse(req.body),o=owner(req);
    const voice=requireValue(await repo.get<any>(o,'voice',b.voiceId));
    if(voice.kind!=='standard' && voice.status!=='verified')throw new HttpError(409,'clone_unverified','Only a verified, owner-owned clone can be enabled.');
    return repo.put(o,'voice',{...voice,enabled:b.enabled});
  });
  app.route({method:['GET','POST'],url:'/voices/:id/preview',handler:async(req,reply)=>{
    const voice=requireValue(await repo.get<any>(owner(req),'voice',idParam(req)));
    const voiceId=voice.kind==='standard'?config.standardVoice:voice.providerVoiceId;
    if(!engine.eleven || !voiceId)throw new HttpError(503,'preview_not_configured','Voice preview needs configured ElevenLabs credentials. No audio is fabricated in demo mode.');
    if(config.liveOwnerId!==owner(req))throw new HttpError(403,'provider_owner_required','Shared provider voice previews are limited to the configured private pilot owner.');
    if(voice.kind!=='standard' && voice.status!=='verified')throw new HttpError(403,'voice_unverified','Voice verification required.');
    const audio=await engine.eleven.previewVoice(voiceId);return reply.header('Content-Type',audio.contentType).send(Buffer.from(audio.audio));
  }});
  app.delete('/voices/:id',async req=>{
    const o=owner(req),voice=requireValue(await repo.get<any>(o,'voice',idParam(req)));
    if(voice.kind==='standard')throw new HttpError(400,'standard_voice','The standard fallback voice is not a personal asset.');
    if(voice.providerVoiceId)await repo.enqueue(o,null,'provider_delete',{voiceId:voice.providerVoiceId});await repo.remove(o,'voice',voice.id);return {ok:true,providerDeletion:'queued'};
  });
  app.post('/voices/enroll',async()=>{throw new HttpError(409,'enrollment_unavailable','Verified customer-owned voice enrollment requires an approved provider account arrangement. Continue using the standard assistant.');});
  app.post('/integrations/google-calendar/connect',async(req,reply)=>reply.header('Cache-Control','no-store').send(await google.begin(owner(req),req.headers.authorization)));
  app.delete('/integrations/google-calendar/connect',async(req,reply)=>reply.header('Cache-Control','no-store').send({ok:true,connection:await google.cancel(owner(req))}));
  app.get('/integrations/google-calendar/callback',async(req,reply)=>reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer').send(await google.callback(req.query)));
  app.get('/integrations/google-calendar',async(req,reply)=>reply.header('Cache-Control','no-store').send(await google.status(owner(req))));
  app.delete('/integrations/google-calendar',async(req,reply)=>reply.header('Cache-Control','no-store').send({ok:true,connection:await google.disconnect(owner(req))}));
  // Explicit public projection: OAuth state, PKCE, account subject and tokens
  // must never escape through generic resource listings or exports.
  app.get('/integrations',async(req,reply)=>reply.header('Cache-Control','no-store').send(await google.list(owner(req))));
  app.delete('/integrations/:id',async req=>{const o=owner(req),id=idParam(req);if(id===`${o}:google-calendar`)return {ok:true,connection:await google.disconnect(o)};throw new HttpError(409,'integration_unverified','This legacy connection cannot be remotely verified. Revoke it in the provider account before removing its record.');});
  app.get('/export',async(req,reply)=>{
    const o=owner(req),result:any={exportedAt:new Date().toISOString()};
    for(const k of ['profile','contact','memory','mission','attempt','action','voice','calendar','voice_session','voice_turn'])result[k]=await repo.list(o,k);
    result.recipientSuppression=await suppression.list(o);
    result.integrations=await google.list(o);
    result.toolActivity=await gateway.traces(o);
    result.toolPermissions=await repo.get(o,'tool_access',`tool-access:${o}`)??defaultToolAccess(o);
    result.draftSubmissions=(await repo.list<any>(o,'mission_submission')).map(({requestId,missionId,createdAt,purpose,retention})=>({requestId,missionId,createdAt,purpose,retention}));
    result.agentNetwork=await exportNetworkAccount(db,o);
    return reply.header('Content-Disposition','attachment; filename="personal-agent-export.json"').send(result);
  });
  app.delete('/account',async req=>{
    const o=owner(req);
    const live=await liveSessions.listUnresolved(o);
    for(const receipt of live)if(receipt.providerSessionId)await openaiLive.close(o,receipt.providerSessionId).catch(()=>{});
    if((await liveSessions.listUnresolved(o)).length)throw new HttpError(409,'voice_termination_pending','Voice session closure is not confirmed. Close or reconcile the existing voice session before deleting this account; no new session was started.');
    for(const m of await repo.list<Mission>(o,'mission'))await engine.cancel(o,m.id);
    const active=(await repo.list<Attempt>(o,'attempt')).some(a=>a.provider==='elevenlabs'&&!a.endedAt);
    if(active)throw new HttpError(409,'termination_pending','Queued work cancelled and active call termination requested. Retry account deletion when termination is confirmed.');
    // Tombstone preserves a cleanup job owner until provider deletion can be retried.
    await db.transaction(async sql=>{
      await lockNetworkDeletion(sql,o);const r=repo.in(sql);
      // Reserve/authorize/personal writes all lock the owner first. Recheck
      // after acquiring it: the earlier graceful-close pass is not atomic.
      const unresolved=await sql.query("SELECT id FROM live_sessions WHERE owner_id=$1 AND status IN ('creating','active','closing','unconfirmed') LIMIT 1",[o]);
      if(unresolved.length)throw new HttpError(409,'voice_termination_pending','Voice session closure is not confirmed. End the existing voice session before deleting this account.');
      const attempts=await r.list<Attempt>(o,'attempt');
      if(attempts.some(a=>a.provider==='elevenlabs'&&!a.endedAt))throw new HttpError(409,'termination_pending','An active telephone attempt still needs terminal provider evidence. Retry deletion after termination is confirmed.');
      for(const a of attempts)if(a.providerConversationId)await r.enqueue(o,null,'provider_delete',{conversationId:a.providerConversationId},0,`account:${o}:conversation:${a.id}`);
      for(const v of await r.list<any>(o,'voice'))if(v.providerVoiceId)await r.enqueue(o,null,'provider_delete',{voiceId:v.providerVoiceId},0,`account:${o}:voice:${v.id}`);
      await google.queueAccountCleanup(o,sql);
      await deleteNetworkAccount(db,sql,o);
      await sql.query("UPDATE jobs SET status='done',lease_until=NULL,lease_token=NULL,worker_id=NULL WHERE owner_id=$1 AND kind NOT IN ('provider_delete','google_revoke') AND status IN ('queued','running','failed')",[o]);
      await sql.query('DELETE FROM resources WHERE owner_id=$1',[o]);await sql.query('DELETE FROM sessions WHERE owner_id=$1',[o]);await sql.query('DELETE FROM audit WHERE owner_id=$1',[o]);await sql.query("UPDATE users SET deleted_at=now(),email=$2,password_hash='deleted' WHERE id=$1",[o,`deleted-${o}@example.invalid`]);
    });
    return {ok:true,providerDeletion:'queued_if_needed',retentionNotice:'Provider deletion is retried; contractual backups and provider retention limits still apply.'};
  });
  app.post('/webhooks/elevenlabs',async(req,reply)=>{
    if(!config.webhookSecret)throw new HttpError(503,'webhook_unconfigured','Webhook verification is not configured.');
    let event;try{event=verifyElevenLabsWebhook(req.rawJson??'',req.headers['elevenlabs-signature'] as string|undefined,config.webhookSecret);}catch{throw new HttpError(401,'invalid_signature','Webhook authentication failed.');}
    const conversation=event.data.conversation_id;if(!conversation)throw new HttpError(400,'missing_conversation','Conversation ID required.');
    const key=webhookDeduplicationKey(event);
    // Only enqueue authenticated provider reads. Speech/webhook content cannot authorize actions.
    return db.transaction(async sql=>{
      const rows=await sql.query('INSERT INTO provider_events(event_key,conversation_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_key',[key,conversation]);
      if(!rows.length)return {accepted:true,duplicate:true};
      const r=repo.in(sql),attemptRows=await sql.query("SELECT owner_id,payload FROM resources WHERE kind='attempt'");
      for(const row of attemptRows) {const a=db.decrypt<Attempt>(row.payload);if(a.providerConversationId===conversation){await r.enqueue(row.owner_id,a.missionId,'reconcile',{attemptId:a.id},0,`webhook:${key}`);return {accepted:true};}}
      return reply.status(202).send({accepted:true,unmatched:true});
    });
  });
  app.addHook('onClose',async()=>{await openaiLive.dispose();await network.stop();await engine.stop();if(!options.db)await db.close();});
  if(options.worker??config.embeddedWorker){engine.start();network.start();}
  return {app,db,repo,engine,config,voice,openaiLive,gateway,network,internalCalendar};
}
