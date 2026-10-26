import https from 'node:https';
import tls from 'node:tls';
import {createHash,X509Certificate} from 'node:crypto';
const fail=()=>Object.assign(Error('The original registered service GET is unavailable.'),{code:'IDE_SERVICE_READ_NETWORK_SCOPE'});
export function serviceReadURLs(service,requestId){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(requestId||'')||typeof service?.apiEndpoint!=='string'||!/^[a-f0-9]{64}$/.test(service.tlsSPKISHA256||''))throw fail();
 const u=new URL(service.apiEndpoint);
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.pathname.includes('%')||u.pathname.includes('//'))throw fail();
 const base=u.href.replace(/\/+$/,'');
 const prefix=base.endsWith('/api/v1')?base:base+'/api/v1';
 return Object.freeze([prefix+'/ide/deployments/'+requestId,prefix+'/ide/deployments/'+requestId+'/logs']);
}
// Explicit per-query GET only. Standard hostname/CA validation AND the original
// registered SPKI pin are required. There is no redirect, retry or global fetch.
export function createPinnedServiceReadFetch({service,requestId,assertCurrent,assertNetworkApproved}){
 const allowed=serviceReadURLs(service,requestId),pin=service.tlsSPKISHA256;
 return async(url,options={})=>{
  const target=String(url);
  if(!allowed.includes(target)||options.method!=='GET'||options.body!==undefined&&options.body!==''||typeof assertCurrent!=='function'||typeof assertNetworkApproved!=='function')throw fail();
  const headers=new Headers(options.headers);
  if([...headers.keys()].some(k=>!['accept','x-ynx-product-session-proof-v2'].includes(k))||!headers.get('x-ynx-product-session-proof-v2'))throw fail();
  options.signal?.throwIfAborted();await assertCurrent();await assertNetworkApproved(target);await assertCurrent();options.signal?.throwIfAborted();
  const response=await new Promise((resolve,reject)=>{
   let settled=false,request;
   const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
   const abort=()=>{const cause=options.signal.reason||fail();request?.destroy(cause);finish(cause);};
   const timer=setTimeout(()=>{const cause=fail();request?.destroy(cause);finish(cause);},10000);
   options.signal?.addEventListener('abort',abort,{once:true});
   try{
    request=https.request(target,{method:'GET',headers:Object.fromEntries(headers),agent:false,rejectUnauthorized:true,
     checkServerIdentity(host,cert){const error=tls.checkServerIdentity(host,cert);if(error)return error;try{const key=new X509Certificate(cert.raw).publicKey.export({type:'spki',format:'der'});if(createHash('sha256').update(key).digest('hex')!==pin)return fail();}catch{return fail();}}
    },res=>{
     if(res.statusCode>=300&&res.statusCode<400){res.destroy();finish(fail());return;}
     const chunks=[];let size=0;
     res.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){res.destroy(fail());return;}chunks.push(chunk);});
     res.once('error',error=>finish(error));res.once('aborted',()=>finish(fail()));
     res.once('end',()=>{try{finish(null,new Response([204,205,304].includes(res.statusCode)?null:Buffer.concat(chunks),{status:res.statusCode,headers:res.headers}));}catch(error){finish(error);}});
    });
    request.once('error',error=>finish(error));if(options.signal?.aborted){abort();return;}request.end();
   }catch(error){finish(error);}
  });
  await assertCurrent();options.signal?.throwIfAborted();return response;
 };
}
