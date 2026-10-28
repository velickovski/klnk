import net from 'node:net';

/** Applied to every default Vitest worker. Provider fixtures inject transports;
 * an accidental real request must fail before DNS/network access. */
const local=new Set(['localhost','127.0.0.1','::1','[::1]']);
const approvedOpenAI=process.env.KLNK_ALLOW_OPENAI_TEST==='1';
function checkHost(host:string){if(!local.has(host.toLowerCase())&&!(approvedOpenAI&&host==='api.openai.com'))throw new Error('Test egress blocked: only loopback application endpoints are allowed.');}
const originalFetch=globalThis.fetch;
globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  checkHost(url.hostname);
  if(url.hostname==='api.openai.com'&&!['/v1/responses','/v1/live/sessions'].some(path=>url.pathname===path||url.pathname.startsWith(path+'/')))throw new Error('Test egress blocked: OpenAI endpoint is not allowlisted.');
  // Redirects cannot escape the host/path allowlist after the initial check.
  return originalFetch(input,{...init,redirect:'error'});
}) as typeof fetch;
const originalConnect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(this:net.Socket,...args:any[]){
  let first=args[0];if(Array.isArray(first))first=first[0];
  if(first&&typeof first==='object'){
    if(!first.path)checkHost(String(first.host??'localhost'));
  }else if(typeof first==='number')checkHost(typeof args[1]==='string'?args[1]:'localhost');
  else if(typeof first!=='string')throw new Error('Test egress blocked: unrecognized connection target.');
  return (originalConnect as (...values:any[])=>net.Socket).apply(this,args);
} as typeof net.Socket.prototype.connect;
