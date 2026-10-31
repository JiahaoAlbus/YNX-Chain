// PRIVATE release-selected production Source factory, not a public SDK setter.
// This server issues durable pair/session records, NOT Native/Source grants.
import {openSync,closeSync,lstatSync,fstatSync,readFileSync,realpathSync,constants as F} from 'node:fs';
import {dirname} from 'node:path';
import {canonicalJSON} from './canonical.js';
import {evmAddressFromYNX} from './crypto.js';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from './product-session-device-registration-v4.js';
import {loadReleaseSelectedOriginalRootV2,assertOriginalRootReadOwnerV2} from './original-source-root-owner-v2.js';
import {acquireOriginalNativeCommittedProductPolicyV4} from './product-pair-session-v4-account-source.js';
import {openProductPairSessionV4Store,pairV4Digest} from './product-pair-session-v4-store.js';
import {ProductPairSessionV4IssuerKernel} from './product-pair-session-v4-issuer.js';
const fail=c=>{throw Object.assign(Error(c),{code:c});};
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
export async function acquireOriginalProductPairSessionV4Issuer(...args){
 if(args.length)fail('PAIR_V4_ZERO_INPUT_REQUIRED');
 if(admittedServiceEntries.length!==1)fail('PAIR_V4_SOURCE_NOT_CONFIGURED');
 if(process.versions.node!=='26.7.0'||process.versions.openssl!=='3.6.4'||!['darwin','linux'].includes(process.platform))fail('PAIR_V4_PHYSICAL_RUNTIME');
 const e=structuredClone(admittedServiceEntries[0]);let manifest,root,store,kernel,owner,source;let closed=false,closeError;
 const close=()=>{if(!closed){closed=true;for(const f of [()=>store?.close(),()=>root?.close(),()=>manifest?.close()])try{f();}catch(error){closeError??={cause:error};}}if(closeError)throw closeError.cause;};
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
   let policy;const global=()=>{current();const negative=root.queryNegative(binding.canonicalOwner,binding.globalDeviceId,binding.generation);if(negative.networkId!==m.networkId||negative.registryId!==m.registryId||negative.revoked)fail('PAIR_V4_GLOBAL_DEVICE_REVOKED');return negative;};const initial=global();
   try{policy=await acquireOriginalNativeCommittedProductPolicyV4(e.node,{chainId:m.networkId,nativeChainId:e.node.nativeChainId,owner:record.canonicalOwner},account);const expiresAtMs=Math.min(m.expiresAtMs,policy.expiresAtMs,Date.parse(record.expiresAt));let retired=false;
    const check=n=>{if(retired||n>=expiresAtMs)fail('PAIR_V4_SOURCE_LEASE_EXPIRED');const after=global();if(after.sequence!==initial.sequence||after.head!==initial.head)fail('PAIR_V4_GLOBAL_CHECKPOINT_CHANGED');policy.resource.assertCurrent();current();if(Date.now()>=expiresAtMs)fail('PAIR_V4_SOURCE_POST_EXPIRED');};check(current());
    return Object.freeze({policyRef:policy.policyRef,expiresAtMs,assertCurrent:check,async recheck(n){check(n);await policy.resource.recheck();check(current());},
     // Account/device PoP authorizes issuance only. Until distinct management
     // proof domains are admitted, HTTP cannot cancel/revoke by naming IDs.
     assertRevocationAllowed(){fail('PAIR_V4_MANAGEMENT_PROOF_NOT_SUPPLIED');},assertCancellationAllowed(){fail('PAIR_V4_MANAGEMENT_PROOF_NOT_SUPPLIED');},
     retire(){retired=true;policy.resource.retire();},join(){policy.resource.join();},close(){policy.resource.close();}});
   }catch(error){if(policy){policy.resource.retire();policy.resource.close();}throw error;}
  },close});
  current();store=openProductPairSessionV4Store(e.storage);current();kernel=new ProductPairSessionV4IssuerKernel(e.registry,store,source);owner=new OriginalPairIssuerOwnerV4(kernel);return Object.freeze({owner,error:undefined});
 }catch(error){return Object.freeze({owner:owner??Object.freeze({retire(){kernel?.retire();},join(){kernel?.join();},close,status:()=>Object.freeze({unknown:true,configured:false})}),error});}
}
