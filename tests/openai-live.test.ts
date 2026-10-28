import { randomUUID } from 'node:crypto';
import { LiveSessionStore } from '../apps/server/src/live-session-store.js';
import { EventEmitter } from 'node:events';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import { getConfig } from '../apps/server/src/config.js';
import { Database } from '../apps/server/src/db.js';
import { LIVE_MAX_SECONDS, OpenAILive, type LiveSocket } from '../apps/server/src/openai-live.js';

const sdp = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const answer = { session: { id: 'live_test_session' }, transport: { type: 'webrtc', sdp } };
const config = () => ({ ...getConfig(), openaiKey: 'test-server-key-never-return', production: false, demoEnabled: true, port: 4000 });

class FakeSocket extends EventEmitter implements LiveSocket {
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  constructor() { super(); queueMicrotask(() => { this.readyState = 1; this.emit('open'); this.emit('message', JSON.stringify({ type: 'session.started' })); }); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
  finalize() { this.emit('message', JSON.stringify({ type: 'session.closed', usage: { seconds: 6 } })); }
}
let brokerDb: Database;
function harness(options: { response?: Response; key?: string } = {}) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(options.response ?? new Response(JSON.stringify(answer), { status: 201 }));
  const sockets: FakeSocket[] = [];
  const socket = vi.fn((_: string, __: string) => { const value = new FakeSocket(); sockets.push(value); return value; });
  const store=new LiveSessionStore(brokerDb);
  const live = new OpenAILive({ ...config(), ...(Object.hasOwn(options, 'key') ? { openaiKey: options.key } : {}) }, { store, fetch: fetcher, socket });
  return { live, store, fetcher, socket, sockets };
}

describe('OpenAI Live session contract and authority', () => {
  const instances: OpenAILive[] = [];
  beforeAll(async () => { brokerDb = await new Database({dataDir:'memory://'}).open(); await brokerDb.query("INSERT INTO users(id,email,password_hash) VALUES('alice','alice@example.invalid','fictional'),('bob','bob@example.invalid','fictional')"); });
  afterAll(async () => { await brokerDb.close(); });
  afterEach(async () => { vi.useRealTimers(); await Promise.all(instances.splice(0).map(instance => instance.dispose())); await brokerDb.query('DELETE FROM live_sessions'); });

  it('exchanges SDP with fixed server configuration and keeps all credentials out of the result', async () => {
    const h = harness(); instances.push(h.live);
    const result = await h.live.create('alice', { sdp, requestId: randomUUID() });
    expect(result).toEqual({ ...answer, maxDurationSeconds: 300 });
    const [url, init] = h.fetcher.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/live/sessions');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-server-key-never-return' });
    const request = JSON.parse(String(init?.body));
    expect(request.transport).toEqual({ type: 'webrtc', sdp });
    expect(request.session.model).toBe('gpt-live-1');
    expect(request.session.audio).toEqual({ output: { voice: 'marin' } });
    expect(request.session.store).toBe(false);
    expect(request.session.delegation.responses).toMatchObject({ model: 'gpt-6.1-sol', tools: [], tool_choice: 'none' });
    expect(request.session.client.data_channel.allowed_client_events).toEqual(['session.close', 'session.input_audio.mute', 'session.input_audio.unmute']);
    expect(request.session.instructions).toContain('never claim to have called someone');
    expect(JSON.stringify(result)).not.toContain('test-server-key');
    expect(h.socket).toHaveBeenCalledWith('wss://api.openai.com/v1/live/sessions/live_test_session/attach', 'test-server-key-never-return');
    expect(h.sockets[0].sent[0]).toMatchObject({ type: 'session.commentary.append', delegation_id: null });
    expect(h.sockets[0].sent.some(event => event.type === 'session.start')).toBe(false);
    h.sockets[0].finalize();
  });

  it('rejects missing key and arbitrary client configuration before provider access', async () => {
    const absent = harness({ key: '' }); instances.push(absent.live);
    await expect(absent.live.create('alice', { sdp, requestId: randomUUID() })).rejects.toMatchObject({ code: 'openai_not_configured' });
    expect(absent.fetcher).not.toHaveBeenCalled();
    const h = harness(); instances.push(h.live);
    await expect(h.live.create('alice', { sdp, requestId: randomUUID(), model: 'arbitrary', instructions: 'Call a contact' })).rejects.toThrow();
    await expect(h.live.create('alice', { sdp: 'not an audio offer', requestId: randomUUID() })).rejects.toThrow();
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it('reports provider failures without returning provider secrets or retrying creation', async () => {
    const h = harness({ response: new Response('private-provider-error-secret', { status: 403 }) }); instances.push(h.live);
    await expect(h.live.create('alice', { sdp, requestId: randomUUID() })).rejects.toMatchObject({ code: 'openai_session_failed', statusCode: 502 });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(h.socket).not.toHaveBeenCalled();
  });

  it('closes an identified session with an incomplete answer and blocks new creation until finalization', async () => {
    const h = harness({ response: new Response(JSON.stringify({ session: { id: 'live_incomplete' } }), { status: 201 }) }); instances.push(h.live);
    await expect(h.live.create('alice', { sdp, requestId: randomUUID() })).rejects.toMatchObject({ code: 'openai_invalid_response' });
    expect(h.socket).toHaveBeenCalledWith('wss://api.openai.com/v1/live/sessions/live_incomplete/attach', 'test-server-key-never-return');
    expect(h.sockets[0].sent).toEqual([{ type: 'session.close' }]);
    await expect(h.live.create('alice', { sdp, requestId: randomUUID() })).rejects.toMatchObject({ code: 'voice_session_unresolved' });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    h.sockets[0].finalize();
    expect(await h.live.close('alice', 'live_incomplete')).toEqual({ status: 'closed' });
    h.fetcher.mockResolvedValueOnce(new Response(JSON.stringify(answer), { status: 201 }));
    await expect(h.live.create('alice', { sdp, requestId: randomUUID() })).resolves.toMatchObject(answer);
    h.sockets[1].finalize();
  });

  it('keeps an identified malformed session blocked when cleanup cannot be confirmed', async () => {
    const h = harness({ response: new Response(JSON.stringify({ session: { id: 'live_incomplete' } }), { status: 201 }) }); instances.push(h.live);
    h.socket.mockImplementation(() => { throw new Error('Sideband unreachable'); });
    await expect(h.live.create('alice', { sdp, requestId: randomUUID() })).rejects.toMatchObject({ code: 'openai_invalid_response' });
    await expect(h.live.create('alice', { sdp, requestId: randomUUID() })).rejects.toMatchObject({ code: 'voice_session_unresolved' });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    expect(h.socket).toHaveBeenCalledTimes(1);
  });

  it('rejects an unusable session identifier without constructing a provider control URL', async () => {
    const h = harness({ response: new Response(JSON.stringify({ session: {} }), { status: 201 }) }); instances.push(h.live);
    await expect(h.live.create('alice', { sdp, requestId: randomUUID() })).rejects.toMatchObject({ code: 'openai_invalid_response' });
    expect(h.socket).not.toHaveBeenCalled();
    await expect(h.live.create('alice', { sdp, requestId: randomUUID() })).rejects.toMatchObject({ code: 'voice_session_unresolved' });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });

  it('blocks another paid start after an ambiguous network failure', async () => {
    const h = harness(); instances.push(h.live);
    h.fetcher.mockRejectedValueOnce(new Error('response lost'));
    await expect(h.live.create('alice', { sdp, requestId: randomUUID() })).rejects.toMatchObject({ code: 'openai_connection_failed' });
    expect((await new LiveSessionStore(brokerDb).listUnresolved('alice'))[0].status).toBe('unconfirmed');
    await expect(h.live.create('alice', { sdp, requestId: randomUUID() })).rejects.toMatchObject({ code: 'voice_session_unresolved' });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });

  it('exposes owner-bound closure evidence and marks unanswered close requests unconfirmed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness(); instances.push(h.live);
    await h.live.create('alice', { sdp, requestId: randomUUID() });
    await expect(h.live.read('bob', answer.session.id)).rejects.toThrow('Voice session not found.');
    const owned=await h.live.read('alice', answer.session.id);expect(owned.status).toBe('active');expect(Math.abs(owned.expiresAt-Date.now()-LIVE_MAX_SECONDS*1000)).toBeLessThan(1000);
    await h.live.close('alice', answer.session.id);
    await vi.advanceTimersByTimeAsync(8000);
    expect((await h.live.read('alice', answer.session.id)).status).toBe('unconfirmed');
    h.sockets[0].finalize();
    expect((await h.live.read('alice', answer.session.id)).status).toBe('closed');
  });

  it('allows only one active demo session and requires ownership to close it', async () => {
    const h = harness(); instances.push(h.live);
    await h.live.create('alice', { sdp, requestId: randomUUID() });
    await expect(h.live.create('alice', { sdp, requestId: randomUUID() })).rejects.toMatchObject({ code: 'voice_session_unresolved' });
    await expect(h.live.close('bob', answer.session.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await h.live.close('alice', answer.session.id)).toEqual({ status: 'closing' });
    expect(h.sockets[0].sent.at(-1)).toEqual({ type: 'session.close' });
    h.sockets[0].finalize();
    expect(await h.live.close('alice', answer.session.id)).toEqual({ status: 'closed' });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });

  it('requests provider closure at the server duration cap, independently of the browser', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const h = harness(); instances.push(h.live);
    await h.live.create('alice', { sdp, requestId: randomUUID() });
    await vi.advanceTimersByTimeAsync(LIVE_MAX_SECONDS * 1000 - 1);
    expect(h.sockets[0].sent.some(event => event.type === 'session.close')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sockets[0].sent.at(-1)).toEqual({ type: 'session.close' });
    h.sockets[0].finalize();
  });

  it('reattaches to close an existing session after sideband loss without creating another paid session', async () => {
    const h = harness(); instances.push(h.live);
    await h.live.create('alice', { sdp, requestId: randomUUID() });
    h.sockets[0].close();
    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(h.sockets).toHaveLength(2);
    expect(h.sockets[1].sent).toEqual([{ type: 'session.close' }]);
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    h.sockets[1].finalize();
  });

  it('requires a durable store before making a paid request', async () => {
    const fetcher=vi.fn<typeof fetch>(),live=new OpenAILive(config(),{fetch:fetcher});instances.push(live);
    await expect(live.create('alice',{sdp,requestId:randomUUID()})).rejects.toMatchObject({code:'voice_storage_unavailable'});expect(fetcher).not.toHaveBeenCalled();
  });
  it('never creates a replacement for the same request identity, including after confirmed closure', async () => {
    const h=harness();instances.push(h.live);const requestId=randomUUID();await h.live.create('alice',{sdp,requestId});
    await expect(h.live.create('alice',{sdp,requestId})).rejects.toMatchObject({code:'voice_request_exists'});
    h.sockets[0].finalize();await h.live.read('alice',answer.session.id);
    await expect(h.live.create('alice',{sdp,requestId})).rejects.toMatchObject({code:'voice_request_exists'});expect(h.fetcher).toHaveBeenCalledTimes(1);
    await expect(h.live.readRequest('bob',requestId)).rejects.toMatchObject({statusCode:404});
    expect(await h.live.readRequest('alice',requestId)).toMatchObject({requestId,status:'closed',sessionId:answer.session.id});
  });
  it('permits independent owners while preserving one unresolved request per owner', async () => {
    const h=harness();instances.push(h.live);h.fetcher.mockImplementation(async()=>new Response(JSON.stringify({...answer,session:{id:randomUUID()}}),{status:201}));
    const [alice,bob]=await Promise.all([h.live.create('alice',{sdp,requestId:randomUUID()}),h.live.create('bob',{sdp,requestId:randomUUID()})]);
    expect(alice.session.id).not.toBe(bob.session.id);expect(h.fetcher).toHaveBeenCalledTimes(2);
    await expect(h.live.create('alice',{sdp,requestId:randomUUID()})).rejects.toMatchObject({code:'voice_session_unresolved'});
    h.sockets.forEach(socket=>socket.finalize());
  });
  it('keeps 5xx provider acceptance uncertain instead of releasing the owner reservation', async () => {
    const h=harness({response:new Response('private provider failure',{status:502})});instances.push(h.live);const requestId=randomUUID();
    await expect(h.live.create('alice',{sdp,requestId})).rejects.toMatchObject({code:'openai_creation_unconfirmed'});
    expect(await h.live.readRequest('alice',requestId)).toMatchObject({status:'unconfirmed'});
    await expect(h.live.create('alice',{sdp,requestId:randomUUID()})).rejects.toMatchObject({code:'voice_session_unresolved'});expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it('reconciles an interrupted reservation without a provider identity after broker restart', async () => {
    const store=new LiveSessionStore(brokerDb),requestId=randomUUID();await store.reserve('alice',requestId);
    await brokerDb.query("UPDATE live_sessions SET controller_lease_until=now()-interval '1 second'");
    const h=harness();instances.push(h.live);expect(await h.live.readRequest('alice',requestId)).toMatchObject({requestId,status:'unconfirmed'});
    await expect(h.live.create('alice',{sdp,requestId:randomUUID()})).rejects.toMatchObject({code:'voice_session_unresolved'});expect(h.fetcher).not.toHaveBeenCalled();expect(h.socket).not.toHaveBeenCalled();
  });
  it('reattaches only the existing provider identity after broker restart and persists terminal evidence', async () => {
    const store=new LiveSessionStore(brokerDb),requestId=randomUUID(),{receipt}=await store.reserve('alice',requestId);
    await store.attachProvider('alice',receipt.id,receipt.version,'existing-provider-session');await brokerDb.query("UPDATE live_sessions SET controller_lease_until=now()-interval '1 second'");const h=harness();instances.push(h.live);
    expect(await h.live.readRequest('alice',requestId)).toMatchObject({sessionId:'existing-provider-session',status:'closing'});
    expect(h.sockets[0].sent).toEqual([{type:'session.close'}]);expect(h.fetcher).not.toHaveBeenCalled();h.sockets[0].finalize();
    expect(await h.live.read('alice','existing-provider-session')).toMatchObject({status:'closed'});
    expect((await store.get('alice',receipt.id))?.terminalEvidence).toEqual({source:'provider_event',event:'session.closed'});
  });
  it('enforces daily and concurrent owner quotas before provider access', async () => {
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>new Response(JSON.stringify({...answer,session:{id:randomUUID()}}),{status:201}));
    const sockets:FakeSocket[]=[],live=new OpenAILive(config(),{store:new LiveSessionStore(brokerDb,{maxConcurrent:1,maxPerOwnerDay:1,maxDurationSeconds:300}),fetch:fetcher,socket:()=>{const socket=new FakeSocket();sockets.push(socket);return socket;}});instances.push(live);
    const first=await live.create('alice',{sdp,requestId:randomUUID()});await expect(live.create('bob',{sdp,requestId:randomUUID()})).rejects.toMatchObject({code:'voice_concurrency_limit'});
    sockets[0].finalize();await live.read('alice',first.session.id);await expect(live.create('alice',{sdp,requestId:randomUUID()})).rejects.toMatchObject({code:'voice_daily_limit'});expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not reclaim or close a healthy conversation owned by another broker',async()=>{
    const first=harness();instances.push(first.live);const requestId=randomUUID();await first.live.create('alice',{sdp,requestId});const second=harness();instances.push(second.live);
    expect(await second.live.readRequest('alice',requestId)).toMatchObject({status:'active'});expect(second.socket).not.toHaveBeenCalled();expect(second.fetcher).not.toHaveBeenCalled();
    await expect(second.live.close('alice',answer.session.id)).rejects.toMatchObject({code:'voice_controller_lost'});expect(first.sockets[0].sent.some(event=>event.type==='session.close')).toBe(false);first.sockets[0].finalize();
  });
  it('fences a stale broker after expired-lease takeover without accepting its late terminal event',async()=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const first=harness();instances.push(first.live);const requestId=randomUUID();await first.live.create('alice',{sdp,requestId});
    await brokerDb.query("UPDATE live_sessions SET controller_lease_until=now()-interval '1 second'");const second=harness();instances.push(second.live);expect(await second.live.readRequest('alice',requestId)).toMatchObject({status:'closing'});
    const oldCommands=first.sockets[0].sent.length;await vi.advanceTimersByTimeAsync(10000);await vi.waitFor(()=>expect(first.sockets[0].readyState).toBe(3));expect(first.sockets[0].sent).toHaveLength(oldCommands);
    first.sockets[0].finalize();expect(await second.live.readRequest('alice',requestId)).toMatchObject({status:'closing'});second.sockets[0].finalize();expect(await second.live.readRequest('alice',requestId)).toMatchObject({status:'closed'});
  });
  it('records late paid acceptance after fencing so the new controller closes the existing identity',async()=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const first=harness();instances.push(first.live);let deliver!:(value:Response)=>void;first.fetcher.mockImplementationOnce(()=>new Promise(resolve=>{deliver=resolve;}));
    const requestId=randomUUID(),starting=first.live.create('alice',{sdp,requestId});const rejected=expect(starting).rejects.toMatchObject({code:'voice_controller_lost'});await vi.waitFor(()=>expect(first.fetcher).toHaveBeenCalledTimes(1));
    await brokerDb.query("UPDATE live_sessions SET controller_lease_until=now()-interval '1 second'");const second=harness();instances.push(second.live);expect(await second.live.readRequest('alice',requestId)).toMatchObject({status:'unconfirmed'});
    deliver(new Response(JSON.stringify(answer),{status:201}));await rejected;expect(first.socket).not.toHaveBeenCalled();expect(await second.live.readRequest('alice',requestId)).toMatchObject({sessionId:answer.session.id,status:'unconfirmed'});
    await vi.advanceTimersByTimeAsync(10000);await vi.waitFor(()=>expect(second.socket).toHaveBeenCalledTimes(1));expect(second.sockets[0].sent).toEqual([{type:'session.close'}]);expect(second.fetcher).not.toHaveBeenCalled();second.sockets[0].finalize();expect(await second.live.readRequest('alice',requestId)).toMatchObject({status:'closed'});
  });
  it('fails closed and releases local controls when controller renewal cannot reach storage',async()=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const h=harness();instances.push(h.live);await h.live.create('alice',{sdp,requestId:randomUUID()});const commands=h.sockets[0].sent.length;
    vi.spyOn(h.store,'renewControllerLeases').mockRejectedValue(new Error('Fictional storage outage'));await vi.advanceTimersByTimeAsync(10000);await vi.waitFor(()=>expect(h.sockets[0].readyState).toBe(3));expect(h.sockets[0].sent).toHaveLength(commands);expect(h.live.status().configured).toBe(false);
    await expect(h.live.create('alice',{sdp,requestId:randomUUID()})).rejects.toMatchObject({code:'voice_storage_unavailable'});expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('local voice demo HTTP boundary', () => {
  let service: Awaited<ReturnType<typeof createApp>>;
  let token: string;
  const fetcher = vi.fn<typeof fetch>();
  const localHeaders = { host: 'localhost:4000', origin: 'http://localhost:4000' };
  beforeAll(async () => {
    const db = await new Database({ dataDir: 'memory://' }).open();
    service = await createApp({ db, config: { ...config(), openaiKey: undefined }, worker: false, openaiLiveDependencies: { store: new LiveSessionStore(db), fetch: fetcher } });
    token = (await service.app.inject({ method: 'POST', url: '/auth/demo' })).json().token;
  });
  afterAll(async () => { await service?.app.close(); await service?.db.close(); });

  it('exposes only non-sensitive readiness and rejects nonlocal access', async () => {
    const result = await service.app.inject({ url: '/demo/status', headers: localHeaders });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ configured: false, model: 'gpt-live-1', voice: 'marin' });
    expect((await service.app.inject({ url: '/demo/status', headers: { host: 'attacker.example:4000' } })).statusCode).toBe(403);
    expect((await service.app.inject({ url: '/demo/status', headers: localHeaders, remoteAddress: '192.168.1.9' })).statusCode).toBe(403);
    expect((await service.app.inject({ url: '/demo/.env', headers: localHeaders })).statusCode).toBe(401);
  });

  it('serves the exact demo assets with restrictive headers and no general filesystem route', async () => {
    for (const url of ['/demo', '/demo/styles.css', '/demo/app.js', '/demo/assets/klnk-presence.png']) {
      const result = await service.app.inject({ url, headers: localHeaders });
      expect(result.statusCode, url).toBe(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    }
    const result = await service.app.inject({ url: '/demo/assets/secret.json', headers: { ...localHeaders, authorization: `Bearer ${token}` } });
    expect(result.statusCode).toBe(404);
  });

  it('requires authentication, same-origin requests and a configured key before creating sessions', async () => {
    expect((await service.app.inject({ method: 'POST', url: '/voice/live/session', headers: localHeaders, payload: { sdp, requestId: randomUUID() } })).statusCode).toBe(401);
    const headers = { ...localHeaders, authorization: `Bearer ${token}` };
    expect((await service.app.inject({ method: 'POST', url: '/voice/live/session', headers: { ...headers, origin: 'https://attacker.example' }, payload: { sdp, requestId: randomUUID() } })).statusCode).toBe(403);
    expect((await service.app.inject({ method: 'POST', url: '/voice/live/session', headers, payload: { sdp, requestId: randomUUID() } })).statusCode).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('allows configured loopback Expo origins, while rejecting missing and untrusted origins', async () => {
    const headers = { ...localHeaders, authorization: `Bearer ${token}`, origin: 'http://localhost:8081' };
    expect((await service.app.inject({ url: '/demo/status', headers })).statusCode).toBe(200);
    expect((await service.app.inject({ url: '/voice/live/session/unknown', headers })).statusCode).toBe(404);
    expect((await service.app.inject({ url: '/voice/live/session/unknown', headers: localHeaders })).statusCode).toBe(401);
    expect((await service.app.inject({ method: 'POST', url: '/voice/live/session/unknown/close', headers: { host: localHeaders.host, authorization: `Bearer ${token}` } })).statusCode).toBe(403);
    expect((await service.app.inject({ url: '/demo/status', headers: { ...headers, origin: 'http://localhost:9999' } })).statusCode).toBe(403);
  });
  it('protects durable request recovery with authentication, ownership and the existing local boundary',async()=>{
    const requestId=randomUUID(),headers={...localHeaders,authorization:`Bearer ${token}`};
    expect((await service.app.inject({url:`/voice/live/requests/${requestId}`,headers:localHeaders})).statusCode).toBe(401);
    expect((await service.app.inject({url:`/voice/live/requests/${requestId}`,headers})).statusCode).toBe(404);
    expect((await service.app.inject({url:`/voice/live/requests/${requestId}`,headers,remoteAddress:'192.168.1.8'})).statusCode).toBe(403);
  });

  it('disables public demo routes and session creation in production or when demos are disabled', async () => {
    service.config.production = true;
    expect((await service.app.inject({ url: '/demo/status', headers: localHeaders })).statusCode).toBe(404);
    expect((await service.app.inject({ url: '/demo', headers: localHeaders })).statusCode).toBe(404);
    service.config.production = false; service.config.demoEnabled = false;
    expect((await service.app.inject({ url: '/demo/status', headers: localHeaders })).statusCode).toBe(404);
    await expect(service.openaiLive.create('alice', { sdp, requestId: randomUUID() })).rejects.toMatchObject({ statusCode: 404 });
    expect(fetcher).not.toHaveBeenCalled();
    service.config.demoEnabled = true;
  });

  it('closes a provider session created after the browser aborts its SDP request', async () => {
    let deliver!: (response: Response) => void;
    let providerStarted!: () => void;
    const started = new Promise<void>(resolve => { providerStarted = resolve; });
    const provider = vi.fn<typeof fetch>(() => { providerStarted(); return new Promise(resolve => { deliver = resolve; }); });
    const sockets: FakeSocket[] = [];
    const db = await new Database({ dataDir: 'memory://' }).open();
    const local = await createApp({ db, config: config(), worker: false, openaiLiveDependencies: {
      store: new LiveSessionStore(db), fetch: provider, socket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
    } });
    try {
      const ownerToken = (await local.app.inject({ method: 'POST', url: '/auth/demo' })).json().token;
      const address = await local.app.listen({ host: '127.0.0.1', port: 0 });
      local.config.port = Number(new URL(address).port);
      const controller = new AbortController();
      const pending = fetch(`${address}/voice/live/session`, {
        method: 'POST', signal: controller.signal,
        headers: { Origin: address, Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp, requestId: randomUUID() }),
      }).catch(() => null);
      await started;
      controller.abort(); await pending;
      // Let the loopback disconnect reach the server before resolving the provider.
      await new Promise(resolve => setTimeout(resolve, 25));
      deliver(new Response(JSON.stringify(answer), { status: 201 }));
      await vi.waitFor(() => expect(sockets[0]?.sent.some(event => event.type === 'session.close')).toBe(true));
      expect(provider).toHaveBeenCalledTimes(1);
      sockets[0].finalize();
    } finally { await local.app.close(); await db.close(); }
  });
  it('flushes terminal evidence and releases controller leases before an app-owned database closes',async()=>{
    const sockets:FakeSocket[]=[],provider=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(answer),{status:201}));
    const local=await createApp({config:{...config(),databaseUrl:undefined,dataDir:'memory://'},worker:false,openaiLiveDependencies:{fetch:provider,socket:()=>{
      const socket=new FakeSocket(),send=socket.send.bind(socket);socket.send=(value:string)=>{send(value);if(JSON.parse(value).type==='session.close')queueMicrotask(()=>socket.finalize());};sockets.push(socket);return socket;
    }}});
    const token=(await local.app.inject({method:'POST',url:'/auth/demo'})).json().token;
    const created=await local.app.inject({method:'POST',url:'/voice/live/session',headers:{...localHeaders,authorization:`Bearer ${token}`},payload:{requestId:randomUUID(),sdp}});expect(created.statusCode).toBe(201);
    await expect(local.app.close()).resolves.toBeUndefined();await expect(local.openaiLive.dispose()).resolves.toBeUndefined();expect(sockets[0].sent.some(event=>event.type==='session.close')).toBe(true);expect(provider).toHaveBeenCalledTimes(1);
  });
});
