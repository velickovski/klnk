import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import WebSocket from 'ws';
import { getConfig } from '../apps/server/src/config.js';
import { LIVE_MODEL, LIVE_BACKEND_MODEL, LIVE_VOICE } from '../apps/server/src/openai-live.js';
import { createLiveSmokeObserver } from './lib/live-smoke-observer.js';

// Opt-in, bounded provider diagnostic. Not a browser/WebRTC or native-device E2E test.
// Input is a fictional, locally synthesized PCM16 mono 24 kHz fixture, never a microphone.
// https://developers.openai.com/api/docs/guides/voice-websockets
const args = process.argv.slice(2);
if (!args.includes('--run-live')) {
  console.log(
    'Opt-in only: npx tsx scripts/openai-live-smoke.ts --run-live --pcm <24k-mono-pcm16-file>',
  );
  process.exit(0);
}
const pcmIndex = args.indexOf('--pcm');
if (pcmIndex < 0 || !args[pcmIndex + 1])
  throw new Error('A fictional PCM fixture is required. No microphone is captured.');
const audio = await readFile(args[pcmIndex + 1]);
if (
  !audio.length ||
  audio.length % 2 ||
  audio.length > 15 * 48_000 ||
  audio.subarray(0, 4).toString() === 'RIFF'
) {
  throw new Error('Expected 1–15 seconds of raw PCM16 mono at 24 kHz, without a WAV header.');
}
const key = getConfig().openaiKey?.trim();
if (!key) throw new Error('OPENAI_API_KEY is not configured.');
const observer = createLiveSmokeObserver();
const startedAt = Date.now();
const report = {
  runAt: new Date().toISOString(),
  scope: 'provider-websocket-fictional-audio',
  model: LIVE_MODEL,
  voice: LIVE_VOICE,
  backendModel: LIVE_BACKEND_MODEL,
  configuredTools: [] as string[],
  keyConfigured: true,
  microphoneUsed: false,
  browserWebRtcTested: false,
  nativeDeviceTested: false,
  handshakeStatus: null as number | null,
  transportError: false,
  firstOutputAudioMs: null as number | null,
  inputBytesSent: 0,
  elapsedMs: 0,
  ...observer.summary,
};
let closing = false;
let finished = false;
let sendTimer: ReturnType<typeof setInterval> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
const socket = new WebSocket('wss://api.openai.com/v1/live/sessions', {
  headers: { Authorization: `Bearer ${key}` },
  handshakeTimeout: 15_000,
  maxPayload: 2 * 1024 * 1024,
});
function requestClose() {
  if (closing || finished) return;
  closing = true;
  clearInterval(sendTimer);
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'session.close' }));
  closeTimer = setTimeout(() => {
    socket.terminate();
    void finish();
  }, 10_000);
}
async function finish() {
  if (finished) return;
  finished = true;
  clearInterval(sendTimer);
  clearTimeout(closeTimer);
  clearTimeout(deadline);
  Object.assign(report, observer.summary, { elapsedMs: Date.now() - startedAt });
  const path = '.data/production-audit/openai-live-smoke.json';
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (
    !report.started ||
    !report.closed ||
    !report.outputAudioBytes ||
    !report.inputTranscriptCharacters ||
    !report.outputAfterInputTranscript ||
    report.transportError ||
    report.providerErrorCodes.length ||
    report.toolCalls.length
  )
    process.exitCode = 1;
}
deadline = setTimeout(requestClose, 30_000);
socket.on('upgrade', (response) => {
  report.handshakeStatus = response.statusCode ?? null;
});
socket.on('unexpected-response', (_request, response) => {
  report.handshakeStatus = response.statusCode ?? null;
  response.resume();
  socket.terminate();
  void finish();
});
socket.on('open', () => {
  socket.send(
    JSON.stringify({
      type: 'session.start',
      session: {
        model: LIVE_MODEL,
        store: false,
        instructions:
          'You are klnk, an AI conversation partner. Answer concisely in English. This is a fictional integration test. You have no contacts, calendar, telephone, messaging, or memory tools. Never claim an external action happened. Delegate deeper reasoning to your backend.',
        audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice: LIVE_VOICE } },
        delegation: {
          type: 'responses',
          responses: {
            model: LIVE_BACKEND_MODEL,
            tools: [],
            tool_choice: 'none',
            max_output_tokens: 400,
            instructions:
              'No external tools or data access. Explain limitations honestly; do not claim completed actions.',
          },
        },
      },
    }),
  );
});
socket.on('message', (raw) => {
  let event: Record<string, any>;
  try {
    event = JSON.parse(String(raw));
  } catch {
    return;
  }
  observer.observe(event);
  if (event.type === 'session.started' && !sendTimer && !closing) {
    let position = 0;
    // Pace the fixture and then silence at 100 ms per 4,800 bytes.
    sendTimer = setInterval(() => {
      if (closing || socket.readyState !== WebSocket.OPEN) return;
      const chunk =
        position < audio.length ? audio.subarray(position, position + 4800) : Buffer.alloc(4800);
      position += chunk.length;
      report.inputBytesSent += chunk.length;
      socket.send(
        JSON.stringify({ type: 'session.input_audio.append', audio: chunk.toString('base64') }),
      );
    }, 100);
  }
  if (event.type === 'session.output_audio.delta' && report.firstOutputAudioMs === null)
    report.firstOutputAudioMs = Date.now() - startedAt;
  if (event.type === 'error') requestClose();
  if (event.type === 'session.closed') {
    socket.close();
    void finish();
  }
});
socket.on('error', () => {
  report.transportError = true;
  if (socket.readyState === WebSocket.OPEN) requestClose();
  else void finish();
});
socket.on('close', () => {
  void finish();
});
process.once('SIGINT', requestClose);
process.once('SIGTERM', requestClose);
