import {verifyProductSessionApprovalV4Data} from './product-session-pq-v4-codec.js';
import {deriveOriginalPendingCompletionProfileCandidateDATA} from './product-device-pending-completion-candidate.mjs';
// PRIVATE release-selected production Source factory, not a public SDK setter.
// This server issues durable pair/session records, NOT Native/Source grants.
import {openSync,closeSync,lstatSync,fstatSync,readFileSync,realpathSync,constants as F} from 'node:fs';
import {dirname} from 'node:path';
import{types}from'node:util';
import {canonicalJSON} from './canonical.js';
import {evmAddressFromYNX} from './crypto.js';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from './product-session-device-registration-v4.js';
import {loadReleaseSelectedOriginalRootCurrentV3,assertOriginalRootReadCurrentOwnerV3,assertReleaseSelectedRootReadCurrentPlanV3} from './root-current-v3/root-read-current-owner-v3.mjs';
import {acquireOriginalNativeCommittedProductPolicyV4} from './product-pair-session-v4-account-source.js';
import {openProductPairSessionV4Store,openProductPairSessionV4CurrentStore,pairV4Digest} from './product-pair-session-v4-store.js';
import {productPairSessionV4ActorDATA,ProductPairSessionV4IssuerKernel} from './product-pair-session-v4-issuer.js';
import {OriginalProductSessionDeviceV4ServerCurrentKernel} from './original-product-device-v4-server-current.js';
import {OriginalReadOnlyChildDebtV4} from './original-readonly-child-debt-v4.js';
const fail=c=>{throw Object.assign(Error(c),{code:c});};
const originalSourceFailure=cause=>cause===undefined?Object.assign(Error('PAIR_V4_SOURCE_FAILED_UNDEFINED'),{code:'PAIR_V4_SOURCE_FAILED_UNDEFINED',cause}):cause;
// Independent release review must supply BOTH this exact service row and the
// independent Root reader's trust row. Empty is deliberate, not auto-admission.
const admittedServiceEntries=Object.freeze([]),owners=new WeakSet();
const exact=(v,keys)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).sort().join('|')!==keys.slice().sort().join('|'))fail('PAIR_V4_SOURCE_SCHEMA');};
const stable=(a,b)=>['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
class ProtectedServiceManifest {
 #ref;#fd;#s;#raw;#parents=[];#closed=false;#error;
 constructor(ref){this.#ref=structuredClone(ref);}
 open(){const r=this.#ref;exact(r,['path','device','inode','uid','gid','mode','bytes','sha256']);if(r.uid!==0||![0o400,0o444,0o600].includes(r.mode)||r.bytes<1||r.bytes>393216||realpathSync(r.path)!==r.path)fail('PAIR_V4_SOURCE_REF');for(let p=dirname(r.path);;p=dirname(p)){const s=lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||(s.uid!==0&&s.uid!==process.getuid())||(s.mode&0o022))fail('PAIR_V4_SOURCE_PARENT');this.#parents.push([p,s]);if(p==='/')break;}this.#fd=openSync(r.path,F.O_RDONLY|F.O_NOFOLLOW|F.O_NONBLOCK);const s=this.#s=fstatSync(this.#fd);if(!s.isFile()||s.nlink!==1||s.uid!==r.uid||s.gid!==r.gid||String(s.dev)!==r.device||String(s.ino)!==r.inode||(s.mode&511)!==r.mode||s.size!==r.bytes)fail('PAIR_V4_SOURCE_TUPLE');this.#raw=readFileSync(this.#fd,'utf8');if(pairV4Digest(this.#raw)!==r.sha256)fail('PAIR_V4_SOURCE_SHA');this.current();return this;}
 current(){if(this.#closed||this.#fd===undefined||!stable(this.#s,fstatSync(this.#fd))||!stable(this.#s,lstatSync(this.#ref.path))||realpathSync(this.#ref.path)!==this.#ref.path)fail('PAIR_V4_SOURCE_CHANGED');for(const[p,s]of this.#parents){const n=lstatSync(p);if(!n.isDirectory()||n.isSymbolicLink()||['dev','ino','uid','gid','mode'].some(k=>n[k]!==s[k]))fail('PAIR_V4_SOURCE_PARENT_CHANGED');}}
 get raw(){this.current();return this.#raw;}
 close(){if(!this.#closed){this.#closed=true;try{if(this.#fd!==undefined)closeSync(this.#fd);}catch(e){this.#error={cause:e};}}if(this.#error)throw this.#error.cause;}
}
class OriginalPairIssuerOwnerV4 {
 #kernel;
 constructor(kernel){this.#kernel=kernel;owners.add(this);Object.freeze(this);}
 pair(raw){return this.#kernel.pair(raw);}complete(raw){return this.#kernel.complete(raw);}challenge(raw){return this.#kernel.challenge(raw);}
 revoke(raw){return this.#kernel.revoke(raw);}cancel(raw){return this.#kernel.cancel(raw);}
 active(raw){return this.#kernel.active(raw);}recover(raw){return this.#kernel.recover(raw);}
 retire(){this.#kernel.retire();}join(){this.#kernel.join();}close(){return this.#kernel.close();}
}
Object.freeze(OriginalPairIssuerOwnerV4.prototype);
export function assertOriginalProductPairIssuerOwnerV4(owner){if(!owners.has(owner))fail('PAIR_V4_ORIGINAL_SOURCE_REQUIRED');return owner;}
async function acquireOriginalPairServiceResources(readOnlyStore){
 if(admittedServiceEntries.length!==1)fail('PAIR_V4_SOURCE_NOT_CONFIGURED');
 if(process.versions.node!=='26.7.0'||process.versions.openssl!=='3.6.4'||!['darwin','linux'].includes(process.platform))fail('PAIR_V4_PHYSICAL_RUNTIME');
 const e=structuredClone(admittedServiceEntries[0]);let manifest,store,owner,source,closed=false,closing,firstClose,parents;
 const roots=new Map(),policies=new Map(),pending=new Set();
 const drainMap=async map=>{for(const[held,debt]of map){try{await debt.drain();}finally{if(debt.closed)map.delete(held);}}};
 const drainAll=async()=>{while(pending.size)await Promise.allSettled([...pending]);await drainMap(policies);await drainMap(roots);parents??=[new OriginalReadOnlyChildDebtV4({close:()=>store?.close()}),new OriginalReadOnlyChildDebtV4({close:()=>manifest?.close()})];for(const p of parents)await p.drain();};
 const close=()=>{if(!closing){closed=true;closing=drainAll().catch(cause=>{firstClose??={cause};throw firstClose.cause;});}return closing;};
 const drainPartial=async()=>{if(!closing)fail('PAIR_V4_SOURCE_NOT_CLOSING');await drainAll();};
 const track=work=>{if(closed||pending.size>=32||roots.size>=32||policies.size>=32)fail('PAIR_V4_SOURCE_CHILD_CAPACITY_OR_CLOSED');const p=Promise.resolve().then(work);pending.add(p);const done=()=>pending.delete(p);p.then(done,done);return p;};
 try{
  exact(e,['manifest','registry','node','rootPlan','storage']);manifest=new ProtectedServiceManifest(e.manifest);manifest.open();const m=JSON.parse(manifest.raw);
  exact(m,['version','purpose','networkId','registryId','productRegistrySHA256','nodeBindingSHA256','issuedAtMs','expiresAtMs','deviceBindings']);
  if(canonicalJSON(m)!==manifest.raw||m.version!=='4'||m.purpose!=='AUTH-PRODUCT-PAIR-SESSION-ISSUER/v4'||m.productRegistrySHA256!==pairV4Digest(canonicalJSON(e.registry))||m.nodeBindingSHA256!==pairV4Digest(canonicalJSON(e.node))||!Array.isArray(m.deviceBindings)||m.deviceBindings.length<1||m.deviceBindings.length>4096||!Number.isSafeInteger(m.issuedAtMs)||!Number.isSafeInteger(m.expiresAtMs)||m.issuedAtMs<0||m.expiresAtMs<=m.issuedAtMs||m.expiresAtMs-m.issuedAtMs>86400000)fail('PAIR_V4_COMMISSIONING_MANIFEST');
  const seen=new Set();for(const b of m.deviceBindings){exact(b,['canonicalOwner','deviceId','globalDeviceId','generation','pkA','pkB']);if(!/^0x[0-9a-f]{40}$/.test(b.canonicalOwner)||!/^[A-Za-z0-9._:-]{8,128}$/.test(b.deviceId)||!/^[A-Za-z0-9._:-]{8,128}$/.test(b.globalDeviceId)||!/^[1-9][0-9]{0,19}$/.test(b.generation)||BigInt(b.generation)>(1n<<64n)-1n||!/^[0-9a-f]{5184}$/.test(b.pkA)||!/^[0-9a-f]{128}$/.test(b.pkB))fail('PAIR_V4_COMMISSIONED_DEVICE');const k=b.canonicalOwner+':'+b.deviceId;if(seen.has(k))fail('PAIR_V4_COMMISSIONED_DUPLICATE');seen.add(k);}
  let floor=0;const current=()=>{if(closed)fail('PAIR_V4_SOURCE_CLOSED');manifest.current();const n=Date.now();if(!Number.isSafeInteger(n)||n<floor||n<m.issuedAtMs||n>=m.expiresAtMs)fail('PAIR_V4_SOURCE_WINDOW');floor=n;return n;};current();

  // Stable independent release qualification only. No finite Root checkpoint is
  // opened at service startup or compiled into this plan/source/npm/image.
  assertReleaseSelectedRootReadCurrentPlanV3(e.rootPlan);current();
  source=Object.freeze({async acquire({registrationOriginal,account,at}){
   return track(async()=>{
    current();const record=inspectProductSessionDeviceRegistrationOriginalV4Data(Buffer.from(registrationOriginal)).record;
    const b=m.deviceBindings.find(v=>v.canonicalOwner===record.canonicalOwner&&v.deviceId===record.deviceId);
    if(!b||record.networkId!==m.networkId||record.canonicalOwner!==evmAddressFromYNX(account)||record.generation!==b.generation||record.pkA!==b.pkA||record.pkB!==b.pkB||record.revokedAt!==null||Date.parse(record.registeredAt)>at||Date.parse(record.expiresAt)<=at)fail('PAIR_V4_ORIGINAL_DEVICE_NOT_COMMISSIONED');
    let root,rootDebt,policy,policyDebt;
    const dispose=async()=>{if(policyDebt){await policyDebt.drain();if(policyDebt.closed)policies.delete(policy.resource);}if(rootDebt){await rootDebt.drain();if(rootDebt.closed)roots.delete(root);}};
    try{
     const captured=await loadReleaseSelectedOriginalRootCurrentV3(e.rootPlan);
     // Adopt original root even on failure before examining its error.
     root=captured.owner;if(root){rootDebt=new OriginalReadOnlyChildDebtV4(root);roots.set(root,rootDebt);}
     if(captured.error!==null)throw captured.error;assertOriginalRootReadCurrentOwnerV3(root);current();
     const global=()=>{current();root.assertCurrent();const n=root.queryNegative(b.canonicalOwner,b.globalDeviceId,b.generation);if(n.networkId!==m.networkId||n.registryId!==m.registryId||n.revoked)fail('PAIR_V4_GLOBAL_DEVICE_REVOKED');return n;};
     const initial=global();
     policy=await acquireOriginalNativeCommittedProductPolicyV4(e.node,{chainId:m.networkId,nativeChainId:e.node.nativeChainId,owner:record.canonicalOwner},account);
     if(policy?.resource){policyDebt=new OriginalReadOnlyChildDebtV4(policy.resource);policies.set(policy.resource,policyDebt);}
     current();const expiresAtMs=Math.min(m.expiresAtMs,root.expiresAtMs,policy.expiresAtMs,Date.parse(record.expiresAt));
     let retired=false;const flights=new Set();
     const check=n=>{if(retired||closed||!Number.isSafeInteger(n)||n>=expiresAtMs)fail('PAIR_V4_SOURCE_LEASE_EXPIRED');const next=global();if(next.sequence!==initial.sequence||next.head!==initial.head)fail('PAIR_V4_GLOBAL_CHECKPOINT_CHANGED');policy.resource.assertCurrent();const end=current();if(end>=expiresAtMs)fail('PAIR_V4_SOURCE_POST_EXPIRED');};
     check(current());
     return Object.freeze({policyRef:policy.policyRef,expiresAtMs,assertCurrent:check,
      recheck(n){check(n);const p=(async()=>{await root.recheck();check(current());await policy.resource.recheck();check(current());await root.recheck();check(current());})();flights.add(p);const done=()=>flights.delete(p);p.then(done,done);return p;},
      assertRevocationAllowed(){fail('PAIR_V4_MANAGEMENT_PROOF_NOT_SUPPLIED');},assertCancellationAllowed(){fail('PAIR_V4_MANAGEMENT_PROOF_NOT_SUPPLIED');},
      retire(){retired=true;},async join(){if(!retired)fail('PAIR_V4_SOURCE_NOT_RETIRED');while(flights.size)await Promise.allSettled([...flights]);},
      async close(){if(!retired||flights.size)fail('PAIR_V4_SOURCE_CHILD_DEBT');await dispose();}
     });
    }catch(cause){try{await dispose();}catch{}throw cause;}
   });
  },close,drainPartial});
  current();store=(readOnlyStore?openProductPairSessionV4CurrentStore:openProductPairSessionV4Store)(e.storage);current();
  owner=Object.freeze({store,source,registry:structuredClone(e.registry),retire(){closed=true;},async join(){while(pending.size)await Promise.allSettled([...pending]);},close,drainPartial});return Object.freeze({owner,error:undefined});
 }catch(error){return Object.freeze({owner:owner??Object.freeze({retire(){closed=true;},async join(){while(pending.size)await Promise.allSettled([...pending]);},close,drainPartial,status:()=>Object.freeze({unknown:true,configured:false,rootChildren:roots.size,policyChildren:policies.size})}),error:originalSourceFailure(error)});}

}

const deviceCurrentOwners=new WeakSet();
class OriginalDeviceServerCurrentOwnerV4 {
 #kernel; #deviceCurrent;
 constructor(kernel){this.#kernel=kernel;this.#deviceCurrent=Object.freeze({readCurrent:(...a)=>kernel.readCurrent(...a),assertCurrent:(...a)=>kernel.assertCurrent(...a),readRegistrationOriginal:(...a)=>kernel.readRegistrationOriginal(...a),readSessionOriginal:(...a)=>kernel.readSessionOriginal(...a)});deviceCurrentOwners.add(this);Object.freeze(this);}
 get deviceCurrent(){return this.#deviceCurrent;}
 retire(){this.#kernel.retire();}join(){return this.#kernel.join();}close(){return this.#kernel.close();}drainPartial(){return this.#kernel.drainPartial();}status(){return this.#kernel.status();}
}
Object.freeze(OriginalDeviceServerCurrentOwnerV4.prototype);
export function assertOriginalProductSessionDeviceV4ServerCurrentOwner(owner){if(!deviceCurrentOwners.has(owner))fail('PAIR_V4_ORIGINAL_SERVER_CURRENT_OWNER_REQUIRED');return owner;}
// Consumer must FIRST retain a non-null outcome.owner, before invoking this
// guard. Only null is success; undefined/false/0 and missing error are failures.
export function assertOriginalProductSessionDeviceV4ServerCurrentResult(result){if(!result||types.isProxy(result)||Object.getPrototypeOf(result)!==Object.prototype)fail('PAIR_V4_SERVER_CURRENT_RESULT_SCHEMA');const d=Object.getOwnPropertyDescriptors(result),keys=['owner','deviceCurrent','error'];if(Reflect.ownKeys(d).length!==3||keys.some(k=>!d[k]?.enumerable||!Object.hasOwn(d[k],'value')))fail('PAIR_V4_SERVER_CURRENT_RESULT_SCHEMA');if(d.error.value!==null)throw d.error.value;const owner=assertOriginalProductSessionDeviceV4ServerCurrentOwner(d.owner.value);if(d.deviceCurrent.value!==owner.deviceCurrent)fail('PAIR_V4_SERVER_CURRENT_RESULT_SCHEMA');return owner;}
export async function acquireOriginalProductPairSessionV4Issuer(...args){
 if(args.length)fail('PAIR_V4_ZERO_INPUT_REQUIRED');const opened=await acquireOriginalPairServiceResources(false);
 if(opened.error!==undefined)return opened;
 let kernel;try{kernel=new ProductPairSessionV4IssuerKernel(opened.owner.registry,opened.owner.store,opened.owner.source);return Object.freeze({owner:new OriginalPairIssuerOwnerV4(kernel),error:undefined});}catch(error){return Object.freeze({owner:opened.owner,error:originalSourceFailure(error)});}
}
export async function acquireOriginalProductSessionDeviceV4ServerCurrent(...args){
 if(args.length)fail('PAIR_V4_ZERO_INPUT_REQUIRED');const opened=await acquireOriginalPairServiceResources(true);
 if(opened.error!==undefined)return Object.freeze({owner:opened.owner,deviceCurrent:null,error:opened.error===null?Object.assign(Error('PAIR_V4_SERVER_CURRENT_SOURCE_FAILED'),{code:'PAIR_V4_SERVER_CURRENT_SOURCE_FAILED',cause:null}):opened.error});
 try{const kernel=new OriginalProductSessionDeviceV4ServerCurrentKernel(opened.owner.registry,opened.owner.store,opened.owner.source),owner=new OriginalDeviceServerCurrentOwnerV4(kernel);return Object.freeze({owner,deviceCurrent:owner.deviceCurrent,error:null});}catch(error){return Object.freeze({owner:opened.owner,deviceCurrent:null,error:Object.assign(Error('PAIR_V4_SERVER_CURRENT_SOURCE_FAILED'),{code:'PAIR_V4_SERVER_CURRENT_SOURCE_FAILED',cause:error})});}
}

// Same protected pair-service resources and original independent Source/current.
// This returns candidate DATA, never a recognized PROFILE/CURRENT issuer.
export async function acquireOriginalProductPairPendingCompletionReaderV4(...args){
 if(args.length)fail('PAIR_V4_ZERO_INPUT_REQUIRED');
 let opened;try{opened=await acquireOriginalPairServiceResources(true);}catch(error){return Object.freeze({owner:null,errorPresent:true,error});}
 if(opened.error!==undefined)return Object.freeze({owner:opened.owner,errorPresent:true,error:opened.error});
 const parent=opened.owner;let retired=false,firstPresent=false,first,active=0,drainFlight=null,closeFlight=null,parentCloseSelected=false,closed=false;const debts=new Set();
 const remember=e=>{if(!firstPresent){firstPresent=true;first=e;}};
 const live=()=>{if(firstPresent)throw first;if(retired)fail('PAIR_V4_PENDING_COMPLETION_RETIRED');parent.store.assertCurrent();};
 const drain=()=>{if(!drainFlight)drainFlight=(async()=>{for(const h of debts){await h.retire();await h.join();await h.close();debts.delete(h);}})().finally(()=>{drainFlight=null;});return drainFlight;};
 const owner=Object.freeze({
  async readOriginalCompletionCandidateDATA({profileBodyOriginal,queryOriginal,originalPairPost,completionOperationId}){
   live();if(active)fail('PAIR_V4_PENDING_COMPLETION_BUSY');active++;let held,candidate=null;
   try{const at=Date.now(),post=JSON.parse(originalPairPost.toString('utf8'));
    if(typeof completionOperationId!=='string'||!/^[a-f0-9]{64}$/.test(completionOperationId)||completionOperationId===post.operationId)fail('PENDING_COMPLETION_DISTINCT_OPERATION_REQUIRED');
    held=await parent.source.acquire({request:post.request,registrationOriginal:post.registrationOriginal,account:post.approval.account,at});if(held)debts.add(held);live();
    await held.recheck(at);held.assertCurrent(Date.now());
    verifyProductSessionApprovalV4Data(parent.registry,post.request,post.approval,held.policyRef,Buffer.from(post.registrationOriginal),new Date());
    const actor=productPairSessionV4ActorDATA(post.request,inspectProductSessionDeviceRegistrationOriginalV4Data(Buffer.from(post.registrationOriginal)).record,post.approval.account);
    const read=()=>parent.store.readPendingCompletionOriginalsDATA({queryOriginal,originalPairPost,actor,at:Date.now()});
    const originals=read();candidate=deriveOriginalPendingCompletionProfileCandidateDATA(profileBodyOriginal,originals,Date.now(),completionOperationId);
    await held.recheck(Date.now());held.assertCurrent(Date.now());if(canonicalJSON(read())!==canonicalJSON(originals))fail('PAIR_V4_PENDING_COMPLETION_CHANGED');live();
    await drain();live();if(Date.now()>=candidate.expiresAtMs)fail('PAIR_V4_PENDING_COMPLETION_EXPIRED');return Object.freeze({candidate,errorPresent:false});
   }catch(error){remember(error);return Object.freeze({candidate,errorPresent:true,error:first});}finally{active--;}
  },
  retire(){retired=true;},async join(){if(!retired||active)fail('PAIR_V4_PENDING_COMPLETION_JOIN_PENDING');await drain();await parent.retire();await parent.join();},
  close(){retired=true;if(!closeFlight)closeFlight=(async()=>{try{if(active)fail('PAIR_V4_PENDING_COMPLETION_JOIN_PENDING');await drain();await parent.retire();await parent.join();if(!closed){if(!parentCloseSelected){parentCloseSelected=true;await parent.close();}else await parent.drainPartial();closed=true;}if(firstPresent)throw first;}catch(error){remember(error);throw first;}})().finally(()=>{closeFlight=null;});return closeFlight;},
  statusDATA(){return Object.freeze({retired,closed,active,childDebts:debts.size,firstCausePresent:firstPresent,firstCause:first,SourceAdmission:false});}
 });return Object.freeze({owner,errorPresent:false});
}
