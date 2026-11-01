// PRIVATE normal same issuer receiver. No arbitrary Kernel method dispatch,
// public Source setter, session fallback or pending-E13 management permission.
import {acquireOriginalRegisteredManagementSourceV4,acquireOriginalCompletionQuerySourceV4,assertOriginalProductSessionManagementSourceV4} from './product-pair-session-v4-source.js';
import {ProductSessionManagementServerKernelV4,ORIGINAL_MANAGEMENT_SOURCE_PURPOSE,ORIGINAL_COMPLETION_QUERY_SOURCE_PURPOSE} from './product-session-management-server-kernel.mjs';
import {PRODUCT_SESSION_MANAGEMENT_V4_ROUTES} from './product-session-management-v4.js';
import {PRODUCT_SESSION_PROOF_HEADER_V4,PRODUCT_SESSION_V4_HEADER_MAX_BYTES,PRODUCT_SESSION_V4_TOTAL_HEADERS_MAX_BYTES} from './product-session-proof-v4.js';
const recognized=new WeakSet(),fail=code=>{throw Object.assign(Error(code),{code});};
export const ORIGINAL_MANAGEMENT_V4_REQUIRED_MAX_HEADER_BYTES=PRODUCT_SESSION_V4_TOTAL_HEADERS_MAX_BYTES;
export const ORIGINAL_MANAGEMENT_V4_ROUTES=PRODUCT_SESSION_MANAGEMENT_V4_ROUTES;
class OriginalManagementServerOwnerV4 {
 #kernel;#purpose;
 constructor(source,purpose){assertOriginalProductSessionManagementSourceV4(source,purpose);this.#purpose=purpose;this.#kernel=new ProductSessionManagementServerKernelV4(source);recognized.add(this);Object.freeze(this);}
 accepts(operation){return this.#purpose===ORIGINAL_COMPLETION_QUERY_SOURCE_PURPOSE?operation==='recover':['active','revoke','cancel'].includes(operation);}
 execute(operation,raw,proofHeader,signal){if(!this.accepts(operation))fail('PAIR_V4_MANAGEMENT_PURPOSE');return this.#kernel.execute(operation,raw,proofHeader,signal);}
 retire(){this.#kernel.retire();}join(){return this.#kernel.join();}close(){return this.#kernel.close();}drainPartial(){return this.#kernel.drainPartial();}status(){return this.#kernel.status();}
}
Object.freeze(OriginalManagementServerOwnerV4.prototype);
export function assertOriginalProductSessionManagementServerV4(owner){if(!recognized.has(owner))fail('PAIR_V4_MANAGEMENT_ORIGINAL_SERVER_REQUIRED');return owner;}
async function acquire(purpose){const r=await(purpose===ORIGINAL_MANAGEMENT_SOURCE_PURPOSE?acquireOriginalRegisteredManagementSourceV4():acquireOriginalCompletionQuerySourceV4()),partial=r.owner;if(r.error!==null)return Object.freeze({owner:partial,error:r.error});try{return Object.freeze({owner:new OriginalManagementServerOwnerV4(partial,purpose),error:null});}catch(error){return Object.freeze({owner:partial,error:error===null?Object.assign(Error('PAIR_V4_MANAGEMENT_FAILED_NULL'),{code:'PAIR_V4_MANAGEMENT_FAILED_NULL',cause:null}):error});}}
export async function acquireOriginalRegisteredManagementServerV4(...args){if(args.length)fail('PAIR_V4_ZERO_INPUT_REQUIRED');return acquire(ORIGINAL_MANAGEMENT_SOURCE_PURPOSE);}
export async function acquireOriginalCompletionQueryServerV4(...args){if(args.length)fail('PAIR_V4_ZERO_INPUT_REQUIRED');return acquire(ORIGINAL_COMPLETION_QUERY_SOURCE_PURPOSE);}
export function createOriginalManagementV4HTTPHandler(owner){
 assertOriginalProductSessionManagementServerV4(owner);
 return async(req,res)=>{
  const operation=Object.keys(PRODUCT_SESSION_MANAGEMENT_V4_ROUTES).find(k=>PRODUCT_SESSION_MANAGEMENT_V4_ROUTES[k]===req.url);if(!operation||!owner.accepts(operation))return false;
  const controller=new AbortController(),cancel=()=>controller.abort(Object.assign(Error('PAIR_V4_MANAGEMENT_CANCELLED'),{code:'PAIR_V4_MANAGEMENT_CANCELLED'}));req.once('aborted',cancel);const disconnected=()=>{if(!res.writableEnded)cancel();};res.once('close',disconnected);const timer=setTimeout(()=>{cancel();if(!req.complete)req.destroy();},5000);
  try{
   if(req.method!=='POST'||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']??'')||req.headers['content-encoding']!==undefined||req.headers['transfer-encoding']!==undefined)fail('PAIR_V4_MANAGEMENT_HTTP_REQUEST');
   const length=req.headers['content-length'];if(typeof length!=='string'||!/^[1-9][0-9]{0,5}$/.test(length)||Number(length)>393216)fail('PAIR_V4_MANAGEMENT_HTTP_SIZE');
   let proofs=0,total=0;if(!Array.isArray(req.rawHeaders)||req.rawHeaders.length%2)fail('PAIR_V4_MANAGEMENT_HTTP_HEADERS');for(let i=0;i<req.rawHeaders.length;i+=2){total+=Buffer.byteLength(req.rawHeaders[i])+Buffer.byteLength(req.rawHeaders[i+1])+4;if(req.rawHeaders[i].toLowerCase()===PRODUCT_SESSION_PROOF_HEADER_V4)proofs++;}
   const proof=req.headers[PRODUCT_SESSION_PROOF_HEADER_V4];if(proofs!==1||total>PRODUCT_SESSION_V4_TOTAL_HEADERS_MAX_BYTES||typeof proof!=='string'||!proof.length||Buffer.byteLength(proof)>PRODUCT_SESSION_V4_HEADER_MAX_BYTES)fail('PAIR_V4_MANAGEMENT_HTTP_HEADERS');
   let size=0;const chunks=[];for await(const c of req){controller.signal.throwIfAborted();size+=c.length;if(size>Number(length)||size>393216)fail('PAIR_V4_MANAGEMENT_HTTP_SIZE');chunks.push(Buffer.from(c));}if(size!==Number(length)||req.destroyed&&!req.complete)fail('PAIR_V4_MANAGEMENT_HTTP_INCOMPLETE');
   controller.signal.throwIfAborted();const result=await owner.execute(operation,Buffer.concat(chunks),proof,controller.signal);controller.signal.throwIfAborted();
   if(!res.destroyed){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(result);}
  }catch(error){if(!res.headersSent&&!res.destroyed){const code=typeof error?.code==='string'&&/^(PAIR_V4|PRODUCT_SESSION)[A-Z0-9_]+$/.test(error.code)?error.code:'PAIR_V4_MANAGEMENT_REFUSED';res.writeHead(422,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({code,authorized:false,newSession:false,retryAuthorized:false}));}}
  finally{clearTimeout(timer);req.removeListener('aborted',cancel);res.removeListener('close',disconnected);}return true;
 };
}
