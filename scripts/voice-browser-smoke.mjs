// Actual local UI -> authenticated broker -> OpenAI WebRTC, using Chromium's fake microphone.
// Opt-in only. No real microphone, user profile, third-party calls or service writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import WebSocket from 'ws';
import { createApp } from '../apps/server/src/app.ts';
import { getConfig } from '../apps/server/src/config.ts';
import { createLiveSmokeObserver } from './lib/live-smoke-observer.ts';

if (!process.argv.includes('--run-live')) {
  console.log('Opt-in: node --import tsx scripts/voice-browser-smoke.mjs --run-live --pcm <fixture>. Requires playwright locally or KLNK_BROWSER_TEST_RUNTIME pointing to its node_modules.');
  process.exit(0);
}
const pcmPath = process.argv[process.argv.indexOf('--pcm') + 1];
const applicationTools=process.argv.includes('--in-app-tools');
if (!process.argv.includes('--pcm') || !pcmPath) throw new Error('Pass a fictional raw PCM16 mono 24 kHz fixture.');
const pcm = await readFile(pcmPath);
if (!pcm.length || pcm.length % 2 || pcm.length > (applicationTools?30:15) * 48000 || pcm.subarray(0, 4).toString() === 'RIFF') throw new Error('Invalid PCM fixture.');
const runtime = process.env.KLNK_BROWSER_TEST_RUNTIME;
const require = runtime ? createRequire(resolve(runtime, 'package.json')) : createRequire(import.meta.url);
const { chromium } = require('playwright');
const base = getConfig();
if (!base.openaiKey?.trim()) throw new Error('OPENAI_API_KEY is missing.');
const directory = '.data/production-audit';
await mkdir(directory, { recursive: true });
const wav = Buffer.alloc(44);
wav.write('RIFF'); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40);
const wavPath = resolve(directory, 'fictional-input.wav');
await writeFile(wavPath, Buffer.concat([wav, pcm]));
const observer = createLiveSmokeObserver();
const start = Date.now();
const report = { runAt: new Date().toISOString(), scope: 'standalone-browser-broker-real-webrtc', fixtureMicrophone: true, physicalMicrophoneUsed: false, nativeDeviceTested: false, checks: [], error: null, sidebandTransportErrors: 0, sidebandClosedWithoutTerminalEvent: false, elapsedMs: 0 };
const sessions = [];
const config = { ...base, production: false, demoEnabled: true, provider: 'simulator', liveEnabled: false, recipients: [], elevenKey:undefined,agentId:undefined,phoneId:undefined,twilioSid:undefined,twilioToken:undefined,googleClientId:undefined,googleClientSecret:undefined,googleRedirectUri:undefined,databaseUrl: undefined, dataDir: `${directory}/browser-db-${Date.now()}`, key: undefined, embeddedWorker: false, port: 4101, host: '127.0.0.1', origins: ['http://localhost:4101'] };
let toolOwner,toolResultAt=0,outputAfterTool=false,spokenText='',inputText='',continuations=0;
const configuredToolNames=[];
const forwardedToolResults=[];
const toolOutcomes=[];
const service = await createApp({ config, worker: false, openaiLiveDependencies: { fetch:async(url,init)=>{if(applicationTools&&url==='https://api.openai.com/v1/live/sessions'){const body=JSON.parse(String(init?.body));const names=body.session.delegation.responses.tools.map(tool=>tool.name);assert.deepEqual(names,['contacts_lookup']);configuredToolNames.push(...names);}return fetch(url,init);},socket(url, key) {
  const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 10000, maxPayload: 2 * 1024 * 1024 });
  if(applicationTools){const send=socket.send.bind(socket);socket.send=(raw,...rest)=>{const sent=send(raw,...rest);try{const event=JSON.parse(String(raw));if(event.type==='response.item.create'&&event.item?.type==='function_call_output'){const result=JSON.parse(event.item.output);if(result.toolName==='contacts_lookup'&&result.status==='succeeded'&&result.verification==='local_commit'){forwardedToolResults.push({toolName:'contacts_lookup',status:'succeeded',verification:'local_commit'});toolResultAt=Date.now();}}if(event.type==='response.create')continuations++;}catch{}return sent;};}
  socket.on('message', raw => { try { const event=JSON.parse(String(raw));observer.observe(event);if(event.type==='session.input_transcript.delta'&&typeof event.delta==='string')inputText=(inputText+event.delta).slice(-12000);if(event.type==='session.output_transcript.delta'&&typeof event.delta==='string'){spokenText=(spokenText+event.delta).slice(-12000);if(toolResultAt&&Date.now()>=toolResultAt)outputAfterTool=true;} } catch {} });
  socket.on('error', () => { report.sidebandTransportErrors++; });
  socket.on('close', () => { if (observer.summary.started && !observer.summary.closed) report.sidebandClosedWithoutTerminalEvent = true; });
  sessions.push(socket);
  return socket;
} } });
const {app,gateway}=service;
if(applicationTools){
  const invoke=gateway.invoke.bind(gateway);
  gateway.invoke=async(...arguments_)=>{const result=await invoke(...arguments_);toolOutcomes.push({toolName:result.toolName,status:result.status,reasonCode:result.reasonCode,verification:result.verification});return result;};
  // A disposable fictional owner grants only a read lookup through the actual
  // authenticated permission route before its auth response reaches the demo.
  app.addHook('onSend',async(request,reply,payload)=>{if(request.url==='/auth/demo'&&reply.statusCode===201){const auth=JSON.parse(String(payload));const response=await app.inject({method:'PUT',url:'/tools/access',headers:{authorization:`Bearer ${auth.token}`},payload:{enabled:true,tools:['contacts_lookup']}});assert.equal(response.statusCode,200);toolOwner=auth.user.id;}return payload;});
}
let browser;
let page;
let watchdog;
try {
  await app.listen({ host: config.host, port: config.port });
  browser = await chromium.launch({ headless: true, channel: process.env.KLNK_BROWSER_TEST_CHANNEL || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}%noloop`, '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  let creationRequests = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/voice/live/session' && request.method() === 'POST') creationRequests++; });
  watchdog = setTimeout(() => { for (const socket of sessions) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'session.close' })); }, 60000);
  await page.goto('http://localhost:4101/demo');
  await page.waitForFunction(() => !document.querySelector('#call-button').disabled);
  assert.equal(await page.locator('button:visible').count(), 1);
  report.checks.push('one visible opening action');
  await page.getByRole('button', { name: 'Call klnk', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#app').dataset.phase === 'connected', null, { timeout: 30000 });
  report.checks.push('connected after real provider event');
  await page.waitForFunction(() => { const a = document.querySelector('#remote-audio'); return a.currentTime > 0 && !a.paused && a.srcObject?.getAudioTracks().some(t => t.readyState === 'live'); }, null, { timeout: 20000 });
  report.checks.push('remote audio track playing in headless browser');
  await page.waitForFunction(() => document.querySelector('#caption-text').textContent.length > 0);
  report.checks.push('actual provider captions rendered');
  await page.getByRole('button', { name: 'Mute mic', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#mute-button').getAttribute('aria-pressed') === 'true' && document.querySelector('#mute-button').textContent === 'Unmute mic');
  report.checks.push('mute acknowledged');
  await page.getByRole('button', { name: 'Unmute mic', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#mute-button').getAttribute('aria-pressed') === 'false' && document.querySelector('#mute-button').textContent === 'Mute mic');
  report.checks.push('unmute acknowledged');
  // Allow the ten-second fictional fixture to finish and a response to arrive.
  await page.waitForTimeout(12000);
  if(applicationTools){const deadline=Date.now()+25000;while(Date.now()<deadline&&(!outputAfterTool||!toolOutcomes.some(result=>result.toolName==='contacts_lookup'&&result.status==='succeeded')))await page.waitForTimeout(100);}
  assert.ok(observer.summary.inputTranscriptCharacters > 0);
  assert.equal(observer.summary.outputAfterInputTranscript, true);
  report.checks.push('fictional input transcribed; subsequent assistant caption received');
  await page.getByRole('button', { name: 'End call', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#connection-label').textContent === 'Conversation ended');
  report.checks.push('UI confirms terminal provider evidence');
  assert.equal(creationRequests, 1);
  report.checks.push('one paid session creation request');
  assert.equal(await page.locator('#remote-audio').evaluate(a => a.srcObject), null);
  report.checks.push('remote playback released');
  assert.equal(observer.summary.closed, true);
  assert.deepEqual(observer.summary.providerErrorCodes, []);
  assert.equal(report.sidebandTransportErrors, 0);
  assert.equal(report.sidebandClosedWithoutTerminalEvent, false);
  if(applicationTools){
    assert.deepEqual(configuredToolNames,['contacts_lookup']);
    assert.equal(/Jordan/i.test(inputText)&&/contact/i.test(inputText)&&/look\s*up/i.test(inputText),true);
    assert.ok(toolOutcomes.some(result=>result.toolName==='contacts_lookup'&&result.status==='succeeded'));
    assert.ok(observer.summary.toolCalls.includes('function_call:contacts_lookup'));
    assert.ok(forwardedToolResults.length>0);assert.ok(continuations>0);
    assert.equal(outputAfterTool,true);
    assert.equal(/\bI (?:have )?(?:called|sent|booked|changed your calendar)\b/i.test(spokenText),false);
    assert.equal((await service.repo.list(toolOwner,'mission')).length,0);
    report.checks.push('real delegated lookup recorded; result forwarded and backend continued; later caption observed; no outbound request created');
  }else{assert.deepEqual(observer.summary.toolCalls, []);report.checks.push('sideband closure confirmed; no tool calls observed');}
} catch (error) {
  // Do not save Playwright diagnostic objects, request headers, tokens or page transcripts.
  report.error = error instanceof assert.AssertionError ? 'assertion_failed' : 'browser_smoke_step_failed';
  report.failedAfter = report.checks.at(-1) ?? 'setup';
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  for (const socket of sessions) if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'session.close' }));
  if (sessions.length && !observer.summary.closed) {
    const until = Date.now() + 10000;
    while (Date.now() < until && !observer.summary.closed) await new Promise(r => setTimeout(r, 100));
  }
  await browser?.close();
  await app.close().catch(() => { report.error ??= 'service_shutdown_failed'; process.exitCode = 1; });
  if (observer.summary.providerErrorCodes.length || report.sidebandTransportErrors || report.sidebandClosedWithoutTerminalEvent) {
    report.error ??= 'provider_or_control_transport_error';
    process.exitCode = 1;
  }
  Object.assign(report, { elapsedMs: Date.now() - start, sideband: observer.summary,...(applicationTools?{scope:'standalone-browser-real-webrtc-in-app-read-only-tool',configuredToolNames,inputFixtureKeywordsHeard:/Jordan/i.test(inputText)&&/contact/i.test(inputText)&&/look\s*up/i.test(inputText),toolOutcomes,forwardedToolResults,continuations,captionAfterForwardedResult:outputAfterTool,selectedEnglishCompletionClaimDetected:/\bI (?:have )?(?:called|sent|booked|changed your calendar)\b/i.test(spokenText),semanticSpokenResultVerified:false}:{}) });
  const serialized=JSON.stringify(report,null,2)+'\n';
  await writeFile(`${directory}/${applicationTools?'voice-application-tools-smoke':'voice-browser-smoke'}.json`,serialized);
  if(applicationTools)await writeFile(`${directory}/voice-application-tools-${start}.json`,serialized,{flag:'wx'});
  console.log(JSON.stringify(report, null, 2));
}
