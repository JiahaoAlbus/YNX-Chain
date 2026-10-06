import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {canonicalJSON,exactFields,WalletAuthError} from './canonical.js';
import {parseProductSessionRegistry,productPlatformBinding} from './product-session-registry.js';
import {ProductSessionGatewayHttpHandler} from './product-session-gateway-http.js';
import {originalSessionProjectionRecord,parseOriginalSessionProjection} from './product-session-authority-projection.js';
import {productSessionControlClockFloor} from './product-session-control-intent.js';
import {verifyProductSessionProofV2} from './product-session-proof-v2.js';
import {verifyOriginalDeveloperProjectResourceApproval} from './original-developer-project-resource-approval.js';
import {parseOriginalOperationMapping} from './original-operation-recovery-state.js';

export const ORIGINAL_DEVELOPER_RESOURCE_PARTICIPANT_VERSION='ynx-original-developer-resource-participant/v1';
const fail=(code='ORIGINAL_RESOURCE_PARTICIPANT_INVALID')=>{throw new WalletAuthError(code,'Original registered resource participant is unavailable');};
const digest=v=>createHash('sha256').update(canonicalJSON(v)).digest('hex');
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const key=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
function data(v,max=65536){
 const seen=new Set();let budget=0,nodes=0;
 const visit=(v,depth)=>{
  if(++nodes>1000000||depth>32)fail();
  if(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isSafeInteger(v))return v;
  if(typeof v==='string'){budget+=Buffer.byteLength(v);if(budget>max)fail();return v;}
  if(!v||typeof v!=='object'||types.isProxy(v)||seen.has(v))fail();seen.add(v);
  const array=Array.isArray(v),out=array?[]:{};if(Object.getPrototypeOf(v)!==(array?Array.prototype:Object.prototype))fail();
  const keys=Reflect.ownKeys(v);if(array&&(keys.length!==v.length+1||keys.some(k=>k!=='length'&&(typeof k!=='string'||! /^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=v.length))))fail();
  for(const k of keys){if(array&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||!d.enumerable||!Object.hasOwn(d,'value'))fail();Object.defineProperty(out,k,{value:visit(d.value,depth+1),enumerable:true});}
  seen.delete(v);return Object.freeze(out);
 };const captured=visit(v,0);if(Buffer.byteLength(canonicalJSON(captured))>max)fail();return captured;
}
const DATE=Date.prototype.getTime;
function instant(fn,prior,floor){let n;try{n=Reflect.apply(DATE,fn(),[]);}catch{fail('ORIGINAL_RESOURCE_CLOCK_UNAVAILABLE');}if(!Number.isSafeInteger(n)||n<prior||n<floor)fail('ORIGINAL_RESOURCE_CLOCK_UNAVAILABLE');return n;}
function wireDigest(raw){
 if(!raw||typeof raw!=='object'||types.isProxy(raw)||!types.isUint8Array(raw))fail('ORIGINAL_RESOURCE_WIRE_INVALID');
 const proto=Object.getPrototypeOf(Uint8Array.prototype);let length,buffer;
 try{length=Object.getOwnPropertyDescriptor(proto,'byteLength').get.call(raw);buffer=Object.getOwnPropertyDescriptor(proto,'buffer').get.call(raw);}catch{fail('ORIGINAL_RESOURCE_WIRE_INVALID');}
 if(!Number.isSafeInteger(length)||length>16*1024*1024||!(buffer instanceof ArrayBuffer))fail('ORIGINAL_RESOURCE_WIRE_INVALID');
 const detached=new Uint8Array(length);Uint8Array.prototype.set.call(detached,raw);return createHash('sha256').update(detached).digest('hex');
}
function descriptor(input){if(!input||typeof input!=='object'||types.isProxy(input)||Object.getPrototypeOf(input)!==Object.prototype)fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED');const d=Object.getOwnPropertyDescriptors(input);if(Reflect.ownKeys(d).length!==4)fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED');for(const k of ['registry','tokenFactory','now','resourceCurrent'])if(!d[k]||!Object.hasOwn(d[k],'value')||!d[k].enumerable)fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED');for(const k of ['tokenFactory','now','resourceCurrent'])if(typeof d[k].value!=='function'||types.isProxy(d[k].value))fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED');return d;}
function request(raw){const r=data(raw);exactFields(r,['intentId','projectId','projectDigest','resourceOrigin','resourceId','action','method','path','bodyDigest'],'Original resource command');if(!key(r.intentId)||!key(r.projectId)||!key(r.resourceId)||!hash(r.projectDigest)||!hash(r.bodyDigest))fail();const cloud=r.action==='file-content-save'&&r.resourceOrigin==='https://web4.ynxweb4.com'&&r.method==='PUT'&&r.path===`/api/v1/objects/${r.resourceId}/content`;const ai=r.action==='ai-generate'&&r.resourceOrigin==='http://127.0.0.1:18111'&&r.method==='POST'&&['/ai/stream','/ai/byok/stream','/ai-build/ai/stream','/ai-build/ai/byok/stream'].includes(r.path);if(!cloud&&!ai)fail();return {request:r,requiredScope:cloud?'developer:resource:cloud-file-content':'developer:resource:ai-generation'};}
function expected(session,r){return canonicalJSON({account:session.account,deviceId:session.deviceId,sessionBinding:session.sessionBinding,projectId:r.projectId,projectDigest:r.projectDigest,resourceOrigin:r.resourceOrigin,resourceId:r.resourceId,action:r.action,bodyDigest:r.bodyDigest});}
function current(raw,actor,r,scope,at){
 const c=data(raw);exactFields(c,['version','purpose','requiredScope','registrationDigest','sourceDigest','currentReference','account','deviceBinding','sessionBinding','familyId','privateGeneration','projectId','projectDigest','resourceOrigin','resourceId','projectRole','resourceRole','resourceRevision','issuedAt','expiresAt'],'Fixed protected resource current');
 if(c.version!=='ynx-original-developer-resource-current/v1'||c.purpose!=='developer-project-resource/v1'||c.requiredScope!==scope||!hash(c.registrationDigest)||!hash(c.sourceDigest)||typeof c.currentReference!=='string'||!/^[\x21-\x7e]{1,256}$/.test(c.currentReference)||c.account!==actor.session.account||c.deviceBinding!==actor.session.deviceBinding||c.sessionBinding!==actor.session.sessionBinding||c.familyId!==actor.projection.familyId||c.privateGeneration!==actor.projection.generation||c.projectId!==r.projectId||c.projectDigest!==r.projectDigest||c.resourceOrigin!==r.resourceOrigin||c.resourceId!==r.resourceId||!['owner','editor'].includes(c.projectRole)||!['owner','editor'].includes(c.resourceRole)||!key(c.resourceRevision))fail('ORIGINAL_RESOURCE_CURRENT_DENIED');
 const issued=Date.parse(c.issuedAt),expires=Date.parse(c.expiresAt);if(!Number.isSafeInteger(issued)||!Number.isSafeInteger(expires)||new Date(issued).toISOString()!==c.issuedAt||new Date(expires).toISOString()!==c.expiresAt||issued>at||expires<=at||expires-issued>30000||expires<=issued||expires>Date.parse(actor.session.expiresAt))fail('ORIGINAL_RESOURCE_CURRENT_EXPIRED');return c;
}

// Only original Host/Store-owned synchronous source wiring may use this object.
// Configuration/callbacks/brands are not registration, provenance or grants.
export function createOriginalDeveloperResourceParticipant(input){
 const d=descriptor(input),registry=parseProductSessionRegistry(data(d.registry.value,65536)),binding=productPlatformBinding(registry,'developer','macos');
 if(binding.clientId!=='ynx-developer-v1'||binding.applicationId!=='com.ynxweb4.developer.testnetpreview'||binding.origin!=='app://macos/com.ynxweb4.developer.testnetpreview'||binding.callback!=='ynxdeveloper://wallet-auth/callback'||!['account:read','developer:resource:cloud-file-content','developer:resource:ai-generation'].every(s=>binding.scopes.includes(s)))fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED');
 const caps=new WeakSet();let active=false,invalid=false,last=0;
 const enter=()=>{if(active){invalid=true;fail('ORIGINAL_RESOURCE_REENTRY');}if(invalid)fail('ORIGINAL_RESOURCE_SOURCE_NOT_CONFIGURED');active=true;};
 const clock=floor=>{const at=instant(d.now.value,last,floor);if(invalid)fail('ORIGINAL_RESOURCE_REENTRY');last=at;return at;};
 function actor(state,original,scope,at){
  const checked=new ProductSessionGatewayHttpHandler(registry,d.tokenFactory.value,state.snapshot).revalidate(original,['account:read',scope],'developer',new Date(at),true);
  if(checked?.active!==true)fail();
  const view=originalSessionProjectionRecord(state.snapshot,state.projection,original.sessionBinding);
  if(view.session.platform!=='macos'||view.session.productId!=='developer'||view.session.clientId!==binding.clientId||view.session.applicationId!==binding.applicationId||view.session.bundleId!==binding.bundleId||view.session.packageId!==null||view.session.origin!==binding.origin||view.session.callback!==binding.callback||canonicalJSON(view.session)!==canonicalJSON(original))fail();
  return data({session:view.session,projection:view.record});
 }
 function check(state,cap,initial){
  const before=digest(state),floor=productSessionControlClockFloor(state.snapshot),at=clock(floor);
  if(digest(state)!==before){invalid=true;fail('ORIGINAL_RESOURCE_STATE_CHANGED');}
  const captured=actor(state,cap.actor.session,cap.requiredScope,at);if(!initial&&canonicalJSON(captured)!==canonicalJSON(cap.actor))fail('ORIGINAL_RESOURCE_GENERATION_CHANGED');
  const action=verifyProductSessionProofV2(cap.actionProof,captured.session,{method:cap.request.method,path:cap.request.path,bodyDigest:cap.request.bodyDigest},new Date(at));
  const approval=verifyOriginalDeveloperProjectResourceApproval(cap.approval,expected(captured.session,cap.request),new Date(at));if(approval.requiredScope!==cap.requiredScope||Date.parse(action.expiresAt)-Date.parse(action.issuedAt)>30000)fail();
  const observed=current(d.resourceCurrent.value(data({actor:captured,request:cap.request,requiredScope:cap.requiredScope,purpose:'developer-project-resource/v1'}),new Date(at)),captured,cap.request,cap.requiredScope,at);
  if(invalid)fail('ORIGINAL_RESOURCE_REENTRY');
  const finalAt=clock(floor);
  if(digest(state)!==before){invalid=true;fail('ORIGINAL_RESOURCE_STATE_CHANGED');}
  if(finalAt-at>100||Date.parse(action.expiresAt)<=finalAt||Date.parse(approval.expiresAt)<=finalAt||Date.parse(captured.session.expiresAt)<=finalAt||Date.parse(observed.expiresAt)<=finalAt)fail('ORIGINAL_RESOURCE_CURRENT_EXPIRED');
  const finalActor=actor(state,captured.session,cap.requiredScope,finalAt);if(canonicalJSON(finalActor)!==canonicalJSON(captured)||!initial&&canonicalJSON(observed)!==canonicalJSON(cap.resourceCurrent))fail('ORIGINAL_RESOURCE_GENERATION_CHANGED');
  if(digest(state)!==before||invalid){invalid=true;fail('ORIGINAL_RESOURCE_STATE_CHANGED');}
  return {actor:captured,resourceCurrent:observed,actionNonce:action.nonce,approvalNonce:approval.nonce,approvalDigest:createHash('sha256').update(cap.approval).digest('hex'),observedAt:new Date(finalAt).toISOString()};
 }
 const participant={
  capture(state,session,actionProof,rawApproval,rawRequest,rawWire){enter();try{if(typeof rawApproval!=='string'||Buffer.byteLength(rawApproval)>8192)fail();const r=request(rawRequest);if(wireDigest(rawWire)!==r.request.bodyDigest)fail('ORIGINAL_RESOURCE_WIRE_MISMATCH');const original=data(session),draft={actor:{session:original},actionProof:data(actionProof),approval:rawApproval,request:r.request,requiredScope:r.requiredScope};const found=check(state,draft,true);const cap=data({version:ORIGINAL_DEVELOPER_RESOURCE_PARTICIPANT_VERSION,...draft,...found});caps.add(cap);return cap;}finally{active=false;}},
  assertCurrent(state,cap){enter();try{if(!caps.has(cap))fail();check(state,cap,false);return cap;}finally{active=false;}},
  assertOriginalPublication(state,cap,rawMapping){enter();try{if(!caps.has(cap))fail();check(state,cap,false);const mapping=parseOriginalOperationMapping(data(rawMapping));if(mapping.productOperationId!==cap.request.intentId||mapping.sessionBinding!==cap.actor.session.sessionBinding||mapping.method!==cap.request.method||mapping.path!==cap.request.path||mapping.actionBodyDigest!==cap.request.bodyDigest||mapping.wireDigest!==cap.request.bodyDigest||mapping.actionNonce!==cap.actionNonce)fail('ORIGINAL_RESOURCE_MAPPING_CONFLICT');const stored=state.recovery?.mappings.find(m=>m.operationId===mapping.operationId),effect=state.projection.effects.find(e=>e.operationId===mapping.operationId);if(!stored||canonicalJSON(stored)!==canonicalJSON(mapping)||!effect||effect.sessionBinding!==mapping.sessionBinding||effect.requestDigest!==mapping.requestDigest||effect.state!=='unknown')fail('ORIGINAL_RESOURCE_PUBLICATION_UNCONFIRMED');return data({mapping,obligation:effect,association:{...cap,intentId:cap.request.intentId,familyId:cap.actor.projection.familyId,privateGeneration:cap.actor.projection.generation},readbackOnly:true,dispatchConfirmed:false});}finally{active=false;}},
  observeStoredOriginalTerminal(state,cap,rawMapping){enter();try{if(!caps.has(cap))fail();const mapping=parseOriginalOperationMapping(data(rawMapping));const projection=parseOriginalSessionProjection(state.projection,state.snapshot);const record=projection.records.find(r=>r.sessionBinding===cap.actor.session.sessionBinding),session=state.snapshot.authority.sessions.find(s=>s.sessionBinding===cap.actor.session.sessionBinding);if(!record||record.familyId!==cap.actor.projection.familyId||record.generation!==cap.actor.projection.generation||canonicalJSON(session)!==canonicalJSON(cap.actor.session))fail();const stored=state.recovery?.mappings.find(m=>m.operationId===mapping.operationId),effect=projection.effects.find(e=>e.operationId===mapping.operationId);if(!stored||canonicalJSON(stored)!==canonicalJSON(mapping)||mapping.productOperationId!==cap.request.intentId||mapping.sessionBinding!==cap.actor.session.sessionBinding||mapping.method!==cap.request.method||mapping.path!==cap.request.path||mapping.actionNonce!==cap.actionNonce||mapping.wireDigest!==cap.request.bodyDigest||!effect||effect.sessionBinding!==mapping.sessionBinding||effect.requestDigest!==mapping.requestDigest||!['committed','not_executed'].includes(effect.state)||!hash(effect.receiptDigest))fail('ORIGINAL_RESOURCE_TERMINAL_UNAVAILABLE');return data({mapping,obligation:effect,approvalDigest:cap.approvalDigest,readOnly:true,effectAuthorized:false});}finally{active=false;}},
 };
 return Object.freeze(participant);
}
