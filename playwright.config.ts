import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: '.data/e2e-results',
  reporter: [['list'], ['json', { outputFile: '.data/e2e-results/results.json' }]],
  use: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } }
      : {}),
    baseURL: 'http://127.0.0.1:8083',
    viewport: { width: 390, height: 844 },
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    ...(process.env.KLNK_E2E_CHANNEL ? { channel: process.env.KLNK_E2E_CHANNEL } : {}),
  },
  webServer: {
    command: 'npx tsx scripts/e2e-server.ts',
    url: 'http://127.0.0.1:8083/__e2e/ready',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
