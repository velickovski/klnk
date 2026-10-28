import { beforeAll, describe, expect, it } from 'vitest';
import { acknowledgesIntent, OWNER_UTTERANCE_CORPUS, runOwnerUtteranceCorpus } from '../scripts/owner-utterance-corpus.js';

describe('M5 fixed fictional owner text/domain corpus', () => {
  let report: Awaited<ReturnType<typeof runOwnerUtteranceCorpus>>;
  beforeAll(async () => { report = await runOwnerUtteranceCorpus(); });
  it('contains exactly20 unique fixed fictional samples with required intent diversity', () => {
    expect(OWNER_UTTERANCE_CORPUS).toHaveLength(20);
    expect(new Set(OWNER_UTTERANCE_CORPUS.map(item => item.id)).size).toBe(20);
    expect(new Set(OWNER_UTTERANCE_CORPUS.map(item => item.utterance)).size).toBe(20);
    const tags = new Set(OWNER_UTTERANCE_CORPUS.flatMap(item => item.tags));
    for (const tag of ['exact_message', 'ambiguous_name', 'recipient_correction', 'phone_correction', 'private_clause', 'unavailable_calendar', 'unavailable_messages', 'stop', 'clear_chat', 'conversation_end', 'interruption_intent']) expect(tags.has(tag)).toBe(true);
  });
  it('actually evaluates all20 authenticated localAPI samples with zero network, external effects or authority failures', () => {
    expect(report.sampleCount).toBe(20); expect(report.environment.noHttpListener).toBe(true);
    expect(report.summary.networkAttempts).toBe(0); expect(report.summary.safetyFailures).toBe(0);
    expect(report.results.every(result => result.observed.externalAttempts === 0 && result.observed.audioReturned === false && result.observed.replyMode === 'simulator')).toBe(true);
    expect(report.results.every(result => result.checks.some(check => check.name === 'existing_authorization_unchanged' && check.passed))).toBe(true);
  });
  it('preserves exact-message fast paths without adding universal review and anchors relative time', () => {
    for (const id of ['OC-01', 'OC-02', 'OC-03', 'OC-04', 'OC-06']) {
      const result = report.results.find(result => result.id === id)!;
      expect(result.actualStatus).toBe('queued'); expect(result.observed.authorizedMissions).toBe(1);
      expect(result.checks.find(check => check.name === 'exact_message_fast_path_preserved')?.passed).toBe(true);
    }
    expect(report.results.find(result => result.id === 'OC-04')?.checks.find(check => check.name === 'relative_time_anchored_to_original_instruction')?.passed).toBe(true);
  });
  it('passes the supported stop/clear/status scenarios while keeping clearing separate from cancellation', () => {
    for (const id of ['OC-15', 'OC-16', 'OC-17', 'OC-20']) expect(report.results.find(result => result.id === id)?.outcome).toBe('passed');
    expect(report.results.find(result => result.id === 'OC-17')?.actualStatus).toBe('reply');
    expect(report.results.find(result => result.id === 'OC-20')?.actualStatus).toBe('completed');
  });
  it('records unsupported feedback as findings rather than inventing successful behavior', () => {
    for (const result of report.results.filter(result => result.outcome === 'finding')) {
      const sample = OWNER_UTTERANCE_CORPUS.find(item => item.id === result.id)!;
      expect(sample.expectation.acknowledgement).toBeTruthy();
      expect(result.checks.filter(check => !check.passed)).toEqual([{ name: 'specific_intent_acknowledged_or_unavailability_explained', passed: false, category: 'routing' }]);
    }
    expect(report.summary.passed + report.summary.findings).toBe(20);
  });
  it('does not treat generic call help as unavailable-service or interruption support', () => {
    const generic = 'Say call Jordan Lee with the exact message, or say stop.';
    for (const kind of ['calendar_unavailable', 'messages_unavailable', 'conversation_end', 'playback_interruption'] as const) expect(acknowledgesIntent(kind, generic)).toBe(false);
    expect(acknowledgesIntent('calendar_unavailable', 'Calendar access is unavailable here.')).toBe(true);
    expect(acknowledgesIntent('messages_unavailable', 'SMS messaging is not supported.')).toBe(true);
    expect(acknowledgesIntent('conversation_end', 'Use the End conversation button to close this session.')).toBe(true);
    expect(acknowledgesIntent('conversation_end', 'To end live voice, choose End call.')).toBe(true);
    expect(acknowledgesIntent('playback_interruption', 'Use Stop audio to stop playback.')).toBe(true);
  });
  it('labels the result as text/domain only and excludes raw utterances/replies/account tokens from shared metadata', () => {
    const serialized = JSON.stringify(report);
    expect(report.environment.model).toContain('none');
    expect(report.limits.join(' ')).toContain('not ASR');
    expect(serialized).not.toContain('Bearer '); expect(serialized).not.toContain('Fictional local corpus password');
    for (const sample of OWNER_UTTERANCE_CORPUS) expect(serialized).not.toContain(JSON.stringify(sample.utterance));
    expect(report.sourceIdentity).toHaveLength(3);
  });
});
