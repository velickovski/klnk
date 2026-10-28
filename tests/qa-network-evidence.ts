import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

// Explicit code paths only: never traverse .env, databases or private artifacts.
const root=resolve('.'),out=resolve('docs/agent-network/evidence');await mkdir(out,{recursive:true});
const report=JSON.parse(await readFile(resolve('.data/e2e-results/results.json'),'utf8'));
const cases:Array<Record<string,unknown>>=[];
function visit(suite:any){for(const spec of suite.specs??[])for(const test of spec.tests??[]){const results=test.results??[],last=results.at(-1);const observations:Record<string,unknown>={};for(const attachment of last?.attachments??[])if(attachment.name.startsWith('network-')&&attachment.body){try{observations[attachment.name]=JSON.parse(Buffer.from(attachment.body,'base64').toString('utf8'));}catch{/* Only structured QA observations are retained. */}}cases.push({file:spec.file,title:spec.title,expectedStatus:test.expectedStatus,status:test.status,result:last?.status,durationMs:last?.duration,retries:results.length-1,observations});}for(const child of suite.suites??[])visit(child);}
for(const suite of report.suites??[])visit(suite);
await writeFile(resolve(out,'browser-results.json'),JSON.stringify({recordedAt:new Date().toISOString(),stats:report.stats,cases},null,2)+'\n');
const files=['AGENTS.md','packages/domain/src/network.ts','packages/domain/src/tools.ts','packages/domain/src/owner-intent.ts','apps/mobile/App.tsx','apps/mobile/src/api.ts','apps/server/src/app.ts','apps/server/src/db.ts','apps/server/src/openai-live.ts','apps/server/src/integrations/gateway.ts','scripts/e2e-server.ts','scripts/e2e-build.ts','playwright.config.ts','tests/qa-network-api.test.ts','tests/qa-network-postgres.test.ts','tests/qa-network-child.ts','tests/network-egress-guard.ts','e2e/browser/network.spec.ts','e2e/browser/network-helpers.ts'];
for(const directory of ['apps/server/src/network','apps/mobile/src/features/network','apps/server/migrations'])for(const name of await readdir(resolve(directory)).catch(()=>[]))if(/\.(?:ts|tsx|sql)$/.test(name))files.push(directory+'/'+name);
const identities=[];for(const file of [...new Set(files)].sort()){try{const bytes=await readFile(resolve(root,file));identities.push({path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}catch{if(file==='packages/domain/src/owner-intent.ts')continue;throw new Error('Expected source identity path is unavailable: '+file);}}
await writeFile(resolve(out,'qa-source-identity.json'),JSON.stringify({recordedAt:new Date().toISOString(),scope:'Explicit integrated source and independent QA paths; no private data scanned.',files:identities},null,2)+'\n');
console.log(JSON.stringify({artifact:'network_qa_evidence',cases:cases.length,sourceFiles:identities.length,unexpected:cases.filter(c=>c.status!=='expected').length}));
