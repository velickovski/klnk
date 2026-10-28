import { readFile,stat } from 'node:fs/promises';
import { resolve,sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

// Operate only the already-created disposable fixture, never install/reinitialize
// a database or accept an arbitrary data directory/connection from arguments.
const command=process.argv[2];
if(!['start','stop','status'].includes(command))throw new Error('Use start, stop or status for the existing isolated local PostgreSQL fixture.');
if(process.platform!=='win32')throw new Error('This workstation helper uses its verified Windows portable binaries. Configure another isolated PostgreSQL fixture explicitly on other hosts.');
const base=resolve('.data/production-pg'),cluster=resolve(base,'cluster'),binary=resolve(base,'pgsql/bin/pg_ctl.exe');
if(!cluster.startsWith(base+sep)||!binary.startsWith(base+sep))throw new Error('Invalid fixture path.');
await stat(binary);const version=(await readFile(resolve(cluster,'PG_VERSION'),'utf8')).trim();
if(version!=='18')throw new Error('The prepared PostgreSQL18 fixture is missing or incompatible. No initialization was attempted.');
const connection=JSON.parse(await readFile(resolve(base,'connection.json'),'utf8')),address=new URL(connection.url);
if(address.protocol!=='postgresql:'||address.hostname!=='127.0.0.1'||address.port!=='55432'||address.pathname!=='/klnk_qa')throw new Error('Refusing to operate outside the prepared local QA fixture.');
let running=spawnSync(binary,['-D',cluster,'status'],{stdio:'ignore',windowsHide:true}).status===0;
if(command==='start'&&!running){const result=spawnSync(binary,['-D',cluster,'-l',resolve(base,'postgres.log'),'-o','-h 127.0.0.1 -p 55432','-w','start'],{stdio:'ignore',windowsHide:true});if(result.status!==0)throw new Error('Fixture startup was not confirmed; inspect its private local log.');running=true;}
if(command==='stop'&&running){const pool=new pg.Pool({connectionString:connection.url});try{const rows=await pool.query("SELECT count(*)::int AS total FROM pg_namespace WHERE nspname LIKE 'qa_%'");if(rows.rows[0].total)throw new Error('QA namespaces remain. Reconcile their ownership before stopping.');const active=await pool.query("SELECT count(*)::int AS total FROM pg_stat_activity WHERE datname='klnk_qa' AND pid<>pg_backend_pid() AND state<>'idle'");if(active.rows[0].total)throw new Error('Another fixture operation is active. Stop was deferred.');}finally{await pool.end();}if(spawnSync(binary,['-D',cluster,'-m','fast','-w','stop'],{stdio:'ignore',windowsHide:true}).status!==0)throw new Error('Fixture shutdown was not confirmed.');running=false;}
console.log(JSON.stringify({fixture:'local_postgresql_qa',version,running,serviceInstalled:false}));
