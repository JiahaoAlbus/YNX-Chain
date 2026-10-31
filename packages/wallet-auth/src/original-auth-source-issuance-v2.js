// PRIVATE protected administration counterpart, never an HTTP signing API.
// A PUBLIC kernel fixture is not a release-selected issuer or role grant.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,basename} from 'node:path';
import {openSync,closeSync,fstatSync,lstatSync,readFileSync,realpathSync,constants} from 'node:fs';
import {batchSign,extract,encodeMember,discardBatch,importKeyMaterial,destroyKey,KEY_MATERIAL_FORMAT,SUITE} from '@ynx/batch-v01-candidate';
import {OriginalSourceCurrentV2KeyFile} from './original-auth-source-current-v2.js';
import {canonical,sha} from '../native/original-auth-identity-source-verifier.mjs';
import {encodeOriginalAuthSourceStatementV2,canonicalOriginalAuthSourceEnvelopeV2,verifyOriginalAuthSourceEnrollmentV2,verifyOriginalAuthSourceProfileV2} from '../native/original-auth-identity-source-v2-verifier.mjs';
import {inspectOriginalProductDeviceV4IssuanceBodyDATA} from '../native/original-auth-identity-source-v2-verifier.mjs';
import {PRODUCT_DEVICE_V4_SOURCE_PURPOSE} from '../native/original-product-device-v4-source-contract.mjs';
import {PRODUCT_DEVICE_V4_PENDING_PURPOSE} from '../native/original-product-device-v4-pending-source-contract.mjs';
import{PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE}from'../native/original-product-device-v4-provisioning-source-contract.mjs';
const devicePurpose=p=>[PRODUCT_DEVICE_V4_SOURCE_PURPOSE,PRODUCT_DEVICE_V4_PENDING_PURPOSE,PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE].includes(p);
import {fetchOriginalNativeAuthorization} from '../native/original-ide-auth-proof-dispatch.mjs';
import {parsePQAccountAuthorization,inspectPQAuthorizationView,assertPQAuthorizationCurrent} from './pq-wallet-policy.js';
import {verifyPQRegisteredMemberData} from './pq-registered-member.js';
const fail=code=>{throw Object.assign(Error(code),{code});};
const roles=Object.freeze({enrollment:'AUTH-SOURCE-ENROLLMENT',profile:'AUTH-SOURCE-PROFILE'});
// Existing separately admitted families plus the dedicated device-v4 CODE
// contract. This creates no admitted row/approval/key/Root. RECEIVE remains the
// normal AdministrationProfile/private-daemon + IDE-parent Source family.
const PURPOSES=Object.freeze(['wallet-pq-host-catalog-source-v1','AUTH-IDENTITY-RECEIVE',PRODUCT_DEVICE_V4_SOURCE_PURPOSE,PRODUCT_DEVICE_V4_PENDING_PURPOSE,PRODUCT_DEVICE_V4_PROVISIONING_PURPOSE]);
function document(raw){let v;try{v=JSON.parse(raw);}catch{fail('AUTH_ISSUANCE_CANONICAL');}if(typeof raw!=='string'||Buffer.byteLength(raw)>393216||canonical(v)!==raw)fail('AUTH_ISSUANCE_CANONICAL');return v;}
function exact(v,names){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).sort().join('|')!==names.slice().sort().join('|')||Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!Object.hasOwn(d,'value')))fail('AUTH_ISSUANCE_SCHEMA');}
function window(v,now){if(!Number.isSafeInteger(v.issuedAtMs)||!Number.isSafeInteger(v.expiresAtMs)||v.issuedAtMs<0||v.expiresAtMs<=v.issuedAtMs||v.expiresAtMs-v.issuedAtMs>86400000||now<v.issuedAtMs||now>=v.expiresAtMs)fail('AUTH_ISSUANCE_EXPIRED');}
function independentApproval(p,raw,now){
 const a=document(raw),message=encodeOriginalAuthSourceStatementV2(p.role,p.policy.signatureContract[p.role+'Frame'],p.binding,p.bodyRaw);
 exact(a,['version','role','purpose','owner','networkId','keyVersion','bodySHA256','messageSHA256','decision','issuedAtMs','expiresAtMs']);
 if(sha(raw)!==p.approvalDigest||a.version!=='YNX-ORIGINAL-SOURCE-ISSUANCE-APPROVAL/v1'||a.role!==p.role||a.purpose!==roles[p.role]||a.owner!==p.binding.owner||a.networkId!==p.binding.networkId||a.keyVersion!==p.binding.keyVersion||a.bodySHA256!==sha(p.bodyRaw)||a.messageSHA256!==sha(message)||a.decision!=='approved')fail('AUTH_ISSUANCE_INDEPENDENT_APPROVAL_REQUIRED');
 window(a,now);return{message,a};
}
// Testable lifecycle only. Normal acquisition below supplies all custody and
// observations itself; this class is not accepted as a production service.
export class OriginalSourceIssuanceV2Kernel {
 #plan;#approval;#signer;#io;#observe;#clock;#loan;#floor=0;#entered=false;#selected=false;#attempted=false;#retired=false;#unknown=false;#first;#hasFirst=false;#partial;#completion;#closeSelected=false;#closeFailed=false;#closeCause;
 constructor(plan,approval,signer,io,observe,clock=Date.now){this.#plan=structuredClone(plan);this.#approval=approval;this.#signer=signer;this.#io=io;this.#observe=observe;this.#clock=clock;}
 #alive(){if(this.#retired||this.#unknown||this.#closeSelected)fail('AUTH_ISSUANCE_UNRESOLVED');}
 #now(){const n=this.#clock();if(!Number.isSafeInteger(n)||n<0||n<this.#floor)fail('AUTH_ISSUANCE_CLOCK_ROLLBACK');this.#floor=n;return n;}
 #remember(e){this.#unknown=true;if(!this.#hasFirst){this.#hasFirst=true;this.#first=e;}}
 #check(views){
  this.#alive();const p=this.#plan;
  exact(p,['role','rootRaw','enrollmentRaw','bodyRaw','policy','binding','approvalDigest','journalPath']);
  if(!Object.hasOwn(roles,p.role)||!PURPOSES.includes(p.policy.signatureContract.purpose))fail('AUTH_ISSUANCE_DEDICATED_ROLE_REQUIRED');
  const root=document(p.rootRaw),body=document(p.bodyRaw),binding=p.binding;
  if(devicePurpose(p.policy.signatureContract.purpose))inspectOriginalProductDeviceV4IssuanceBodyDATA(p.role,p.rootRaw,p.enrollmentRaw,p.bodyRaw,p.policy,views,this.#now());
  if(sha(p.rootRaw)!==p.policy.rootDigest||root.purpose!==p.policy.signatureContract.purpose||body.purpose!==root.purpose||root.networkId!==binding.networkId||binding.owner!==(p.role==='enrollment'?root.rootOwner:document(Buffer.from(document(p.enrollmentRaw).body,'base64url').toString('utf8')).profileOwner))fail('AUTH_ISSUANCE_ROLE_BINDING');
  // A normal profile may not borrow even an independently signed catalog
  // enrollment. Reject this BEFORE intent persistence or any signing effect,
  // not merely in the output verifier after a signature already exists.
  if(p.role==='profile'){
   verifyOriginalAuthSourceEnrollmentV2(p.rootRaw,p.enrollmentRaw,p.policy,views,this.#now());
   if(body.enrollmentDigest!==sha(p.enrollmentRaw))fail('AUTH_ISSUANCE_ROLE_BINDING');
  }
  const snapshot=views[p.role==='enrollment'?'root':'profile'],v=inspectPQAuthorizationView(snapshot);
  if(!v.pqSigningEnabled||!v.activeRecord||v.authorizationStatus==='revoked'||snapshot.networkId!==binding.networkId||snapshot.owner!==binding.owner||snapshot.executionHeight!==binding.executionHeight||v.activeRecord.revision!==binding.keyVersion)fail('AUTH_ISSUANCE_ROLE_NOT_CURRENT');
  const approvalRaw=this.#approval.readOriginal(),{message,a}=independentApproval(p,approvalRaw,this.#now());
  this.#signer.assertCurrent(snapshot);if(this.#loan&&this.#io.ready(this.#loan)!==undefined)fail('AUTH_ISSUANCE_CUSTODY_CHANGED');
  if(this.#approval.readOriginal()!==approvalRaw)fail('AUTH_ISSUANCE_APPROVAL_CHANGED');
  const n=this.#now();this.#alive();window(body,n);window(a,n);return{snapshot,message};
 }
 async initialize(){
  if(this.#selected)fail('AUTH_ISSUANCE_ALREADY_SELECTED');this.#selected=true;
  try{const views=await this.#observe();this.#check(views);this.#loan=this.#io.openV2(dirname(this.#plan.journalPath),basename(this.#plan.journalPath));this.#check(views);
   if(this.#io.list(this.#loan).length!==0)fail('AUTH_ISSUANCE_PREVIOUS_ATTEMPT_UNKNOWN');this.#check(views);
  }catch(e){this.#remember(e);throw e;}
 }
 async issueSelected(){
  this.#alive();if(!this.#loan||this.#entered||this.#attempted)fail('AUTH_ISSUANCE_NOT_READY');this.#entered=true;this.#attempted=true;
  try{const before=await this.#observe(),{snapshot,message}=this.#check(before),p=this.#plan;
   const marker=sha(canonical({role:p.role,approvalDigest:p.approvalDigest,bodySHA256:sha(p.bodyRaw)}));
   // Persist selected intent BEFORE a signature may exist. Orphan/restart is
   // UNKNOWN and requires original reconciliation, never implicit re-signing.
   const entered=canonical({version:1,role:p.role,approvalDigest:p.approvalDigest,bodySHA256:sha(p.bodyRaw)});
   this.#partial=Object.freeze({phase:'SELECTED',marker,bodyRaw:p.bodyRaw});this.#io.write(this.#loan,marker+'.entered',entered);this.#check(before);
   const member=this.#signer.signSelected(message,p.binding,snapshot),raw=canonicalOriginalAuthSourceEnvelopeV2(p.role,p.binding,p.bodyRaw,member);
   this.#partial=Object.freeze({phase:'SIGNED',marker,original:raw});
   verifyPQRegisteredMemberData(snapshot,member,{chainId:p.binding.networkId,owner:p.binding.owner,keyVersion:p.binding.keyVersion,executionHeight:p.binding.executionHeight,purpose:roles[p.role],message});
   const outputPolicy=p.role==='enrollment'?{...p.policy,enrollmentDigest:sha(raw)}:p.policy;
   if(p.role==='enrollment')verifyOriginalAuthSourceEnrollmentV2(p.rootRaw,raw,outputPolicy,before,this.#now());
   else verifyOriginalAuthSourceProfileV2(p.rootRaw,p.enrollmentRaw,raw,outputPolicy,before,this.#now());
   const after=await this.#observe();for(const role of ['root','profile','current','subject']){assertPQAuthorizationCurrent(before[role],after[role]);if(before[role].executionHeight!==after[role].executionHeight)fail('AUTH_ISSUANCE_OBSERVATION_CHANGED');}
   this.#check(after);const terminal=canonical({version:1,originalSHA256:sha(raw)});this.#io.write(this.#loan,marker+'.terminal',terminal);
   if(this.#io.read(this.#loan,marker+'.entered')!==entered||this.#io.read(this.#loan,marker+'.terminal')!==terminal)fail('AUTH_ISSUANCE_READBACK_UNKNOWN');
   this.#check(after);this.#completion={raw,after,marker,entered,terminal};return raw;
  }catch(e){this.#remember(e);throw e;}finally{this.#entered=false;}
 }
 assertOriginalCompletion(raw){
  const c=this.#completion;if(!c||raw!==c.raw||this.#entered)fail('AUTH_ISSUANCE_COMPLETION_NOT_ORIGINAL');
  try{if(this.#io.read(this.#loan,c.marker+'.entered')!==c.entered||this.#io.read(this.#loan,c.marker+'.terminal')!==c.terminal)fail('AUTH_ISSUANCE_READBACK_UNKNOWN');this.#check(c.after);}
  catch(e){this.#remember(e);throw e;}
 }
 retire(){this.#retired=true;}
 join(){if(!this.#retired||this.#entered)fail('AUTH_ISSUANCE_JOIN_PENDING');}
 close(){if(this.#closeSelected){if(this.#closeFailed)throw this.#closeCause;return;}this.retire();this.join();this.#closeSelected=true;for(const work of [()=>{if(this.#loan&&this.#io.close(this.#loan)!==undefined)fail('AUTH_ISSUANCE_CLOSE_UNKNOWN');},()=>this.#signer.close(),()=>this.#approval.close()])try{work();}catch(e){this.#remember(e);if(!this.#closeFailed){this.#closeFailed=true;this.#closeCause=e;}}if(this.#closeFailed)throw this.#closeCause;}
 status(){return Object.freeze({unknown:this.#unknown,firstCausePresent:this.#hasFirst,firstCause:this.#first,partial:this.#partial,closeFailed:this.#closeFailed,closeCause:this.#closeCause});}
}
// Public approval ORIGINAL, not a private-key container. Only the independent
// release pin selects it. Never caller JSON/ENV or a boolean from this process.
class ProtectedApprovalOriginal {
 #ref;#fd;#stat;#raw;#parents=[];#closeSelected=false;#closeFailed=false;#closeCause;
 constructor(ref){this.#ref=structuredClone(ref);}
 initialize(){const r=this.#ref;if(realpathSync(r.path)!==r.path)fail('AUTH_ISSUANCE_APPROVAL_PATH');for(let p=dirname(r.path);;p=dirname(p)){const s=lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))fail('AUTH_ISSUANCE_APPROVAL_PARENT');this.#parents.push([p,s]);if(p==='/')break;}
  this.#fd=openSync(r.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);this.#stat=fstatSync(this.#fd);const s=this.#stat;
  if(!s.isFile()||s.nlink!==1||s.uid!==0||String(s.dev)!==r.device||String(s.ino)!==r.inode||s.gid!==r.gid||(s.mode&0o777)!==r.mode||s.size!==r.bytes||s.size<1||s.size>393216||(s.mode&0o022))fail('AUTH_ISSUANCE_APPROVAL_TUPLE');this.#raw=readFileSync(this.#fd,'utf8');if(sha(this.#raw)!==r.sha256)fail('AUTH_ISSUANCE_APPROVAL_CHANGED');this.readOriginal();
 }
 readOriginal(){if(this.#fd===undefined)fail('AUTH_ISSUANCE_APPROVAL_CLOSED');const same=(a,b)=>['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);if(!same(this.#stat,fstatSync(this.#fd))||!same(this.#stat,lstatSync(this.#ref.path))||realpathSync(this.#ref.path)!==this.#ref.path)fail('AUTH_ISSUANCE_APPROVAL_CHANGED');for(const[p,s]of this.#parents)if(!same(s,lstatSync(p)))fail('AUTH_ISSUANCE_APPROVAL_PARENT_CHANGED');return this.#raw;}
 close(){if(this.#closeSelected){if(this.#closeFailed)throw this.#closeCause;return;}this.#closeSelected=true;try{if(this.#fd!==undefined)closeSync(this.#fd);}catch(e){this.#closeFailed=true;this.#closeCause=e;throw e;}finally{this.#fd=undefined;}}
}
// Internal release loader. Callers cannot pass a signer callback, role keys,
// approval string or HTTP body to the normal administrative entrypoint.
export async function loadReleaseSelectedOriginalSourceIssuanceV2(entry){
 if(process.versions.node!=='26.7.0'||process.versions.openssl!=='3.6.4')fail('AUTH_ISSUANCE_NATIVE_RUNTIME_REQUIRED');
 let approval,a,b,keys,kernel,closed=false,first,present=false;
 const close=()=>{if(closed){if(present)throw first;return;}closed=true;for(const work of [()=>{if(keys&&!destroyKey(keys.privateKey))fail('AUTH_ISSUANCE_KEY_CLOSE_UNKNOWN');},()=>b?.close(),()=>a?.close()])try{work();}catch(e){if(!present){present=true;first=e;}}if(present)throw first;};
 try{
  if(!Object.hasOwn(roles,entry.plan.role)||!PURPOSES.includes(entry.plan.policy.signatureContract.purpose)||entry.plan.approvalDigest!==entry.approval.sha256)fail('AUTH_ISSUANCE_DEDICATED_ROLE_REQUIRED');
  approval=new ProtectedApprovalOriginal(entry.approval);approval.initialize();
  // Denial/expiry/mismatched exact operation refuses before touching role keys.
  independentApproval(entry.plan,approval.readOriginal(),Date.now());
  const root=document(entry.plan.rootRaw),e=entry.plan.role==='enrollment'?document(entry.plan.bodyRaw):document(Buffer.from(document(entry.plan.enrollmentRaw).body,'base64url').toString('utf8')),p=entry.plan.role==='profile'?document(entry.plan.bodyRaw):null;
  const owners=[root.rootOwner,e.profileOwner,e.currentOwner,p?.subjectOwner??entry.subjectOwner];
  const observe=async()=>{const values=await Promise.all(owners.map(async owner=>parsePQAccountAuthorization(await fetchOriginalNativeAuthorization(entry.node,owner),{chainId:root.networkId,nativeChainId:entry.node.nativeChainId,owner})));if(values.some(v=>v.executionHeight!==values[0].executionHeight))fail('AUTH_ISSUANCE_OBSERVATION_CHANGED');return Object.fromEntries(['root','profile','current','subject'].map((r,i)=>[r,values[i]]));};
  const firstViews=await observe(),selected=firstViews[entry.plan.role==='enrollment'?'root':'profile'],record=inspectPQAuthorizationView(selected).activeRecord;if(!record)fail('AUTH_ISSUANCE_ROLE_NOT_CURRENT');
  if(entry.plan.binding.owner!==selected.owner||entry.plan.binding.networkId!==selected.networkId||entry.plan.binding.keyVersion!==record.revision||entry.plan.binding.executionHeight!==selected.executionHeight)fail('AUTH_ISSUANCE_ROLE_BINDING');
  if(devicePurpose(entry.plan.policy.signatureContract.purpose))inspectOriginalProductDeviceV4IssuanceBodyDATA(entry.plan.role,entry.plan.rootRaw,entry.plan.enrollmentRaw,entry.plan.bodyRaw,entry.plan.policy,firstViews,Date.now());
  independentApproval(entry.plan,approval.readOriginal(),Date.now());
  window(document(entry.plan.bodyRaw),Date.now());
  // Separate roleKeys, never entry.currentKeys. Their original protected
  // custodian must independently authorize this release's fixed role.
  a=new OriginalSourceCurrentV2KeyFile(entry.roleKeys.A);a.initialize();b=new OriginalSourceCurrentV2KeyFile(entry.roleKeys.B);b.initialize();keys=importKeyMaterial({format:KEY_MATERIAL_FORMAT,algorithmVersion:'YNX-BATCH/v0.1',suite:SUITE,pkcs8A:a.raw,pkcs8B:b.raw,pkA:Buffer.from(record.pkA,'hex'),pkB:Buffer.from(record.pkB,'hex')},{provider:'native'});
  const signer={assertCurrent(view){if(closed)fail('AUTH_ISSUANCE_KEY_CLOSED');a.assertCurrent();b.assertCurrent();assertPQAuthorizationCurrent(selected,view);},signSelected(message,binding,view){this.assertCurrent(view);let batch;try{batch=batchSign(keys.privateKey,{chainId:Buffer.from(binding.networkId,'hex'),owner:binding.owner,purpose:roles[entry.plan.role]},[Buffer.from(message)]).batch;return encodeMember(extract(batch,0));}finally{if(batch)discardBatch(batch);}},close};
  const io=createRequire(import.meta.url)(fileURLToPath(new URL('../../../apps/wallet-desktop/native/original-source-current-dirfd.node',import.meta.url)));
  kernel=new OriginalSourceIssuanceV2Kernel(entry.plan,approval,signer,io,observe);await kernel.initialize();return kernel;
 }catch(error){return Object.freeze({partial:kernel??{retire(){},join(){},close(){let first,present=false;try{close();}catch(e){first=e;present=true;}try{approval?.close();}catch(e){if(!present){first=e;present=true;}}if(present)throw first;}},error});}finally{a?.wipe();b?.wipe();}
}
