import { describe, expect, it } from 'vitest';
import { createLiveSmokeObserver } from '../scripts/lib/live-smoke-observer.js';

describe('live provider evidence redaction and truthfulness', () => {
  it('requires provider terminal evidence, not a local close request', () => {
    const { summary, observe } = createLiveSmokeObserver();
    observe({ type: 'session.started' });
    observe({ type: 'session.close' });
    expect(summary.started).toBe(true);
    expect(summary.closed).toBe(false);
    observe({ type: 'session.closed', usage: { private: 'not exported' } });
    expect(summary.closed).toBe(true);
  });
  it('counts audio and captions without retaining speech, credentials, session IDs or error text', () => {
    const { summary, observe } = createLiveSmokeObserver();
    observe({ type: 'session.started', session: { id: 'secret-session', token: 'sk-secret' } });
    observe({ type: 'session.input_transcript.delta', delta: 'private speech' });
    observe({ type: 'session.output_transcript.delta', delta: 'private answer' });
    observe({ type: 'session.output_audio.delta', delta: Buffer.alloc(4800).toString('base64') });
    observe({ type: 'error', error: { code: 'rate_limit', message: 'sk-secret' } });
    expect(summary.outputAudioBytes).toBe(4800);
    expect(summary.inputTranscriptCharacters).toBe(14);
    expect(summary.outputTranscriptCharacters).toBe(14);
    expect(summary.providerErrorCodes).toEqual(['rate_limit']);
    expect(JSON.stringify(summary)).not.toMatch(/private|sk-secret|secret-session/);
  });
  it('observes nested completed tool calls, deduplicates delivery, and drops arguments/results', () => {
    const { summary, observe } = createLiveSmokeObserver();
    const event = { type: 'response.event', delegation_id: 'private-id', event: { type: 'response.output_item.done', item: { type: 'function_call', name: 'calendar_lookup', call_id: 'call-1', arguments: '{"token":"secret"}' } } };
    observe(event); observe(event);
    observe({ type: 'session.delegation.created' });
    expect(summary.toolCalls).toEqual(['function_call:calendar_lookup']);
    expect(summary.delegations).toBe(1);
    expect(JSON.stringify(summary)).not.toMatch(/private-id|call-1|secret|arguments/);
  });
  it('does not mistake reasoning messages or tool results for new execution', () => {
    const { summary, observe } = createLiveSmokeObserver();
    for (const type of ['reasoning', 'message', 'function_call_output']) observe({ type: 'response.event', event: { type: 'response.output_item.done', item: { type, output: 'sensitive' } } });
    expect(summary.toolCalls).toEqual([]);
  });
  it('captures attempted tool calls even when no completion arrives', () => {
    const { summary, observe } = createLiveSmokeObserver();
    const item = { type: 'function_call', name: 'calendar_lookup', call_id: 'call-2' };
    observe({ type: 'response.event', event: { type: 'response.output_item.added', item } });
    observe({ type: 'response.event', event: { type: 'response.output_item.done', item } });
    expect(summary.toolCalls).toEqual(['function_call:calendar_lookup']);
  });
  it('bounds event labels and rejects reflected arbitrary error strings', () => {
    const { summary, observe } = createLiveSmokeObserver();
    observe(null); observe('not-json');
    observe({ type: 'a'.repeat(1000) });
    observe({ type: 'error', error: { code: 'Bearer secret token' } });
    expect(summary.eventCounts.unrecognized).toBe(1);
    expect(summary.providerErrorCodes).toEqual(['unrecognized']);
    expect(JSON.stringify(summary)).not.toContain('secret token');
  });
  it('does not count a greeting alone as an input/output conversation', () => {
    const { summary, observe } = createLiveSmokeObserver();
    observe({ type: 'session.output_transcript.delta', delta: 'Hello' });
    expect(summary.outputAfterInputTranscript).toBe(false);
    observe({ type: 'session.input_transcript.delta', delta: 'Fictional input' });
    expect(summary.outputAfterInputTranscript).toBe(false);
    observe({ type: 'session.output_transcript.delta', delta: 'Response' });
    expect(summary.outputAfterInputTranscript).toBe(true);
  });
  it('redacts secret-shaped valid identifiers in every exported label while preserving attempted-call evidence', () => {
    const { summary, observe } = createLiveSmokeObserver();
    const secret = 'sk-proj-FictionalSecret123';
    observe({ type: secret });
    observe({ type: 'error', error: { code: secret } });
    observe({ type: 'response.event', event: { type: 'response.output_item.added', item: { type: 'function_call', name: secret, call_id: `${secret}-first` } } });
    observe({ type: 'response.event', event: { type: 'response.output_item.done', item: { type: `${secret}_call`, name: secret, id: `${secret}-second` } } });
    expect(summary.eventCounts.unrecognized).toBe(1);
    expect(summary.providerErrorCodes).toEqual(['unrecognized']);
    expect(summary.toolCalls).toEqual(['function_call:unrecognized', 'unrecognized:unrecognized']);
    expect(JSON.stringify(summary)).not.toContain(secret);
  });
  it('does not export arbitrary identifier labels or inherited object-property names', () => {
    const { summary, observe } = createLiveSmokeObserver();
    for (const type of ['constructor', '__proto__', 'toString', 'future_private_event']) observe({ type });
    observe({ type: 'response.event', event: { type: 'response.output_item.done', item: { type: 'web_search_call', id: 'private-call' } } });
    expect(summary.eventCounts.unrecognized).toBe(4);
    expect(summary.toolCalls).toEqual(['web_search_call:web_search_call']);
    expect(JSON.stringify(summary)).not.toMatch(/constructor|__proto__|toString|future_private_event|private-call/);
  });
});
