// Auth-owned lifecycle CODE for the SDK's canonical account-policy port.
// NOT a second Session engine and NOT authority from caller metadata.
// Test kernels are deliberately never branded as normal supplied resources.
const supplied=new WeakSet();
const fail=code=>{throw Object.assign(new Error(code),{code});};
const exact=(v,keys)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail('AUTH_ACCOUNT_POLICY_SCHEMA');};
const u64=v=>{if(typeof v!=='string'||! /^(0|[1-9][0-9]{0,19})$/.test(v)||BigInt(v)>((1n<<64n)-1n))fail('AUTH_ACCOUNT_POLICY_U64');return BigInt(v);};
const hex=(v,n)=>typeof v==='string'&&new RegExp('^[0-9a-f]{'+n+'}$').test(v);
const instant=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(Date.parse(v)).toISOString()!==v)fail('AUTH_ACCOUNT_POLICY_TIME');return Date.parse(v);};
const frozen=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))frozen(x);Object.freeze(v);}return v;};
function requestCopy(v){
 exact(v,['networkId','owner','operation','at']);
 if(!hex(v.networkId,64)||typeof v.owner!=='string'||!/^0x[0-9a-f]{40}$/.test(v.owner)||!['approval','challenge','completion','introspection','revalidation'].includes(v.operation))fail('AUTH_ACCOUNT_POLICY_REQUEST');instant(v.at);return frozen({...v});
}
function copyOriginal(value,request,now){
 // A returned data object never establishes provenance. This check is only the
 // boundary after the SAME normal source's verified committed read/recheck.
 // Serialize no arbitrary objects: copy only JSON from that source port.
 if(typeof value!=='string'||Buffer.byteLength(value)>16384)fail('AUTH_ACCOUNT_POLICY_ORIGINAL_BYTES');
 let v;try{v=JSON.parse(value);}catch{fail('AUTH_ACCOUNT_POLICY_ORIGINAL_BYTES');}
 exact(v,['version','networkId','canonicalOwner','checkpoint','policyVersion','algorithmVersion','activeRecord','observedAt','expiresAt']);
 if(v.version!=='YNX-PRODUCT-SESSION-ACCOUNT-POLICY/v1'||v.networkId!==request.networkId||v.canonicalOwner!==request.owner)fail('AUTH_ACCOUNT_POLICY_BINDING');
 exact(v.checkpoint,['kind','height','blockHash']);
 if(v.checkpoint.kind!=='trusted-node-committed/v1'||!hex(v.checkpoint.blockHash,64))fail('AUTH_ACCOUNT_POLICY_CHECKPOINT');const height=u64(v.checkpoint.height);
 if(![null,'YNX-ACCOUNT-POLICY/v1'].includes(v.policyVersion)||!['legacy','YNX-BATCH/v0.1'].includes(v.algorithmVersion))fail('AUTH_ACCOUNT_POLICY_VERSION');
 if(v.algorithmVersion==='legacy'){if(v.activeRecord!==null)fail('AUTH_ACCOUNT_POLICY_ACTIVE_RECORD');}
 else{
  if(v.policyVersion!=='YNX-ACCOUNT-POLICY/v1')fail('AUTH_ACCOUNT_POLICY_VERSION');
  const a=v.activeRecord;exact(a,['revision','registeredAt','activeFrom','pkA','pkB']);
  if(!u64(a.revision)||u64(a.registeredAt)>=u64(a.activeFrom)||u64(a.activeFrom)>height||!hex(a.pkA,5184)||!hex(a.pkB,128))fail('AUTH_ACCOUNT_POLICY_ACTIVE_RECORD');
 }
 const observed=instant(v.observedAt),expiry=instant(v.expiresAt);
 if(observed>now||observed<instant(request.at)||expiry<=observed||now>=expiry)fail('AUTH_ACCOUNT_POLICY_EXPIRED');
 const record=v.activeRecord;
 return frozen({version:v.version,networkId:v.networkId,canonicalOwner:v.canonicalOwner,checkpoint:{kind:v.checkpoint.kind,height:v.checkpoint.height,blockHash:v.checkpoint.blockHash},policyVersion:v.policyVersion,algorithmVersion:v.algorithmVersion,activeRecord:record===null?null:{revision:record.revision,registeredAt:record.registeredAt,activeFrom:record.activeFrom,pkA:record.pkA,pkB:record.pkB},observedAt:v.observedAt,expiresAt:v.expiresAt});
}
const sameBinding=(a,b)=>a.version===b.version&&a.networkId===b.networkId&&a.canonicalOwner===b.canonicalOwner&&a.policyVersion===b.policyVersion&&a.algorithmVersion===b.algorithmVersion&&JSON.stringify(a.checkpoint)===JSON.stringify(b.checkpoint)&&JSON.stringify(a.activeRecord)===JSON.stringify(b.activeRecord);

export class AccountPolicyResourceKernel{
 #request;#source;#clock;#floor=0;#original;#capturedRaw;#lastRecheckRaw;#deadline;#entered=false;#checking=false;#pending=new Set();#retired=false;#retireSelected=false;#retireFailed=false;#retireCause;#unknown=false;#first;#hasFirst=false;#joining;#closing;#cleanup;#cleanupFailed=false;
 constructor(request,source,clock=Date.now){
  this.#request=requestCopy(request);
  if(!source||['readOriginal','recheck','retire','join','close'].some(k=>typeof source[k]!=='function')||typeof clock!=='function')fail('AUTH_ACCOUNT_POLICY_SOURCE_REQUIRED');
  this.#source=source;this.#clock=clock;
 }
 #now(){const n=this.#clock();if(!Number.isSafeInteger(n)||n<this.#floor)fail('AUTH_ACCOUNT_POLICY_CLOCK');this.#floor=n;return n;}
 #remember(cause){if(!this.#hasFirst){this.#hasFirst=true;this.#first=cause;}this.#unknown=true;this.#retired=true;}
 #track(p){this.#pending.add(p);void p.then(()=>this.#pending.delete(p),()=>this.#pending.delete(p));return p;}
 async initialize(){
  if(this.#entered)fail('AUTH_ACCOUNT_POLICY_ALREADY_ENTERED');this.#entered=true;
  const p=Promise.resolve().then(async()=>{
   if(this.#retired)fail('AUTH_ACCOUNT_POLICY_RETIRED');this.#now();
   const raw=await this.#source.readOriginal(this.#request);
   // Preserve the exact original before a post-await fence can fail.
   if(typeof raw==='string'&&Buffer.byteLength(raw)<=16384)this.#capturedRaw=raw;
   this.#original=copyOriginal(raw,this.#request,this.#now());this.#deadline=instant(this.#original.expiresAt);
   this.assertCurrent();return undefined;
  });
  try{return await this.#track(p);}catch(cause){this.#remember(cause);throw cause;}
 }
 assertCurrent(){
  try{if(this.#retired)throw this.#hasFirst?this.#first:Error('AUTH_ACCOUNT_POLICY_RETIRED');if(!this.#original||this.#now()>=this.#deadline)fail('AUTH_ACCOUNT_POLICY_EXPIRED');return undefined;}
  catch(cause){this.#remember(cause);throw cause;}
 }
 readOriginal(){this.assertCurrent();return this.#original;}
 async recheck(){
  this.assertCurrent();if(this.#checking)fail('AUTH_ACCOUNT_POLICY_RECHECK_PENDING');this.#checking=true;const p=Promise.resolve().then(async()=>{
   this.assertCurrent();const raw=await this.#source.recheck(this.#request,this.#original);
   if(typeof raw==='string'&&Buffer.byteLength(raw)<=16384)this.#lastRecheckRaw=raw;
   this.assertCurrent();const refreshed=copyOriginal(raw,this.#request,this.#now());
   if(!sameBinding(this.#original,refreshed)||instant(refreshed.observedAt)<instant(this.#original.observedAt)||instant(refreshed.expiresAt)>this.#deadline)fail('AUTH_ACCOUNT_POLICY_CHANGED');
   // Do not replace the original or extend its deadline. An earlier source
   // expiry tightens the local fence without mutating the immutable original.
   this.#deadline=Math.min(this.#deadline,instant(refreshed.expiresAt));this.assertCurrent();return undefined;
  });
  try{return await this.#track(p);}catch(cause){this.#remember(cause);throw cause;}finally{this.#checking=false;}
 }
 retire(){
  this.#retired=true;if(this.#retireSelected){if(this.#retireFailed)throw this.#retireCause;return undefined;}this.#retireSelected=true;
  try{if(this.#source.retire()!==undefined)fail('AUTH_ACCOUNT_POLICY_RETIRE_UNKNOWN');return undefined;}catch(cause){this.#retireFailed=true;this.#retireCause=cause;this.#remember(cause);throw cause;}
 }
 join(){
  if(!this.#retired)fail('AUTH_ACCOUNT_POLICY_RETIRE_REQUIRED');
  if(!this.#joining){this.#joining=Promise.resolve().then(async()=>{await Promise.allSettled([...this.#pending]);const result=await this.#source.join();if(result!==undefined)fail('AUTH_ACCOUNT_POLICY_JOIN_UNKNOWN');}).catch(cause=>{this.#remember(cause);throw cause;});void this.#joining.catch(()=>{});}
  return this.#joining;
 }
 close(){
  if(this.#closing)return this.#closing;
  this.#retired=true;
  this.#closing=Promise.resolve().then(async()=>{
   let cleanup,failed=false;const once=async fn=>{try{if(await fn()!==undefined)fail('AUTH_ACCOUNT_POLICY_CLEANUP_UNKNOWN');}catch(cause){if(!failed){failed=true;cleanup=cause;}}};
   await once(()=>this.retire());let joined=false;await once(async()=>{await this.join();joined=true;});if(joined)await once(()=>this.#source.close());
   if(failed){this.#cleanup=cleanup;this.#cleanupFailed=true;this.#remember(cleanup);throw cleanup;}return undefined;
  });void this.#closing.catch(()=>{});return this.#closing;
 }
 outcome(){return Object.freeze({original:this.#original??null,capturedRaw:this.#capturedRaw??null,lastRecheckRaw:this.#lastRecheckRaw??null,unknown:this.#unknown,firstCausePresent:this.#hasFirst,firstCause:this.#first,cleanupFailed:this.#cleanupFailed,cleanupCause:this.#cleanup});}
}
export function isOriginalAccountPolicyResource(value){return supplied.has(value);}
export async function acquireOriginalAccountPolicy(request){
 requestCopy(request);
 // No accepted committed-source configuration/reader is supplied yet. Do not
 // promote r11 next-execution diagnostics, backup proofs or a test kernel.
 fail('AUTH_ACCOUNT_POLICY_COMMITTED_SOURCE_NOT_SUPPLIED');
}
