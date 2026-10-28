import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import { Database } from '../apps/server/src/db.js';
import { getConfig } from '../apps/server/src/config.js';
import { hashToken } from '../apps/server/src/auth.js';
class Socket extends EventEmitter {
  readyState = 1;
  sent: any[] = [];
  constructor() {
    super();
    queueMicrotask(() => {
      this.emit('open');
      this.event({ type: 'session.started' });
    });
  }
  event(value: unknown) {
    this.emit('message', JSON.stringify(value));
  }
  send(raw: string) {
    const value = JSON.parse(raw);
    this.sent.push(value);
    if (value.type === 'session.close')
      queueMicrotask(() => this.event({ type: 'session.closed' }));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  terminate() {
    this.close();
  }
}
const services: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  for (const s of services.splice(0)) {
    await s.app.close();
    await s.db.close();
  }
});
async function until(check: () => Promise<boolean> | boolean) {
  const end = Date.now() + 4000;
  while (!(await check())) {
    if (Date.now() >= end) throw new Error('Fixture state did not settle.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function fixture() {
  const db = await new Database({ dataDir: 'memory://' }).open(),
    bodies: any[] = [],
    sockets: Socket[] = [];
  const s = await createApp({
    db,
    worker: false,
    config: {
      ...getConfig(),
      port: 4000,
      production: false,
      demoEnabled: true,
      provider: 'simulator',
      liveEnabled: false,
      openaiKey: 'fictional-provider-key',
      origins: ['http://localhost:8081'],
      googleClientId: undefined,
      googleClientSecret: undefined,
      googleRedirectUri: undefined,
    },
    openaiLiveDependencies: {
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            session: { id: `fixture-session-${bodies.length}` },
            transport: { type: 'webrtc', sdp: 'fixture-answer' },
          }),
          { status: 200 },
        );
      },
      socket: () => {
        const socket = new Socket();
        sockets.push(socket);
        return socket;
      },
    },
  });
  services.push(s);
  const a = (await s.app.inject({ method: 'POST', url: '/auth/demo' })).json(),
    headers = {
      authorization: `Bearer ${a.token}`,
      host: 'localhost:4000',
      origin: 'http://localhost:8081',
    };
  const start = () =>
    s.app.inject({
      method: 'POST',
      url: '/voice/live/session',
      headers,
      payload: { requestId: randomUUID(), sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111' },
    });
  return { ...s, a, headers, bodies, sockets, start };
}
describe('actual application permission to Live tool delivery boundary', () => {
  it('starts tool-free by default, then only an explicit owner grant exposes in-app schemas and returns a recorded lookup', async () => {
    const f = await fixture(),
      first = await f.start();
    expect(first.statusCode).toBe(201);
    expect(f.bodies[0].session.delegation.responses.tools).toEqual([]);
    await f.app.inject({
      method: 'POST',
      url: `/voice/live/session/${first.json().session.id}/close`,
      headers: f.headers,
      payload: {},
    });
    await until(
      async () =>
        !(await f.app.inject({ url: '/voice/live/recovery', headers: f.headers })).json().requests
          .length,
    );
    await f.app.inject({
      method: 'PUT',
      url: '/tools/access',
      headers: f.headers,
      payload: {
        enabled: true,
        tools: ['contacts_lookup', 'memory_lookup', 'request_prepare', 'request_status'],
      },
    });
    const second = await f.start();
    expect(second.statusCode).toBe(201);
    const sent = f.bodies[1].session;
    expect(sent.delegation.responses.tools.map((tool: any) => tool.name)).toEqual([
      'contacts_lookup',
      'memory_lookup',
      'request_prepare',
      'request_status',
    ]);
    expect(sent.client.data_channel.allowed_client_events).toEqual([
      'session.close',
      'session.input_audio.mute',
      'session.input_audio.unmute',
    ]);
    expect(JSON.stringify(sent)).not.toContain(f.a.token);
    expect(JSON.stringify(sent)).not.toContain(hashToken(f.a.token));
    expect(JSON.stringify(sent)).not.toContain(f.a.user.id);
    const socket = f.sockets[1],
      envelope = (event: unknown) =>
        socket.event({ type: 'response.event', delegation_id: 'fixture-delegation', event });
    envelope({ type: 'response.created', response: { id: 'fixture-response' } });
    envelope({
      type: 'response.output_item.done',
      response_id: 'fixture-response',
      item: {
        type: 'function_call',
        call_id: 'fixture-contact-call',
        name: 'contacts_lookup',
        arguments: JSON.stringify({ query: 'Jordan', limit: 2 }),
      },
    });
    envelope({
      type: 'response.completed',
      response: { id: 'fixture-response', status: 'completed', output: [] },
    });
    await until(() => socket.sent.some((value) => value.type === 'response.item.create'));
    const output = JSON.parse(
      socket.sent.find((value) => value.type === 'response.item.create').item.output,
    );
    expect(output).toMatchObject({
      toolName: 'contacts_lookup',
      status: 'succeeded',
      spokenDeliveryConfirmed: false,
      data: { untrusted: true },
    });
    expect(output.data.contacts.length).toBeGreaterThan(0);
    const traces = (await f.app.inject({ url: '/tools/traces', headers: f.headers })).json().events;
    expect(traces.some((event: any) => event.event === 'tool_succeeded')).toBe(true);
    expect(JSON.stringify(traces)).not.toContain('Jordan');
    expect(await f.repo.list(f.a.user.id, 'mission')).toHaveLength(0);
    expect(f.bodies).toHaveLength(2);
  });
  it('foreign approved-request binding is rejected before any provider creation', async () => {
    const f = await fixture(),
      b = (await f.app.inject({ method: 'POST', url: '/auth/demo' })).json(),
      otherHeaders = { authorization: `Bearer ${b.token}` };
    const mission = (
      await f.app.inject({
        method: 'POST',
        url: '/missions',
        headers: otherHeaders,
        payload: { templateId: 'information' },
      })
    ).json();
    await f.app.inject({
      method: 'POST',
      url: `/missions/${mission.id}/authorize`,
      headers: otherHeaders,
      payload: { version: 1 },
    });
    await f.app.inject({
      method: 'PUT',
      url: '/tools/access',
      headers: f.headers,
      payload: { enabled: true, tools: ['request_dispatch'] },
    });
    const result = await f.app.inject({
      method: 'POST',
      url: '/voice/live/session',
      headers: f.headers,
      payload: {
        requestId: randomUUID(),
        authorizedMissionId: mission.id,
        sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111',
      },
    });
    expect(result.statusCode).toBe(409);
    expect(f.bodies).toHaveLength(0);
  });
});
