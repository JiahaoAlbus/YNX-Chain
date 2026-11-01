import {parsePQAccountAuthorization,assertPQAuthorizationCurrent} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {CANONICAL_NETWORK_ID,openNormalOperatorSource} from './operator-query.mjs';
const supplied=new WeakSet(),fail=code=>{throw Object.assign(new Error(code),{code});};
const exact=(v,keys)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('AUTH_TX_POLICY_SCHEMA');};
const time=v=>{if(typeof v!=='string'||!Number.isFinite(Date.parse(v))||new Date(Date.parse(v)).toISOString()!==v)fail('AUTH_TX_POLICY_TIME');return Date.parse(v);};
const req=v=>{exact(v,['networkId','nativeChainId','owner','operation','at']);if(v.networkId!==CANONICAL_NETWORK_ID||v.nativeChainId!=='6423'||typeof v.owner!=='string'||!/^0x[0-9a-f]{40}$/.test(v.owner)||!['transfer','migration'].includes(v.operation))fail('AUTH_TX_POLICY_BINDING');time(v.at);return Object.freeze({...v});};
function packet(raw,expected,now){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>8*1024*1024)fail('AUTH_TX_POLICY_BYTES');let v;try{v=JSON.parse(raw);}catch{fail('AUTH_TX_POLICY_BYTES');}
 exact(v,['version','networkId','nativeChainId','canonicalOwner','authorization','observedAt','expiresAt']);
 if(v.version!=='YNX-WALLET-TRANSACTION-POLICY/v1'||v.networkId!==expected.networkId||v.nativeChainId!==expected.nativeChainId||v.canonicalOwner!==expected.owner)fail('AUTH_TX_POLICY_BINDING');
 if(time(v.observedAt)<time(expected.at)||time(v.observedAt)>now||time(v.expiresAt)<=time(v.observedAt)||now>=time(v.expiresAt))fail('AUTH_TX_POLICY_EXPIRED');
 const authorization=parsePQAccountAuthorization(v.authorization,{chainId:v.networkId,nativeChainId:v.nativeChainId,owner:v.canonicalOwner});
 return Object.freeze({version:v.version,networkId:v.networkId,nativeChainId:v.nativeChainId,canonicalOwner:v.canonicalOwner,authorization,observedAt:v.observedAt,expiresAt:v.expiresAt});
}
// PUBLIC test kernel isn't a normal original. Only the fixed factory below
// brands successfully captured resources. No signer or planner is implemented.
export class TransactionPolicyResourceKernel{
 #request;#source;#clock;#floor=0;#original;#raw;#refreshRaw;#deadline;#entered=false;#checking=false;#pending=new Set();#retired=false;#unknown=false;#first;#hasFirst=false;#retireSelected=false;#retireFailed=false;#retireCause;#joining;#closing;#cleanup;#cleanupFailed=false;
 constructor(request,source,clock=Date.now){this.#request=req(request);if(!source||['readOriginal','recheck','retire','join','close'].some(k=>typeof source[k]!=='function')||typeof clock!=='function')fail('AUTH_TX_POLICY_SOURCE');this.#source=source;this.#clock=clock;}
 #now(){const n=this.#clock();if(!Number.isSafeInteger(n)||n<this.#floor)fail('AUTH_TX_POLICY_CLOCK');this.#floor=n;return n;}
 #remember(e){if(!this.#hasFirst){this.#hasFirst=true;this.#first=e;}this.#unknown=true;this.#retired=true;}
 #track(p){this.#pending.add(p);void p.then(()=>this.#pending.delete(p),()=>this.#pending.delete(p));return p;}
 async initialize(){
  if(this.#entered)fail('AUTH_TX_POLICY_ALREADY_ENTERED');this.#entered=true;const p=Promise.resolve().then(async()=>{
   if(this.#retired)fail('AUTH_TX_POLICY_RETIRED');this.#now();const raw=await this.#source.readOriginal(this.#request);if(typeof raw==='string'&&Buffer.byteLength(raw)<=8*1024*1024)this.#raw=raw;
   this.#original=packet(raw,this.#request,this.#now());this.#deadline=time(this.#original.expiresAt);this.assertCurrent();return undefined;
  });try{return await this.#track(p);}catch(e){this.#remember(e);throw e;}
 }
 assertCurrent(){try{if(this.#retired)throw this.#hasFirst?this.#first:Error('AUTH_TX_POLICY_RETIRED');if(!this.#original||this.#now()>=this.#deadline)fail('AUTH_TX_POLICY_EXPIRED');return undefined;}catch(e){this.#remember(e);throw e;}}
 readOriginal(){this.assertCurrent();return this.#original;}
 async recheck(){
  this.assertCurrent();if(this.#checking)fail('AUTH_TX_POLICY_RECHECK_PENDING');this.#checking=true;const p=Promise.resolve().then(async()=>{
   this.assertCurrent();const raw=await this.#source.recheck(this.#request,this.#original);if(typeof raw==='string'&&Buffer.byteLength(raw)<=8*1024*1024)this.#refreshRaw=raw;this.assertCurrent();
   const fresh=packet(raw,this.#request,this.#now());assertPQAuthorizationCurrent(this.#original.authorization,fresh.authorization);
   if(time(fresh.observedAt)<time(this.#original.observedAt)||time(fresh.expiresAt)>this.#deadline)fail('AUTH_TX_POLICY_CHANGED');this.#deadline=Math.min(this.#deadline,time(fresh.expiresAt));this.assertCurrent();return undefined;
  });try{return await this.#track(p);}catch(e){this.#remember(e);throw e;}finally{this.#checking=false;}
 }
 retire(){this.#retired=true;if(this.#retireSelected){if(this.#retireFailed)throw this.#retireCause;return undefined;}this.#retireSelected=true;try{if(this.#source.retire()!==undefined)fail('AUTH_TX_POLICY_RETIRE_UNKNOWN');return undefined;}catch(e){this.#retireFailed=true;this.#retireCause=e;this.#remember(e);throw e;}}
 join(){if(!this.#retired)fail('AUTH_TX_POLICY_RETIRE_REQUIRED');if(!this.#joining){this.#joining=Promise.resolve().then(async()=>{await Promise.allSettled([...this.#pending]);if(await this.#source.join()!==undefined)fail('AUTH_TX_POLICY_JOIN_UNKNOWN');}).catch(e=>{this.#remember(e);throw e;});void this.#joining.catch(()=>{});}return this.#joining;}
 close(){if(this.#closing)return this.#closing;this.#retired=true;this.#closing=Promise.resolve().then(async()=>{
  let failed=false,first,joined=false;const attempt=async fn=>{try{if(await fn()!==undefined)fail('AUTH_TX_POLICY_CLEANUP_UNKNOWN');}catch(e){if(!failed){failed=true;first=e;}}};
  await attempt(()=>this.retire());await attempt(async()=>{await this.join();joined=true;});if(joined)await attempt(()=>this.#source.close());if(failed){this.#cleanup=first;this.#cleanupFailed=true;this.#remember(first);throw first;}return undefined;
 });void this.#closing.catch(()=>{});return this.#closing;}
 outcome(){return Object.freeze({original:this.#original??null,capturedRaw:this.#raw??null,lastRecheckRaw:this.#refreshRaw??null,unknown:this.#unknown,firstCausePresent:this.#hasFirst,firstCause:this.#first,cleanupFailed:this.#cleanupFailed,cleanupCause:this.#cleanup});}
}
export function isOriginalWalletTransactionPolicy(value){return supplied.has(value);}
export async function acquireOriginalWalletTransactionPolicy(request){
 const selected=req(request),resource=new TransactionPolicyResourceKernel(selected,openNormalOperatorSource('transaction'));
 try{await resource.initialize();resource.assertCurrent();supplied.add(resource);return resource;}
 catch(cause){const error=Object.assign(new Error('AUTH_WALLET_TRANSACTION_POLICY_NOT_SUPPLIED',{cause}),{code:'AUTH_WALLET_TRANSACTION_POLICY_NOT_SUPPLIED'});Object.defineProperty(error,'partial',{value:resource});throw error;}
}
