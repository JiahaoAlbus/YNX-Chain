// Private integration callee for the ORIGINAL Auth server, not a second server.
// Source is acquired at normal startup, never from a request or callback.
import {acquireOriginalProductPairSessionV4Issuer,assertOriginalProductPairIssuerOwnerV4} from './product-pair-session-v4-source.js';
const MAX=393216,fail=c=>{throw Object.assign(Error(c),{code:c});};
export function createProductPairSessionV4HTTPHandler(owner){
 assertOriginalProductPairIssuerOwnerV4(owner);
 const routes=Object.freeze({'/v4/product-pairs':'pair','/v4/product-session-challenges':'challenge','/v4/product-sessions':'complete'});
 return async function handle(req,res){
  // Return false for original server routing, without consuming its stream.
  const method=routes[req.url];if(!Object.hasOwn(routes,req.url))return false;
  try{if(req.method!=='POST'||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']??'')||req.headers['content-encoding']!==undefined||req.headers['transfer-encoding']!==undefined)fail('PAIR_V4_HTTP_REQUEST');
   const length=req.headers['content-length'];if(typeof length!=='string'||!/^[1-9][0-9]{0,6}$/.test(length)||Number(length)>MAX)fail('PAIR_V4_HTTP_SIZE');
   const controller=new AbortController(),timer=setTimeout(()=>{controller.abort();req.destroy();},5000);let raw;
   try{const chunks=[];let bytes=0;for await(const c of req){bytes+=c.length;if(bytes>MAX||bytes>Number(length))fail('PAIR_V4_HTTP_SIZE');chunks.push(c);}if(bytes!==Number(length)||controller.signal.aborted)fail('PAIR_V4_HTTP_INCOMPLETE');raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}finally{clearTimeout(timer);}
   if(req.destroyed&&!req.complete)fail('PAIR_V4_HTTP_ABORTED');
   const result=await owner[method](raw);
   // Do not stringify internal errors, partial owners, Source refs or DB rows.
   res.writeHead(result.recoveryOnly?409:200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(result.recoveryOnly?{code:'PAIR_V4_RECOVER_ORIGINAL_ONLY',newSession:false}:{original:result.original,durable:true,sourceAdmission:false,nativeAdmission:false}));
  }catch(error){const code=typeof error?.code==='string'&&/^PAIR_V4_[A-Z0-9_]+$/.test(error.code)?error.code:'PAIR_V4_REFUSED';if(!res.headersSent&&!res.destroyed){res.writeHead(422,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({code,authorized:false,newSession:false}));}}
  return true;
 };
}
export async function openOriginalProductPairSessionV4HTTPRoutes(...args){
 if(args.length)fail('PAIR_V4_ZERO_INPUT_REQUIRED');const acquired=await acquireOriginalProductPairSessionV4Issuer();if(acquired.error!==undefined)return acquired;
 try{return Object.freeze({owner:acquired.owner,handle:createProductPairSessionV4HTTPHandler(acquired.owner),error:undefined});}
 catch(error){return Object.freeze({owner:acquired.owner,error});}
}
