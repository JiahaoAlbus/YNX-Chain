// Original Auth request-specific permission mechanics, NOT a public factory
// or authority brand. Only the original authenticated Main review producer
// may construct a production instance. A caller-supplied object is NOT that
// producer, even if it implements this interface. No signing or POST here.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {normalizePQNativeAction,encodePQNativeAction} from '@ynx-chain/wallet-auth/pq-native-action';
import {encodePQNativeTransfer} from '@ynx-chain/wallet-auth/pq-wallet-authorization';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const exact=(v,keys)=>{
 if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('AUTH_TX_PERMISSION_SCHEMA');
 const ds=Object.getOwnPropertyDescriptors(v),ks=Reflect.ownKeys(ds);
 if(ks.length!==keys.length||ks.some(k=>!keys.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))fail('AUTH_TX_PERMISSION_SCHEMA');
};
const time=v=>{if(typeof v!=='string'||!Number.isSafeInteger(Date.parse(v))||new Date(Date.parse(v)).toISOString()!==v)fail('AUTH_TX_PERMISSION_TIME');return Date.parse(v);};
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const transportHash=v=>typeof v==='string'&&/^0x[a-f0-9]{64}$/.test(v);
export function bindTransactionPermissionRequest(value){
 if(types.isProxy(value))fail('AUTH_TX_PERMISSION_SCHEMA');
 if(value&&Object.hasOwn(value,'typedAction'))return bindTypedRequest(value);
 const sign=value&&Object.getOwnPropertyDescriptor(value,'action')?.value==='sign';
 exact(value,['action','networkId','nativeChainId','account','operationId','origin','transfer','requestDigest',...(sign?['policyRevision','expiresAt']:['transportHash'])]);
 if(!['sign','broadcast'].includes(value.action)||!hash(value.networkId)||value.nativeChainId!=='6423'||typeof value.account!=='string'||!/^0x[a-f0-9]{40}$/.test(value.account)||typeof value.operationId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(value.operationId)||value.origin!=='ynx-wallet:local-pq')fail('AUTH_TX_PERMISSION_BINDING');
 exact(value.transfer,['chainId','nativeChainId','from','to','amount','fee','nonce']);
 const transfer=Object.freeze(Object.fromEntries(['chainId','nativeChainId','from','to','amount','fee','nonce'].map(k=>[k,value.transfer[k]])));
 if(transfer.chainId!==value.networkId||transfer.nativeChainId!==value.nativeChainId||transfer.from!==value.account||transfer.fee!=='1')fail('AUTH_TX_PERMISSION_BINDING');
 // Correlation only: the sole signer signs full E, NOT this digest. For sign,
 // wire/hash does not exist yet. Broadcast independently binds saved original.
 const digest=createHash('sha256').update(encodePQNativeTransfer(transfer)).digest('hex');
 if(value.requestDigest!==digest)fail('AUTH_TX_PERMISSION_INTENT_MISMATCH');
 if(sign){if(typeof value.policyRevision!=='string'||! /^[1-9][0-9]*$/.test(value.policyRevision))fail('AUTH_TX_PERMISSION_POLICY');time(value.expiresAt);}
 else if(!transportHash(value.transportHash))fail('AUTH_TX_PERMISSION_TRANSPORT_HASH');
 return Object.freeze({action:value.action,networkId:value.networkId,nativeChainId:value.nativeChainId,account:value.account,operationId:value.operationId,origin:value.origin,transfer,requestDigest:value.requestDigest,...(sign?{policyRevision:value.policyRevision,expiresAt:value.expiresAt}:{transportHash:value.transportHash})});
}
// Typed sign and independently reviewed broadcast are additive to Transfer.
// Broadcast carries already-saved dual hashes; sign has no future hashes.
const u64=v=>typeof v==='string'&&/^[1-9][0-9]*$/.test(v)&&BigInt(v)<=18446744073709551615n;
function sameCanonicalData(actual,expected){
 if(expected===null||typeof expected!=='object')return actual===expected;
 if(!actual||typeof actual!=='object'||types.isProxy(actual)||Object.getPrototypeOf(actual)!==Object.getPrototypeOf(expected))return false;
 const a=Object.getOwnPropertyDescriptors(actual),e=Object.getOwnPropertyDescriptors(expected),keys=Reflect.ownKeys(e);
 return Reflect.ownKeys(a).length===keys.length&&keys.every(key=>Object.hasOwn(a,key)&&Object.hasOwn(a[key],'value')&&a[key].enumerable===e[key].enumerable&&sameCanonicalData(a[key].value,e[key].value));
}
function bindTypedRequest(value){
 const broadcast=Object.getOwnPropertyDescriptor(value,'action')?.value==='broadcast';
 exact(value,['action','purpose','memberCount','memberIndex','networkId','nativeChainId','account','operationId','origin','typedAction','requestDigest','policyRevision','pair','reviewExecutionHeight','executionHeight','expiresAt',...(broadcast?['transportHash','memberHash']:[])]);
 if(!['sign','broadcast'].includes(value.action)||value.purpose!=='TX-BATCH'||value.memberCount!==1||value.memberIndex!==0||!hash(value.networkId)||value.nativeChainId!=='6423'||typeof value.account!=='string'||!/^0x[a-f0-9]{40}$/.test(value.account)||typeof value.operationId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(value.operationId)||value.origin!=='ynx-wallet:local-pq')fail('AUTH_TX_PERMISSION_BINDING');
 exact(value.pair,['pkA','pkB']);
 if(typeof value.pair.pkA!=='string'||! /^[a-f0-9]{5184}$/.test(value.pair.pkA)||typeof value.pair.pkB!=='string'||! /^[a-f0-9]{128}$/.test(value.pair.pkB)||!u64(value.policyRevision)||!u64(value.reviewExecutionHeight)||!u64(value.executionHeight)||BigInt(value.reviewExecutionHeight)>BigInt(value.executionHeight))fail('AUTH_TX_PERMISSION_POLICY');
 time(value.expiresAt);
 if(broadcast&&(!transportHash(value.transportHash)||!transportHash(value.memberHash)))fail('AUTH_TX_PERMISSION_TRANSPORT_HASH');
 // The original SDK alone defines all sixteen payloads and fees. Normalize
 // then require the exact already-reviewed canonical data; no Transfer cast.
 const typedAction=normalizePQNativeAction(value.typedAction);
 if(!sameCanonicalData(value.typedAction,typedAction)||typedAction.chainId!==value.networkId||typedAction.nativeChainId!==value.nativeChainId||typedAction.owner!==value.account)fail('AUTH_TX_PERMISSION_BINDING');
 const digest=createHash('sha256').update(encodePQNativeAction(typedAction)).digest('hex');
 if(value.requestDigest!==digest)fail('AUTH_TX_PERMISSION_INTENT_MISMATCH');
 return Object.freeze({action:value.action,purpose:'TX-BATCH',memberCount:1,memberIndex:0,networkId:value.networkId,nativeChainId:value.nativeChainId,account:value.account,operationId:value.operationId,origin:value.origin,typedAction,requestDigest:digest,policyRevision:value.policyRevision,pair:Object.freeze({pkA:value.pair.pkA,pkB:value.pair.pkB}),reviewExecutionHeight:value.reviewExecutionHeight,executionHeight:value.executionHeight,expiresAt:value.expiresAt,...(broadcast?{transportHash:value.transportHash,memberHash:value.memberHash}:{})});
}
export class TransactionPermissionKernel {
 #request;#peer;#clock;#floor=0;#binding;#expires;#pending=new Set();#initialized=false;#checking=false;#busy=false;
 #phase='captured';#first;#hasFirst=false;#result;#retireSelected=false;#retireError;#retireFailed=false;#joining;#closing;#cleanupError;
 constructor(request,peer,clock=Date.now){
  this.#request=request;
  if(!peer||['readOriginal','assertCurrent','recheck','enterOriginal','completeOriginal','assertCompletedCurrent','retire','join','close'].some(k=>typeof peer[k]!=='function')||typeof clock!=='function')fail('AUTH_TX_PERMISSION_PEER_REQUIRED');
  this.#peer=peer;this.#clock=clock; // Adopt before any peer call or await.
 }
 #remember(error){if(!this.#hasFirst){this.#hasFirst=true;this.#first=error;}this.#phase='unknown';}
 #now(){const n=this.#clock();if(!Number.isSafeInteger(n)||n<this.#floor)fail('AUTH_TX_PERMISSION_CLOCK');this.#floor=n;return n;}
 #window(){if(!this.#binding||this.#now()>=this.#expires)fail('AUTH_TX_PERMISSION_EXPIRED');}
 #track(p){this.#pending.add(p);void p.then(()=>this.#pending.delete(p),()=>this.#pending.delete(p));return p;}
 #peerVoid(fn){if(fn()!==undefined)fail('AUTH_TX_PERMISSION_PEER_RESULT_INVALID');}
 async initialize(){
  if(this.#initialized)fail('AUTH_TX_PERMISSION_INITIALIZE_ONCE');this.#initialized=true;
  try{return await this.#track(Promise.resolve().then(async()=>{
   if(this.#phase!=='captured')fail('AUTH_TX_PERMISSION_RETIRED');this.#request=bindTransactionPermissionRequest(this.#request);const before=this.#now();
   const original=await this.#peer.readOriginal(this.#request);
   // This packet is authenticated ONLY by the original private peer producer,
   // not by its shape, these words, a policy DTO, TLS or a test callback.
   exact(original,['request','issuedAt','expiresAt']);const request=bindTransactionPermissionRequest(original.request);
   if(JSON.stringify(request)!==JSON.stringify(this.#request))fail('AUTH_TX_PERMISSION_ORIGINAL_CHANGED');
   const issued=time(original.issuedAt),expires=time(original.expiresAt);
   if(issued>before||expires<=issued||expires-issued>30000||before>=expires||((request.action==='sign'||request.typedAction)&&expires>time(request.expiresAt)))fail('AUTH_TX_PERMISSION_EXPIRED');
   this.#binding=Object.freeze({...request,issuedAt:original.issuedAt,expiresAt:original.expiresAt});this.#expires=expires;
   if(this.#phase!=='captured')fail('AUTH_TX_PERMISSION_RETIRED');this.#phase='ready';this.assertCurrent();return undefined;
  }));}catch(e){this.#remember(e);throw e;}
 }
 assertCurrent(){
  try{
   if(this.#busy)fail('AUTH_TX_PERMISSION_REENTRANT');
   if(!['ready','entered','completed'].includes(this.#phase))throw this.#hasFirst?this.#first:Error('AUTH_TX_PERMISSION_NOT_CURRENT');
   this.#window();const phase=this.#phase;this.#busy=true;
   try{this.#peerVoid(()=>this.#phase==='completed'?this.#peer.assertCompletedCurrent(this.#result):this.#peer.assertCurrent());}finally{this.#busy=false;}
   if(this.#phase!==phase)throw this.#hasFirst?this.#first:Error('AUTH_TX_PERMISSION_CHANGED_DURING_CURRENT');
   this.#window();return undefined;
  }catch(e){this.#remember(e);throw e;}
 }
 readOriginal(){this.assertCurrent();return this.#binding;}
 async recheck(){
  this.assertCurrent();if(this.#checking)fail('AUTH_TX_PERMISSION_RECHECK_PENDING');this.#checking=true;
  try{return await this.#track(Promise.resolve().then(async()=>{this.assertCurrent();if(await this.#peer.recheck()!==undefined)fail('AUTH_TX_PERMISSION_RECHECK_RESULT_INVALID');this.assertCurrent();return undefined;}));}
  catch(e){this.#remember(e);throw e;}finally{this.#checking=false;}
 }
 #enter(action){
  try{
   this.assertCurrent();if(this.#checking||this.#busy||this.#phase!=='ready'||this.#request.action!==action)fail('AUTH_TX_PERMISSION_ENTER_ONCE');
   this.#phase='entered';this.#busy=true;
   try{this.#peerVoid(()=>this.#peer.enterOriginal(action));}finally{this.#busy=false;}
   this.assertCurrent();return undefined;
  }catch(e){this.#remember(e);throw e;}
 }
 enterSign(){return this.#enter('sign');}
 enterBroadcast(){return this.#enter('broadcast');}
 complete(value){
  try{
   if(this.#busy||this.#phase!=='entered')fail('AUTH_TX_PERMISSION_COMPLETE_ONCE');
   exact(value,this.#request.typedAction?['outcome','transportHash','memberHash']:['outcome','transportHash']);if(!['returned','unknown'].includes(value.outcome)||!transportHash(value.transportHash)||(this.#request.typedAction&&!transportHash(value.memberHash))||(this.#request.action==='broadcast'&&(value.transportHash!==this.#request.transportHash||(this.#request.typedAction&&value.memberHash!==this.#request.memberHash))))fail('AUTH_TX_PERMISSION_RESULT_BINDING');
   this.#result=Object.freeze({...value}); // Retain BEFORE any foreign call.
   this.#phase='completed';this.#window();this.#busy=true;
   try{this.#peerVoid(()=>this.#peer.completeOriginal(this.#result));}finally{this.#busy=false;}
   this.assertCurrent();if(value.outcome==='unknown')fail('AUTH_TX_PERMISSION_EFFECT_UNKNOWN');return undefined;
  }catch(e){this.#remember(e);throw e;}
 }
 retire(){
  if(this.#retireSelected){if(this.#retireFailed)throw this.#retireError;return undefined;}
  this.#retireSelected=true;if(!this.#hasFirst)this.#phase='retired';
  try{this.#peerVoid(()=>this.#peer.retire());return undefined;}catch(e){this.#retireFailed=true;this.#retireError=e;this.#remember(e);throw e;}
 }
 join(){
  if(!this.#retireSelected)fail('AUTH_TX_PERMISSION_RETIRE_REQUIRED');
  if(!this.#joining){this.#joining=Promise.resolve().then(async()=>{await Promise.allSettled([...this.#pending]);if(this.#busy)fail('AUTH_TX_PERMISSION_JOIN_PENDING');if(await this.#peer.join()!==undefined)fail('AUTH_TX_PERMISSION_JOIN_UNKNOWN');return undefined;}).catch(e=>{this.#remember(e);throw e;});void this.#joining.catch(()=>{});}return this.#joining;
 }
 close(){
  if(this.#closing)return this.#closing;
  this.#closing=Promise.resolve().then(async()=>{
   let first,failed=false,joined=false;const attempt=async fn=>{try{if(await fn()!==undefined)fail('AUTH_TX_PERMISSION_CLOSE_UNKNOWN');}catch(e){if(!failed){first=e;failed=true;}}};
   await attempt(()=>this.retire());await attempt(async()=>{await this.join();joined=true;});if(joined)await attempt(()=>this.#peer.close());
   if(failed){this.#cleanupError=first;this.#remember(first);throw first;}this.#phase=this.#hasFirst?'unknown':'closed';return undefined;
  });void this.#closing.catch(()=>{});return this.#closing;
 }
 outcome(){return Object.freeze({binding:this.#binding??null,result:this.#result??null,phase:this.#phase,firstCausePresent:this.#hasFirst,firstCause:this.#first,cleanupCause:this.#cleanupError,permissionFactoryBranded:false,effectRetryAuthorized:false});}
}
