import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ApplicationToolArguments, NETWORK_VOICE_TOOLS, NetworkPolicySchema, NetworkRequestInputSchema, ToolTraceSchema, type ApplicationToolStatus, type NetworkConnection, type NetworkConversation, type NetworkPolicy, type NetworkRequestInput, type NetworkVoiceToolName, type ToolTrace} from '../../../../packages/domain/src/index.js';
import {Database, Repository, type SQL} from '../db.js';
import {HttpError} from '../errors.js';
import {LiveSessionStore} from '../live-session-store.js';
import {ToolAccessSchema} from '../integrations/gateway.js';
import {toolRequestId, type OwnerToolGateway, type ToolActorContext, type ToolOutcome} from '../integrations/tool-contract.js';
import {NetworkCoordinator} from './coordination.js';
import {NetworkStore, networkRequestActor} from './store.js';
import {meetingRuleAllows} from './policy.js';

const contextSchema = z.object({ownerId:z.uuid(),liveReceiptId:z.uuid(),authSessionHash:z.string().regex(/^[a-f0-9]{64}$/),callId:z.string().min(1).max(512),authorizedMissionId:z.uuid().optional()}).strict();
type Receipt = {id:string;schemaVersion:1;requestId:string;toolName:NetworkVoiceToolName;liveReceiptId:string;callId:string;argumentDigest?:string;argumentExpiresAt:number;status:ApplicationToolStatus;createdAt:string;updatedAt:string;outcome?:ToolOutcome};
const networkNames = new Set<string>(NETWORK_VOICE_TOOLS);
const denial = (code:string) => new HttpError(409,code,'The current voice or internal-network permission does not allow this operation.');
const knownReasons = new Set(['invalid_arguments','tool_access_required','tool_not_allowed','session_expired','member_unavailable','live_session_inactive','controller_lost','network_policy_changed','network_scope_denied','network_connection_changed','network_expired','network_rate_limited','network_deadline','network_message_required','network_request_conflict','not_found','receipt_conflict','reconciliation_required','review_required']);

/** Trusted broker adapter. No network/provider client is available to its tool registry. */
export class NetworkVoiceTools implements OwnerToolGateway {
  private repo:Repository;
  constructor(private db:Database,private live:LiveSessionStore,private coordinator:NetworkCoordinator,private legacy:OwnerToolGateway){this.repo = new Repository(db);}
  private async actor(sql:SQL,context:ToolActorContext,name:NetworkVoiceToolName) {
    const [owner] = await sql.query('SELECT id,deleted_at FROM users WHERE id=$1 FOR UPDATE',[context.ownerId]);
    if (!owner || owner.deleted_at) throw denial('member_unavailable');
    if (!(await sql.query('SELECT token_hash FROM sessions WHERE owner_id=$1 AND token_hash=$2 AND expires_at>clock_timestamp() FOR UPDATE',[context.ownerId,context.authSessionHash])).length) throw denial('session_expired');
    const [live] = await sql.query('SELECT *,controller_lease_until>clock_timestamp() AS controller_valid,expires_at>clock_timestamp() AS live_valid FROM live_sessions WHERE owner_id=$1 AND id=$2 FOR UPDATE',[context.ownerId,context.liveReceiptId]);
    if (!live || live.status !== 'active' || !live.live_valid) throw denial('live_session_inactive');
    if (live.controller_id !== this.live.controllerId || !live.controller_valid) throw denial('controller_lost');
    const grant = ToolAccessSchema.safeParse(await this.repo.in(sql).get(context.ownerId,'tool_access',`tool-access:${context.ownerId}`));
    if (!grant.success || grant.data.id !== `tool-access:${context.ownerId}` || grant.data.ownerId !== context.ownerId || !grant.data.enabled) throw denial('tool_access_required');
    if (!grant.data.tools.includes(name)) throw denial('tool_not_allowed');
    const stored = (await new NetworkStore(this.db,sql).list<NetworkPolicy>(context.ownerId,'policy')).find(record => record.ownerA === context.ownerId && !record.ownerB)?.value;
    const parsed = NetworkPolicySchema.safeParse(stored), policy = parsed.success ? parsed.data : undefined;
    if (!policy || policy.ownerId !== context.ownerId || !policy.enabled || Date.parse(policy.expiresAt) <= Date.now()) throw denial('network_policy_changed');
    return policy;
  }
  private outcome(context:ToolActorContext,name:NetworkVoiceToolName,status:ApplicationToolStatus,reasonCode:string,data?:Record<string,unknown>):ToolOutcome {
    return {schemaVersion:1,requestId:toolRequestId(context),toolName:name,status,reasonCode,verification:status === 'blocked' ? 'policy_denial' : status === 'unknown' ? 'unconfirmed' : 'local_commit',...(data?{data}: {})};
  }
  private async trace(sql:SQL,context:ToolActorContext,outcome:ToolOutcome,event:ToolTrace['event'],started:number,count=0) {
    const value = ToolTraceSchema.parse({schemaVersion:1,eventId:randomUUID(),occurredAt:new Date().toISOString(),event,traceId:outcome.requestId,requestId:outcome.requestId,sessionRef:context.liveReceiptId,ownerRef:context.ownerId,toolName:outcome.toolName,toolVersion:1,adapter:'application',status:outcome.status,reasonCode:outcome.reasonCode,verification:outcome.verification,argumentSummary:{operation:outcome.toolName === 'network_connections_lookup' ? 'lookup' : outcome.toolName === 'network_request_submit' ? 'dispatch' : 'status',resourceCount:count},durationMs:Math.max(0,Date.now()-started)});
    await this.repo.in(sql).put(context.ownerId,'tool_trace',{id:value.eventId,...value});
  }
  private projection(conversation:NetworkConversation,ownerId:string):Record<string,unknown> {
    return {untrusted:true,scope:'klnk_only',conversationId:conversation.id,state:conversation.state,summary:conversation.summary,nextAction:conversation.nextAction,needsYourDecision:conversation.state === 'awaiting_approval' && conversation.decisionOwnerIds.includes(ownerId),...(conversation.eventId?{eventId:conversation.eventId}:{}),...(conversation.proposal?{proposal:{version:conversation.proposal.version,hash:conversation.proposal.hash,terms:conversation.proposal.terms,expiresAt:conversation.proposal.expiresAt}}:{}),externalEffectsEnabled:false,spokenDeliveryConfirmed:false};
  }
  async invoke(rawContext:ToolActorContext,rawName:string,argumentsJson:string):Promise<ToolOutcome> {
    if (!networkNames.has(rawName)) return this.legacy.invoke(rawContext,rawName,argumentsJson);
    const parsedContext = contextSchema.safeParse(rawContext);
    if (!parsedContext.success) throw new HttpError(400,'invalid_tool_context','Tool control identity is invalid.');
    const context = parsedContext.data, name = rawName as NetworkVoiceToolName, started = Date.now();
    let parameters:any;
    try {if (typeof argumentsJson !== 'string' || argumentsJson.length > 15000) throw new Error(); parameters = ApplicationToolArguments[name].parse(JSON.parse(argumentsJson));}
    catch {return this.outcome(context,name,'blocked','invalid_arguments');}
    const requestId = toolRequestId(context), id = `tool-receipt:${requestId}`, digest = this.db.keyedDigest('tool-arguments',JSON.stringify([requestId,name,parameters]));
    let returnedEffect = false;
    try {
      const reservation = await this.db.transaction(async sql => {
        await this.actor(sql,context,name);
        const repo = this.repo.in(sql), old = await repo.get<Receipt>(context.ownerId,'tool_receipt',id);
        if (old) {
          if (!old.argumentDigest || old.argumentExpiresAt <= Date.now()) throw denial('reconciliation_required');
          if (old.argumentDigest !== digest || old.toolName !== name || old.liveReceiptId !== context.liveReceiptId || old.callId !== context.callId) throw denial('receipt_conflict');
          return old;
        }
        const at = new Date().toISOString(), receipt:Receipt = {id,schemaVersion:1,requestId,toolName:name,liveReceiptId:context.liveReceiptId,callId:context.callId,argumentDigest:digest,argumentExpiresAt:Date.now()+86400000,status:'running',createdAt:at,updatedAt:at};
        await repo.put(context.ownerId,'tool_receipt',receipt);
        await this.trace(sql,context,this.outcome(context,name,'running','queued'),'tool_requested',started);
        await this.trace(sql,context,this.outcome(context,name,'running','queued'),'tool_validated',started);
        return receipt;
      });
      // The guard executes inside each coordinator transaction after every participating
      // owner is locked in sorted order, so grant/controller revocation wins before effects.
      const trusted = {ownerId:context.ownerId,sessionHash:context.authSessionHash,guard:async(sql:SQL)=>{
        const policy = await this.actor(sql,context,name);
        if (name === 'network_request_submit' && parameters.kind === 'meeting') {
          const connection = await new NetworkStore(this.db,sql).get<NetworkConnection>('connection',parameters.connectionId);
          if (!connection || ![connection.ownerA,connection.ownerB].includes(context.ownerId)) throw denial('not_found');
          const peer = connection.ownerA === context.ownerId ? connection.ownerB! : connection.ownerA;
          // The model can express the owner's bounded delegation, never a personal
          // approval exception to that owner's scheduling limits. The explicit
          // voice-tool grant allows initiation even when incoming auto-accept is off.
          if (!parameters.candidateSlots.every((slot:NetworkRequestInput['candidateSlots'][number]) => meetingRuleAllows({...policy,autoAcceptMeetings:true},peer,parameters.topic,slot))) throw denial('review_required');
        }
        await this.trace(sql,context,this.outcome(context,name,'running','queued'),'authorization_checked',started);
      }};
      const outcome = await networkRequestActor.run(trusted,async () => {
        if (name === 'network_connections_lookup') {
          const query = (parameters.query as string).trim().toLocaleLowerCase();
          const connections = (await this.coordinator.connections(context.ownerId)).filter(connection => connection.status === 'accepted' && (connection.peer?.name ?? '').toLocaleLowerCase().includes(query)).slice(0,parameters.limit).map(connection => ({connectionId:connection.id,memberId:connection.fromId === context.ownerId ? connection.toId : connection.fromId,name:connection.peer?.name ?? 'Member'}));
          return this.outcome(context,name,'succeeded','lookup_complete',{untrusted:true,connections,externalEffectsEnabled:false});
        }
        if (name === 'network_request_status') return this.outcome(context,name,'succeeded','status_available',this.projection(await this.coordinator.detail(context.ownerId,parameters.conversationId),context.ownerId));
        const input = NetworkRequestInputSchema.parse({...parameters,requestId}), conversation = await this.coordinator.submit(context.ownerId,input);
        returnedEffect = true;
        const status:ApplicationToolStatus = conversation.state === 'queued' ? 'queued' : conversation.state === 'processing' ? 'running' : ['awaiting_approval','paused'].includes(conversation.state) ? 'proposed' : conversation.state === 'cancelled' ? 'cancelled' : ['expired','declined','unresolved'].includes(conversation.state) ? 'failed' : 'succeeded';
        return this.outcome(context,name,status,'network_request_recorded',this.projection(conversation,context.ownerId));
      });
      await this.db.transaction(async sql => {
        await this.actor(sql,context,name);
        // Keep argument digests and structural metadata, never retrieved private text,
        // messages, canonical terms or raw model arguments in receipt/trace resources.
        await this.repo.in(sql).put(context.ownerId,'tool_receipt',{...reservation,status:outcome.status,outcome:{...outcome,data:undefined},updatedAt:new Date().toISOString()});
        const count = Array.isArray(outcome.data?.connections) ? outcome.data.connections.length : 1;
        await this.trace(sql,context,outcome,'tool_result_received',started,count);
        await this.trace(sql,context,outcome,outcome.status === 'failed' ? 'tool_failed' : 'tool_succeeded',started,count);
      });
      return outcome;
    } catch (error) {
      const reason = error instanceof HttpError && knownReasons.has(error.code) ? error.code : 'operation_failed';
      const outcome = this.outcome(context,name,returnedEffect || reason === 'operation_failed' ? 'unknown' : 'blocked',returnedEffect ? 'reconciliation_required' : reason,reason === 'review_required' && !returnedEffect ? {needsOwnerReview:true,nextAction:'Review the exact meeting and its authority in the typed Inbox. Voice cannot grant an exception to your saved scheduling limits.'} : undefined);
      await this.db.transaction(async sql => {await this.actor(sql,context,name); await this.trace(sql,context,outcome,outcome.status === 'unknown' ? 'tool_reconciliation_required' : 'tool_blocked',started);}).catch(()=>undefined);
      return outcome;
    }
  }
}
