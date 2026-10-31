// PRIVATE release-selected production Source factory, not a public SDK setter.
// This server issues durable pair/session records, NOT Native/Source grants.
import {openSync,closeSync,lstatSync,fstatSync,readFileSync,realpathSync,constants as F} from 'node:fs';
import {dirname} from 'node:path';
import{types}from'node:util';
import {canonicalJSON} from './canonical.js';
import {evmAddressFromYNX} from './crypto.js';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from './product-session-device-registration-v4.js';
import {loadReleaseSelectedOriginalRootV2,assertOriginalRootReadOwnerV2} from './original-source-root-owner-v2.js';
import {acquireOriginalNativeCommittedProductPolicyV4} from './product-pair-session-v4-account-source.js';
import {openProductPairSessionV4Store,openProductPairSessionV4CurrentStore,pairV4Digest} from './product-pair-session-v4-store.js';
import {ProductPairSessionV4IssuerKernel} from './product-pair-session-v4-issuer.js';
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
 retire(){this.#kernel.retire();}join(){this.#kernel.join();}close(){this.#kernel.close();}
}
Object.freeze(OriginalPairIssuerOwnerV4.prototype);
export function assertOriginalProductPairIssuerOwnerV4(owner){if(!owners.has(owner))fail('PAIR_V4_ORIGINAL_SOURCE_REQUIRED');return owner;}
async function acquireOriginalPairServiceResources(readOnlyStore){
 if(admittedServiceEntries.length!==1)fail('PAIR_V4_SOURCE_NOT_CONFIGURED');
 if(process.versions.node!=='26.7.0'||process.versions.openssl!=='3.6.4'||!['darwin','linux'].includes(process.platform))fail('PAIR_V4_PHYSICAL_RUNTIME');
 const e=structuredClone(admittedServiceEntries[0]);let manifest,root,store,kernel,owner,source;let closed=false,closeError,readOnlyClose,readOnlyParents;const currentRootPartials=new Map(),currentPolicyPartials=new Map(),currentRootPending=new Set();
 const drainReadOnly=async()=>{while(currentRootPending.size)await Promise.allSettled([...currentRootPending]);for(const map of[currentPolicyPartials,currentRootPartials])for(const[held,debt]of map){try{await debt.drain()}finally{if(debt.closed)map.delete(held)}}readOnlyParents??=[new OriginalReadOnlyChildDebtV4(root),new OriginalReadOnlyChildDebtV4(store),new OriginalReadOnlyChildDebtV4(manifest)];for(const debt of readOnlyParents)await debt.drain();};
 const drainPartial=async()=>{if(!readOnlyStore||!readOnlyClose)fail('PAIR_V4_SOURCE_NOT_CLOSING');await drainReadOnly();};
 const close=()=>{if(readOnlyStore){if(!readOnlyClose){closed=true;readOnlyClose=drainReadOnly().catch(cause=>{closeError??={cause};throw cause})}return readOnlyClose;}if(!closed){closed=true;for(const f of [()=>store?.close(),()=>root?.close(),()=>manifest?.close()])try{f();}catch(error){closeError??={cause:error};}}if(closeError)throw closeError.cause;};
 try{
  exact(e,['manifest','registry','node','rootPlan','storage']);manifest=new ProtectedServiceManifest(e.manifest);manifest.open();const m=JSON.parse(manifest.raw);
  exact(m,['version','purpose','networkId','registryId','productRegistrySHA256','nodeBindingSHA256','issuedAtMs','expiresAtMs','deviceBindings']);
  if(canonicalJSON(m)!==manifest.raw||m.version!=='4'||m.purpose!=='AUTH-PRODUCT-PAIR-SESSION-ISSUER/v4'||m.productRegistrySHA256!==pairV4Digest(canonicalJSON(e.registry))||m.nodeBindingSHA256!==pairV4Digest(canonicalJSON(e.node))||!Array.isArray(m.deviceBindings)||m.deviceBindings.length<1||m.deviceBindings.length>4096||!Number.isSafeInteger(m.issuedAtMs)||!Number.isSafeInteger(m.expiresAtMs)||m.issuedAtMs<0||m.expiresAtMs<=m.issuedAtMs||m.expiresAtMs-m.issuedAtMs>86400000)fail('PAIR_V4_COMMISSIONING_MANIFEST');
  const seen=new Set();for(const b of m.deviceBindings){exact(b,['canonicalOwner','deviceId','globalDeviceId','generation','pkA','pkB']);if(!/^0x[0-9a-f]{40}$/.test(b.canonicalOwner)||!/^[A-Za-z0-9._:-]{8,128}$/.test(b.deviceId)||!/^[A-Za-z0-9._:-]{8,128}$/.test(b.globalDeviceId)||!/^[1-9][0-9]{0,19}$/.test(b.generation)||BigInt(b.generation)>(1n<<64n)-1n||!/^[0-9a-f]{5184}$/.test(b.pkA)||!/^[0-9a-f]{128}$/.test(b.pkB))fail('PAIR_V4_COMMISSIONED_DEVICE');const k=b.canonicalOwner+':'+b.deviceId;if(seen.has(k))fail('PAIR_V4_COMMISSIONED_DUPLICATE');seen.add(k);}
  let floor=0;const current=()=>{if(closed)fail('PAIR_V4_SOURCE_CLOSED');manifest.current();const n=Date.now();if(!Number.isSafeInteger(n)||n<floor||n<m.issuedAtMs||n>=m.expiresAtMs)fail('PAIR_V4_SOURCE_WINDOW');floor=n;return n;};current();
  const opened=await loadReleaseSelectedOriginalRootV2(e.rootPlan,true);root=opened.owner;if(opened.error!==undefined)throw opened.error;assertOriginalRootReadOwnerV2(root);current();
  source=Object.freeze({async acquire({registrationOriginal,account,at}){
   current();const record=inspectProductSessionDeviceRegistrationOriginalV4Data(Buffer.from(registrationOriginal)).record;
   const binding=m.deviceBindings.find(b=>b.canonicalOwner===record.canonicalOwner&&b.deviceId===record.deviceId);
   if(!binding||record.networkId!==m.networkId||record.canonicalOwner!==evmAddressFromYNX(account)||record.generation!==binding.generation||record.pkA!==binding.pkA||record.pkB!==binding.pkB||record.revokedAt!==null||Date.parse(record.registeredAt)>at||Date.parse(record.expiresAt)<=at)fail('PAIR_V4_ORIGINAL_DEVICE_NOT_COMMISSIONED');
   let policy;const global=()=>{current();const negative=root.queryNegative(binding.canonicalOwner,binding.globalDeviceId,binding.generation);if(negative.networkId!==m.networkId||negative.registryId!==m.registryId||negative.revoked)fail('PAIR_V4_GLOBAL_DEVICE_REVOKED');return negative;};const initial=global(),rootPartials=[];
   // A read-only server lease must not treat the startup Root cache as fresh
   // registered-root/current/revoke evidence. Reopen the SAME independently
   // trusted original read owner; no new plan, Root key or signer is supplied.
   const freshGlobal=()=>{if(!readOnlyStore)return Promise.resolve();const flight=Promise.resolve().then(async()=>{if(rootPartials.length>=16)fail('PAIR_V4_ROOT_CURRENT_CAPACITY');let held,debt,first;try{const opened=await loadReleaseSelectedOriginalRootV2(e.rootPlan,true);held=opened.owner;if(held){debt=new OriginalReadOnlyChildDebtV4(held);currentRootPartials.set(held,debt)}rootPartials.push(opened);if(opened.error!==undefined)throw opened.error;assertOriginalRootReadOwnerV2(held);current();const n=held.queryNegative(binding.canonicalOwner,binding.globalDeviceId,binding.generation);if(n.networkId!==m.networkId||n.registryId!==m.registryId||n.revoked||n.sequence!==initial.sequence||n.head!==initial.head)fail('PAIR_V4_GLOBAL_CHECKPOINT_CHANGED');current();}catch(cause){first={cause}}finally{if(debt)try{await debt.drain()}catch(cause){first??={cause}}finally{if(debt.closed)currentRootPartials.delete(held)}}if(first)throw first.cause;});currentRootPending.add(flight);flight.then(()=>currentRootPending.delete(flight),()=>currentRootPending.delete(flight));return flight;};
   try{await freshGlobal();policy=await acquireOriginalNativeCommittedProductPolicyV4(e.node,{chainId:m.networkId,nativeChainId:e.node.nativeChainId,owner:record.canonicalOwner},account);const expiresAtMs=Math.min(m.expiresAtMs,policy.expiresAtMs,Date.parse(record.expiresAt));let retired=false;
    const check=n=>{if(retired||n>=expiresAtMs)fail('PAIR_V4_SOURCE_LEASE_EXPIRED');const after=global();if(after.sequence!==initial.sequence||after.head!==initial.head)fail('PAIR_V4_GLOBAL_CHECKPOINT_CHANGED');policy.resource.assertCurrent();current();if(Date.now()>=expiresAtMs)fail('PAIR_V4_SOURCE_POST_EXPIRED');};check(current());
    return Object.freeze({policyRef:policy.policyRef,expiresAtMs,assertCurrent:check,async recheck(n){check(n);await freshGlobal();await policy.resource.recheck();await freshGlobal();check(current());},
     // Account/device PoP authorizes issuance only. Until distinct management
     // proof domains are admitted, HTTP cannot cancel/revoke by naming IDs.
     assertRevocationAllowed(){fail('PAIR_V4_MANAGEMENT_PROOF_NOT_SUPPLIED');},assertCancellationAllowed(){fail('PAIR_V4_MANAGEMENT_PROOF_NOT_SUPPLIED');},
     retire(){retired=true;policy.resource.retire();},join(){policy.resource.join();},close(){policy.resource.close();}});
   }catch(error){if(policy){if(readOnlyStore){const debt=new OriginalReadOnlyChildDebtV4(policy.resource);currentPolicyPartials.set(policy.resource,debt);try{await debt.drain()}catch{}finally{if(debt.closed)currentPolicyPartials.delete(policy.resource)}}else{policy.resource.retire();policy.resource.close();}}throw error;}
  },close,...(readOnlyStore?{drainPartial}:{})});
  current();store=(readOnlyStore?openProductPairSessionV4CurrentStore:openProductPairSessionV4Store)(e.storage);current();owner=Object.freeze({store,source,registry:structuredClone(e.registry),retire(){},join(){},close,...(readOnlyStore?{drainPartial}:{})});return Object.freeze({owner,error:undefined});
 }catch(error){return Object.freeze({owner:owner??Object.freeze({retire(){kernel?.retire();},join(){kernel?.join();},close,...(readOnlyStore?{drainPartial}:{}),status:()=>Object.freeze({unknown:true,configured:false})}),error:originalSourceFailure(error)});}
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
