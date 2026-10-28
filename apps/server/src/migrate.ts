import { Database } from './db.js';
import { getConfig } from './config.js';
const c=getConfig(),db=await new Database({url:c.databaseUrl,dataDir:c.dataDir,key:c.key,production:c.production}).open();
console.log('Database migrations applied.');await db.close();
