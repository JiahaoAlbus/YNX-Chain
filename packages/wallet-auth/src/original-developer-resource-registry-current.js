import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
import {createOriginalDeveloperResourceParticipant} from './original-developer-resource-participant.js';
import {verifyOriginalDeveloperProjectResourceApproval} from './original-developer-project-resource-approval.js';
import {verifyProductSessionProofV2} from './product-session-proof-v2.js';
import {parseOriginalSessionProjection} from './product-session-authority-projection.js';
import {productSessionControlClockFloor} from './product-session-control-intent.js';

export const ORIGINAL_DEVELOPER_RESOURCE_REGISTRY_VERSION=1;
const fail=(code='ORIGINAL_RESOURCE_REGISTRY_INVALID')=>{throw new WalletAuthError(code,'Original resource registry source is unavailable');};
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const equal=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const ms=raw=>{const n=Date.parse(raw);if(typeof raw!=='string'||!Number.isSafeInteger(n)||new Date(n).toISOString()!==raw)fail();return n;};
function capture(raw,max=1048576){
 const seen=new Set();let nodes=0;
 function copy(v,depth){
  if(++nodes>200000||depth>32)fail();
  if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isSafeInteger(v))return v;
  if(!v||typeof v!=='object'||types.isProxy(v)||seen.has(v))fail();seen.add(v);
  const array=Array.isArray(v),out=array?[]:{};
  if(Object.getPrototypeOf(v)!==(array?Array.prototype:Object.prototype))fail();
  const keys=Reflect.ownKeys(v);
  if(array&&(keys.length!==v.length+1||keys.some(k=>k!=='length'&&(typeof k!=='string'||!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=v.length))))fail();
  for(const k of keys){if(array&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||!d.enumerable||!Object.hasOwn(d,'value'))fail();Object.defineProperty(out,k,{value:copy(d.value,depth+1),enumerable:true});}
  seen.delete(v);return Object.freeze(out);
 }
 const result=copy(raw,0);if(Buffer.byteLength(canonicalJSON(result))>max)fail('ORIGINAL_RESOURCE_REGISTRY_CAPACITY');return result;
}
function evidence(raw){if(typeof raw!=='string'||Buffer.byteLength(raw)>65536)fail();let decoded;try{decoded=JSON.parse(raw);}catch{fail();}if(canonicalJSON(decoded)!==raw)fail();return raw;}
function expected(row){const s=row.actor.session,r=row.request;return canonicalJSON({account:s.account,deviceId:s.deviceId,sessionBinding:s.sessionBinding,projectId:r.projectId,projectDigest:r.projectDigest,resourceOrigin:r.resourceOrigin,resourceId:r.resourceId,action:r.action,bodyDigest:r.bodyDigest});}
function sourceObservation(raw,row){
 const v=capture(raw,65536);exactFields(v,['version','approvalDigest','approvedOwner','accountGeneration','resourceCurrent'],'Registered domain observation');
 if(v.version!=='ynx-original-developer-resource-domain-observation/v1'||v.approvalDigest!==row.approvalDigest||v.approvedOwner!==row.approvedOwner||!(v.accountGeneration===null||Number.isSafeInteger(v.accountGeneration)&&v.accountGeneration>0))fail('ORIGINAL_RESOURCE_DOMAIN_BINDING_INVALID');
 const c=v.resourceCurrent,s=row.actor.session,p=row.actor.projection,r=row.request;
 exactFields(c,['version','purpose','requiredScope','registrationDigest','sourceDigest','currentReference','account','deviceBinding','sessionBinding','familyId','privateGeneration','projectId','projectDigest','resourceOrigin','resourceId','projectRole','resourceRole','resourceRevision','issuedAt','expiresAt'],'Original resource current data');
 if(c.version!=='ynx-original-developer-resource-current/v1'||c.purpose!=='developer-project-resource/v1'||c.requiredScope!==row.requiredScope||!hash(c.registrationDigest)||!hash(c.sourceDigest)||typeof c.currentReference!=='string'||!/^[\x21-\x7e]{1,256}$/.test(c.currentReference)||c.account!==s.account||c.deviceBinding!==s.deviceBinding||c.sessionBinding!==s.sessionBinding||c.familyId!==p.familyId||c.privateGeneration!==p.generation||c.projectId!==r.projectId||c.projectDigest!==r.projectDigest||c.resourceOrigin!==r.resourceOrigin||c.resourceId!==r.resourceId||!['owner','editor'].includes(c.projectRole)||!['owner','editor'].includes(c.resourceRole)||typeof c.resourceRevision!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(c.resourceRevision))fail('ORIGINAL_RESOURCE_DOMAIN_BINDING_INVALID');
 const from=ms(c.issuedAt),to=ms(c.expiresAt);if(to<=from||to-from>30000||to>ms(s.expiresAt))fail();return v;
}
function parseRecord(raw){
 const row=capture(raw,98304);
 exactFields(row,['approvalDigest','approval','approvalNonce','actionNonce','approvedAt','approvedOwner','actor','actionProof','request','requiredScope','sourceEvidence','domainObservation'],'Original resource registry record');
 if(!hash(row.approvalDigest)||typeof row.approval!=='string'||Buffer.byteLength(row.approval)>8192||sha(row.approval)!==row.approvalDigest)fail();
 exactFields(row.actor,['session','projection'],'Original accepted actor');
 exactFields(row.actor.projection,['sessionBinding','familyId','generation','revoked'],'Original private projection');
 const projection=row.actor.projection,s=row.actor.session;
 if(projection.sessionBinding!==s.sessionBinding||typeof projection.familyId!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(projection.familyId)||!Number.isSafeInteger(projection.generation)||projection.generation<1||projection.revoked!==false||row.approvedOwner!==s.account)fail();
 const at=new Date(ms(row.approvedAt)),r=row.request;
 exactFields(r,['intentId','projectId','projectDigest','resourceOrigin','resourceId','action','method','path','bodyDigest'],'Original resource request');
 if(typeof r.intentId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(r.intentId))fail();
 const cloud=r.action==='file-content-save'&&r.resourceOrigin==='https://web4.ynxweb4.com'&&r.method==='PUT'&&r.path===`/api/v1/objects/${r.resourceId}/content`;
 const ai=r.action==='ai-generate'&&r.resourceOrigin==='http://127.0.0.1:18111'&&r.method==='POST'&&['/ai/stream','/ai/byok/stream','/ai-build/ai/stream','/ai-build/ai/byok/stream'].includes(r.path);
 const scope=cloud?'developer:resource:cloud-file-content':ai?'developer:resource:ai-generation':null;
 if(!scope||scope!==row.requiredScope||s.productId!=='developer'||s.clientId!=='ynx-developer-v1'||s.platform!=='macos'||s.origin!=='app://macos/com.ynxweb4.developer.testnetpreview'||!s.scopes.includes('account:read')||!s.scopes.includes(scope))fail();
 const action=verifyProductSessionProofV2(row.actionProof,s,{method:r.method,path:r.path,bodyDigest:r.bodyDigest},at);
 if(ms(action.expiresAt)-ms(action.issuedAt)>30000)fail();
 const approval=verifyOriginalDeveloperProjectResourceApproval(row.approval,expected(row),at);if(approval.requiredScope!==scope||approval.nonce!==row.approvalNonce||action.nonce!==row.actionNonce)fail();
 evidence(row.sourceEvidence);const observation=sourceObservation(row.domainObservation,row);
 if(ms(observation.resourceCurrent.issuedAt)>at.getTime()||ms(observation.resourceCurrent.expiresAt)<=at.getTime())fail();
 return row;
}
export function emptyOriginalDeveloperResourceRegistryState(){return Object.freeze({version:1,records:Object.freeze([])});}
export function parseOriginalDeveloperResourceRegistryState(raw){
 const state=capture(raw);exactFields(state,['version','records'],'Original resource registry state');
 if(state.version!==1||!Array.isArray(state.records)||state.records.length>64)fail('ORIGINAL_RESOURCE_REGISTRY_CAPACITY');
 const ids=new Set(),actions=new Set(),approvals=new Set();
 const records=state.records.map(raw=>{
  const row=parseRecord(raw),action=`${row.actor.session.sessionBinding}:${row.actionProof.nonce}`,approval=`${row.approvedOwner}:${JSON.parse(row.approval).nonce}`;
  if(ids.has(row.approvalDigest)||actions.has(action)||approvals.has(approval))fail('ORIGINAL_RESOURCE_REGISTRY_REPLAY_CONFLICT');
  ids.add(row.approvalDigest);actions.add(action);approvals.add(approval);return row;
 });
 return Object.freeze({version:1,records:Object.freeze(records)});
}

// A must instantiate this inside the original protected writer with an actual,
// independently admitted domain-evidence verifier. This model never signs evidence.
export function createOriginalDeveloperResourceRegistryCurrent(rawInput){
 if(!rawInput||typeof rawInput!=='object'||types.isProxy(rawInput)||Object.getPrototypeOf(rawInput)!==Object.prototype)fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED');
 const d=Object.getOwnPropertyDescriptors(rawInput);if(Reflect.ownKeys(d).length!==4)fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED');
 for(const key of ['registry','tokenFactory','now','verifyDomainEvidence'])if(!d[key]||!d[key].enumerable||!Object.hasOwn(d[key],'value'))fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED');
 for(const key of ['tokenFactory','now','verifyDomainEvidence'])if(typeof d[key].value!=='function'||types.isProxy(d[key].value))fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED');
 let active=false,invalid=false,pending=null,last=0;
 const enter=()=>{if(active){invalid=true;fail('ORIGINAL_RESOURCE_REENTRY');}if(invalid)fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED');active=true;};
 const now=()=>{const value=d.now.value();if(invalid)fail('ORIGINAL_RESOURCE_REENTRY');let at;try{at=Date.prototype.getTime.call(value);}catch{fail();}if(!Number.isSafeInteger(at)||at<last)fail();last=at;return new Date(at);};
 const verify=(row,at,mode)=>{
  const result=d.verifyDomainEvidence.value(row.sourceEvidence,capture({approval:row.approval,approvalDigest:row.approvalDigest,approvedOwner:row.approvedOwner,actor:row.actor,request:row.request,requiredScope:row.requiredScope,actionProof:row.actionProof}),new Date(at),mode);
  if(invalid)fail('ORIGINAL_RESOURCE_REENTRY');return sourceObservation(result,row);
 };
 const participant=createOriginalDeveloperResourceParticipant({registry:d.registry.value,tokenFactory:d.tokenFactory.value,now,resourceCurrent(context,at){
  if(!pending)fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED');const row={...pending,actor:context.actor,request:context.request,requiredScope:context.requiredScope};
  const observation=verify(row,Date.prototype.getTime.call(at),'current');
  if(observation.accountGeneration===null)fail('ORIGINAL_RESOURCE_ACCOUNT_GENERATION_NOT_CONFIGURED');pending={...row,domainObservation:observation};return observation.resourceCurrent;
 }});
 const stateDigest=state=>sha(canonicalJSON(state));
 const metadataDigest=metadata=>stateDigest(capture(metadata));
 const final=(state,metadata,before,metadataBefore,start)=>{
  const historyFloor=Math.max(0,...capture(metadata).records.map(r=>ms(r.approvedAt)));const at=now().getTime();if(at<historyFloor||at<productSessionControlClockFloor(state.snapshot)||at-start>100||stateDigest(state)!==before||metadataDigest(metadata)!==metadataBefore||invalid){invalid=true;fail('ORIGINAL_RESOURCE_STATE_CHANGED');}return at;
 };
 function stored(state,metadata){
  const parsed=parseOriginalDeveloperResourceRegistryState(metadata),projection=parseOriginalSessionProjection(state.projection,state.snapshot);
  for(const row of parsed.records){
   const record=projection.records.find(r=>r.sessionBinding===row.actor.session.sessionBinding),session=state.snapshot.authority.sessions.find(s=>s.sessionBinding===row.actor.session.sessionBinding);
   if(!record||!session||record.familyId!==row.actor.projection.familyId||record.generation!==row.actor.projection.generation||!equal(session,row.actor.session))fail('ORIGINAL_RESOURCE_HISTORY_UNAVAILABLE');
   if(!equal(verify(row,ms(row.approvedAt),'history'),row.domainObservation))fail('ORIGINAL_RESOURCE_HISTORY_PROOF_INVALID');
  }
  return parsed;
 }
 return Object.freeze({
  assertStored(state,metadata){enter();try{const before=stateDigest(state),mb=metadataDigest(metadata),start=now().getTime(),result=stored(state,metadata);final(state,metadata,before,mb,start);return result;}finally{active=false;}},
  admit(state,metadata,session,actionProof,approval,request,rawWire,sourceEvidence){enter();try{
   const capturedSession=capture(session,65536),capturedAction=capture(actionProof,65536),capturedRequest=capture(request,65536);
   if(typeof approval!=='string'||Buffer.byteLength(approval)>8192)fail();
   const before=stateDigest(state),mb=metadataDigest(metadata),start=now().getTime(),parsed=stored(state,metadata);
   pending={approval,approvalDigest:sha(approval),approvedOwner:capturedSession.account,actionProof:capturedAction,sourceEvidence:evidence(sourceEvidence)};
   const cap=participant.capture(state,capturedSession,capturedAction,approval,capturedRequest,rawWire);
   if(invalid)fail('ORIGINAL_RESOURCE_REENTRY');
   const row=parseRecord({approvalDigest:cap.approvalDigest,approval:cap.approval,approvalNonce:cap.approvalNonce,actionNonce:cap.actionNonce,approvedAt:cap.observedAt,approvedOwner:cap.actor.session.account,actor:cap.actor,actionProof:cap.actionProof,request:cap.request,requiredScope:cap.requiredScope,sourceEvidence:pending.sourceEvidence,domainObservation:pending.domainObservation});
   const old=parsed.records.find(r=>r.approvalDigest===row.approvalDigest);let result;
   if(old){const {approvedAt:a,...one}=old,{approvedAt:b,...two}=row;if(!equal(one,two))fail('ORIGINAL_RESOURCE_REGISTRY_REPLAY_CONFLICT');result=capture({state:parsed,record:old,readOnly:true,newlyRegistered:false,durablyRegistered:false,effectAuthorized:false});}
   else{const next=parseOriginalDeveloperResourceRegistryState({version:1,records:[...parsed.records,row]});result=capture({state:next,record:row,readOnly:false,newlyRegistered:true,durablyRegistered:false,effectAuthorized:false});}
   // Every proof parse and detached output clone precedes the final owned clock.
   const at=final(state,metadata,before,mb,start);
   for(const until of [cap.actor.session.expiresAt,cap.actionProof.expiresAt,JSON.parse(cap.approval).expiresAt,pending.domainObservation.resourceCurrent.expiresAt])if(ms(until)<=at)fail('ORIGINAL_RESOURCE_CURRENT_EXPIRED');
   return result;
  }finally{pending=null;active=false;}},
  readCurrent(state,metadata,approvalDigest,freshSourceEvidence,actualRawWire){enter();try{
   const before=stateDigest(state),mb=metadataDigest(metadata),start=now().getTime(),parsed=stored(state,metadata),row=parsed.records.find(r=>r.approvalDigest===approvalDigest);
   if(!row)fail('ORIGINAL_RESOURCE_HISTORY_UNAVAILABLE');pending={...row,sourceEvidence:evidence(freshSourceEvidence)};
   // Current is not reconstructed from historical config/rows. Revalidate exact
   // original action/approval and independently authenticated fresh evidence.
   const cap=participant.capture(state,row.actor.session,row.actionProof,row.approval,row.request,actualRawWire);
   const result=capture({approvalDigest:row.approvalDigest,approvedOwner:row.approvedOwner,accountGeneration:pending.domainObservation.accountGeneration,resourceCurrent:pending.domainObservation.resourceCurrent,readOnly:true,effectAuthorized:false});
   const at=final(state,metadata,before,mb,start);
   for(const until of [cap.actor.session.expiresAt,cap.actionProof.expiresAt,JSON.parse(cap.approval).expiresAt,pending.domainObservation.resourceCurrent.expiresAt])if(ms(until)<=at)fail('ORIGINAL_RESOURCE_CURRENT_EXPIRED');
   return result;
  }finally{pending=null;active=false;}}
 });
}
