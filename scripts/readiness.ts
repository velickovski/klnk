import { getConfig } from '../apps/server/src/config.js';
import { inspectProviders, localReadiness } from '../apps/server/src/readiness.js';
const config = getConfig();
const report: any = {
  local: localReadiness(config),
  note: 'This command never calls a recipient, creates a resource, uploads audio or synthesizes speech.',
};
if (process.argv.includes('--providers')) {
  try {
    report.providers = await inspectProviders(config);
  } catch {
    report.providers = {
      ready: false,
      error:
        'Read-only provider verification failed. Check key permissions and account configuration; no provider response bodies are printed.',
    };
  }
}
console.log(JSON.stringify(report, null, 2));
