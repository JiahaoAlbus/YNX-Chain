// Private integration callee for the ORIGINAL Auth server, not a second server.
// Source is acquired at normal startup, never from a request or callback.
import {acquireOriginalProductPairSessionV4Issuer,assertOriginalProductPairIssuerOwnerV4} from './product-pair-session-v4-source.js';
import {acquireOriginalPendingPairQueryServerV1,createOriginalPendingPairQueryHTTPHandler,PENDING_ORIGINAL_QUERY_SERVER_PATH,PENDING_ORIGINAL_QUERY_REQUIRED_MAX_HEADER_BYTES} from './product-pair-pending-query-server.mjs';
import {OriginalReadOnlyChildDebtV4} from './original-readonly-child-debt-v4.js';
import {acquireOriginalRegisteredManagementServerV4,acquireOriginalCompletionQueryServerV4,createOriginalManagementV4HTTPHandler,ORIGINAL_MANAGEMENT_V4_ROUTES,ORIGINAL_MANAGEMENT_V4_REQUIRED_MAX_HEADER_BYTES} from './product-session-management-server.mjs';
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
 if(args.length)fail('PAIR_V4_ZERO_INPUT_REQUIRED');
 const children=[];let pairHandler,queryHandler,managementHandler,completionHandler,pairFailure,queryFailure,managementFailure,completionFailure;
 const adopt=owner=>{if(!owner)return;let retireSelected=false,joined=false;const child={retire(){if(!retireSelected){retireSelected=true;return owner.retire();}},async join(){if(!joined){if(await owner.join()!==undefined)fail('PAIR_V4_HTTP_JOIN_PENDING');joined=true;}},close:()=>owner.close(),...(typeof owner.drainPartial==='function'?{drainPartial:()=>owner.drainPartial()}: {})};children.push({child,debt:new OriginalReadOnlyChildDebtV4(child)});};
 try{const r=await acquireOriginalProductPairSessionV4Issuer();adopt(r.owner);if(r.error!==undefined)pairFailure={cause:r.error};else pairHandler=createProductPairSessionV4HTTPHandler(r.owner);}catch(cause){pairFailure={cause};}
 try{const r=await acquireOriginalPendingPairQueryServerV1();adopt(r.owner);if(r.error!==null)queryFailure={cause:r.error};else queryHandler=createOriginalPendingPairQueryHTTPHandler(r.owner);}catch(cause){queryFailure={cause};}
 try{const r=await acquireOriginalRegisteredManagementServerV4();adopt(r.owner);if(r.error===null)managementHandler=createOriginalManagementV4HTTPHandler(r.owner);else managementFailure={cause:r.error};}catch(cause){managementFailure={cause};}
 try{const r=await acquireOriginalCompletionQueryServerV4();adopt(r.owner);if(r.error===null)completionHandler=createOriginalManagementV4HTTPHandler(r.owner);else completionFailure={cause:r.error};}catch(cause){completionFailure={cause};}
 const routeFailures=Object.freeze(Object.fromEntries(Object.entries({issuer:pairFailure,pendingOriginalQuery:queryFailure,registeredManagement:managementFailure,completionQuery:completionFailure}).map(([k,v])=>[k,Object.freeze({present:!!v,cause:v?.cause})])));
 let retired=false,closeFlight,firstClose;
 const drain=async()=>{while(children.length){const current=children[0];await current.debt.drain();if(!current.debt.closed)fail('PAIR_V4_HTTP_CHILD_DEBT');children.shift();}};
 const owner=Object.freeze({retire(){retired=true;let first;for(const{child}of children)try{child.retire();}catch(cause){first??={cause};}if(first)throw first.cause;},async join(){if(!retired)fail('PAIR_V4_HTTP_NOT_RETIRED');for(const{child}of children)if(await child.join()!==undefined)fail('PAIR_V4_HTTP_JOIN_PENDING');},close(){if(!closeFlight){retired=true;closeFlight=drain().catch(cause=>{firstClose??={cause};throw firstClose.cause;});}return closeFlight;},async drainPartial(){if(!closeFlight)fail('PAIR_V4_HTTP_NOT_CLOSING');await drain();},status(){return Object.freeze({retired,childDebt:children.length,routeFailures,firstClosePresent:!!firstClose,firstClose:firstClose?.cause});}});
 const routeStatus=Object.freeze({issuer:!!pairHandler,pendingOriginalQuery:!!queryHandler,registeredManagement:!!managementHandler,completionQuery:!!completionHandler});
 const handle=async(req,res)=>{
  if(req.url===PENDING_ORIGINAL_QUERY_SERVER_PATH){if(queryHandler&&!retired)return queryHandler(req,res);res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end('{"code":"PAIR_PENDING_QUERY_SOURCE_NOT_CONFIGURED","authorized":false,"newSession":false,"retryAuthorized":false}');return true;}
  if(Object.values(ORIGINAL_MANAGEMENT_V4_ROUTES).includes(req.url)){const selected=req.url===ORIGINAL_MANAGEMENT_V4_ROUTES.recover?completionHandler:managementHandler;if(selected&&!retired)return selected(req,res);res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end('{"code":"PAIR_V4_MANAGEMENT_SOURCE_NOT_CONFIGURED","authorized":false,"newSession":false,"retryAuthorized":false}');return true;}
  if(!['/v4/product-pairs','/v4/product-session-challenges','/v4/product-sessions'].includes(req.url))return false;
  if(pairHandler&&!retired)return pairHandler(req,res);res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end('{"code":"PAIR_V4_SOURCE_NOT_CONFIGURED","authorized":false,"newSession":false}');return true;
 };
 return Object.freeze({owner,handle,routeStatus,routeFailures,requiredMaxHeaderSize:Math.max(PENDING_ORIGINAL_QUERY_REQUIRED_MAX_HEADER_BYTES,ORIGINAL_MANAGEMENT_V4_REQUIRED_MAX_HEADER_BYTES),error:undefined});
}
