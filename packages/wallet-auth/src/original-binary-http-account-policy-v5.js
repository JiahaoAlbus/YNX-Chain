// Original committed registered-account current runner. This supplies NO
// Principal, device, Source grant, HTTP signer or callback installer.
import{types}from'node:util';
import{openSync,closeSync,readFileSync,lstatSync,fstatSync,realpathSync,constants}from'node:fs';import{dirname}from'node:path';import{createHash}from'node:crypto';
import{canonicalJSON}from'./canonical.js';import{evmAddressFromYNX}from'./crypto.js';
import{acquireOriginalNativeCommittedProductPolicyV4}from'./product-pair-session-v4-account-source.js';
import{readProductSessionAccountPolicy}from'./product-session-account-policy.js';
import{assertSessionAccountPolicy}from'./product-session-account-private.js';
import{createProductSessionHTTPBodyV5DATA,decodeProductSessionProofHeaderV5}from'./product-session-proof-v5.js';
const fail=c=>{throw Object.assign(Error(c),{code:c});},rows=Object.freeze([]),owners=new WeakSet();
function data(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('BINARY_V5_POLICY_SCHEMA');const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]?.enumerable||!Object.hasOwn(d[k],'value')))fail('BINARY_V5_POLICY_SCHEMA');return Object.fromEntries(keys.map(k=>[k,d[k].value]));}
const ta=Object.getPrototypeOf(Uint8Array.prototype),length=Object.getOwnPropertyDescriptor(ta,'byteLength').get,buffer=Object.getOwnPropertyDescriptor(ta,'buffer').get,set=Uint8Array.prototype.set;
function owned(v){if(types.isProxy(v)||!types.isUint8Array(v))fail('BINARY_V5_POLICY_BYTES');let n,b;try{n=length.call(v);b=buffer.call(v)}catch{fail('BINARY_V5_POLICY_BYTES')};if(!n||n>68288512||types.isSharedArrayBuffer(b))fail('BINARY_V5_POLICY_BYTES');const out=Buffer.alloc(n);try{set.call(out,v)}catch{fail('BINARY_V5_POLICY_BYTES')};return out;}
function capture(operation){const v=data(operation,['version','requestId','method','path','bodyOriginal','contentType','bodyDigest','bodyBinding','proofHeader','walletControlProofHeader','session','at']);if(v.version!=='5'||v.method!=='POST'||v.path!=='/api/v1/ide/deployments'||!/^req_[A-Za-z0-9_-]{12,80}$/.test(v.requestId)||v.walletControlProofHeader!==null||typeof v.at!=='string'||!Number.isFinite(Date.parse(v.at)))fail('BINARY_V5_POLICY_OPERATION');const body=owned(v.bodyOriginal),binding=data(v.bodyBinding,['bytes','sha3_512','sha512']);if(!v.session||types.isProxy(v.session)||Object.getPrototypeOf(v.session)!==Object.prototype)fail('BINARY_V5_POLICY_SESSION');const session=JSON.parse(canonicalJSON(v.session));if(session.version!=='4'||session.productId!=='developer'||session.accountAuthorization?.canonicalOwner!==evmAddressFromYNX(session.account))fail('BINARY_V5_POLICY_SESSION');const actual=createProductSessionHTTPBodyV5DATA(body,v.contentType),{member,...p}=decodeProductSessionProofHeaderV5(v.proofHeader);if(actual.bodyDigest!==v.bodyDigest||canonicalJSON(actual.bodyBinding)!==canonicalJSON(binding)||p.bodyDigest!==actual.bodyDigest||canonicalJSON(p.bodyBinding)!==canonicalJSON(actual.bodyBinding)||p.contentType!==v.contentType||p.sessionBinding!==session.sessionBinding||['account','productId','clientId','applicationId','bundleId','packageId','origin','callback','deviceId'].some(k=>p[k]!==session[k]))fail('BINARY_V5_POLICY_BINDING');return{...v,bodyOriginal:body,bodyBinding:Object.freeze(binding),session,proof:p};}
// PUBLIC lifecycle seam for isolated controls. Normal supply below ALWAYS
// uses the fixed original committed producer; no HTTP/JSON creates this owner.
// A completed lifecycle stage is never repeated. Join alone is a retryable
// wait: a refusal retains this same original child, not a new acquisition.
function drainOriginalBinaryV5Child(child){
 if(child.terminal)throw child.terminal.cause;
 const stages=['retire','join','close'];
 while(child.stage<stages.length){
  if(child.pending){
   const pending=child.pending;
   if(!pending.settled)return pending.promise;
   child.pending=null;
   if(pending.errorPresent){if(child.stage!==1)child.terminal={cause:pending.error};throw pending.error;}
   if(pending.value!==undefined){const error=Object.assign(Error('BINARY_V5_POLICY_CLEANUP_RESULT'),{code:'BINARY_V5_POLICY_CLEANUP_RESULT'});child.terminal={cause:error};throw error;}
   child.stage++;continue;
  }
  let result;
  try{result=child.resource[stages[child.stage]]();}
  catch(error){if(child.stage!==1)child.terminal={cause:error};throw error;}
  if(types.isPromise(result)){
   const pending={settled:false,errorPresent:false};child.pending=pending;
   pending.promise=result.then(value=>{pending.value=value;pending.settled=true;},error=>{pending.errorPresent=true;pending.error=error;pending.settled=true;});
   return pending.promise;
  }
  if(result!==undefined){const error=Object.assign(Error('BINARY_V5_POLICY_CLEANUP_RESULT'),{code:'BINARY_V5_POLICY_CLEANUP_RESULT'});child.terminal={cause:error};throw error;}
  child.stage++;
 }
}
// Private normal-owner closure. A historical child error may be rethrown only
// after its status proves closed; an unresolved child never releases manifest.
function createOriginalBinaryV5PolicyClose(readKernel,readManifest,onClosed){
 let retired=false,joined=false,childClosed=false,parentAttempted=false,parentClosed=false,first;
 const close=()=>{
  const kernel=readKernel();
  if(!retired){kernel?.retire();retired=true;}
  if(!joined){kernel?.join();joined=true;}
  if(!childClosed){
   try{kernel?.close();}
   catch(error){if(kernel&&!kernel.status().closed)throw error;first??={cause:error};}
   if(kernel&&!kernel.status().closed)fail('BINARY_V5_POLICY_JOIN_PENDING');
   childClosed=true;
  }
  if(!parentAttempted){parentAttempted=true;try{readManifest()?.close();parentClosed=true;}catch(error){first??={cause:error};}}
  if(parentClosed)onClosed();
  if(first)throw first.cause;
 };
 Object.defineProperty(close,'status',{value:()=>{const kernel=readKernel(),state=kernel?.status()??{closed:false,unknown:false,phase:'IDLE',entered:false};return Object.freeze({...state,closed:parentClosed&&(!kernel||state.closed),unknown:state.unknown||!!first});}});
 return close;
}
export class OriginalBinaryV5AccountPolicyKernel{
 #acquire;#current;#clock;#closed=false;#retired=false;#first;#active=0;#floor=0;#last=null;#children=new Set();
 constructor(acquire,current,clock=Date.now){this.#acquire=acquire;this.#current=current;this.#clock=clock;}
 #now(){const n=this.#clock();if(!Number.isSafeInteger(n)||n<0||n<this.#floor)fail('BINARY_V5_POLICY_CLOCK');this.#floor=n;return n;}
 #drainChildren(){
  for(const child of this.#children){
   try{if(drainOriginalBinaryV5Child(child))fail('BINARY_V5_POLICY_JOIN_PENDING');this.#children.delete(child);}
   catch(error){this.#first??={cause:error};}
  }
  if(this.#children.size){if(this.#first)throw this.#first.cause;fail('BINARY_V5_POLICY_JOIN_PENDING');}
 }
 async runBinaryV5(operation,execute){if(this.#closed||this.#retired||this.#first)fail('BINARY_V5_POLICY_CLOSED');if(typeof execute!=='function')fail('BINARY_V5_POLICY_CONTINUATION');const v=capture(operation),fingerprint=x=>{const{bodyOriginal,proof,...rest}=x;return canonicalJSON(rest)},wire=fingerprint(v),started=this.#now();if(Date.parse(v.at)>started||started>=Math.min(Date.parse(v.proof.expiresAt),Date.parse(v.session.expiresAt)))fail('BINARY_V5_POLICY_EXPIRED');this.#current();this.#active++;let lease,child,entered=false,first,firstPresent=false;
 try{lease=await this.#acquire(v.session);if(lease?.resource){child={resource:lease.resource,stage:0,pending:null,terminal:null};this.#children.add(child);}this.#last={phase:'ACQUIRED',lease,entered:false};const end=Math.min(lease.expiresAtMs,Date.parse(v.proof.expiresAt),Date.parse(v.session.expiresAt));const check=()=>{const actualOperation=capture(operation);if(fingerprint(actualOperation)!==wire)fail('BINARY_V5_POLICY_OPERATION_CHANGED');this.#current();lease.resource.assertCurrent();assertSessionAccountPolicy(v.session,readProductSessionAccountPolicy(lease.policyRef,v.session.account,new Date(this.#now())));const actual=createProductSessionHTTPBodyV5DATA(v.bodyOriginal,v.contentType);if(actual.bodyDigest!==v.bodyDigest||canonicalJSON(actual.bodyBinding)!==canonicalJSON(v.bodyBinding)||this.#now()>=end||this.#closed||this.#retired)fail('BINARY_V5_POLICY_CHANGED');};await lease.resource.recheck();check();if(entered)fail('BINARY_V5_POLICY_ONCE');entered=true;this.#last={phase:'ENTERED',lease,entered:true};const result=execute(Object.freeze({observation:lease.policyRef,verifiedApproval:null,required:true}));if(result!==undefined)fail('BINARY_V5_POLICY_RESULT_SUBSTITUTED');check();await lease.resource.recheck();check();this.#last={phase:'COMPLETED',lease,entered:true};}
 catch(error){firstPresent=true;first=error;this.#last={phase:entered?'UNKNOWN':'REFUSED',lease,entered,cause:error};throw error;}
 finally{
  try{if(child){let pending;while((pending=drainOriginalBinaryV5Child(child)))await pending;this.#children.delete(child);}}
  catch(error){this.#retired=true;this.#first??={cause:firstPresent?first:error};if(!firstPresent)throw error;}
  finally{this.#active--;}
 }
 }
 status(){return Object.freeze({closed:this.#closed,unknown:!!this.#first||this.#last?.phase==='UNKNOWN',phase:this.#last?.phase??'IDLE',entered:this.#last?.entered??false});}
 retire(){this.#retired=true;}
 join(){if(this.#active)fail('BINARY_V5_POLICY_JOIN_PENDING');this.#drainChildren();}
 close(){if(this.#active)fail('BINARY_V5_POLICY_JOIN_PENDING');this.#drainChildren();this.#closed=true;if(this.#first)throw this.#first.cause;}
}
const same=(a,b)=>['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
class ProtectedPolicyManifest{
 #ref;#fd;#stat;#raw;#parents=[];#closed=false;#first;
 constructor(ref){this.#ref=structuredClone(ref)}
 open(){const r=data(this.#ref,['path','device','inode','uid','gid','mode','bytes','sha256']);if(r.uid!==0||![0o400,0o444,0o600].includes(r.mode)||r.bytes<1||r.bytes>393216||realpathSync(r.path)!==r.path)fail('BINARY_V5_POLICY_MANIFEST');for(let p=dirname(r.path);;p=dirname(p)){const s=lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||(s.uid!==0&&s.uid!==process.getuid())||(s.mode&0o022))fail('BINARY_V5_POLICY_MANIFEST_PARENT');this.#parents.push([p,s]);if(p==='/')break}this.#fd=openSync(r.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const s=this.#stat=fstatSync(this.#fd);if(!s.isFile()||s.nlink!==1||s.uid!==r.uid||s.gid!==r.gid||String(s.dev)!==r.device||String(s.ino)!==r.inode||(s.mode&511)!==r.mode||s.size!==r.bytes)fail('BINARY_V5_POLICY_MANIFEST_IDENTITY');this.#raw=readFileSync(this.#fd,'utf8');if(createHash('sha256').update(this.#raw).digest('hex')!==r.sha256)fail('BINARY_V5_POLICY_MANIFEST_HASH');this.current();return this.#raw}
 current(){if(this.#closed||!this.#stat||!same(this.#stat,fstatSync(this.#fd))||!same(this.#stat,lstatSync(this.#ref.path))||realpathSync(this.#ref.path)!==this.#ref.path)fail('BINARY_V5_POLICY_MANIFEST_CHANGED');for(const[p,s]of this.#parents){const n=lstatSync(p);if(['dev','ino','uid','gid','mode'].some(k=>s[k]!==n[k]))fail('BINARY_V5_POLICY_MANIFEST_PARENT_CHANGED')}}
 close(){if(!this.#closed){this.#closed=true;try{if(this.#fd!==undefined)closeSync(this.#fd)}catch(e){this.#first={cause:e}}}if(this.#first)throw this.#first.cause}
}
export function assertOriginalBinaryV5AccountPolicyOwner(owner){if(!owners.has(owner))fail('BINARY_V5_POLICY_ORIGINAL_OWNER_REQUIRED');return owner;}
export async function acquireOriginalBinaryV5AccountPolicyRunner(){if(arguments.length)fail('BINARY_V5_POLICY_ZERO_INPUT');if(rows.length!==1)fail('ACCOUNT_POLICY_BINARY_V5_NOT_SUPPLIED');let manifest,kernel,closed=false;const close=createOriginalBinaryV5PolicyClose(()=>kernel,()=>manifest,()=>{closed=true});try{if(process.versions.node!=='26.7.0'||process.versions.openssl!=='3.6.4')fail('BINARY_V5_POLICY_RUNTIME');const e=structuredClone(rows[0]);data(e,['manifest','node']);manifest=new ProtectedPolicyManifest(e.manifest);const raw=manifest.open(),m=JSON.parse(raw);data(m,['version','purpose','networkId','nodeBindingSHA256','issuedAtMs','expiresAtMs']);if(canonicalJSON(m)!==raw||m.version!=='5'||m.purpose!=='AUTH-BINARY-HTTP-ACCOUNT-POLICY/v5'||!/^[a-f0-9]{64}$/.test(m.networkId)||createHash('sha256').update(canonicalJSON(e.node)).digest('hex')!==m.nodeBindingSHA256||![m.issuedAtMs,m.expiresAtMs].every(Number.isSafeInteger)||m.expiresAtMs<=m.issuedAtMs||m.expiresAtMs-m.issuedAtMs>86400000)fail('BINARY_V5_POLICY_RELEASE');let floor=0;const current=()=>{manifest.current();const n=Date.now();if(n<floor||n<m.issuedAtMs||n>=m.expiresAtMs||closed)fail('BINARY_V5_POLICY_RELEASE_EXPIRED');floor=n;};current();kernel=new OriginalBinaryV5AccountPolicyKernel(async session=>{current();if(session.accountAuthorization.networkId!==m.networkId)fail('BINARY_V5_POLICY_NETWORK');return acquireOriginalNativeCommittedProductPolicyV4(e.node,{chainId:m.networkId,nativeChainId:e.node.nativeChainId,owner:evmAddressFromYNX(session.account)},session.account)},current);const owner=Object.freeze({retire:()=>kernel.retire(),join:()=>kernel.join(),runBinaryV5:kernel.runBinaryV5.bind(kernel),status:close.status,close});owners.add(owner);return{owner,error:null};}catch(error){return{owner:Object.freeze({close,status:()=>Object.freeze({configured:false,unknown:true})}),error}}}
