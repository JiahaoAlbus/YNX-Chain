import {parsePQAccountAuthorization,inspectPQAuthorizationView,pqRegisteredPublicBinding,assertPQAuthorizationCurrent} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {assertPQPublicBindingMatches} from '@ynx-chain/wallet-auth/pq-wallet-contract';
import {CANONICAL_NETWORK_ID,NORMAL_OPERATOR,openNormalOperatorSource} from './operator-query.mjs';
const originals=new WeakSet();
const fail=code=>{throw Object.assign(new Error(code),{code});};
const exact=(v,keys)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype)fail('AUTH_REGISTERED_BINDING_SCHEMA');const d=Object.getOwnPropertyDescriptors(v),k=Reflect.ownKeys(d);if(k.length!==keys.length||k.some(x=>typeof x!=='string'||!keys.includes(x)||!Object.hasOwn(d[x],'value')||!d[x].enumerable))fail('AUTH_REGISTERED_BINDING_SCHEMA');};
const time=v=>{if(typeof v!=='string'||!Number.isFinite(Date.parse(v))||new Date(Date.parse(v)).toISOString()!==v)fail('AUTH_REGISTERED_BINDING_TIME');return Date.parse(v);};
const hex=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const height=v=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(v)||BigInt(v)>18446744073709551615n)fail('AUTH_REGISTERED_BINDING_HEIGHT');return BigInt(v);};
function request(v){exact(v,['networkId','nativeChainId','owner','operation','at']);if(v.networkId!==CANONICAL_NETWORK_ID||v.nativeChainId!=='6423'||typeof v.owner!=='string'||!/^0x[0-9a-f]{40}$/.test(v.owner)||v.operation!=='read-registered-binding')fail('AUTH_REGISTERED_BINDING_REQUEST');time(v.at);return Object.freeze({...v});}
function packet(raw,expected,now){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>NORMAL_OPERATOR.maxBytes)fail('AUTH_REGISTERED_BINDING_BYTES');let v;try{v=JSON.parse(raw);}catch{fail('AUTH_REGISTERED_BINDING_BYTES');}
 exact(v,['version','networkId','nativeChainId','canonicalOwner','authorization','committedHeight','committedBlockHash','checkpointIntegrity','observedAt','expiresAt']);
 if(v.version!=='YNX-WALLET-REGISTERED-BINDING/v1'||v.networkId!==expected.networkId||v.nativeChainId!==expected.nativeChainId||v.canonicalOwner!==expected.owner||!hex(v.committedBlockHash)||!hex(v.checkpointIntegrity))fail('AUTH_REGISTERED_BINDING_MISMATCH');
 const observed=time(v.observedAt),expires=time(v.expiresAt);
 if(observed<time(expected.at)||observed>now||expires<=observed||expires-observed>NORMAL_OPERATOR.lifetimeMs||now>=expires)fail('AUTH_REGISTERED_BINDING_EXPIRED');
 const authorization=parsePQAccountAuthorization(v.authorization,{chainId:v.networkId,nativeChainId:v.nativeChainId,owner:v.canonicalOwner});
 const committedHeight=height(v.committedHeight),nextHeight=height(authorization.executionHeight);
 if(nextHeight!==(committedHeight===18446744073709551615n?committedHeight:committedHeight+1n))fail('AUTH_REGISTERED_BINDING_HEIGHT');
 const committed=inspectPQAuthorizationView(authorization,v.committedHeight),next=inspectPQAuthorizationView(authorization);
 if(!committed.activeRecord)fail('AUTH_REGISTERED_BINDING_NOT_COMMITTED');
 if(!authorization.enabled||committed.authorizationStatus!=='active'||next.authorizationStatus!=='active'||committed.pqSigningEnabled!==true||next.pqSigningEnabled!==true||!next.activeRecord||next.activeRecord.revision!==committed.activeRecord.revision)fail('AUTH_REGISTERED_BINDING_NOT_CURRENT');
 // Sole SDK selects/encodes full keys. Neither a backup, renderer revision,
 // pending future registration nor this supplier chooses expected key bytes.
 const publicBinding=pqRegisteredPublicBinding(authorization,committed.activeRecord.revision);
 return Object.freeze({version:v.version,publicBinding,authorization,
  registration:Object.freeze({...committed.activeRecord}),
  checkpoint:Object.freeze({kind:'trusted-node-committed/v1',height:v.committedHeight,blockHash:v.committedBlockHash,integrity:v.checkpointIntegrity}),
  committedView:committed,nextView:next,observedAt:v.observedAt,expiresAt:v.expiresAt,
  dataOnly:true,restorationAuthorized:false,adoptionAuthorized:false,signingAuthorized:false,transactionAuthorized:false,retryAuthorized:false});
}
// PUBLIC test kernel has no original brand. Only the fixed normal factory
// below selects the original authenticated read-only operator resource.
export class RegisteredBindingResourceKernel{
 #request;#source;#clock;#floor=0;#entered=false;#original;#raw;#refresh;#deadline=0;#retired=false;#checking=false;#pending=new Set();#first;#hasFirst=false;#unknown=false;#retireSelected=false;#retireError;#retireFailed=false;#joining;#closing;#cleanupCause;#cleanupFailed=false;
 constructor(req,source,clock=Date.now){this.#request=request(req);if(!source||['readOriginal','recheck','retire','join','close'].some(k=>typeof source[k]!=='function')||typeof clock!=='function')fail('AUTH_REGISTERED_BINDING_SOURCE');this.#source=source;this.#clock=clock;}
 #now(){const t=this.#clock();if(!Number.isSafeInteger(t)||t<this.#floor)fail('AUTH_REGISTERED_BINDING_CLOCK');this.#floor=t;return t;}
 #remember(e){if(!this.#hasFirst){this.#first=e;this.#hasFirst=true;}this.#unknown=true;this.#retired=true;}
 #track(p){this.#pending.add(p);void p.then(()=>this.#pending.delete(p),()=>this.#pending.delete(p));return p;}
 async initialize(){if(this.#entered)fail('AUTH_REGISTERED_BINDING_ALREADY_ENTERED');this.#entered=true;
  const p=Promise.resolve().then(async()=>{if(this.#retired)fail('AUTH_REGISTERED_BINDING_RETIRED');this.#now();const raw=await this.#source.readOriginal(this.#request);if(typeof raw==='string'&&Buffer.byteLength(raw)<=NORMAL_OPERATOR.maxBytes)this.#raw=raw;if(this.#retired)fail('AUTH_REGISTERED_BINDING_RETIRED');this.#original=packet(raw,this.#request,this.#now());this.#deadline=time(this.#original.expiresAt);this.assertCurrent();});
  try{return await this.#track(p);}catch(e){this.#remember(e);throw e;}
 }
 assertCurrent(){try{if(this.#retired){if(this.#hasFirst)throw this.#first;fail('AUTH_REGISTERED_BINDING_RETIRED');}if(!this.#original||this.#now()>=this.#deadline)fail('AUTH_REGISTERED_BINDING_EXPIRED');return undefined;}catch(e){this.#remember(e);throw e;}}
 readOriginal(){this.assertCurrent();return this.#original;}
 async recheck(){this.assertCurrent();if(this.#checking)fail('AUTH_REGISTERED_BINDING_RECHECK_PENDING');this.#checking=true;
  const p=Promise.resolve().then(async()=>{this.assertCurrent();const raw=await this.#source.recheck(this.#request,this.#original);if(typeof raw==='string'&&Buffer.byteLength(raw)<=NORMAL_OPERATOR.maxBytes)this.#refresh=raw;this.assertCurrent();const fresh=packet(raw,this.#request,this.#now());
   assertPQAuthorizationCurrent(this.#original.authorization,fresh.authorization);assertPQPublicBindingMatches(fresh.publicBinding,this.#original.publicBinding);
   if(height(fresh.checkpoint.height)<height(this.#original.checkpoint.height)||(fresh.checkpoint.height===this.#original.checkpoint.height&&fresh.checkpoint.blockHash!==this.#original.checkpoint.blockHash)||time(fresh.observedAt)<time(this.#original.observedAt)||time(fresh.expiresAt)>this.#deadline)fail('AUTH_REGISTERED_BINDING_CHANGED');
   this.#deadline=Math.min(this.#deadline,time(fresh.expiresAt));this.assertCurrent();return undefined;
  });try{return await this.#track(p);}catch(e){this.#remember(e);throw e;}finally{this.#checking=false;}
 }
 retire(){this.#retired=true;if(this.#retireSelected){if(this.#retireFailed)throw this.#retireError;return undefined;}this.#retireSelected=true;try{if(this.#source.retire()!==undefined)fail('AUTH_REGISTERED_BINDING_RETIRE_UNKNOWN');}catch(e){this.#retireFailed=true;this.#retireError=e;this.#remember(e);throw e;}}
 join(){if(!this.#retired)fail('AUTH_REGISTERED_BINDING_RETIRE_REQUIRED');if(!this.#joining){this.#joining=Promise.resolve().then(async()=>{await Promise.allSettled([...this.#pending]);if(await this.#source.join()!==undefined)fail('AUTH_REGISTERED_BINDING_JOIN_UNKNOWN');}).catch(e=>{this.#remember(e);throw e;});void this.#joining.catch(()=>{});}return this.#joining;}
 close(){if(this.#closing)return this.#closing;this.#retired=true;this.#closing=Promise.resolve().then(async()=>{let failed=false,cause,joined=false;const attempt=async f=>{try{if(await f()!==undefined)fail('AUTH_REGISTERED_BINDING_CLEANUP_UNKNOWN');}catch(e){if(!failed){failed=true;cause=e;}}};await attempt(()=>this.retire());await attempt(async()=>{await this.join();joined=true;});if(joined)await attempt(()=>this.#source.close());if(failed){this.#cleanupCause=cause;this.#cleanupFailed=true;this.#remember(cause);throw cause;}return undefined;});void this.#closing.catch(()=>{});return this.#closing;}
 outcome(){return Object.freeze({original:this.#original??null,capturedRaw:this.#raw??null,lastRecheckRaw:this.#refresh??null,unknown:this.#unknown,firstCausePresent:this.#hasFirst,firstCause:this.#first,cleanupFailed:this.#cleanupFailed,cleanupCause:this.#cleanupCause});}
}
export const isOriginalWalletRegisteredBinding=value=>originals.has(value);
export async function acquireOriginalWalletRegisteredBinding(req){
 const selected=request(req),resource=new RegisteredBindingResourceKernel(selected,openNormalOperatorSource('registered-binding'));
 try{await resource.initialize();resource.assertCurrent();originals.add(resource);return resource;}
 catch(cause){const error=Object.assign(new Error('AUTH_WALLET_REGISTERED_BINDING_NOT_SUPPLIED',{cause}),{code:'AUTH_WALLET_REGISTERED_BINDING_NOT_SUPPLIED'});Object.defineProperty(error,'partial',{value:resource});throw error;}
}
