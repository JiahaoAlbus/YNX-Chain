// PRIVATE normal server factory, not a generic proof/provider setter.
import {acquireOriginalPendingPairQuerySourceV1,assertOriginalPendingPairQuerySourceOwnerV1} from './product-pair-session-v4-source.js';
import {PendingPairOriginalQueryServerKernel} from './product-pair-pending-query-server-kernel.mjs';
import {decodeProductPairPendingOriginalQueryProofHeaderV1,extractProductPairPendingOriginalQueryClaimsDATA,inspectRegisteredProductPairPendingOriginalQueryEnvelopeN1DATA,inspectRegisteredProductPairPendingOriginalQueryN1DATA,PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_PROOF_HEADER_V1} from './product-pair-pending-original-query-e13.js';
const owners=new WeakSet(),fail=code=>{throw Object.assign(Error(code),{code});};
export const PENDING_ORIGINAL_QUERY_SERVER_PATH='/v4/product-pairs/original-query';
// Consumer must configure its existing Node listener accordingly; this module
// starts no listener. Large PQ header transport is NOT public-deployment proof.
export const PENDING_ORIGINAL_QUERY_REQUIRED_MAX_HEADER_BYTES=147456;
const expectedKeys=['networkId','canonicalOwner','pkA','pkB','actorDigest','serviceOrigin','nonce','issuedAt','expiresAt','atMs','sourceIssuedAtMs','sourceExpiresAtMs'];
export function inspectOriginalPendingPairQueryN1WithRegisteredSourceDATA({stage,memberOriginal,queryOriginal,registrationOriginal,originalPairPost,expected}){
 if(stage!=='stage'&&stage!=='full')fail('PAIR_PENDING_QUERY_INSPECT_STAGE');
 const input={queryOriginal,registrationOriginal,...(stage==='full'?{originalPairPost}:{}),expected:Object.fromEntries(expectedKeys.map(k=>[k,expected[k]]))};
 return stage==='full'?inspectRegisteredProductPairPendingOriginalQueryN1DATA(memberOriginal,input):inspectRegisteredProductPairPendingOriginalQueryEnvelopeN1DATA(memberOriginal,input);
}
class OriginalPendingPairQueryServerOwnerV1 {
 #source;#kernel;
 constructor(source){assertOriginalPendingPairQuerySourceOwnerV1(source);this.#source=source;this.#kernel=new PendingPairOriginalQueryServerKernel(source,inspectOriginalPendingPairQueryN1WithRegisteredSourceDATA);owners.add(this);Object.freeze(this);}
 query(queryOriginal,memberOriginal,signal){
  const claims=extractProductPairPendingOriginalQueryClaimsDATA(memberOriginal);
  if(!Buffer.from(claims.queryOriginal).equals(queryOriginal))fail('PAIR_PENDING_QUERY_BODY_BINDING');
  // Extracted claims remain untrusted until registered stage N1. Root/current
  // values and service origin NEVER come from these claims/certificate keys.
  return this.#kernel.query({queryOriginal,memberOriginal,registrationOriginal:Buffer.from(claims.registrationOriginal),transport:{nonce:claims.nonce,issuedAt:claims.issuedAt,expiresAt:claims.expiresAt,serviceOrigin:this.#source.serviceOrigin}},signal);
 }
 retire(){this.#kernel.retire();}join(){return this.#kernel.join();}close(){return this.#kernel.close();}drainPartial(){return this.#kernel.drainPartial();}status(){return this.#kernel.status();}
}
Object.freeze(OriginalPendingPairQueryServerOwnerV1.prototype);
export function assertOriginalPendingPairQueryServerOwnerV1(owner){if(!owners.has(owner))fail('PAIR_PENDING_QUERY_ORIGINAL_SERVER_REQUIRED');return owner;}
export async function acquireOriginalPendingPairQueryServerV1(...args){
 if(args.length)fail('PAIR_V4_ZERO_INPUT_REQUIRED');const acquired=await acquireOriginalPendingPairQuerySourceV1();
 // First adopt a non-null owner. Only null is success for the NEW contract.
 const partial=acquired.owner;if(acquired.error!==null)return Object.freeze({owner:partial,error:acquired.error});
 try{return Object.freeze({owner:new OriginalPendingPairQueryServerOwnerV1(partial),error:null});}catch(error){return Object.freeze({owner:partial,error});}
}
export function createOriginalPendingPairQueryHTTPHandler(owner){
 assertOriginalPendingPairQueryServerOwnerV1(owner);
 return async(req,res)=>{
  if(req.url!==PENDING_ORIGINAL_QUERY_SERVER_PATH)return false;
  const abort=new AbortController(),cancel=()=>abort.abort(Object.assign(Error('PAIR_PENDING_QUERY_CANCELLED'),{code:'PAIR_PENDING_QUERY_CANCELLED'}));
  const timer=setTimeout(()=>{cancel();if(!req.complete)req.destroy();},5000);req.once('aborted',cancel);const disconnected=()=>{if(!res.writableEnded)cancel();};res.once('close',disconnected);
  try{
   if(req.method!=='POST'||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']??'')||req.headers['content-encoding']!==undefined||req.headers['transfer-encoding']!==undefined)fail('PAIR_PENDING_QUERY_HTTP_REQUEST');
   const length=req.headers['content-length'];if(typeof length!=='string'||!/^[1-9][0-9]{0,3}$/.test(length)||Number(length)>1024)fail('PAIR_PENDING_QUERY_HTTP_SIZE');
   if(!Array.isArray(req.rawHeaders)||req.rawHeaders.length%2)fail('PAIR_PENDING_QUERY_HTTP_HEADERS');let proofs=0,total=0;for(let i=0;i<req.rawHeaders.length;i+=2){total+=Buffer.byteLength(req.rawHeaders[i])+Buffer.byteLength(req.rawHeaders[i+1])+4;if(req.rawHeaders[i].toLowerCase()===PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_PROOF_HEADER_V1)proofs++;}if(proofs!==1||total>PENDING_ORIGINAL_QUERY_REQUIRED_MAX_HEADER_BYTES)fail('PAIR_PENDING_QUERY_HTTP_HEADERS');
   const memberOriginal=Buffer.from(decodeProductPairPendingOriginalQueryProofHeaderV1(req.headers[PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_PROOF_HEADER_V1]));
   let bytes=0;const chunks=[];for await(const chunk of req){abort.signal.throwIfAborted();bytes+=chunk.length;if(bytes>Number(length)||bytes>1024)fail('PAIR_PENDING_QUERY_HTTP_SIZE');chunks.push(Buffer.from(chunk));}
   if(bytes!==Number(length)||req.destroyed&&!req.complete)fail('PAIR_PENDING_QUERY_HTTP_INCOMPLETE');abort.signal.throwIfAborted();
   const result=await owner.query(Buffer.concat(chunks),memberOriginal,abort.signal);abort.signal.throwIfAborted();
   if(!res.destroyed){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(result));}
  }catch(error){if(!res.headersSent&&!res.destroyed){const code=typeof error?.code==='string'&&/^PAIR_(?:PENDING_QUERY|V4)_[A-Z0-9_]+$/.test(error.code)?error.code:'PAIR_PENDING_QUERY_REFUSED';res.writeHead(422,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({code,authorized:false,newSession:false,retryAuthorized:false}));}}
  finally{clearTimeout(timer);req.removeListener('aborted',cancel);res.removeListener('close',disconnected);}return true;
 };
}
