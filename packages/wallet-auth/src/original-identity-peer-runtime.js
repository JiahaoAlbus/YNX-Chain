// PRIVATE normal runtime lifecycle. This kernel does not recognize arbitrary
// objects as Native admission. Fixed SDK factory+actual NAPI type-tag owner
// must supply peer/request owners; tests explicitly use PUBLIC seams.
import {canonicalJSON} from './canonical.js';
import {parseOriginalAuthIdentityRequest,AUTH_IDENTITY_PURPOSES} from '../native/original-auth-identity-v2-contract.mjs';
const purposes=Object.freeze({receive:AUTH_IDENTITY_PURPOSES.receive,recover:AUTH_IDENTITY_PURPOSES.recover,keyCall:AUTH_IDENTITY_PURPOSES.keyCall});
const fail=code=>{throw Object.assign(new Error(code),{code});};
const exact=(value,keys)=>{
 if(!value||Object.getPrototypeOf(value)!==Object.prototype)fail('AUTH_IDENTITY_PEER_SCHEMA');
 const descriptors=Object.getOwnPropertyDescriptors(value),own=Reflect.ownKeys(descriptors);
 if(own.length!==keys.length||own.some(k=>!keys.includes(k)||!Object.hasOwn(descriptors[k],'value')||!descriptors[k].enumerable))fail('AUTH_IDENTITY_PEER_SCHEMA');
};
const text=(v,cap)=>typeof v==='string'&&v.length>0&&new TextEncoder().encode(v).length<=cap&&!v.includes('\0');
const voidResult=value=>{if(value!==undefined)fail('AUTH_IDENTITY_PEER_NATIVE_RESULT');};
function original(original,purpose){
 if(!text(original,16384))fail('AUTH_IDENTITY_PEER_REQUEST_BOUND');const body=parseOriginalAuthIdentityRequest(original);
 if(body.purpose!==purpose)fail('AUTH_IDENTITY_PEER_PURPOSE');return body;
}
function wire(value){
 if(!(value instanceof Uint8Array)||!(value.buffer instanceof ArrayBuffer)||value.buffer.resizable||value.byteLength<1||value.byteLength>262144)fail('AUTH_IDENTITY_PEER_PROOF_BOUND');
 // Detached and SharedArrayBuffer are rejected before selection.
 try{return new Uint8Array(value);}catch{fail('AUTH_IDENTITY_PEER_PROOF_BOUND');}
}
export class OriginalIdentityPeerCall {
 #call;#peer;#kind;#request;#ready=false;#first;#hasFirst=false;#retired=false;#started=false;#selected=false;#settled=false;#inflight=new Set();#closing;#cleanup;#result;#proof;
 constructor(call,peer){this.#call=call;this.#peer=peer;}
 #remember(e){if(!this.#hasFirst){this.#hasFirst=true;this.#first=e;}return this.#first;}
 #live(){if(this.#retired||this.#hasFirst)throw this.#hasFirst?this.#first:Error('AUTH_IDENTITY_PEER_RETIRED');}
 async #current(){this.#live();voidResult(await this.#call.current());this.#live();voidResult(await this.#peer.current());this.#live();}
 #track(p){this.#inflight.add(p);void p.then(()=>this.#inflight.delete(p),()=>this.#inflight.delete(p));return p;}
 begin(kind,invocationOriginal){
  if(this.#started)fail('AUTH_IDENTITY_PEER_BEGIN_ONCE');
  if(!Object.hasOwn(purposes,kind)||(kind==='keyCall'?!text(invocationOriginal,16384):invocationOriginal!==undefined))fail('AUTH_IDENTITY_PEER_OPERATION');
  this.#started=true;this.#kind=kind;
  return this.#track(Promise.resolve().then(async()=>{
   this.#live();voidResult(await this.#call.begin(kind,invocationOriginal));this.#live();
   const request=await this.#call.request();this.#live();
   exact(request,['original','message','dataOnly','authorized']);if(request.dataOnly!==true||request.authorized!==false)fail('AUTH_IDENTITY_PEER_REQUEST_RESULT');
   const body=original(request.original,purposes[kind]);
   this.#request=body;
   // Native channel independently retains this SAME R91 expected request and
   // actual invocation; no renderer Root/clock/expected selector is passed.
   await this.#current();voidResult(await this.#peer.sendRequest(kind,request.original,invocationOriginal));await this.#current();this.#ready=true;
   return Object.freeze({requestId:body.requestId,purpose:body.purpose,expiresAtMs:body.expiresAtMs,dataOnly:true,authorized:false});
  }).catch(e=>{throw this.#remember(e);}));
 }
 waitForReturn(){
  if(!this.#ready||this.#selected||this.#settled)fail('AUTH_IDENTITY_PEER_RETURN_ONCE');this.#selected=true;
  return this.#track(Promise.resolve().then(async()=>{
   await this.#current();const response=await this.#peer.receiveReturn();
   // Capture returned proof/result before cancellation or late-current errors.
   exact(response,['decision','requestId','purpose','proof']);
   if(response.decision==='approve')this.#proof=wire(response.proof);
   await this.#current();
   const body=this.#request;
   if(response.requestId!==body.requestId||response.purpose!==body.purpose)fail('AUTH_IDENTITY_PEER_CORRELATION');
   if(response.decision==='reject'){if(response.proof!==null)fail('AUTH_IDENTITY_PEER_REJECT_SCHEMA');fail('AUTH_IDENTITY_PEER_USER_REJECTED');}
   if(response.decision!=='approve')fail('AUTH_IDENTITY_PEER_DECISION');
   await this.#current();voidResult(await this.#call.completeProof(this.#proof));
   await this.#current();this.#result=this.#kind==='keyCall'?await this.#call.invoke():await this.#call.result();
   await this.#current();this.#settled=true;return this.#result;
  }).catch(e=>{throw this.#remember(e);}));
 }
 retire(){
  if(this.#retired)return;this.#retired=true;
  let failed=false,first;for(const owner of [this.#peer,this.#call])try{voidResult(owner.retire());}catch(e){if(!failed){failed=true;first=e;}}
  if(failed){this.#remember(first);throw first;}
 }
 close(){
  if(this.#closing)return this.#closing;
  this.#closing=Promise.resolve().then(async()=>{
   let failed=false,first;const attempt=async action=>{try{voidResult(await action());return true;}catch(e){if(!failed){failed=true;first=e;}return false;}};
   await attempt(()=>this.retire());await Promise.allSettled([...this.#inflight]);
   // Join EACH owner before closing it, even when another failed to join.
   for(const owner of [this.#peer,this.#call])if(await attempt(()=>owner.join()))await attempt(()=>owner.close());
   if(failed){this.#cleanup=first;this.#remember(first);throw first;}return undefined;
  });void this.#closing.catch(()=>{});return this.#closing;
 }
 outcome(){return Object.freeze({kind:this.#kind??null,started:this.#started,proofSelected:this.#selected,settled:this.#settled,retired:this.#retired,proof:this.#proof?new Uint8Array(this.#proof):null,result:this.#result,firstCausePresent:this.#hasFirst,firstCause:this.#first,cleanupCause:this.#cleanup,dataOnly:true,nativeAdmission:false,effectRetryAuthorized:false});}
}
// No production factory is exposed by this kernel. Native normal-peer factory
// comes only through the original SDK fixed module/compiled method registry.
export function parseOriginalIdentityPeerFrameData(raw){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>524288)fail('AUTH_IDENTITY_PEER_FRAME_BOUND');let v;try{v=JSON.parse(raw);}catch{fail('AUTH_IDENTITY_PEER_SCHEMA');}
 if(canonicalJSON(v)!==raw)fail('AUTH_IDENTITY_PEER_CANONICAL');
 exact(v,['version','kind','peerNonce','requestId','purpose','requestOriginalSha256','payload']);
 if(v.version!=='YNX-IDE-IDENTITY-PEER/v1'||!['request','proof','reject','cancel','current','result','failure','close'].includes(v.kind)||!text(v.peerNonce,64)||!/^[A-Za-z0-9_-]{43}$/.test(v.peerNonce)||!text(v.requestId,128)||!Object.values(purposes).includes(v.purpose)||typeof v.requestOriginalSha256!=='string'||!/^[a-f0-9]{64}$/.test(v.requestOriginalSha256))fail('AUTH_IDENTITY_PEER_SCHEMA');
 return Object.freeze({...v,dataOnly:true,nativeAdmission:false});
}
