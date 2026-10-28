import { getConfig } from '../apps/server/src/config.js';
import { LIVE_MODEL } from '../apps/server/src/openai-live.js';
const key = getConfig().openaiKey?.trim();
if (!key) {
  console.log(
    JSON.stringify({ keyConfigured: false, model: LIVE_MODEL, liveSessionStarted: false }),
  );
  process.exit(0);
}
try {
  const response = await fetch(
    `https://api.openai.com/v1/models/${encodeURIComponent(LIVE_MODEL)}`,
    { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) },
  );
  console.log(
    JSON.stringify({
      keyConfigured: true,
      model: LIVE_MODEL,
      metadataStatus: response.status,
      metadataAccessible: response.ok,
      liveSessionStarted: false,
      note: 'Read-only model metadata check. This does not verify live session access, billing, microphone or audio.',
    }),
  );
} catch {
  console.log(
    JSON.stringify({
      keyConfigured: true,
      model: LIVE_MODEL,
      metadataAccessible: false,
      liveSessionStarted: false,
      note: 'Metadata request could not complete. No secret or provider response was logged.',
    }),
  );
}
