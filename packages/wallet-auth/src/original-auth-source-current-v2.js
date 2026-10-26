// PRIVATE normal Source-current counterpart. A PUBLIC test kernel is not a
// service registration. Only the release-selected original factory may mount.
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,basename} from 'node:path';
import {openSync,readFileSync,fstatSync,lstatSync,realpathSync,closeSync,constants} from 'node:fs';
import {batchSign,extract,encodeMember,discardBatch,importKeyMaterial,destroyKey,KEY_MATERIAL_FORMAT,SUITE} from '@ynx/batch-v01-candidate';
import {canonical,sha} from '../native/original-auth-identity-source-verifier.mjs';
import {PRODUCT_DEVICE_V4_SOURCE_PURPOSE} from '../native/original-product-device-v4-source-contract.mjs';
import {verifyOriginalAuthSourceProfileV2,verifyOriginalAuthSourceTransitionV2,verifyOriginalAuthSourceCurrentV2,encodeOriginalAuthSourceStatementV2,canonicalOriginalAuthSourceEnvelopeV2} from '../native/original-auth-identity-source-v2-verifier.mjs';
import {fetchOriginalNativeAuthorization} from '../native/original-ide-auth-proof-dispatch.mjs';
import {parsePQAccountAuthorization,inspectPQAuthorizationView,assertPQAuthorizationCurrent} from './pq-wallet-policy.js';
import {encodeOriginalIDEApprovalCurrentDATA,canonicalOriginalIDEApprovalCurrentDATA,verifyOriginalIDEApprovalCurrentDATA,inspectOriginalIDEApprovalScopeDATA,ORIGINAL_IDE_APPROVAL_SOURCE_PURPOSE} from '../native/original-ide-publication-approval-contract.mjs';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const CAP=393216,ZERO=Object.freeze({sequence:0,floor:0,head:'',timeFloor:0,executionHeight:'0'});
const nonced=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value)&&Buffer.from(value,'base64url').toString('base64url')===value;
// EXACT original Go store digest, without parsing decimal counters as Number.
// Only opaque hash/counter/enum fields occur here; no alternate grant codec.
import {originalApprovalStateHeadDATA} from '../native/original-ide-approval-state-head-data.mjs';
import {readOriginalDeveloperHTTPCredential,assertOriginalDeveloperHTTPCredentialCompletion} from './product-session-gateway-node-host.js';
import {encodeOriginalDeveloperPrincipalDATA} from '../native/original-developer-principal-data.mjs';
export {originalApprovalStateHeadDATA};
function parsed(raw,cap=CAP){if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw)>cap)fail('AUTH_SOURCE_V2_CAPACITY');let v;try{v=JSON.parse(raw);}catch{fail('AUTH_SOURCE_V2_CANONICAL');}if(canonical(v)!==raw)fail('AUTH_SOURCE_V2_CANONICAL');return v;}
function hint(raw){const e=parsed(raw),b=Buffer.from(e.body??'','base64url');if(e.version!==2||e.role!=='profile'&&e.role!=='enrollment'&&e.role!=='current'||!b.length||b.length>65536||b.toString('base64url')!==e.body)fail('AUTH_SOURCE_V2_ENVELOPE');return parsed(new TextDecoder('utf8',{fatal:true}).decode(b),65536);}
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).sort().join('|')!==keys.slice().sort().join('|')||Object.values(Object.getOwnPropertyDescriptors(v)).some(d=>!Object.hasOwn(d,'value')||!d.enumerable))fail('AUTH_SOURCE_V2_SCHEMA');}
function sameViews(before,after){for(const role of ['root','profile','current','subject']){assertPQAuthorizationCurrent(before[role],after[role]);if(before[role].executionHeight!==after[role].executionHeight)fail('AUTH_SOURCE_V2_HEIGHT_CHANGED');}}

export class OriginalAuthSourceCurrentV2Kernel {
 #root;#enrollment;#profiles=new Map();#policy;#node;#get;#clock;#signer;#io;#loan;#rows=new Map();#nonces=new Map();#floor=0;#height=0n;#entered=false;#initialized=false;#retired=false;#closed=false;#closeSelected=false;#closeCause;#closeFailed=false;#unknown=false;#first;#firstPresent=false;#partial;#completionViews;#completionRaw;#principalCompletions=new WeakMap();#approvalCompletion;
 constructor(rootRaw,enrollmentRaw,profiles,policy,node,signer,nativeIO,clock=Date.now,get=fetchOriginalNativeAuthorization){
  // Explicit test seams exist only here. Normal loader supplies the fixed
  // fetcher, native signer and native directory owner; no request can select.
  this.#root=rootRaw;this.#enrollment=enrollmentRaw;this.#policy=structuredClone(policy);this.#node=structuredClone(node);this.#clock=clock;this.#get=get;this.#signer=signer;this.#io=nativeIO;
  exact(node,['origin','spki','nativeChainId']);const r=parsed(rootRaw,16384),e=hint(enrollmentRaw);
  if(r.version!==2||r.algorithmVersion!=='YNX-BATCH/v0.1'||sha(rootRaw)!==policy.rootDigest||sha(enrollmentRaw)!==policy.enrollmentDigest||typeof e.currentStatePath!=='string')fail('AUTH_SOURCE_V2_NOT_PINNED');
  if(!Array.isArray(profiles)||!profiles.length||profiles.length>32)fail('AUTH_SOURCE_V2_PROFILES');
  for(const raw of profiles){const digest=sha(raw);if(this.#profiles.has(digest))fail('AUTH_SOURCE_V2_PROFILE_DUPLICATE');this.#profiles.set(digest,{raw,body:hint(raw)});}
 }
 #remember(error){this.#unknown=true;if(!this.#firstPresent){this.#firstPresent=true;this.#first=error;}}
 #time(){const now=this.#clock();if(!Number.isSafeInteger(now)||now<0||now<this.#floor)fail('AUTH_SOURCE_V2_CLOCK_ROLLBACK');this.#floor=now;return now;}
 #alive(){if(this.#retired||this.#unknown||this.#closed)fail('AUTH_SOURCE_V2_UNRESOLVED');}
 async #views(profile){
  const root=parsed(this.#root,16384),e=hint(this.#enrollment),owners=[root.rootOwner,e.profileOwner,e.currentOwner,profile.body.subjectOwner];
  if(owners.some(o=>typeof o!=='string'||!/^0x[0-9a-f]{40}$/.test(o)))fail('AUTH_SOURCE_V2_OWNER');
  const snapshots=await Promise.all(owners.map(async owner=>parsePQAccountAuthorization(await this.#get(this.#node,owner),{chainId:root.networkId,nativeChainId:this.#node.nativeChainId,owner})));
  const height=snapshots[0].executionHeight;if(snapshots.some(s=>s.executionHeight!==height)||BigInt(height)<this.#height)fail('AUTH_SOURCE_V2_OBSERVATION_ROLLBACK');this.#height=BigInt(height);
  return Object.fromEntries(['root','profile','current','subject'].map((k,i)=>[k,snapshots[i]]));
 }
 #verify(profile,views){this.#alive();const v=verifyOriginalAuthSourceProfileV2(this.#root,this.#enrollment,profile.raw,this.#policy,views,this.#time());this.#signer.assertCurrent(views.current);if(this.#loan&&this.#io.ready(this.#loan)!==undefined)fail('AUTH_SOURCE_V2_CUSTODY_CHANGED');return v;}
 async #post(profile,before,expires=Infinity){const after=await this.#views(profile);sameViews(before,after);const v=this.#verify(profile,after);if(this.#time()>=Math.min(expires,v.profile.expiresAtMs,v.enrollment.expiresAtMs))fail('AUTH_SOURCE_V2_EXPIRED');return after;}
 // An awaited post-check is not the caller's completion boundary: queued
 // retirement/time/custody effects may run before its continuation resumes.
 // Recheck actual same-owner custody and exact original receipt synchronously
 // AFTER that await, then fence time/liveness after the last foreign read.
 #completed(profile,views,expires=Infinity,receipt=null){
  this.#alive();this.#signer.assertCurrent(views.current);
  if(this.#loan&&this.#io.ready(this.#loan)!==undefined)fail('AUTH_SOURCE_V2_CUSTODY_CHANGED');
  if(receipt&&(this.#rows.get(receipt.digest)!==receipt.state||this.#io.read(this.#loan,receipt.key+'.entered')!==receipt.raw||this.#io.read(this.#loan,receipt.key+'.terminal')!==receipt.terminal))fail('AUTH_SOURCE_V2_POST_COMPLETION_CHANGED');
  const limit=Math.min(expires,profile.body.expiresAtMs,hint(this.#enrollment).expiresAtMs,this.#policy.signatureContract.purpose==='ide-project-control-authority-v1'?Number(profile.body.selection.projectControlCapture.expiresAtMs):Infinity);
  const now=this.#time();this.#alive();if(now>=limit)fail('AUTH_SOURCE_V2_POST_COMPLETION_EXPIRED');
 }
 async initialize(){
  if(this.#entered||this.#initialized||this.#loan)fail('AUTH_SOURCE_V2_ALREADY_SELECTED');this.#alive();this.#entered=true;
  try{
   const observations=new Map();let path;
   for(const [digest,p]of this.#profiles){const before=await this.#views(p),v=this.#verify(p,before);path=v.enrollment.currentStatePath;observations.set(digest,before);}
   // Retain the partial native owner BEFORE ready/list may throw.
   this.#loan=this.#io.openV2(dirname(path),basename(path));if(this.#io.ready(this.#loan)!==undefined)fail('AUTH_SOURCE_V2_CUSTODY_CHANGED');
   const names=this.#io.list(this.#loan);if(!Array.isArray(names)||names.length>128||new Set(names).size!==names.length||names.some(n=>!/^[a-f0-9]{64}\.(entered|terminal)$/.test(n)))fail('AUTH_SOURCE_V2_HISTORY_INVALID');
   const events=[];
   for(const name of names.filter(n=>n.endsWith('.entered'))){
    const key=name.slice(0,64);if(!names.includes(key+'.terminal'))fail('AUTH_SOURCE_V2_COLD_UNKNOWN');
    const raw=this.#io.read(this.#loan,name),event=parsed(raw),terminal=parsed(this.#io.read(this.#loan,key+'.terminal'));exact(event,['version','profileDigest','previousDigest','currentRaw']);exact(terminal,['version','eventDigest']);
    if(event.version!==2||terminal.version!==2||terminal.eventDigest!==sha(raw))fail('AUTH_SOURCE_V2_HISTORY_INVALID');const p=this.#profiles.get(event.profileDigest);if(!p)fail('AUTH_SOURCE_V2_PROFILE_NOT_REGISTERED');
    const body=hint(event.currentRaw),projection=verifyOriginalAuthSourceTransitionV2(this.#root,this.#enrollment,p.raw,event.currentRaw,this.#policy,observations.get(event.profileDigest),body.nonce,ZERO,this.#time());
    if(sha(canonical({profileDigest:event.profileDigest,sequence:projection.sequence}))!==key)fail('AUTH_SOURCE_V2_HISTORY_INVALID');events.push({raw,event,projection,body});
   }
   if(names.length!==events.length*2)fail('AUTH_SOURCE_V2_COLD_UNKNOWN');events.sort((a,b)=>a.projection.sequence-b.projection.sequence);
   for(const {raw,event,projection,body}of events){const old=this.#rows.get(event.profileDigest),p=this.#profiles.get(event.profileDigest);if(projection.sequence!==(old?old.sequence+1:p.body.minimumSequence)||event.previousDigest!==(old?.recordDigest??'')||old&&(projection.floor<old.floor||body.issuedAtMs<old.issuedAtMs||BigInt(projection.statementExecutionHeight)<BigInt(old.statementExecutionHeight)||old.status!=='active'&&projection.status!==old.status))fail('AUTH_SOURCE_V2_HISTORY_ROLLBACK');this.#rows.set(event.profileDigest,{...projection,issuedAtMs:body.issuedAtMs,recordDigest:sha(raw)});}
   const completed=new Map();for(const [digest,p]of this.#profiles)completed.set(digest,await this.#post(p,observations.get(digest)));
   for(const [digest,p]of this.#profiles)this.#completed(p,completed.get(digest));
   const finalTime=this.#time();this.#alive();for(const p of this.#profiles.values())if(finalTime>=Math.min(p.body.expiresAtMs,hint(this.#enrollment).expiresAtMs,this.#policy.signatureContract.purpose==='ide-project-control-authority-v1'?Number(p.body.selection.projectControlCapture.expiresAtMs):Infinity))fail('AUTH_SOURCE_V2_POST_COMPLETION_EXPIRED');
   this.#initialized=true;
  }catch(error){this.#remember(error);throw error;}finally{this.#entered=false;}
 }
 #body(p,digest,state,challenge,v){const now=this.#time();return {version:2,purpose:this.#policy.signatureContract.purpose,sourceId:v.profile.sourceId,enrollmentDigest:this.#policy.enrollmentDigest,profileDigest:digest,instanceId:v.profile.instanceId,generation:v.profile.generation,subjectOwner:v.profile.subjectOwner,subjectKeyVersion:v.subjectKeyVersion,sequence:state.sequence,floor:state.floor,head:state.head,status:state.status,nonce:challenge,issuedAtMs:now,expiresAtMs:Math.min(now+30000,v.profile.expiresAtMs,v.enrollment.expiresAtMs,this.#policy.signatureContract.purpose==='ide-project-control-authority-v1'?Number(p.body.selection.projectControlCapture.expiresAtMs):Infinity)};}
 #signed(body,v,views){const binding={networkId:v.root.networkId,owner:v.enrollment.currentOwner,keyVersion:views.current.activeRevision,executionHeight:views.current.executionHeight};const bodyRaw=canonical(body),message=encodeOriginalAuthSourceStatementV2('current',this.#policy.signatureContract.currentFrame,binding,bodyRaw);this.#partial=Object.freeze({phase:'SIGN_SELECTED',profileDigest:body.profileDigest,nonce:body.nonce,bodyRaw});const member=this.#signer.signCurrent(message,binding,views.current);const raw=canonicalOriginalAuthSourceEnvelopeV2('current',binding,bodyRaw,member);this.#partial=Object.freeze({phase:'SIGNED',profileDigest:body.profileDigest,nonce:body.nonce,currentRaw:raw});return raw;}
 async transition(profileDigest,state){
  this.#alive();if(!this.#initialized||this.#entered)fail('AUTH_SOURCE_V2_NOT_READY');this.#entered=true;
  try{const p=this.#profiles.get(profileDigest);if(!p)fail('AUTH_SOURCE_V2_PROFILE_NOT_REGISTERED');exact(state,['status','floor','head']);const before=await this.#views(p),v=this.#verify(p,before),old=this.#rows.get(profileDigest),sequence=old?old.sequence+1:p.body.minimumSequence;
   if(!Number.isSafeInteger(sequence)||!['active','revoked','retired'].includes(state.status)||!Number.isSafeInteger(state.floor)||state.floor<Math.max(p.body.minimumFloor,old?.floor??0)||state.floor>sequence||typeof state.head!=='string'||!/^[a-f0-9]{64}$/.test(state.head)||old&&old.status!=='active'&&state.status!==old.status)fail('AUTH_SOURCE_V2_TRANSITION_INVALID');
   if(this.#policy.signatureContract.purpose===PRODUCT_DEVICE_V4_SOURCE_PURPOSE&&state.head!==sha(canonical(p.body.selection.productSessionDeviceV4)))fail('AUTH_SOURCE_V2_DEVICE_HEAD');
   const body=this.#body(p,profileDigest,{...state,sequence},randomBytes(32).toString('base64url'),v),currentRaw=this.#signed(body,v,before),projection=verifyOriginalAuthSourceTransitionV2(this.#root,this.#enrollment,p.raw,currentRaw,this.#policy,before,body.nonce,ZERO,this.#time()),raw=canonical({version:2,profileDigest,previousDigest:old?.recordDigest??'',currentRaw});if(Buffer.byteLength(raw)>CAP)fail('AUTH_SOURCE_V2_CAPACITY');
   // Signing and persistence are within one selected operation. Any later
   // exception preserves the exact signed partial and poisons this owner.
   const key=sha(canonical({profileDigest,sequence})),terminal=canonical({version:2,eventDigest:sha(raw)});this.#io.write(this.#loan,key+'.entered',raw);this.#io.write(this.#loan,key+'.terminal',terminal);if(this.#io.read(this.#loan,key+'.entered')!==raw||this.#io.read(this.#loan,key+'.terminal')!==terminal)fail('AUTH_SOURCE_V2_READBACK_UNKNOWN');
   const after=await this.#post(p,before,body.expiresAtMs);
   this.#completed(p,after,body.expiresAtMs,{digest:profileDigest,state:old,key,raw,terminal});
   this.#rows.set(profileDigest,{...projection,issuedAtMs:body.issuedAtMs,recordDigest:sha(raw)});
  }catch(error){this.#remember(error);throw error;}finally{this.#entered=false;}
 }
 async current(profileDigest,challenge){
  this.#alive();if(!nonced(challenge))fail('AUTH_SOURCE_V2_NONCE_INVALID');if(!this.#initialized||this.#entered)fail('AUTH_SOURCE_V2_NOT_READY');
  // Public malformed/unknown/replayed requests are denied before operation
  // selection. They must not poison every tenant's genuine service owner.
  const p=this.#profiles.get(profileDigest),state=this.#rows.get(profileDigest);if(!p||!state||state.status!=='active')fail('AUTH_SOURCE_V2_PROFILE_NOT_ACTIVE');const now=this.#time();for(const [n,t]of this.#nonces)if(now-t>=30000)this.#nonces.delete(n);const n=profileDigest+':'+challenge;if(this.#nonces.has(n)||this.#nonces.size>=4096)fail('AUTH_SOURCE_V2_REPLAY_OR_CAPACITY');this.#entered=true;
  try{this.#nonces.set(n,now);
   const before=await this.#views(p),v=this.#verify(p,before),key=sha(canonical({profileDigest,sequence:state.sequence})),raw=this.#io.read(this.#loan,key+'.entered');if(sha(raw)!==state.recordDigest||this.#io.read(this.#loan,key+'.terminal')!==canonical({version:2,eventDigest:state.recordDigest}))fail('AUTH_SOURCE_V2_HISTORY_CHANGED');
   const body=this.#body(p,profileDigest,state,challenge,v),signed=this.#signed(body,v,before);verifyOriginalAuthSourceCurrentV2(this.#root,this.#enrollment,p.raw,signed,this.#policy,before,challenge,{sequence:state.sequence,floor:state.floor,head:state.head,timeFloor:now,executionHeight:state.executionHeight},this.#time());
   const after=await this.#post(p,before,body.expiresAtMs);
   this.#completed(p,after,body.expiresAtMs,{digest:profileDigest,state,key,raw,terminal:canonical({version:2,eventDigest:state.recordDigest})});this.#completionViews=after;this.#completionRaw=signed;return signed;
  }catch(error){this.#remember(error);throw error;}finally{this.#entered=false;}
 }
 // Normal HTTP caller's synchronous completion, after awaiting current().
 // Only the SAME private signed partial and current journal row are accepted.
 // This issues nothing and cannot turn a supplied string into an authority.
 assertOriginalCurrentCompletion(profileDigest,challenge,raw){
  this.#alive();if(!this.#initialized||this.#entered||!nonced(challenge))fail('AUTH_SOURCE_V2_NOT_READY');
  const p=this.#profiles.get(profileDigest),state=this.#rows.get(profileDigest),partial=this.#partial;
  if(!p||!state||state.status!=='active'||partial?.phase!=='SIGNED'||partial.profileDigest!==profileDigest||partial.nonce!==challenge||partial.currentRaw!==raw)fail('AUTH_SOURCE_V2_COMPLETION_NOT_ORIGINAL');
  const body=hint(raw);if(body.profileDigest!==profileDigest||body.nonce!==challenge||body.sequence!==state.sequence||body.floor!==state.floor||body.head!==state.head||body.status!==state.status)fail('AUTH_SOURCE_V2_COMPLETION_NOT_ORIGINAL');
  // The selected registered current role was verified by current's original
  // pre/post network observations. Obtain the same independently verified role
  // from the retained signing operation rather than accepting an HTTP view.
  const views=this.#completionViews;
  if(!views||this.#completionRaw!==raw)fail('AUTH_SOURCE_V2_COMPLETION_NOT_ORIGINAL');
  const key=sha(canonical({profileDigest,sequence:state.sequence})),journal=this.#io.read(this.#loan,key+'.entered');
  if(sha(journal)!==state.recordDigest)fail('AUTH_SOURCE_V2_HISTORY_CHANGED');
  this.#completed(p,views,body.expiresAtMs,{digest:profileDigest,state,key,raw:journal,terminal:canonical({version:2,eventDigest:state.recordDigest})});
 }
 assertDeveloperPrincipalPurpose(){this.#alive();if(!this.#initialized||this.#policy.signatureContract.purpose!=='ide-project-authority-v1')fail('AUTH_ORIGINAL_PRINCIPAL_SOURCE_REQUIRED');}
 async existingDeveloperPrincipal(credential){
  this.#alive();if(!this.#initialized||this.#entered||this.#policy.signatureContract.purpose!=='ide-project-authority-v1')fail('AUTH_ORIGINAL_PRINCIPAL_SOURCE_REQUIRED');
  const first=await readOriginalDeveloperHTTPCredential(credential),s=first.session,matches=[];
  for(const[digest,p]of this.#profiles){const a=p.body.selection.association,principal=p.body.selection.projectAuthority?.principal,state=this.#rows.get(digest);if(state?.status==='active'&&principal&&principal.account===s.account&&principal.deviceId===s.deviceId&&principal.sessionRef===s.sessionBinding&&['account','deviceId','clientId','productId','platform','applicationId'].every(k=>a[k]===s[k]))matches.push([digest,p,state]);}
  if(matches.length!==1)fail('AUTH_ORIGINAL_PRINCIPAL_NOT_SELECTED');
  const[digest,p,state]=matches[0],principal=p.body.selection.projectAuthority.principal;
  if(principal.expiresMS>Date.parse(s.expiresAt))fail('AUTH_ORIGINAL_PRINCIPAL_SESSION_WINDOW');
  // No default account/session generation or invented current reference: all
  // seven fields come from the original Root-signed projectAuthority selection.
  const currentRaw=await this.current(digest,randomBytes(32).toString('base64url'));
  const after=await readOriginalDeveloperHTTPCredential(credential);
  if(after!==first||this.#rows.get(digest)!==state)fail('AUTH_ORIGINAL_PRINCIPAL_POST_CHANGED');
  const before=await this.#views(p);this.#verify(p,before);const completed=await this.#post(p,before,Math.min(principal.expiresMS,first.proofExpiresMS));
  const finalCredential=await readOriginalDeveloperHTTPCredential(credential);this.#alive();this.#signer.assertCurrent(before.current);
  if(finalCredential!==first)fail('AUTH_ORIGINAL_PRINCIPAL_POST_CHANGED');
  if(this.#rows.get(digest)!==state||this.#time()>=Math.min(principal.expiresMS,first.proofExpiresMS))fail('AUTH_ORIGINAL_PRINCIPAL_POST_EXPIRED');
  const original=encodeOriginalDeveloperPrincipalDATA({...principal,expiresMS:String(principal.expiresMS)});
  const result=Object.freeze({version:'YNX-ORIGINAL-DEVELOPER-HTTP-PRINCIPAL/v1',principalOriginal:original.principalOriginal,principalSHA256:original.principalSHA256,profileDigest:digest,currentRaw,method:first.method,path:first.path,bodyDigest:first.bodyDigest,expiresAtMs:Math.min(principal.expiresMS,first.proofExpiresMS),dataOnly:true,authorized:false,nativeAdmission:false});
  this.#principalCompletions.set(result,{credential,view:first,p,state,digest,views:completed});
  this.assertOriginalDeveloperPrincipalCompletion(credential,result);return result;
 }
 // Delivery is not a new Source selection: require the original result object,
 // original credential, same active row, same signed journal and retained
 // role/custody. No network/sign/write/replay occurs in this synchronous fence.
 assertOriginalDeveloperPrincipalCompletion(credential,result){
  const r=this.#principalCompletions.get(result);
  if(!r||r.credential!==credential)fail('AUTH_ORIGINAL_PRINCIPAL_COMPLETION_NOT_ORIGINAL');
  this.assertDeveloperPrincipalPurpose();
  if(this.#entered||this.#rows.get(r.digest)!==r.state||r.state.status!=='active')fail('AUTH_ORIGINAL_PRINCIPAL_POST_CHANGED');
  const key=sha(canonical({profileDigest:r.digest,sequence:r.state.sequence})),raw=this.#io.read(this.#loan,key+'.entered');
  if(sha(raw)!==r.state.recordDigest)fail('AUTH_SOURCE_V2_HISTORY_CHANGED');
  this.#completed(r.p,r.views,result.expiresAtMs,{digest:r.digest,state:r.state,key,raw,terminal:canonical({version:2,eventDigest:r.state.recordDigest})});
  if(assertOriginalDeveloperHTTPCredentialCompletion(credential)!==r.view)fail('AUTH_ORIGINAL_PRINCIPAL_POST_CHANGED');
  const end=this.#time();this.#alive();if(end>=result.expiresAtMs)fail('AUTH_ORIGINAL_PRINCIPAL_POST_EXPIRED');
 }
 async publicationApprovalCurrent(profileDigest,scopeOriginal,currentOriginal){
  this.#alive();if(!this.#initialized||this.#entered)fail('AUTH_SOURCE_V2_NOT_READY');
  if(this.#policy.signatureContract.purpose!==ORIGINAL_IDE_APPROVAL_SOURCE_PURPOSE)fail('AUTH_PUBLICATION_DEDICATED_ISSUER_REQUIRED');
  const p=this.#profiles.get(profileDigest),state=this.#rows.get(profileDigest);if(!p||!state||p.body.selection.publicationApprovalAuthority?.scopeOriginal!==scopeOriginal)fail('AUTH_PUBLICATION_SCOPE_NOT_SELECTED');
  const scope=inspectOriginalIDEApprovalScopeDATA(scopeOriginal),body=parsed(currentOriginal,16384);if(!nonced(body.nonce))fail('AUTH_PUBLICATION_NONCE');const beforeTime=this.#time();if(beforeTime<body.issuedAtMs||beforeTime>=body.expiresAtMs||body.expiresAtMs>scope.expiresAtMs)fail('AUTH_PUBLICATION_CURRENT_EXPIRED');
  const nonceKey='approval:'+profileDigest+':'+body.nonce;for(const[k,t]of this.#nonces)if(beforeTime-t>=30000)this.#nonces.delete(k);if(this.#nonces.has(nonceKey)||this.#nonces.size>=4096)fail('AUTH_PUBLICATION_REPLAY_OR_CAPACITY');
  // The normal issuer cannot sign a caller-chosen state. Its exact stable
  // state digest must already be the original protected Source journal head.
  // Service Source liveness and the approval decision are separate. A revoked
  // approval may have a negative current proof from a LIVE issuer; revoking
  // the issuer Source itself must stop every signing operation.
  const head=originalApprovalStateHeadDATA(scopeOriginal,currentOriginal);if(state.head!==head||state.status!=='active')fail('AUTH_PUBLICATION_STATE_NOT_CURRENT');
  this.#entered=true;this.#nonces.set(nonceKey,beforeTime);this.#partial=Object.freeze({phase:'APPROVAL_SELECTED',profileDigest,nonce:body.nonce,scopeOriginal,currentOriginal});
  try{
   const before=await this.#views(p),v=this.#verify(p,before),key=sha(canonical({profileDigest,sequence:state.sequence})),journalRaw=this.#io.read(this.#loan,key+'.entered');if(sha(journalRaw)!==state.recordDigest||this.#io.read(this.#loan,key+'.terminal')!==canonical({version:2,eventDigest:state.recordDigest}))fail('AUTH_PUBLICATION_JOURNAL_CHANGED');
   const binding={networkId:v.root.networkId,owner:v.enrollment.currentOwner,keyVersion:before.current.activeRevision,executionHeight:before.current.executionHeight};const message=encodeOriginalIDEApprovalCurrentDATA(binding,scopeOriginal,currentOriginal);
   if(body.expiresAtMs>Math.min(v.profile.expiresAtMs,v.enrollment.expiresAtMs)||this.#time()>=body.expiresAtMs)fail('AUTH_PUBLICATION_CURRENT_EXPIRED');
   const member=this.#signer.signCurrent(message,binding,before.current),raw=canonicalOriginalIDEApprovalCurrentDATA(binding,scopeOriginal,currentOriginal,Buffer.from(member).toString('base64url'));this.#partial=Object.freeze({phase:'APPROVAL_SIGNED',profileDigest,nonce:body.nonce,approvalCurrentOriginal:raw});
   verifyOriginalIDEApprovalCurrentDATA(raw,before.current,scopeOriginal,body.nonce,{sequence:'0',floor:'0',decision:'',requestState:'',resultOriginalSHA256:'',scopeSHA256:'',timeFloor:0},this.#time());const after=await this.#post(p,before,body.expiresAtMs);
   if(this.#rows.get(profileDigest)!==state||this.#io.read(this.#loan,key+'.entered')!==journalRaw||this.#io.read(this.#loan,key+'.terminal')!==canonical({version:2,eventDigest:state.recordDigest}))fail('AUTH_PUBLICATION_POST_CURRENT_CHANGED');
   // A retained IO/current check is itself a completion boundary. Recheck time
   // after it, not only before entering a callback/native read.
   this.#completed(p,after,body.expiresAtMs,{digest:profileDigest,state,key,raw:journalRaw,terminal:canonical({version:2,eventDigest:state.recordDigest})});
   this.#approvalCompletion={profileDigest,scopeOriginal,currentOriginal,raw,p,after,state,key,journalRaw,expires:body.expiresAtMs};return raw;
  }catch(error){this.#remember(error);throw error;}finally{this.#entered=false;}
 }
 // Synchronous original caller delivery fence, not another approval/signing
 // operation. A string that merely verifies cannot select this completion.
 assertOriginalPublicationApprovalCompletion(profileDigest,scopeOriginal,currentOriginal,raw){
  const c=this.#approvalCompletion;
  if(!c||c.profileDigest!==profileDigest||c.scopeOriginal!==scopeOriginal||c.currentOriginal!==currentOriginal||c.raw!==raw)fail('AUTH_PUBLICATION_COMPLETION_NOT_ORIGINAL');
  try{this.#alive();if(this.#entered)fail('AUTH_SOURCE_V2_NOT_READY');this.#completed(c.p,c.after,c.expires,{digest:profileDigest,state:c.state,key:c.key,raw:c.journalRaw,terminal:canonical({version:2,eventDigest:c.state.recordDigest})});}
  catch(error){this.#remember(error);throw error;}
 }
 retire(){this.#retired=true;}
 join(){if(!this.#retired||this.#entered)fail('AUTH_SOURCE_V2_JOIN_PENDING');}
 close(){if(this.#closeSelected){if(this.#closeFailed)throw this.#closeCause;return;}this.retire();this.join();this.#closeSelected=true;let first,present=false;try{if(this.#loan&&this.#io.close(this.#loan)!==undefined)fail('AUTH_SOURCE_V2_CLOSE_UNKNOWN');}catch(e){first=e;present=true;}try{this.#signer.close();}catch(e){if(!present){first=e;present=true;}}if(present){this.#closeFailed=true;this.#closeCause=first;this.#remember(first);throw first;}this.#closed=true;}
 status(){return Object.freeze({unknown:this.#unknown,firstCausePresent:this.#firstPresent,firstCause:this.#first,closed:this.#closed,cleanupCausePresent:this.#closeFailed,cleanupCause:this.#closeCause,partial:this.#partial});}
}

// Every protected reference is release-owned, never an ENV/HTTP override.
export class OriginalSourceCurrentV2KeyFile {
 #ref;#parents=[];#fd;#stat;#raw;#selected=false;#closeSelected=false;#closeFailed=false;#closeCause;
 constructor(ref){this.#ref=structuredClone(ref);}
 initialize(){if(this.#selected)fail('AUTH_SOURCE_V2_KEY_ALREADY_SELECTED');this.#selected=true;const ref=this.#ref;exact(ref,['path','device','inode','uid','gid','mode','bytes','sha256']);if(typeof ref.path!=='string'||realpathSync(ref.path)!==ref.path)fail('AUTH_SOURCE_V2_KEY_PATH');for(let p=dirname(ref.path);;p=dirname(p)){const s=lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||(s.uid!==0&&s.uid!==process.getuid())||(s.mode&0o022))fail('AUTH_SOURCE_V2_KEY_PARENT');this.#parents.push([p,s]);if(p==='/')break;}
  // The enclosing custodian has retained THIS object before this open.
  this.#fd=openSync(ref.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const a=fstatSync(this.#fd),n=lstatSync(ref.path);this.#stat=a;if(!a.isFile()||a.nlink!==1||a.uid!==process.getuid()||(a.mode&0o777)!==0o600||String(a.dev)!==ref.device||String(a.ino)!==ref.inode||a.uid!==ref.uid||a.gid!==ref.gid||ref.mode!=='0600'||a.size!==ref.bytes||a.size<1||a.size>4096||a.dev!==n.dev||a.ino!==n.ino)fail('AUTH_SOURCE_V2_KEY_TUPLE');this.#raw=readFileSync(this.#fd);if(sha(this.#raw)!==ref.sha256)fail('AUTH_SOURCE_V2_KEY_CHANGED');this.assertCurrent();
 }
 get raw(){this.assertCurrent();return this.#raw;}
 wipe(){this.#raw?.fill(0);}
 assertCurrent(){if(this.#closeSelected||this.#fd===undefined||!this.#stat)fail('AUTH_SOURCE_V2_KEY_CLOSED');const a=this.#stat,same=(x,y)=>x.dev===y.dev&&x.ino===y.ino&&x.uid===y.uid&&x.gid===y.gid&&x.mode===y.mode&&x.nlink===y.nlink&&x.size===y.size&&x.mtimeMs===y.mtimeMs&&x.ctimeMs===y.ctimeMs;if(!same(a,fstatSync(this.#fd))||!same(a,lstatSync(this.#ref.path))||realpathSync(this.#ref.path)!==this.#ref.path)fail('AUTH_SOURCE_V2_KEY_CHANGED');for(const[p,s]of this.#parents){const end=lstatSync(p);if(!end.isDirectory()||end.isSymbolicLink()||end.dev!==s.dev||end.ino!==s.ino||end.uid!==s.uid||end.gid!==s.gid||end.mode!==s.mode)fail('AUTH_SOURCE_V2_KEY_PARENT_CHANGED');}}
 close(){if(this.#closeSelected){if(this.#closeFailed)throw this.#closeCause;return;}this.#closeSelected=true;this.wipe();try{if(this.#fd!==undefined)closeSync(this.#fd);}catch(e){this.#closeFailed=true;this.#closeCause=e;throw e;}}
}
export async function loadReleaseSelectedOriginalSourceV2(entry,readPublic,readOnly=false){
 // No fallback to portable signing or caller crypto. Runtime check occurs
 // before any private file read; provider itself independently enforces it.
 if(process.versions.node!=='26.7.0'||process.versions.openssl!=='3.6.4')fail('AUTH_SOURCE_V2_NATIVE_RUNTIME_NOT_SUPPLIED');
 const rootRaw=readPublic(entry.rootPath,entry.policy.rootDigest),enrollmentRaw=readPublic(entry.enrollmentPath,entry.policy.enrollmentDigest),profiles=entry.profiles.map(p=>readPublic(p.path,p.sha256)),root=parsed(rootRaw,16384),enrollment=hint(enrollmentRaw);
 const get=fetchOriginalNativeAuthorization;
 let selected;const selectedViews=[];
 for(const raw of profiles){const p=hint(raw),owners=[root.rootOwner,enrollment.profileOwner,enrollment.currentOwner,p.subjectOwner],s=await Promise.all(owners.map(async owner=>parsePQAccountAuthorization(await get(entry.node,owner),{chainId:root.networkId,nativeChainId:entry.node.nativeChainId,owner}))),views=Object.fromEntries(['root','profile','current','subject'].map((k,i)=>[k,s[i]]));verifyOriginalAuthSourceProfileV2(rootRaw,enrollmentRaw,raw,entry.policy,views,Date.now());selected=views.current;selectedViews.push(views);}
 if(!selected)fail('AUTH_SOURCE_V2_PROFILES');const record=inspectPQAuthorizationView(selected).activeRecord;if(!record)fail('AUTH_SOURCE_V2_CURRENT_ROLE_UNAVAILABLE');
 if(entry.policy.signatureContract.purpose===PRODUCT_DEVICE_V4_SOURCE_PURPOSE){
  // Every asynchronous registration observation must finish BEFORE the final
  // device-profile/key-open fence. A first profile may expire while a later
  // profile is observed; no current role key may be read on that stale set.
  for(let i=0;i<profiles.length;i++)verifyOriginalAuthSourceProfileV2(rootRaw,enrollmentRaw,profiles[i],entry.policy,selectedViews[i],Date.now());
  // The verifier itself calls retained math/view suppliers. Recheck all local
  // original windows after those callbacks, immediately before key custody.
  const now=Date.now();if(!Number.isSafeInteger(now)||now<0)fail('AUTH_SOURCE_V2_EXPIRED');
  for(const body of[enrollment,...profiles.map(hint)])if(now<body.issuedAtMs||now>=body.expiresAtMs)fail('AUTH_SOURCE_V2_EXPIRED');
 }
 let a,b,keys,service,closed=false,closeSelected=false,closeCause,closeFailed=false;
 const signer=Object.freeze({retire(){closed=true;},join(){},assertCurrent(snapshot){if(closed)fail('AUTH_SOURCE_V2_KEY_CLOSED');a.assertCurrent();b.assertCurrent();const view=inspectPQAuthorizationView(snapshot);if(!view.pqSigningEnabled||!view.activeRecord||view.activeRecord.pkA!==record.pkA||view.activeRecord.pkB!==record.pkB||view.activeRecord.revision!==record.revision||snapshot.owner!==selected.owner)fail('AUTH_SOURCE_V2_CURRENT_ROLE_CHANGED');},signCurrent(message,binding,snapshot){this.assertCurrent(snapshot);let batch;try{batch=batchSign(keys.privateKey,{chainId:Buffer.from(binding.networkId,'hex'),owner:binding.owner,purpose:'AUTH-SOURCE-CURRENT'},[Buffer.from(message)]).batch;return encodeMember(extract(batch,0));}finally{if(batch)discardBatch(batch);}},close(){if(closeSelected){if(closeFailed)throw closeCause;return;}closed=true;closeSelected=true;for(const work of [()=>{if(keys&&!destroyKey(keys.privateKey))fail('AUTH_SOURCE_V2_KEY_CLOSE_UNKNOWN');},()=>b?.close(),()=>a?.close()])try{work();}catch(e){if(!closeFailed){closeCause=e;closeFailed=true;}}if(closeFailed)throw closeCause;}});
 try{
  a=new OriginalSourceCurrentV2KeyFile(entry.currentKeys.A);a.initialize();b=new OriginalSourceCurrentV2KeyFile(entry.currentKeys.B);b.initialize();keys=importKeyMaterial({format:KEY_MATERIAL_FORMAT,algorithmVersion:'YNX-BATCH/v0.1',suite:SUITE,pkcs8A:a.raw,pkcs8B:b.raw,pkA:Buffer.from(record.pkA,'hex'),pkB:Buffer.from(record.pkB,'hex')},{provider:'native'});
  const native=createRequire(import.meta.url)(fileURLToPath(new URL('../../../apps/wallet-desktop/native/original-source-current-dirfd.node',import.meta.url)));
  if(readOnly&&typeof native.openV2Existing!=='function')fail('AUTH_PUBLICATION_READONLY_IO_NOT_SUPPLIED');
  const io=readOnly?Object.freeze({openV2:(parent,leaf)=>native.openV2Existing(parent,leaf),ready:ref=>native.ready(ref),list:ref=>native.list(ref),read:(ref,name)=>native.read(ref,name),write:()=>fail('AUTH_PUBLICATION_QUERY_READONLY'),close:ref=>native.close(ref)}):native;
  service=new OriginalAuthSourceCurrentV2Kernel(rootRaw,enrollmentRaw,profiles,entry.policy,entry.node,signer,io);await service.initialize();return service;
 }catch(error){return Object.freeze({partial:service??signer,error});}finally{a?.wipe();b?.wipe();}
}
