import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts', 'packages/**/*.test.ts','apps/mobile/test/**/*.test.ts'], setupFiles:['./tests/network-egress-guard.ts'], testTimeout: 30000, hookTimeout: 30000, maxWorkers: 2 } });
