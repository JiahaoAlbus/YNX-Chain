// PRIVATE server orchestration. The exported kernel is a PUBLIC test seam,
// never a recognized normal Source/HTTP owner; production construction is fixed
// in product-pair-pending-query-server.mjs with original Source + sole SDK math.
import {types} from 'node:util';
import {decodePendingPairOriginalQueryDATA} from './product-pair-pending-original-query-data.mjs';
import {inspectPendingPairQueryTransportDATA} from './product-pair-pending-query-transport-data.mjs';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from './product-session-device-registration-v4.js';
import {productPairSessionV4ActorDATA} from './product-pair-session-v4-issuer.js';
import {ynxAddressFromEVM} from './crypto.js';
import {OriginalReadOnlyChildDebtV4} from './original-readonly-child-debt-v4.js';
const fail=code=>{throw Object.assign(Error(code),{code});};
const TA=Object.getPrototypeOf(Uint8Array.prototype),getBuffer=Object.getOwnPropertyDescriptor(TA,'buffer').get,getLength=Object.getOwnPropertyDescriptor(TA,'byteLength').get,set=Uint8Array.prototype.set,abort=AbortSignal.prototype.throwIfAborted;
function original(v,max){if(types.isProxy(v)||!Buffer.isBuffer(v))fail('PAIR_PENDING_QUERY_ORIGINAL');const n=getLength.call(v);if(types.isSharedArrayBuffer(getBuffer.call(v))||n<1||n>max)fail('PAIR_PENDING_QUERY_ORIGINAL');const out=Buffer.alloc(n);set.call(out,v);return out;}
function input(v){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('PAIR_PENDING_QUERY_INPUT');const d=Object.getOwnPropertyDescriptors(v),keys=['queryOriginal','registrationOriginal','memberOriginal','transport'];if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]?.enumerable||!Object.hasOwn(d[k],'value')))fail('PAIR_PENDING_QUERY_INPUT');return {queryOriginal:original(v.queryOriginal,1024),registrationOriginal:original(v.registrationOriginal,16384),memberOriginal:original(v.memberOriginal,98304),transport:v.transport};}

export class PendingPairOriginalQueryServerKernel {
 #source;#inspect;#clock;#floor=0;#retired=false;#pending=new Set();#children=new Map();#sourceRetired=false;#sourceJoined=false;#sourceCloseSelected=false;#closed=false;#first;#closeFirst;#closeSelected=false;#closeFlight;
 constructor(source,inspect,clock=Date.now){this.#source=source;this.#inspect=inspect;this.#clock=clock;}
 #now(){const n=this.#clock();if(!Number.isSafeInteger(n)||n<0||n<this.#floor)fail('PAIR_PENDING_QUERY_CLOCK');this.#floor=n;return n;}
 #alive(){if(this.#retired||this.#closed)fail('PAIR_PENDING_QUERY_RETIRED');}
 query(value,signal){
  this.#alive();if(this.#pending.size>=32||this.#children.size>=32)fail('PAIR_PENDING_QUERY_CHILD_CAPACITY');
  const captured=input(value),work=Promise.resolve().then(()=>this.#query(captured,signal));this.#pending.add(work);const done=()=>this.#pending.delete(work);work.then(done,done);return work;
 }
 async #query(v,signal){
  let child,debt,result,error,deadline=Infinity;
  try{
   this.#alive();if(signal!==undefined)abort.call(signal);const first=this.#now(),query=decodePendingPairOriginalQueryDATA(v.queryOriginal),transport=inspectPendingPairQueryTransportDATA(v.transport,this.#source.serviceOrigin,first);
   const view=inspectProductSessionDeviceRegistrationOriginalV4Data(v.registrationOriginal),record=view.record;
   const acquired=await this.#source.acquire(v.registrationOriginal.toString('utf8'),first);
   // Adopt original child BEFORE checking error (including falsy failures).
   child=acquired?.owner;if(child){debt=new OriginalReadOnlyChildDebtV4(child);this.#children.set(child,debt);}
   if(!acquired||!Object.hasOwn(acquired,'error')||acquired.error!==null)throw acquired?.error;
   if(!child||!acquired.expected)fail('PAIR_PENDING_QUERY_SOURCE_CHILD');
   const e=acquired.expected;
   if(e.registrationOriginal!==v.registrationOriginal.toString('utf8')||e.serviceOrigin!==this.#source.serviceOrigin||e.networkId!==record.networkId||e.canonicalOwner!==record.canonicalOwner||e.pkA!==record.pkA||e.pkB!==record.pkB)fail('PAIR_PENDING_QUERY_REGISTERED_BINDING');
   if(!Number.isSafeInteger(e.sourceIssuedAtMs)||!Number.isSafeInteger(e.sourceExpiresAtMs)||e.sourceExpiresAtMs<=e.sourceIssuedAtMs||!Number.isSafeInteger(child.expiresAtMs))fail('PAIR_PENDING_QUERY_SOURCE_WINDOW');
   deadline=Math.min(Date.parse(transport.expiresAt),Date.parse(record.expiresAt),e.sourceExpiresAtMs,child.expiresAtMs);
   const current=async()=>{this.#alive();if(signal!==undefined)abort.call(signal);const n=this.#now();if(n>=deadline)fail('PAIR_PENDING_QUERY_EXPIRED');if(await child.recheck(n)!==undefined)fail('PAIR_PENDING_QUERY_CURRENT_REFUSED');this.#alive();if(signal!==undefined)abort.call(signal);const after=this.#now();if(after>=deadline)fail('PAIR_PENDING_QUERY_POST_EXPIRED');if(child.assertCurrent(after)!==undefined)fail('PAIR_PENDING_QUERY_CURRENT_REFUSED');if(this.#now()>=deadline)fail('PAIR_PENDING_QUERY_POST_EXPIRED');};
   await current();
   const actor=productPairSessionV4ActorDATA(record,record,ynxAddressFromEVM(record.canonicalOwner));
   // Fixed original SDK/Core AND inspector supplied ONLY by the normal factory.
   // PUBLIC kernel fixtures are not admitted by the normal HTTP WeakSet guard.
   const inspect=async(stage,originalPairPost)=>this.#inspect({stage,queryOriginal:v.queryOriginal,...(stage==='full'?{originalPairPost}:{}),registrationOriginal:v.registrationOriginal,memberOriginal:v.memberOriginal,expected:Object.freeze({...e,actorDigest:actor,nonce:transport.nonce,issuedAt:transport.issuedAt,expiresAt:transport.expiresAt,atMs:this.#now()})});
   const verified=await inspect('stage');
   if(!verified||verified.signatureVerified!==true||verified.originalPostVerified!==false||verified.memberCount!==1||verified.memberIndex!==0||verified.operationId!==query.operationId||verified.actorDigest!==actor||verified.queryBodyDigest!==query.queryBodyDigest||verified.originalRequestBodyDigest!==query.originalRequestBodyDigest)fail('PAIR_PENDING_QUERY_REGISTERED_N1_REQUIRED');
   await current();
   const snapshot=this.#source.captureOriginal(v.queryOriginal,actor);snapshot.assertCurrent();
   const originalPairPost=snapshot.originalPairPost;
   if(originalPairPost!==null){const full=await inspect('full',originalPairPost);if(!full||full.signatureVerified!==true||full.originalPostVerified!==true||full.memberCount!==1||full.memberIndex!==0||full.operationId!==query.operationId||full.actorDigest!==actor||full.queryBodyDigest!==query.queryBodyDigest||full.originalRequestBodyDigest!==query.originalRequestBodyDigest)fail('PAIR_PENDING_QUERY_FULL_ORIGINAL_REQUIRED');}
   snapshot.assertCurrent();result=snapshot.projectResult();snapshot.assertCurrent();
   // Preserve the original public result BEFORE any late-current/cleanup error.
   if(!result||result.operationId!==query.operationId||result.queryBodyDigest!==query.queryBodyDigest||result.originalRequestBodyDigest!==query.originalRequestBodyDigest||!['NOT_FOUND','UNKNOWN','OBSERVED'].includes(result.state)||result.newSession!==false||result.retryAuthorized!==false)fail('PAIR_PENDING_QUERY_ORIGINAL_RESULT');
   await current();
  }catch(cause){error={cause};}
  if(debt){try{await debt.drain();}catch(cause){error??={cause};}finally{if(debt.closed)this.#children.delete(child);}}
  try{this.#alive();if(this.#now()>=deadline)fail('PAIR_PENDING_QUERY_POST_CLEANUP_EXPIRED');}catch(cause){error??={cause};}
  if(error){this.#first??=error;throw Object.assign(Error('PAIR_PENDING_QUERY_UNRESOLVED'),{code:'PAIR_PENDING_QUERY_UNRESOLVED',cause:error.cause,partial:result??null,recoverOnly:true});}
  return result;
 }
 retire(){this.#retired=true;if(!this.#sourceRetired){this.#sourceRetired=true;try{this.#source.retire();}catch(cause){this.#first??={cause};throw cause;}}}
 async join(){if(!this.#retired)fail('PAIR_PENDING_QUERY_NOT_RETIRED');while(this.#pending.size)await Promise.allSettled([...this.#pending]);for(const[child,debt]of this.#children){await debt.drain();if(debt.closed)this.#children.delete(child);}if(this.#children.size)fail('PAIR_PENDING_QUERY_CHILD_DEBT');if(!this.#sourceJoined){if(await this.#source.join()!==undefined)fail('PAIR_PENDING_QUERY_PARENT_JOIN_NOT_COMPLETE');this.#sourceJoined=true;}}
 async #drain(){this.retire();await this.join();if(!this.#sourceCloseSelected){this.#sourceCloseSelected=true;if(await this.#source.close()!==undefined)fail('PAIR_PENDING_QUERY_PARENT_CLOSE_NOT_COMPLETE');this.#closed=true;}else if(!this.#closed){if(typeof this.#source.drainPartial!=='function')fail('PAIR_PENDING_QUERY_PARENT_CLOSE_UNKNOWN');if(await this.#source.drainPartial()!==undefined)fail('PAIR_PENDING_QUERY_PARENT_DRAIN_NOT_COMPLETE');this.#closed=true;}}
 close(){if(!this.#closeSelected){this.#closeSelected=true;this.#closeFlight=this.#drain().catch(cause=>{this.#closeFirst={cause};this.#first??={cause};throw cause;});}return this.#closeFlight;}
 async drainPartial(){if(!this.#closeSelected)fail('PAIR_PENDING_QUERY_NOT_CLOSING');await this.#drain();}
 status(){return Object.freeze({retired:this.#retired,closed:this.#closed,pending:this.#pending.size,childDebt:this.#children.size,sourceJoined:this.#sourceJoined,sourceCloseSelected:this.#sourceCloseSelected,firstCausePresent:!!this.#first,firstCause:this.#first?.cause});}
}
