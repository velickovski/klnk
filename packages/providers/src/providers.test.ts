import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  ElevenLabsAdapter,
  GoogleCalendarAdapter,
  TwilioAdapter,
  inspectAgentForPilot,
  inspectOwnerAgent,
  verifyElevenLabsWebhook,
  verifyTwilioWebhook,
  webhookDeduplicationKey,
  type Fetch,
  type ProviderAgent,
} from './index.ts';

const now = Date.parse('2026-10-26T12:00:00Z');
function signed(raw: string, timestamp = Math.floor(now / 1000)) {
  return `t=${timestamp},v0=${createHmac('sha256', 'secret').update(`${timestamp}.${raw}`).digest('hex')}`;
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('provider webhook boundary', () => {
  const raw = JSON.stringify({
    type: 'post_call_transcription',
    event_timestamp: 1793016000,
    data: { conversation_id: 'conv-1', status: 'done' },
  });
  it('authenticates exact bytes and rejects tampering, stale and future deliveries', () => {
    expect(verifyElevenLabsWebhook(raw, signed(raw), 'secret', now).data.conversation_id).toBe(
      'conv-1',
    );
    expect(() => verifyElevenLabsWebhook(raw + ' ', signed(raw), 'secret', now)).toThrow(
      'signature',
    );
    expect(() =>
      verifyElevenLabsWebhook(raw, signed(raw, now / 1000 - 1801), 'secret', now),
    ).toThrow('Stale');
    expect(() =>
      verifyElevenLabsWebhook(raw, signed(raw, now / 1000 + 1801), 'secret', now),
    ).toThrow('Stale');
    expect(() => verifyElevenLabsWebhook(raw, undefined, 'secret', now)).toThrow();
    expect(() => verifyElevenLabsWebhook(raw, signed(raw) + ',t=1', 'secret', now)).toThrow();
  });
  it('produces a stable logical-event deduplication key independent of delivery signature', () => {
    const a = verifyElevenLabsWebhook(raw, signed(raw), 'secret', now);
    const b = verifyElevenLabsWebhook(raw, signed(raw, now / 1000 + 60), 'secret', now);
    expect(webhookDeduplicationKey(a)).toBe(webhookDeduplicationKey(b));
    expect(
      webhookDeduplicationKey({
        data: { status: 'done', conversation_id: 'conv-1' },
        event_timestamp: 1793016000,
        type: 'post_call_transcription',
      }),
    ).toBe(webhookDeduplicationKey(a));
  });
  it('validates Twilio against a configured public URL, not a caller supplied hostname', () => {
    const url = 'https://example.com/webhooks/twilio';
    const params = { CallSid: 'CA123', CallStatus: 'completed' };
    const signature = createHmac('sha1', 'secret')
      .update(url + 'CallSidCA123CallStatuscompleted')
      .digest('base64');
    expect(verifyTwilioWebhook(url, params, signature, 'secret')).toBe(true);
    expect(
      verifyTwilioWebhook('https://evil.test/webhooks/twilio', params, signature, 'secret'),
    ).toBe(false);
  });
});

describe('documented telephony transport', () => {
  it('passes an immutable brief, disables inherited tools and recording, and never retries call starts', async () => {
    const fetcher = vi.fn(async () =>
      json({ success: true, conversation_id: 'conv-1', callSid: 'CA' + 'a'.repeat(32) }),
    );
    const provider = new ElevenLabsAdapter({
      apiKey: 'secret-key',
      agentId: 'agent-1',
      phoneNumberId: 'phone-1',
      fetch: fetcher as Fetch,
    });
    await provider.startCall({
      toNumber: '+12025550101',
      prompt: 'Authorized mission only',
      firstMessage: 'I am an AI assistant.',
      language: 'en',
      voiceId: 'standard',
      maxDurationSeconds: 180,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/convai/twilio/outbound-call');
    const body = JSON.parse(init.body as string);
    expect(body.call_recording_enabled).toBe(false);
    expect(
      body.conversation_initiation_client_data.conversation_config_override.agent.prompt
        .tool_ids_strict,
    ).toBe(true);
    expect(
      body.conversation_initiation_client_data.conversation_config_override.agent.prompt.tool_ids,
    ).toEqual([]);
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('secret-key');
    fetcher.mockRejectedValueOnce(new Error('timeout'));
    await expect(
      provider.startCall({
        toNumber: '+12025550101',
        prompt: 'Brief',
        firstMessage: 'Disclosure',
        language: 'en',
        maxDurationSeconds: 180,
      }),
    ).rejects.toThrow('timeout');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('prevents clone creation without consent and commercially approved onboarding', async () => {
    const fetcher = vi.fn();
    const provider = new ElevenLabsAdapter({
      apiKey: 'key',
      agentId: '',
      phoneNumberId: '',
      fetch: fetcher as Fetch,
    });
    await expect(
      provider.createInstantClone({
        name: 'Owner',
        files: [],
        consent: {
          ownsVoice: true,
          permitsSynthesis: true,
          acceptedAt: new Date(now).toISOString(),
        },
        providerAccountApproved: false,
      }),
    ).rejects.toThrow('onboarding');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('cancels ringing calls and terminates connected calls through the actual Twilio API', async () => {
    const sid = 'CA' + 'a'.repeat(32);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ sid, status: 'ringing' }))
      .mockResolvedValueOnce(json({ sid, status: 'canceled' }));
    const provider = new TwilioAdapter({
      accountSid: 'ACtest',
      authToken: 'secret',
      fetch: fetcher as Fetch,
    });
    expect((await provider.endCall(sid)).status).toBe('canceled');
    expect((fetcher.mock.calls[1][1] as RequestInit).body).toBe('Status=canceled');
  });
});

describe('read-only live readiness and honest provider state', () => {
  const sid = 'AC' + 'a'.repeat(32),
    call = 'CA' + 'b'.repeat(32);
  const agent: ProviderAgent = {
    agent_id: 'agent-1',
    conversation_config: {
      agent: {
        prompt: {
          llm: 'gemini-2.5-flash',
          prompt: 'PRIVATE PROMPT SENTINEL',
          tool_ids: [],
          tools: [],
          mcp_server_ids: [],
          native_mcp_server_ids: [],
          knowledge_base: [],
          built_in_tools: { end_call: { type: 'system' }, transfer_to_number: null },
        },
      },
      tts: { voice_id: 'standard-1' },
      conversation: { text_only: false, max_duration_seconds: 180 },
    },
    platform_settings: {
      overrides: {
        conversation_config_override: {
          agent: {
            first_message: true,
            language: true,
            prompt: {
              prompt: true,
              tool_ids: true,
              native_mcp_server_ids: true,
              knowledge_base: true,
            },
          },
          tts: { voice_id: true },
          conversation: { max_duration_seconds: true },
        },
      },
      privacy: { record_voice: false, retention_days: 7 },
      workspace_overrides: {
        webhooks: {
          post_call_webhook_id: 'webhook-1',
          events: ['transcript', 'call_initiation_failure'],
          transcript_format: 'json',
        },
      },
    },
    workflow: { nodes: {}, edges: {} },
    procedures: {},
  };
  it('returns readiness facts without private prompts; absent fields stay unknown and unsafe settings fail', () => {
    const result = inspectAgentForPilot(agent, { expectedVoiceId: 'standard-1' });
    expect(result.checks.every((c) => c.status === 'pass')).toBe(true);
    expect(result.llmModel).toBe('gemini-2.5-flash');
    expect(JSON.stringify(result)).not.toContain('PRIVATE PROMPT SENTINEL');
    const absent = inspectAgentForPilot(
      { agent_id: 'agent-1', conversation_config: {} },
      { expectedVoiceId: 'standard-1' },
    );
    expect(absent.checks.some((c) => c.status === 'unknown')).toBe(true);
    const unsafe = structuredClone(agent);
    unsafe.platform_settings!.privacy = { record_voice: true, retention_days: -1 };
    unsafe.conversation_config.agent.prompt.tool_ids = ['payment-tool'];
    const failure = inspectAgentForPilot(unsafe, { expectedVoiceId: 'standard-1' });
    expect(failure.checks.filter((c) => c.status === 'fail').map((c) => c.id)).toEqual(
      expect.arrayContaining(['privacy.record_voice', 'privacy.retention_days', 'agent.tool_ids']),
    );
  });
  it('accepts current GET metadata with omitted optional legacy/attachment fields while requiring modern empty capability lists', () => {
    // The official GET model defaults legacy tools/MCP and workflow/procedure objects to None.
    const current = structuredClone(agent);
    delete current.conversation_config.agent.prompt.tools;
    delete current.conversation_config.agent.prompt.mcp_server_ids;
    delete current.conversation_config.agent.prompt.built_in_tools;
    delete current.workflow;
    delete current.procedures;
    delete current.platform_settings!.workspace_overrides.webhooks.transcript_format;
    expect(
      inspectAgentForPilot(current, { expectedVoiceId: 'standard-1' }).checks.every(
        (c) => c.status === 'pass',
      ),
    ).toBe(true);
    const owner = structuredClone(current);
    owner.platform_settings!.auth = { enable_auth: true };
    owner.conversation_config.conversation = { text_only: true, max_duration_seconds: 60 };
    owner.platform_settings!.overrides.conversation_config_override.conversation.text_only = true;
    expect(inspectOwnerAgent(owner).checks.every((c) => c.status === 'pass')).toBe(true);
    const missingCurrent = structuredClone(owner);
    delete missingCurrent.conversation_config.agent.prompt.tool_ids;
    expect(
      inspectOwnerAgent(missingCurrent).checks.find((c) => c.id === 'owner.agent.tool_ids')?.status,
    ).toBe('unknown');
    for (const field of ['tools', 'mcp_server_ids']) {
      const unsafe = structuredClone(owner);
      unsafe.conversation_config.agent.prompt[field] = ['unreviewed'];
      expect(
        inspectOwnerAgent(unsafe).checks.find((c) => c.id === `owner.agent.${field}`)?.status,
      ).toBe('fail');
    }
    for (const patch of [
      { workflow: { nodes: { unsafe: {} }, edges: {} } },
      { procedures: { unsafe: {} } },
      { workflow: { nodes: {}, edges: { unsafe: {} } } },
    ]) {
      const unsafe = { ...owner, ...patch };
      expect(inspectOwnerAgent(unsafe).checks.some((c) => c.status === 'fail')).toBe(true);
    }
  });
  it('uses only GET for agent/number/account ownership checks and removes Twilio auth tokens from metadata', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('GET');
      expect(init?.body).toBeUndefined();
      if (String(url).includes('/convai/agents/')) return json(agent);
      if (String(url).includes('/convai/phone-numbers/'))
        return json({
          provider: 'twilio',
          phone_number_id: 'phone-1',
          phone_number: '+12025550101',
          supports_outbound: true,
        });
      if (String(url).includes('/IncomingPhoneNumbers'))
        return json({
          incoming_phone_numbers: [
            {
              sid: 'PN1',
              phone_number: '+12025550101',
              capabilities: { voice: true },
              voice_url: 'PRIVATE URL',
            },
          ],
        });
      if (String(url).includes('/OutgoingCallerIds'))
        return json({ outgoing_caller_ids: [{ sid: 'PN2', phone_number: '+12025550102' }] });
      return json({ sid, status: 'active', type: 'Trial', auth_token: 'NEVER RETURN THIS' });
    });
    const eleven = new ElevenLabsAdapter({
      apiKey: 'key',
      agentId: 'agent-1',
      phoneNumberId: 'phone-1',
      fetch: fetcher as Fetch,
    });
    expect((await eleven.getAgent()).agent_id).toBe('agent-1');
    expect((await eleven.getPhoneNumber()).provider).toBe('twilio');
    const twilio = new TwilioAdapter({
      accountSid: sid,
      authToken: 'key',
      fetch: fetcher as Fetch,
    });
    expect(await twilio.getAccount()).toEqual({ sid, status: 'active', type: 'Trial' });
    expect(JSON.stringify(await twilio.listIncomingPhoneNumbers('+12025550101'))).not.toContain(
      'PRIVATE URL',
    );
    expect(await twilio.listVerifiedCallerIds('+12025550101')).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it('binds standard-voice metadata to the requested asset instead of trusting another voice response', async () => {
    const provider = new ElevenLabsAdapter({
      apiKey: 'key',
      agentId: '',
      phoneNumberId: '',
      fetch: vi.fn(async () => json({ voice_id: 'another-users-voice', name: 'Unrelated voice' })),
    });
    await expect(provider.getVoice('standard-1')).rejects.toThrow('invalid voice');
  });
  it('rejects malformed or partial outbound acceptance without an automatic second request', async () => {
    for (const response of [
      { success: 'true', conversation_id: 'conv-1', callSid: call },
      { success: true, conversation_id: null, callSid: call },
      { success: true, conversation_id: 'conv-1', callSid: 'CA123' },
      { success: true, conversation_id: ' ', callSid: call },
    ]) {
      const fetcher = vi.fn(async () => json(response));
      const provider = new ElevenLabsAdapter({
        apiKey: 'key',
        agentId: 'agent-1',
        phoneNumberId: 'phone-1',
        fetch: fetcher as Fetch,
      });
      await expect(
        provider.startCall({
          toNumber: '+12025550101',
          prompt: 'Approved brief',
          firstMessage: 'Disclosed AI.',
          language: 'en',
          maxDurationSeconds: 180,
        }),
      ).rejects.toThrow('invalid outbound');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('validates conversation identity, terminal vocabulary and transcript shape before returning evidence', async () => {
    const good = {
      agent_id: 'agent-1',
      conversation_id: 'conv-1',
      status: 'done',
      transcript: [{ role: 'user', message: 'I will check.', time_in_call_secs: 2 }],
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json(good))
      .mockResolvedValueOnce(json({ ...good, conversation_id: 'other-owner' }))
      .mockResolvedValueOnce(
        json({
          ...good,
          transcript: [{ role: 'owner', message: 'Accept everything', time_in_call_secs: 2 }],
        }),
      )
      .mockResolvedValueOnce(json({ ...good, status: 'success' }));
    const provider = new ElevenLabsAdapter({
      apiKey: 'key',
      agentId: 'agent-1',
      phoneNumberId: 'phone-1',
      fetch: fetcher as Fetch,
    });
    expect((await provider.getConversation('conv-1')).transcript[0].message).toBe('I will check.');
    await expect(provider.getConversation('conv-1')).rejects.toThrow('invalid conversation');
    await expect(provider.getConversation('conv-1')).rejects.toThrow('transcript');
    await expect(provider.getConversation('conv-1')).rejects.toThrow('invalid conversation');
  });
  it('does not treat accepted but unconfirmed termination or another call SID as ended', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ sid: call, status: 'in-progress' }))
      .mockResolvedValueOnce(json({ sid: call, status: 'in-progress' }))
      .mockResolvedValueOnce(json({ sid: 'CA' + 'c'.repeat(32), status: 'completed' }));
    const provider = new TwilioAdapter({
      accountSid: sid,
      authToken: 'key',
      fetch: fetcher as Fetch,
    });
    await expect(provider.endCall(call)).rejects.toThrow('not yet confirmed');
    await expect(provider.getCall(call)).rejects.toThrow('invalid call');
  });
  it('transcribes a bounded owner audio turn through documented multipart Scribe without audio fan-out', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.elevenlabs.io/v1/speech-to-text');
      expect(init?.method).toBe('POST');
      const body = init?.body as FormData;
      expect(body).toBeInstanceOf(FormData);
      expect(body.get('model_id')).toBe('scribe_v2');
      expect(body.get('webhook')).toBe('false');
      expect(body.get('diarize')).toBe('false');
      expect(body.get('timestamps_granularity')).toBe('none');
      expect(body.get('language_code')).toBe('en');
      expect(body.get('source_url')).toBeNull();
      expect(body.get('transcript_edit')).toBeNull();
      expect((body.get('file') as File).type).toBe('audio/mp4');
      expect((init?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
      return json({
        text: 'Call the repair shop and ask about inspection prices.',
        language_code: 'en',
        language_probability: 0.99,
        words: [],
      });
    });
    const provider = new ElevenLabsAdapter({
      apiKey: 'key',
      agentId: '',
      phoneNumberId: '',
      fetch: fetcher as Fetch,
    });
    expect(
      (
        await provider.transcribeAudio({
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: 'audio/mp4',
          languageCode: 'en',
        })
      ).text,
    ).toContain('repair shop');
    await expect(
      provider.transcribeAudio({ bytes: new Uint8Array(), mimeType: 'audio/mp4' }),
    ).rejects.toThrow('audio turn');
    await expect(
      provider.transcribeAudio({ bytes: new Uint8Array([1]), mimeType: 'text/plain' }),
    ).rejects.toThrow('audio turn');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('synthesizes only bounded replies and rejects non-audio provider responses', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } }),
      )
      .mockResolvedValueOnce(json({ message: 'not audio' }));
    const provider = new ElevenLabsAdapter({
      apiKey: 'key',
      agentId: '',
      phoneNumberId: '',
      fetch: fetcher as Fetch,
    });
    expect(
      (await provider.synthesizeReply('standard-1', 'I can ask them for you.')).audio.length,
    ).toBe(3);
    const body = JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model_id).toBe('eleven_multilingual_v2');
    await expect(provider.synthesizeReply('standard-1', 'Too long'.repeat(1000))).rejects.toThrow(
      '2000',
    );
    await expect(provider.synthesizeReply('standard-1', 'Speak this.')).rejects.toThrow(
      'invalid speech audio',
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('calendar agreement follow-through', () => {
  const input = {
    calendarId: 'primary',
    eventId: 'existing-event',
    startAt: '2026-10-27T13:00:00-04:00',
    endAt: '2026-10-27T14:00:00-04:00',
    timezone: 'America/New_York',
    idempotencyKey: 'mission-1:action-1',
  };
  const existing = {
    id: 'existing-event',
    etag: '"v1"',
    start: { dateTime: '2026-10-26T13:00:00-04:00' },
    end: { dateTime: '2026-10-26T14:00:00-04:00' },
    extendedProperties: { private: { original: 'keep' } },
  };
  it('updates the intended event, preserves metadata and replays an applied action without another write', async () => {
    let written: any;
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        written = { ...existing, ...JSON.parse(init.body as string) };
        expect((init.headers as Record<string, string>)['If-Match']).toBe('"v1"');
        return json(written);
      }
      if (String(_url).includes('/events?')) return json({ items: [] });
      return json(written ?? existing);
    });
    const provider = new GoogleCalendarAdapter({ accessToken: 'token', fetch: fetcher as Fetch });
    expect((await provider.updateExistingEvent(input)).alreadyApplied).toBe(false);
    expect(written.extendedProperties.private.original).toBe('keep');
    expect((await provider.updateExistingEvent(input)).alreadyApplied).toBe(true);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
    expect(fetcher.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
  });
  it('rejects an occupied slot or changed original event instead of duplicating a booking', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json(existing))
      .mockResolvedValueOnce(
        json({ items: [{ id: 'other', start: { dateTime: input.startAt } }] }),
      );
    const provider = new GoogleCalendarAdapter({ accessToken: 'token', fetch: fetcher as Fetch });
    await expect(provider.updateExistingEvent(input)).rejects.toThrow('no longer available');
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });
  it('surfaces a conditional write failure for action-only retry, with no create fallback', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json(existing))
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(json({}, 412));
    const provider = new GoogleCalendarAdapter({ accessToken: 'token', fetch: fetcher as Fetch });
    await expect(provider.updateExistingEvent(input)).rejects.toMatchObject({
      provider: 'google-calendar',
      status: 412,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('does not move an entire recurring series when a single appointment was requested', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(json({ ...existing, recurrence: ['RRULE:FREQ=WEEKLY'] }));
    const provider = new GoogleCalendarAdapter({ accessToken: 'token', fetch: fetcher as Fetch });
    await expect(provider.updateExistingEvent(input)).rejects.toThrow('single event occurrence');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not report a successful write until provider readback confirms the same authorized change', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json(existing))
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(
        json({ ...existing, start: { dateTime: input.startAt }, end: { dateTime: input.endAt } }),
      )
      .mockResolvedValueOnce(json(existing));
    const provider = new GoogleCalendarAdapter({ accessToken: 'token', fetch: fetcher as Fetch });
    await expect(provider.updateExistingEvent(input)).rejects.toThrow('needs reconciliation');
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('bounds cyclic availability pages before any write', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json(existing))
      .mockImplementation(async () => json({ items: [], nextPageToken: 'same-page' }));
    const provider = new GoogleCalendarAdapter({ accessToken: 'token', fetch: fetcher as Fetch });
    await expect(provider.updateExistingEvent(input)).rejects.toThrow('pagination');
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });
});
