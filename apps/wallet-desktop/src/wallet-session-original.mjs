import {canonicalJSON,productSessionRequestDigest,parseProductSessionRequest,evmAddressFromYNX} from '@ynx-chain/wallet-auth';
import {PRODUCT_SESSION_REGISTRY} from './wallet-auth-contract.mjs';
import {types} from 'node:util';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from '@ynx-chain/wallet-auth/product-session-device-registration-v4';
const fail=()=>{throw Object.assign(new Error('The retained session original is invalid.'),{code:'SESSION_ORIGINAL_INVALID'});};
const exact=(value,keys)=>{if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).sort().join()!==keys.sort().join())fail();};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const SESSION_ORIGINAL_RESERVE_BYTES=270000;
export const SESSION_V4_APPROVAL_MAX_BYTES=196608;
export const SESSION_V4_PAIR_BODY_MAX_BYTES=393216;
export const SESSION_V4_RESPONSE_MAX_BYTES=196608;
export const SESSION_V4_RESPONSE_RESERVE_BYTES=2*SESSION_V4_RESPONSE_MAX_BYTES+8192;
export const SESSION_V4_APPROVAL_RESERVE_BYTES=2*SESSION_V4_APPROVAL_MAX_BYTES+8192;
function data(value,keys){
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail();
 const ds=Object.getOwnPropertyDescriptors(value),actual=Reflect.ownKeys(ds);
 if(actual.length!==keys.length||actual.some(k=>!keys.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))fail();
 return Object.fromEntries(keys.map(k=>[k,ds[k].value]));
}
function safeData(value,depth=0){
 if(depth>16)fail();if(value===null||['string','boolean'].includes(typeof value))return;
 if(typeof value==='number'){if(!Number.isFinite(value))fail();return;}
 if(!value||types.isProxy(value))fail();
 const array=Array.isArray(value),ds=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(ds);
 if(Object.getPrototypeOf(value)!==(array?Array.prototype:Object.prototype)||keys.length>4096)fail();
 for(const k of keys){if(array&&k==='length')continue;if(typeof k!=='string'||!ds[k].enumerable||!Object.hasOwn(ds[k],'value'))fail();safeData(ds[k].value,depth+1);}
}
function jsonOriginal(raw,max){
 if(typeof raw!=='string'||!raw.length||!raw.isWellFormed()||Buffer.byteLength(raw)>max)fail();
 let value;try{value=JSON.parse(raw);}catch{fail();}safeData(value);if(canonicalJSON(value)!==raw)fail();return value;
}
function time(value){if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)fail();return value;}
const localID=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(value))fail();};
function v4Approval(row){
 const a=data(row.approval,['version','original']);if(a.version!=='4')fail();
 const approval=jsonOriginal(a.original,SESSION_V4_APPROVAL_MAX_BYTES);
 const bound=Object.keys(row.request).filter(k=>!['purpose','issuedAt','expiresAt'].includes(k));
 data(approval,[...bound,'result','requestDigest','account','accountAuthorization','issuedAt','expiresAt','walletProof']);
 for(const k of bound)if(canonicalJSON(approval[k])!==canonicalJSON(row.request[k]))fail();
 if(approval.result!=='approved'||approval.requestDigest!==row.requestDigest||evmAddressFromYNX(approval.account)!==row.account||
    time(approval.issuedAt)<row.createdAt||time(approval.expiresAt)<=approval.issuedAt||approval.expiresAt>row.request.expiresAt||
    typeof approval.walletProof!=='string'||!/^[A-Za-z0-9_-]+$/.test(approval.walletProof))fail();
 // No verification brand or mathematical proof is inferred here.
 if(!approval.accountAuthorization||approval.accountAuthorization.canonicalOwner!==row.account)fail();
 return approval;
}
function v4Registration(row){
 if(typeof row.registrationOriginal!=='string'||Buffer.byteLength(row.registrationOriginal)>16384)fail();
 const result=inspectProductSessionDeviceRegistrationOriginalV4Data(Buffer.from(row.registrationOriginal)),r=result.record;
 if(r.canonicalOwner!==row.account||r.registrationId!==row.request.deviceRegistrationId||r.revision!==row.request.deviceRegistrationRevision||result.registrationDigest!==row.request.deviceRegistrationDigest)fail();
 for(const k of ['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId'])if(r[k]!==row.request[k])fail();
 return r;
}
export function parseSessionPairRequestDATA(value,original){
 const row=parseSessionOriginal(original);if(row.version!==2||row.approval===null)fail();
 const d=data(value,['operationId','originalBody','requestDigest','registrationOriginal','dataOnly','registered','SourceAdmission','NativeAdmission']);
 if(d.operationId!==row.operationId||d.requestDigest!==row.requestDigest||d.registrationOriginal!==row.registrationOriginal||d.dataOnly!==true||d.registered!==false||d.SourceAdmission!==false||d.NativeAdmission!==false)fail();
 const body=data(jsonOriginal(d.originalBody,SESSION_V4_PAIR_BODY_MAX_BYTES),['operationId','request','registrationOriginal','registrationMember','approval']);
 if(body.operationId!==row.operationId||body.registrationOriginal!==row.registrationOriginal||canonicalJSON(body.request)!==canonicalJSON(row.request)||canonicalJSON(body.approval)!==row.approval.original||
    typeof body.registrationMember!=='string'||!body.registrationMember.length||!/^[A-Za-z0-9_-]+$/.test(body.registrationMember)||Buffer.from(body.registrationMember,'base64url').toString('base64url')!==body.registrationMember||Buffer.from(body.registrationMember,'base64url').length>98304)fail();
 return freeze({...d});
}
function pairDATA(row,pair){return {operationId:row.operationId,originalBody:pair.originalBody,requestDigest:row.requestDigest,registrationOriginal:row.registrationOriginal,dataOnly:true,registered:false,SourceAdmission:false,NativeAdmission:false};}
export function parseSessionPairResponseOriginal(raw,original){
 const row=parseSessionOriginal(original);if(row.version!==2||!row.pairSubmission?.entered)fail();
 if(typeof raw!=='string'||!raw.length||!raw.isWellFormed()||/[\u0000-\u001f]/.test(raw)||Buffer.byteLength(raw)>SESSION_V4_RESPONSE_MAX_BYTES)fail();
 // Preserve even a malformed or foreign returned original before the SDK's
 // interpretation/late checks. Opaque storage proves no binding or success.
 return raw;
}
export function sessionV4ReservedBytes(state){
 return (state.sessionOriginals??[]).reduce((n,row)=>n+(row.version!==2?0:!row.approval?SESSION_V4_APPROVAL_RESERVE_BYTES:row.pairSubmission&&!row.pairSubmission.responseOriginal?SESSION_V4_RESPONSE_RESERVE_BYTES:0),0);
}
export function sessionOriginalCause(value){
 // Preserve falsy first causes, but never persist an untrusted exception's
 // payload/message (which could contain signed bytes or a secret).
 if(value===null||['boolean','number','string','undefined'].includes(typeof value))return {kind:typeof value,value:typeof value==='string'?(value===''?'':'redacted'):value===undefined?null:value,code:null};
 const d=Object.getOwnPropertyDescriptor(value??{},'code'),data=Object.getOwnPropertyDescriptor(value??{},'data'),nested=data&&Object.hasOwn(data,'value')&&data.value&&typeof data.value==='object'?Object.getOwnPropertyDescriptor(data.value,'code'):null;
 const code=d&&Object.hasOwn(d,'value')&&typeof d.value==='string'?d.value:nested&&Object.hasOwn(nested,'value')?nested.value:null;
 return {kind:'error',value:null,code:typeof code==='string'&&/^[A-Za-z0-9_:-]{1,128}$/.test(code)?code:null};
}
export function parseSessionOriginal(value){
 if(types.isProxy(value))fail();
 const version=value&&Object.getOwnPropertyDescriptor(value,'version');if(version&&!Object.hasOwn(version,'value'))fail();
 if(value&&!types.isProxy(value)&&Object.getOwnPropertyDescriptor(value,'version')?.value===2)return parseSessionOriginalV4(value);
 exact(value,['version','account','requestId','requestDigest','request','createdAt','approval','deliveryAttempted','cleanupComplete','firstCause','storageCause','cleanupCause']);
 if(value.version!==1||!/^0x[0-9a-f]{40}$/.test(value.account??'')||typeof value.requestId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(value.requestId)||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||new Date(value.createdAt).toISOString()!==value.createdAt||typeof value.deliveryAttempted!=='boolean'||typeof value.cleanupComplete!=='boolean')fail();
 const request=parseProductSessionRequest(PRODUCT_SESSION_REGISTRY,value.request,new Date(value.createdAt));
 if(value.requestDigest!==productSessionRequestDigest(PRODUCT_SESSION_REGISTRY,request,new Date(value.createdAt)))fail();
 if(value.approval!==null){
  const a=value.approval;if(!a||!['2','3'].includes(a.version)||a.result!=='approved'||a.requestDigest!==value.requestDigest||evmAddressFromYNX(a.account)!==value.account||Buffer.byteLength(canonicalJSON(a))>262144)fail();
 }
 for(const cause of [value.firstCause,value.storageCause,value.cleanupCause])if(cause!==null){exact(cause,['kind','value','code']);if(!['error','object','undefined','boolean','number','string'].includes(cause.kind)||cause.code!==null&&(typeof cause.code!=='string'||!/^[A-Za-z0-9_:-]{1,128}$/.test(cause.code))||cause.value!==null&&!['string','number','boolean'].includes(typeof cause.value))fail();}
 if(Buffer.byteLength(canonicalJSON(value))>SESSION_ORIGINAL_RESERVE_BYTES)fail();
 // Disk structure is NOT policy/crypto authority. Fresh SDK verification is
 // mandatory before the original approval may reach a callback again.
 return freeze(JSON.parse(canonicalJSON({...value,request})));
}
function parseSessionOriginalV4(value){
 const row=data(value,['version','account','requestId','requestDigest','request','createdAt','approval','deliveryAttempted','cleanupComplete','firstCause','storageCause','cleanupCause','operationId','registrationOriginal','pairSubmission']);
 if(row.version!==2||!/^0x[0-9a-f]{40}$/.test(row.account??'')||row.deliveryAttempted!==false||typeof row.cleanupComplete!=='boolean')fail();
 localID(row.requestId);localID(row.operationId);time(row.createdAt);safeData(row.request);
 const request=parseProductSessionRequest(PRODUCT_SESSION_REGISTRY,row.request,new Date(row.createdAt));
 if(request.version!=='4'||row.requestDigest!==productSessionRequestDigest(PRODUCT_SESSION_REGISTRY,request,new Date(row.createdAt)))fail();
 const registration=v4Registration({...row,request});
 if(row.approval!==null){const a=v4Approval({...row,request});if(a.accountAuthorization.networkId!==registration.networkId)fail();}
 for(const cause of [row.firstCause,row.storageCause,row.cleanupCause])if(cause!==null){
  const c=data(cause,['kind','value','code']);if(!['error','object','undefined','boolean','number','string'].includes(c.kind)||c.code!==null&&(typeof c.code!=='string'||!/^[A-Za-z0-9_:-]{1,128}$/.test(c.code))||c.value!==null&&!['string','number','boolean'].includes(typeof c.value))fail();
 }
 if(row.pairSubmission!==null){
  const p=data(row.pairSubmission,['operationId','requestDigest','originalBody','entered','responseOriginal']);
  if(row.approval===null||p.operationId!==row.operationId||p.requestDigest!==row.requestDigest||p.entered!==true)fail();
  const withoutPair={...row,pairSubmission:null};parseSessionPairRequestDATA(pairDATA(row,p),withoutPair);
  if(p.responseOriginal!==null){
   if(typeof p.responseOriginal!=='string'||!p.responseOriginal.length||!p.responseOriginal.isWellFormed()||/[\u0000-\u001f]/.test(p.responseOriginal)||Buffer.byteLength(p.responseOriginal)>SESSION_V4_RESPONSE_MAX_BYTES)fail();
  }
 }
 if(Buffer.byteLength(canonicalJSON(row))>1048576)fail();return freeze(JSON.parse(canonicalJSON({...row,request})));
}
