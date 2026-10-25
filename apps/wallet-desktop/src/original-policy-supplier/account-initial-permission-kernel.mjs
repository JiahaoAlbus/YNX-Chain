// Auth mechanics only. A public instance/DTO is NOT a Source or approval.
// Production authority comes only from the separate Main-only initial factory.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {encodePQRegistrationIntent,decodePQRegistrationIntent,decodePQAccountInitialRequest} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
const fail=code=>{throw Object.assign(Error(code),{code});};
const exact=(v,keys)=>{
 if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('AUTH_INITIAL_SCHEMA');
 const ds=Object.getOwnPropertyDescriptors(v),ks=Reflect.ownKeys(ds);
 if(ks.length!==keys.length||ks.some(k=>!keys.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))fail('AUTH_INITIAL_SCHEMA');
};
const sha=v=>createHash('sha256').update(v).digest('hex');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const txhash=v=>typeof v==='string'&&/^0x[a-f0-9]{64}$/.test(v);
const token=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const u64=v=>typeof v==='string'&&/^[1-9][0-9]*$/.test(v)&&BigInt(v)<=18446744073709551615n;
const time=v=>{if(typeof v!=='string'||!Number.isSafeInteger(Date.parse(v))||new Date(Date.parse(v)).toISOString()!==v)fail('AUTH_INITIAL_TIME');return Date.parse(v);};
const typedProto=Object.getPrototypeOf(Uint8Array.prototype),lengthGet=Object.getOwnPropertyDescriptor(typedProto,'byteLength').get,bufferGet=Object.getOwnPropertyDescriptor(typedProto,'buffer').get,offsetGet=Object.getOwnPropertyDescriptor(typedProto,'byteOffset').get;
function bytes(v,max){
 if(!v||types.isProxy(v)||!types.isUint8Array(v)||![Uint8Array.prototype,Buffer.prototype].includes(Object.getPrototypeOf(v)))fail('AUTH_INITIAL_BYTES');
 const n=lengthGet.call(v),b=bufferGet.call(v),o=offsetGet.call(v);
 if(!n||n>max||types.isSharedArrayBuffer(b))fail('AUTH_INITIAL_BYTES');
 return Buffer.from(new Uint8Array(b,o,n));
}
export function bindAccountInitialPermissionRequest(v){
 if(types.isProxy(v))fail('AUTH_INITIAL_SCHEMA');
 const broadcast=!!v&&Object.getOwnPropertyDescriptor(v,'action')?.value==='broadcast';
 exact(v,['version','kind','action','purpose','networkId','nativeChainId','account','operationId','origin','requestDigest','intent','createdAt','expiresAt','dataOnly','bootstrapAdmission',...(broadcast?['originalOperationId','transportHash','abciTransactionHash','executionHeight']:[])]);
 if(v.version!==1||v.kind!=='account-initial'||!['sign','broadcast'].includes(v.action)||v.purpose!=='TX-BATCH'||!hex(v.networkId)||v.nativeChainId!=='6423'||typeof v.account!=='string'||!/^0x[a-f0-9]{40}$/.test(v.account)||!token(v.operationId)||v.origin!=='ynx-wallet:local-pq'||v.dataOnly!==true||v.bootstrapAdmission!==false)fail('AUTH_INITIAL_BINDING');
 exact(v.intent,['chainId','owner','algorithmVersion','pkA','pkB','priorRevision','newRevision','ledgerNonce','activateAt']);
 // Sole SDK defines canonical E15 and dual key encodings, never a new codec.
 const encoded=encodePQRegistrationIntent(v.intent),intent=decodePQRegistrationIntent(encoded);
 if(Object.keys(intent).some(k=>intent[k]!==v.intent[k])||intent.chainId!==v.networkId||intent.owner!==v.account||intent.priorRevision!=='0'||intent.newRevision!=='1'||intent.ledgerNonce!=='1'||sha(encoded)!==v.requestDigest)fail('AUTH_INITIAL_INTENT');
 const start=time(v.createdAt),end=time(v.expiresAt);if(end<=start||end-start>30000)fail('AUTH_INITIAL_TIME');
 if(broadcast&&(!token(v.originalOperationId)||v.originalOperationId===v.operationId||!txhash(v.transportHash)||!txhash(v.abciTransactionHash)||!u64(v.executionHeight)))fail('AUTH_INITIAL_ORIGINAL');
 return Object.freeze({...v,intent:Object.freeze({...intent})});
}
function bindSource(v,request){
 exact(v,['genesisBytes','genesisSHA256','executionHeight','occupancy','memberBytes']);
 const genesis=bytes(v.genesisBytes,8<<20);
 if(!hex(v.genesisSHA256)||sha(genesis)!==v.genesisSHA256||!u64(v.executionHeight)||BigInt(request.intent.activateAt)<=BigInt(v.executionHeight))fail('AUTH_INITIAL_GENESIS_OR_HEIGHT');
 exact(v.occupancy,['chainId','owner','executionHeight','registered','ledgerNonce']);
 const o=v.occupancy;
 if(o.chainId!==request.networkId||o.owner!==request.account||o.executionHeight!==v.executionHeight||o.registered!==false||o.ledgerNonce!=='0')fail('AUTH_INITIAL_OWNER_OCCUPIED_OR_CHANGED');
 if(request.action==='sign'){if(v.memberBytes!==null)fail('AUTH_INITIAL_UNEXPECTED_MEMBER');}
 else{
  if(request.executionHeight!==v.executionHeight)fail('AUTH_INITIAL_ORIGINAL_HEIGHT_CHANGED');
  const member=bytes(v.memberBytes,98304),decoded=decodePQAccountInitialRequest(member,{chainId:request.networkId,owner:request.account,pkA:request.intent.pkA,pkB:request.intent.pkB,executionHeight:v.executionHeight});
  if(sha(decoded.intentBytes)!==request.requestDigest||decoded.transportHash!==request.transportHash||decoded.abciTransactionHash!==request.abciTransactionHash)fail('AUTH_INITIAL_MEMBER_CHANGED');
 }
 // These values are correlation DATA, not issuer/Root authentication. The
 // branded private peer must independently authenticate Genesis pin and same-H
 // occupancy originals on read/current/recheck; never infer it from TLS/DTOs.
 return {genesis,identity:Object.freeze({genesisSHA256:v.genesisSHA256,executionHeight:v.executionHeight,occupancy:Object.freeze({...o})})};
}
export class AccountInitialPermissionKernel {
 #request;#peer;#clock;#floor=0;#binding;#source;#expires;#pending=new Set();#initialized=false;#checking=false;#busy=false;
 #phase='captured';#first;#hasFirst=false;#result;#retireSelected=false;#retireError;#retireFailed=false;#joining;#closing;#cleanupError;
 constructor(request,peer,clock=Date.now){
  this.#request=request;
  if(!peer||['readOriginal','assertCurrent','recheck','enterOriginal','completeOriginal','assertCompletedCurrent','retire','join','close'].some(k=>typeof peer[k]!=='function')||typeof clock!=='function')fail('AUTH_INITIAL_PEER_REQUIRED');
  this.#peer=peer;this.#clock=clock;
 }
 #remember(e){if(!this.#hasFirst){this.#hasFirst=true;this.#first=e;}this.#phase='unknown';}
 #now(){const n=this.#clock();if(!Number.isSafeInteger(n)||n<this.#floor)fail('AUTH_INITIAL_CLOCK');this.#floor=n;return n;}
 #window(){if(!this.#binding||this.#now()>=this.#expires)fail('AUTH_INITIAL_EXPIRED');}
 #track(p){this.#pending.add(p);void p.then(()=>this.#pending.delete(p),()=>this.#pending.delete(p));return p;}
 #void(fn){if(fn()!==undefined)fail('AUTH_INITIAL_PEER_RESULT');}
 async initialize(){
  if(this.#initialized)fail('AUTH_INITIAL_INITIALIZE_ONCE');this.#initialized=true;
  try{return await this.#track(Promise.resolve().then(async()=>{
   if(this.#phase!=='captured')fail('AUTH_INITIAL_RETIRED');this.#request=bindAccountInitialPermissionRequest(this.#request);const before=this.#now();
   const packet=await this.#peer.readOriginal(this.#request);
   exact(packet,['request','issuedAt','expiresAt','source']);const request=bindAccountInitialPermissionRequest(packet.request);
   // Normalize top-level and nested field order before equality comparison.
   for(const k of Object.keys(request))if(k==='intent'?Object.keys(request.intent).some(i=>request.intent[i]!==this.#request.intent[i]):request[k]!==this.#request[k])fail('AUTH_INITIAL_ORIGINAL_CHANGED');
   const issued=time(packet.issuedAt),expires=time(packet.expiresAt);
   if(issued<time(request.createdAt)||issued>before||expires<=issued||expires-issued>30000||before>=expires||expires>time(request.expiresAt))fail('AUTH_INITIAL_EXPIRED');
   this.#source=bindSource(packet.source,request);this.#expires=expires;
   this.#binding=Object.freeze({...request,issuedAt:packet.issuedAt,expiresAt:packet.expiresAt,source:this.#source.identity});
   if(this.#phase!=='captured')fail('AUTH_INITIAL_RETIRED');this.#phase='ready';this.assertCurrent();
  }));}catch(e){this.#remember(e);throw e;}
 }
 assertCurrent(){
  try{
   if(this.#busy)fail('AUTH_INITIAL_REENTRANT');
   if(!['ready','entered','completed'].includes(this.#phase))throw this.#hasFirst?this.#first:Error('AUTH_INITIAL_NOT_CURRENT');
   this.#window();const phase=this.#phase;this.#busy=true;
   try{this.#void(()=>phase==='completed'?this.#peer.assertCompletedCurrent(this.#result):this.#peer.assertCurrent());}finally{this.#busy=false;}
   if(this.#phase!==phase)throw this.#hasFirst?this.#first:Error('AUTH_INITIAL_CHANGED_DURING_CURRENT');
   this.#window();
  }catch(e){this.#remember(e);throw e;}
 }
 readOriginal(){this.assertCurrent();return this.#binding;}
 copyOriginalGenesisBytes(){this.assertCurrent();const out=Uint8Array.from(this.#source.genesis);this.assertCurrent();return out;}
 async recheck(){
  this.assertCurrent();if(this.#checking)fail('AUTH_INITIAL_RECHECK_PENDING');this.#checking=true;
  try{return await this.#track(Promise.resolve().then(async()=>{this.assertCurrent();if(await this.#peer.recheck()!==undefined)fail('AUTH_INITIAL_RECHECK_RESULT');this.assertCurrent();}));}
  catch(e){this.#remember(e);throw e;}finally{this.#checking=false;}
 }
 #enter(action){
  try{
   this.assertCurrent();if(this.#checking||this.#busy||this.#phase!=='ready'||this.#request.action!==action)fail('AUTH_INITIAL_ENTER_ONCE');
   this.#phase='entered';this.#busy=true;try{this.#void(()=>this.#peer.enterOriginal(action));}finally{this.#busy=false;}
   this.assertCurrent();
  }catch(e){this.#remember(e);throw e;}
 }
 enterSign(){return this.#enter('sign');}
 enterBroadcast(){return this.#enter('broadcast');}
 complete(v){
  try{
   if(this.#busy||this.#phase!=='entered')fail('AUTH_INITIAL_COMPLETE_ONCE');exact(v,['outcome','transportHash','abciTransactionHash']);
   if(!['returned','unknown'].includes(v.outcome)||!txhash(v.transportHash)||!txhash(v.abciTransactionHash)||(this.#request.action==='broadcast'&&(v.transportHash!==this.#request.transportHash||v.abciTransactionHash!==this.#request.abciTransactionHash)))fail('AUTH_INITIAL_RESULT_BINDING');
   this.#result=Object.freeze({...v});this.#phase='completed';this.#window();this.#busy=true;
   try{this.#void(()=>this.#peer.completeOriginal(this.#result));}finally{this.#busy=false;}
   this.assertCurrent();if(v.outcome==='unknown')fail('AUTH_INITIAL_EFFECT_UNKNOWN');
  }catch(e){this.#remember(e);throw e;}
 }
 retire(){
  if(this.#retireSelected){if(this.#retireFailed)throw this.#retireError;return;}
  this.#retireSelected=true;if(!this.#hasFirst)this.#phase='retired';
  try{this.#void(()=>this.#peer.retire());}catch(e){this.#retireFailed=true;this.#retireError=e;this.#remember(e);throw e;}
 }
 join(){
  if(!this.#retireSelected)fail('AUTH_INITIAL_RETIRE_REQUIRED');
  if(!this.#joining){this.#joining=Promise.resolve().then(async()=>{await Promise.allSettled([...this.#pending]);if(this.#busy)fail('AUTH_INITIAL_JOIN_PENDING');if(await this.#peer.join()!==undefined)fail('AUTH_INITIAL_JOIN_UNKNOWN');}).catch(e=>{this.#remember(e);throw e;});void this.#joining.catch(()=>{});}return this.#joining;
 }
 close(){
  if(this.#closing)return this.#closing;if(!this.#hasFirst)this.#phase='retired';
  this.#closing=Promise.resolve().then(async()=>{
   let first,failed=false,joined=false;const attempt=async fn=>{try{if(await fn()!==undefined)fail('AUTH_INITIAL_CLOSE_UNKNOWN');}catch(e){if(!failed){first=e;failed=true;}}};
   await attempt(()=>this.retire());await attempt(async()=>{await this.join();joined=true;});if(joined)await attempt(()=>this.#peer.close());
   if(failed){this.#cleanupError=first;this.#remember(first);throw first;}this.#phase=this.#hasFirst?'unknown':'closed';
  });void this.#closing.catch(()=>{});return this.#closing;
 }
 outcome(){return Object.freeze({binding:this.#binding??null,result:this.#result??null,phase:this.#phase,firstCausePresent:this.#hasFirst,firstCause:this.#first,cleanupCause:this.#cleanupError,permissionFactoryBranded:false,effectRetryAuthorized:false});}
}
