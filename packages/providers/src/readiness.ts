import type { ProviderAgent } from './index.js';

export type PilotCheck={id:string;status:'pass'|'fail'|'unknown';message:string};
export type PilotAgentInspection={checks:PilotCheck[];llmModel?:string;voiceId?:string;retentionDays?:number};
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const empty=(value:unknown)=>Array.isArray(value)&&value.length===0;
/** GET models default optional legacy/attachment fields to None; modern capability arrays remain explicit.
 * https://github.com/elevenlabs/elevenlabs-python/blob/main/src/elevenlabs/types/prompt_agent_api_model_output.py
 * https://github.com/elevenlabs/elevenlabs-python/blob/main/src/elevenlabs/types/get_agent_response_model.py
 */
function capabilityChecks(prompt:Record<string,any>|undefined,prefix:string):PilotCheck[] {
  const modern=['tool_ids','native_mcp_server_ids','knowledge_base'];
  const canonicalEmpty=modern.every(field=>empty(prompt?.[field]));
  return [...modern,'tools','mcp_server_ids'].map(field=>{
    const value=prompt?.[field],legacy=field==='tools'||field==='mcp_server_ids';
    const omittedLegacy=legacy&&value==null&&canonicalEmpty;
    const status:PilotCheck['status']=empty(value)||omittedLegacy?'pass':value==null?'unknown':'fail';
    return {id:`${prefix}.${field}`,status,message:omittedLegacy?`Optional ${field} is unset; authoritative tool_ids, native_mcp_server_ids and knowledge_base are explicitly empty.`:status==='pass'?`No inherited ${field}.`:`The dedicated agent must have no inherited ${field}; current capability lists must be explicitly empty.`};
  });
}
function attachments(agent:ProviderAgent,prefix:string):PilotCheck[] {
  // These optional GET fields describe attached workflow/procedure sets; None means no attached object.
  const workflow=agent.workflow,procedures=agent.procedures;
  return [
    {id:`${prefix}.workflow`,status:workflow==null?'pass':record(workflow)&&record(workflow.nodes)&&record(workflow.edges)?Object.keys(workflow.nodes).length===0&&Object.keys(workflow.edges).length===0?'pass':'fail':'fail',message:'Use a simple dedicated agent with no attached workflow nodes or edges.'},
    {id:`${prefix}.procedures`,status:procedures==null?'pass':record(procedures)&&Object.keys(procedures).length===0?'pass':'fail',message:'No attached procedures may be present on this pilot agent.'},
  ];
}

/** Pure validation of read-only metadata. Unknown is never treated as readiness. No prompts/secrets returned. */
export function inspectAgentForPilot(agent:ProviderAgent,options:{expectedVoiceId:string;maxDurationSeconds?:number;maxRetentionDays?:number}):PilotAgentInspection {
  const checks:PilotCheck[]=[];
  const add=(id:string,status:PilotCheck['status'],message:string)=>checks.push({id,status,message});
  const root=agent.conversation_config??{},prompt=root.agent?.prompt,platform=agent.platform_settings;
  const overrides=platform?.overrides?.conversation_config_override;
  const requiredOverrides:[string,unknown][]=[
    ['agent.first_message',overrides?.agent?.first_message],['agent.language',overrides?.agent?.language],
    ['agent.prompt.prompt',overrides?.agent?.prompt?.prompt],['agent.prompt.tool_ids',overrides?.agent?.prompt?.tool_ids],
    ['agent.prompt.native_mcp_server_ids',overrides?.agent?.prompt?.native_mcp_server_ids],['agent.prompt.knowledge_base',overrides?.agent?.prompt?.knowledge_base],
    ['tts.voice_id',overrides?.tts?.voice_id],['conversation.max_duration_seconds',overrides?.conversation?.max_duration_seconds],
  ];
  for(const [path,enabled] of requiredOverrides)add(`override.${path}`,enabled===true?'pass':enabled===false?'fail':'unknown',enabled===true?`Override enabled: ${path}.`:`Enable the ${path} initiation override on the dedicated agent.`);
  // tool_ids_strict is documented as permitted whenever tool_ids can be overridden. Its separate optional flag is not required.
  checks.push(...capabilityChecks(prompt,'agent'));
  const builtins=prompt?.built_in_tools;
  if(record(builtins)) {
    const unsafe=Object.entries(builtins).filter(([name,value])=>value!==null && value!==undefined && !['end_call','voicemail_detection','language_detection','skip_turn'].includes(name));
    add('agent.built_in_tools',unsafe.length?'fail':'pass',unsafe.length?'Remove transfer, keypad or other unreviewed built-in tools.':'Only bounded end/turn/language/voicemail built-ins are present.');
  } else add('agent.built_in_tools',builtins==null&&['tool_ids','native_mcp_server_ids','knowledge_base'].every(field=>empty(prompt?.[field]))?'pass':builtins==null?'unknown':'fail','Optional built-in tools are unset; nonempty transfer/keypad tools remain disallowed.');
  checks.push(...attachments(agent,'agent'));
  const recordVoice=platform?.privacy?.record_voice;
  add('privacy.record_voice',recordVoice===false?'pass':recordVoice===true?'fail':'unknown',recordVoice===false?'Provider voice recording is disabled.':'Set platform_settings.privacy.record_voice=false; Twilio recording=false alone is insufficient.');
  const retention=platform?.privacy?.retention_days,maxRetention=options.maxRetentionDays??30;
  add('privacy.retention_days',typeof retention==='number'&&Number.isInteger(retention)?retention>=1&&retention<=maxRetention?'pass':'fail':'unknown',typeof retention==='number'&&retention>=1&&retention<=maxRetention?`Provider retention is ${retention} days.`:`Set finite provider retention from 1 to ${maxRetention} days and disclose it accurately.`);
  add('conversation.text_only',root.conversation?.text_only===false?'pass':root.conversation?.text_only===true?'fail':'unknown','The telephone agent must process voice (text_only=false).');
  const max=root.conversation?.max_duration_seconds,limit=options.maxDurationSeconds??180;
  add('conversation.max_duration_seconds',typeof max==='number'?max>=30&&max<=limit?'pass':'fail':'unknown',`Set the dedicated agent's duration cap to 30–${limit} seconds; the mission override may shorten it.`);
  const voice=root.tts?.voice_id;
  add('voice.standard',typeof voice==='string'?voice===options.expectedVoiceId?'pass':'fail':'unknown',voice===options.expectedVoiceId?'Configured standard voice matches the agent.':'Set the dedicated agent to the configured standard voice.');
  const llm=prompt?.llm;
  add('agent.llm',typeof llm==='string'&&llm&&llm!=='custom-llm'?'pass':llm==='custom-llm'?'fail':'unknown','Record the actual provider and selected LLM in the disclosure; custom LLMs need a separate review.');
  const webhooks=platform?.workspace_overrides?.webhooks;
  add('webhook.post_call',typeof webhooks?.post_call_webhook_id==='string'&&webhooks.post_call_webhook_id?'pass':'unknown','Confirm the assigned post-call webhook ID, HTTPS URL and signing secret in the workspace.');
  const events=webhooks?.events;
  add('webhook.events',Array.isArray(events)?events.includes('transcript')&&events.includes('call_initiation_failure')&&!events.some((e:string)=>['audio','unredacted_audio','unredacted_transcript'].includes(e))?'pass':'fail':'unknown','Enable transcript and call_initiation_failure events; audio and unredacted events stay disabled.');
  add('webhook.format',webhooks&&(webhooks.transcript_format===undefined||webhooks.transcript_format==='json')?'pass':webhooks?'fail':'unknown','Use JSON transcript webhook format (the documented default when omitted).');
  return {checks,llmModel:typeof llm==='string'?llm:undefined,voiceId:typeof voice==='string'?voice:undefined,retentionDays:typeof retention==='number'?retention:undefined};
}

/** Private owner planning has no tools at all; every unknown critical setting prevents a session. */
export function inspectOwnerAgent(agent:ProviderAgent):PilotAgentInspection {
  const checks:PilotCheck[]=[],root=agent.conversation_config??{},platform=agent.platform_settings,prompt=root.agent?.prompt;
  const add=(id:string,value:unknown,expected:boolean,message:string)=>checks.push({id,status:value===expected?'pass':typeof value==='boolean'?'fail':'unknown',message} as PilotCheck);
  add('owner.auth.enable_auth',platform?.auth?.enable_auth,true,'Require signed authorization on the private owner agent.');
  add('owner.conversation.text_only',root.conversation?.text_only,true,'The owner planner must be text-only.');
  add('owner.privacy.record_voice',platform?.privacy?.record_voice,false,'Provider voice recording must be off for owner planning.');
  const duration=root.conversation?.max_duration_seconds;
  checks.push({id:'owner.conversation.max_duration_seconds',status:typeof duration==='number'&&Number.isInteger(duration)?duration>=1&&duration<=60?'pass':'fail':'unknown',message:'Set the private owner-agent maximum duration to 60 seconds or less.'});
  const retention=platform?.privacy?.retention_days;
  checks.push({id:'owner.privacy.retention_days',status:typeof retention==='number'&&Number.isInteger(retention)?retention>=1&&retention<=30?'pass':'fail':'unknown',message:'Set finite owner-agent retention from 1 to 30 days.'});
  checks.push(...capabilityChecks(prompt,'owner.agent'));
  const builtins=prompt?.built_in_tools;
  checks.push({id:'owner.agent.built_in_tools',status:record(builtins)?Object.values(builtins).every(v=>v===null||v===undefined)?'pass':'fail':builtins==null&&['tool_ids','native_mcp_server_ids','knowledge_base'].every(field=>empty(prompt?.[field]))?'pass':builtins==null?'unknown':'fail',message:'Disable all owner-agent built-in tools, including transfer and end-call tools.'});
  checks.push(...attachments(agent,'owner.agent'));
  const overrides=platform?.overrides?.conversation_config_override;
  for(const [path,value] of [
    ['agent.first_message',overrides?.agent?.first_message],['agent.language',overrides?.agent?.language],
    ['agent.prompt.prompt',overrides?.agent?.prompt?.prompt],['agent.prompt.tool_ids',overrides?.agent?.prompt?.tool_ids],
    ['agent.prompt.native_mcp_server_ids',overrides?.agent?.prompt?.native_mcp_server_ids],['agent.prompt.knowledge_base',overrides?.agent?.prompt?.knowledge_base],
    ['conversation.text_only',overrides?.conversation?.text_only],['conversation.max_duration_seconds',overrides?.conversation?.max_duration_seconds],
  ] as [string,unknown][])add(`owner.override.${path}`,value,true,`Enable the owner ${path} initiation override.`);
  return {checks,llmModel:typeof prompt?.llm==='string'?prompt.llm:undefined,retentionDays:typeof retention==='number'?retention:undefined};
}
