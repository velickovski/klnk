import { ApplicationToolNameSchema } from '../../packages/domain/src/index.js';
// Only these fixed metadata labels leave a paid smoke test. A valid identifier can
// still contain a secret, so character filtering is not a redaction boundary.
const eventTypes = new Set([
  'session.started', 'session.closed', 'session.close',
  'session.delegation.created', 'session.input_audio.muted', 'session.input_audio.unmuted',
  'session.output_audio.delta', 'session.input_transcript.delta', 'session.output_transcript.delta',
  'response.event', 'error',
]);
const errorCodes = new Set([
  'rate_limit', 'rate_limit_exceeded', 'insufficient_quota', 'invalid_request_error',
  'invalid_api_key', 'authentication_error', 'permission_denied', 'model_not_found',
  'server_error', 'internal_error', 'session_expired', 'invalid_value',
]);
const toolTypes = new Set([
  'function_call', 'custom_tool_call', 'web_search_call', 'file_search_call',
  'computer_call', 'code_interpreter_call', 'image_generation_call',
  'mcp_call', 'mcp_approval_request', 'local_shell_call', 'shell_call', 'apply_patch_call',
]);
// calendar_lookup remains a legacy diagnostic fixture, never a product tool.
const toolNames = new Set([...ApplicationToolNameSchema.options,'calendar_lookup']);
const safeLabel = (value: unknown, allowed: ReadonlySet<string>) =>
  typeof value === 'string' && allowed.has(value) ? value : 'unrecognized';

// Never serialize provider events, identifiers, tool arguments/results, or speech.
export function createLiveSmokeObserver() {
  const summary = {
    started: false, closed: false, outputAudioBytes: 0,
    inputTranscriptCharacters: 0, outputTranscriptCharacters: 0, outputAfterInputTranscript: false,
    delegations: 0, toolCalls: [] as string[], providerErrorCodes: [] as string[],
    eventCounts: Object.create(null) as Record<string, number>,
  };
  const seenCalls = new Set<string>();
  function observe(raw: unknown) {
    if (!raw || typeof raw !== 'object') return;
    const event = raw as Record<string, any>;
    const type = safeLabel(event.type, eventTypes);
    summary.eventCounts[type] = (summary.eventCounts[type] ?? 0) + 1;
    if (type === 'session.started') summary.started = true;
    if (type === 'session.closed') summary.closed = true;
    if (type === 'session.delegation.created') summary.delegations++;
    if (type === 'session.output_audio.delta' && typeof event.delta === 'string') summary.outputAudioBytes += Buffer.from(event.delta, 'base64').length;
    if (type === 'session.input_transcript.delta' && typeof event.delta === 'string') summary.inputTranscriptCharacters += event.delta.length;
    if (type === 'session.output_transcript.delta' && typeof event.delta === 'string') {
      summary.outputTranscriptCharacters += event.delta.length;
      if (summary.inputTranscriptCharacters > 0 && event.delta.length > 0) summary.outputAfterInputTranscript = true;
    }
    if (type === 'error') summary.providerErrorCodes.push(safeLabel(event.error?.code, errorCodes));
    if (type !== 'response.event' || !event.event || typeof event.event !== 'object') return;
    const nested = event.event as Record<string, any>;
    if (!['response.output_item.added', 'response.output_item.done'].includes(nested.type) || !nested.item || typeof nested.item !== 'object') return;
    const item = nested.item as Record<string, any>;
    if (typeof item.type !== 'string' || !(/_call$/.test(item.type) || item.type === 'mcp_approval_request')) return;
    const id = typeof item.call_id === 'string' ? item.call_id : typeof item.id === 'string' ? item.id : undefined;
    if (id && seenCalls.has(id)) return;
    if (id) seenCalls.add(id);
    const toolType = safeLabel(item.type, toolTypes);
    const toolName = item.name === undefined ? toolType : safeLabel(item.name, toolNames);
    summary.toolCalls.push(`${toolType}:${toolName}`);
  }
  return { summary, observe };
}
