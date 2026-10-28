import { networkInterfaces } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const args = process.argv.slice(2);
const arg = (key: string) => {
  const i = args.indexOf(key);
  return i < 0 ? undefined : args[i + 1];
};
const lan = Object.values(networkInterfaces())
  .flat()
  .filter(
    (x) =>
      x &&
      !x.internal &&
      x.family === 'IPv4' &&
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.address),
  )
  .map((x) => `http://${x!.address}:4000`);
const api = arg('--api-url');
if (!api) {
  console.log(
    JSON.stringify(
      {
        status: 'not_written',
        next: 'Provide --api-url with your HTTPS backend origin, or a private LAN URL for a same-Wi-Fi development build.',
        lanCandidates: lan,
        notes: [
          'No build, signing, firewall change or tunnel is started.',
          'Keep LIVE_CALLS_ENABLED=false.',
          'The iPhone cannot reach your PC through localhost.',
        ],
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const u = new URL(api);
const localHttp =
  u.protocol === 'http:' && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname);
if (
  u.username ||
  u.password ||
  u.search ||
  u.hash ||
  u.pathname !== '/' ||
  !(u.protocol === 'https:' || localHttp)
)
  throw new Error(
    'Use an HTTPS origin or an explicit private LAN HTTP origin, with no credentials/path/query.',
  );
const mobileDir = resolve('apps/mobile'),
  path = resolve(mobileDir, '.env.local');
let existing = '';
try {
  existing = await readFile(path, 'utf8');
} catch (e: any) {
  if (e.code !== 'ENOENT') throw e;
}
const fields: Record<string, string> = {
  EXPO_PUBLIC_API_URL: u.origin,
  EXPO_PUBLIC_ALLOW_LOCAL_HTTP: String(localHttp),
  IOS_ALLOW_LOCAL_NETWORK: String(localHttp),
};
for (const [flag, key] of [
  ['--bundle-id', 'IOS_BUNDLE_IDENTIFIER'],
  ['--expo-owner', 'EXPO_OWNER'],
  ['--project-id', 'EAS_PROJECT_ID'],
]) {
  const value = arg(flag);
  if (value) {
    if (/[\r\n]/.test(value)) throw new Error('Invalid configuration value');
    fields[key] = value;
  }
}
const lines = existing
  .split(/\r?\n/)
  .filter((line) => line && !Object.keys(fields).some((key) => line.startsWith(key + '=')));
await writeFile(
  path,
  [...lines, ...Object.entries(fields).map(([k, v]) => `${k}=${v}`), ''].join('\n'),
);
console.log(
  JSON.stringify(
    {
      status: 'written',
      file: path,
      api: u.origin,
      localHttp,
      note: 'Public client configuration only. No provider secrets, account resources or builds were created.',
    },
    null,
    2,
  ),
);
