import { Database } from './db.js';
import { getConfig } from './config.js';
import { Engine } from './engine.js';
import {NetworkCoordinator} from './network/coordination.js';
import {InternalCalendar} from './network/calendar.js';
const config=getConfig();
if(!config.databaseUrl)throw new Error('A separate worker needs DATABASE_URL. Local PGlite uses the embedded worker via npm run dev.');
const db=await new Database({url:config.databaseUrl,key:config.key,production:config.production}).open();
const engine=new Engine(db,config);engine.start();
const network=new NetworkCoordinator(db,new InternalCalendar(db));network.start();
console.log('Durable worker running.');
// Keep standalone process alive (the embedded interval intentionally unrefs).
const keepAlive=setInterval(()=>{},60000);
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void Promise.all([engine.stop(),network.stop()]).then(()=>db.close()).then(()=>{clearInterval(keepAlive);process.exit(0);});});
