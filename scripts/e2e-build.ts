import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const child = spawn(
  process.execPath,
  [require.resolve('expo/bin/cli'), 'export', '--platform', 'web', '--output-dir', 'dist-e2e'],
  {
    cwd: new URL('../apps/mobile/', import.meta.url),
    stdio: 'inherit',
    env: {
      ...process.env,
      EXPO_PUBLIC_API_URL: 'http://127.0.0.1:4102',
      EXPO_PUBLIC_ALLOW_LOCAL_HTTP: 'true',
      EXPO_PUBLIC_LEGACY_ENABLED: 'true',
    },
  },
);
child.on('error', () => {
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
