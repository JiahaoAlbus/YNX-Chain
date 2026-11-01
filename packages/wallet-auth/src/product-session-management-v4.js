// Node-only public DATA. No network, key, Source, replay store or activation.
import {types} from 'node:util';
import {createHash} from 'node:crypto';
import {canonicalJSON} from './canonical.js';
import {parseProductSessionRequest,deriveProductSessionV4TargetData} from './product-session-v2.js';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from './product-session-device-registration-v4.js';
import {decodeProductSessionProofHeaderV4,inspectProductSessionHTTPProofHeaderV4Data,PRODUCT_SESSION_PROOF_HEADER_V4} from './product-session-proof-v4.js';
import {evmAddressFromYNX} from './crypto.js';
export const PRODUCT_SESSION_MANAGEMENT_V4_BODY_MAX_BYTES=393216;
export const PRODUCT_SESSION_MANAGEMENT_V4_CONTENT_TYPE='application/json';
export const PRODUCT_SESSION_MANAGEMENT_V4_ROUTES=Object.freeze({active:'/v4/product-sessions/active',recover:'/v4/product-sessions/recover',revoke:'/v4/product-sessions/revoke',cancel:'/v4/product-session-challenges/cancel'});
const keys={active:['request','registrationOriginal','account','sessionBinding'],recover:['request','registrationOriginal','account','operationId'],revoke:['operationId','request','registrationOriginal','account','sessionBinding'],cancel:['operationId','request','registrationOriginal','account','challengeId']};
const fail=code=>{throw Object.assign(Error(code),{code});};
const bad=()=>fail('PRODUCT_SESSION_MANAGEMENT_V4_INVALID');
const text=(v,max)=>{if(typeof v!=='string'||v.length>max||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v))bad();return v;};
const hex=v=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))bad();return v;};
const opaque=v=>{if(typeof v!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(v))bad();return v;};
const sha=b=>createHash('sha256').update(b).digest('hex');
const TA=Object.getPrototypeOf(Uint8Array.prototype),getBuffer=Object.getOwnPropertyDescriptor(TA,'buffer').get,getLength=Object.getOwnPropertyDescriptor(TA,'byteLength').get,set=Uint8Array.prototype.set;
function bytes(v,max){
 if(types.isProxy(v)||!types.isUint8Array(v))bad();let buffer,n,out;
 try{buffer=getBuffer.call(v);n=getLength.call(v);if(types.isSharedArrayBuffer(buffer)||n<1||n>max)bad();out=new Uint8Array(n);set.call(out,v);}catch{bad();}return out;
}
function snapshot(v,depth=0){
 if(depth>12||types.isProxy(v))bad();
 if(v===null||typeof v==='boolean')return v;
 if(typeof v==='string')return text(v,PRODUCT_SESSION_MANAGEMENT_V4_BODY_MAX_BYTES);
 if(typeof v==='number'){if(!Number.isSafeInteger(v))bad();return v;}
 if(!v||typeof v!=='object')bad();
 const ds=Object.getOwnPropertyDescriptors(v),ks=Reflect.ownKeys(ds);
 if(Array.isArray(v)){
  const n=ds.length?.value;if(!Number.isSafeInteger(n)||n<0||n>64||ks.length!==n+1||ks.some(k=>k!=='length'&&(typeof k!=='string'||!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=n)))bad();
  const a=[];for(let i=0;i<n;i++){const d=ds[i];if(!d||!Object.hasOwn(d,'value')||!d.enumerable)bad();a.push(snapshot(d.value,depth+1));}return Object.freeze(a);
 }
 if(![Object.prototype,null].includes(Object.getPrototypeOf(v))||ks.length>64)bad();
 const out={};for(const k of ks){const d=ds[k];if(typeof k!=='string'||!Object.hasOwn(d,'value')||!d.enumerable)bad();text(k,256);Object.defineProperty(out,k,{value:snapshot(d.value,depth+1),enumerable:true});}return Object.freeze(out);
}
function exact(v,wanted){if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).length!==wanted.length||wanted.some(k=>!Object.hasOwn(v,k)))bad();}
const flags=Object.freeze({dataOnly:true,signatureVerified:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,current:false,authorized:false});
function operation(v){if(typeof v!=='string'||!Object.hasOwn(keys,v))fail('PRODUCT_SESSION_MANAGEMENT_V4_UNREGISTERED');return v;}
function bodyDATA(registry,op,input){
 operation(op);const body=snapshot(input);exact(body,keys[op]);
 const raw=text(body.registrationOriginal,16384),record=inspectProductSessionDeviceRegistrationOriginalV4Data(new TextEncoder().encode(raw));
 // Only historical syntax at its own signed time. This is NOT currentness.
 const request=parseProductSessionRequest(registry,body.request,new Date(body.request?.issuedAt));
 if(request.version!=='4'||evmAddressFromYNX(body.account)!==record.record.canonicalOwner)bad();
 for(const k of ['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId'])if(request[k]!==record.record[k])bad();
 if(request.deviceRegistrationId!==record.record.registrationId||request.deviceRegistrationRevision!==record.record.revision||request.deviceRegistrationDigest!==record.registrationDigest)bad();
 if(Object.hasOwn(body,'operationId'))opaque(body.operationId);
 if(op==='active')hex(body.sessionBinding);
 if(op==='revoke'&&body.sessionBinding!==null)hex(body.sessionBinding);
 if(op==='cancel'&&(typeof body.challengeId!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(body.challengeId)))bad();
 return {body,record};
}
function recoveryTargetDATA(registry,body,target){
 if(target===undefined||target===null)fail('PAIR_V4_RECOVERY_SESSION_BINDING_NOT_DERIVABLE');
 const t=snapshot(target);if(t?.kind==='pair')fail('PAIR_V4_RECOVERY_SESSION_BINDING_NOT_DERIVABLE');
 exact(t,['kind','operationId','approvalOriginal','challengeOriginal']);if(t.kind!=='completion'||t.operationId!==body.operationId)bad();
 const parse=raw=>{text(raw,PRODUCT_SESSION_MANAGEMENT_V4_BODY_MAX_BYTES);let value;try{value=JSON.parse(raw);}catch{bad();}if(canonicalJSON(value)!==raw)bad();return value;};
 const derived=deriveProductSessionV4TargetData(registry,body.request,parse(t.approvalOriginal),parse(t.challengeOriginal));
 if(derived.session.account!==body.account)bad();return hex(derived.session.sessionBinding);
}
export function encodeProductSessionManagementV4RequestDATA(registry,op,input,recoveryTarget){
 const capturedRegistry=snapshot(registry),{body}=bodyDATA(capturedRegistry,op,input),intendedSessionBinding=op==='recover'?recoveryTargetDATA(capturedRegistry,body,recoveryTarget):null,bodyOriginal=new TextEncoder().encode(canonicalJSON(body));
 if(bodyOriginal.length>PRODUCT_SESSION_MANAGEMENT_V4_BODY_MAX_BYTES)bad();
 return Object.freeze({operation:op,method:'POST',path:PRODUCT_SESSION_MANAGEMENT_V4_ROUTES[op],contentType:PRODUCT_SESSION_MANAGEMENT_V4_CONTENT_TYPE,proofHeaderName:PRODUCT_SESSION_PROOF_HEADER_V4,bodyOriginal,bodyDigest:sha(bodyOriginal),operationId:body.operationId??null,body,...(op==='recover'?{intendedSessionBinding}:{}),...flags});
}
export function decodeProductSessionManagementV4RequestDATA(registry,op,original,recoveryTarget){
 const captured=bytes(original,PRODUCT_SESSION_MANAGEMENT_V4_BODY_MAX_BYTES);let raw,input;
 try{raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(captured);input=JSON.parse(raw);}catch{bad();}
 const parsed=encodeProductSessionManagementV4RequestDATA(registry,op,input,recoveryTarget);
 if(canonicalJSON(parsed.body)!==raw)bad();return parsed;
}
/** Independent expected unsigned+pair are mandatory. Local full AND math only. */
export function inspectProductSessionManagementV4ProofDATA(registry,op,original,proofHeader,expected,recoveryTarget){
 const selected=snapshot(expected);exact(selected,['networkId','unsigned','pkA','pkB']);
 const data=decodeProductSessionManagementV4RequestDATA(registry,op,original,recoveryTarget),header=decodeProductSessionProofHeaderV4(proofHeader),{record,registrationDigest}=inspectProductSessionDeviceRegistrationOriginalV4Data(new TextEncoder().encode(data.body.registrationOriginal));
 if(header.method!=='POST'||header.path!==data.path||header.bodyDigest!==data.bodyDigest||header.account!==data.body.account||header.canonicalOwner!==record.canonicalOwner||selected.networkId!==record.networkId||selected.pkA!==record.pkA||selected.pkB!==record.pkB)bad();
 for(const k of ['productId','clientId','applicationId','bundleId','packageId','origin','callback','deviceId'])if(header[k]!==record[k])bad();
 if(header.deviceRegistrationId!==record.registrationId||header.deviceRegistrationRevision!==record.revision||header.deviceRegistrationDigest!==registrationDigest||header.issuedAt<record.registeredAt||header.expiresAt>record.expiresAt)bad();
 if((op==='active'||op==='revoke')&&data.body.sessionBinding!==null&&header.sessionBinding!==data.body.sessionBinding)bad();
 if(op==='recover'&&header.sessionBinding!==data.intendedSessionBinding)bad();
 const proof=inspectProductSessionHTTPProofHeaderV4Data(proofHeader,selected);
 return Object.freeze({...data,signatureVerified:proof.signatureVerified});
}
/** A query association only; it never retries an original effect. */
export function assertProductSessionManagementV4RecoveryDATA(decoded,originalSelection){
 if(types.isProxy(originalSelection))bad();const ds=Object.getOwnPropertyDescriptors(originalSelection??{});if(Reflect.ownKeys(ds).length!==3||['operationId','originalBodyDigest','originalBodyOriginal'].some(k=>!ds[k]||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable))bad();
 const expected={operationId:opaque(ds.operationId.value),originalBodyDigest:hex(ds.originalBodyDigest.value)};if(sha(bytes(ds.originalBodyOriginal.value,PRODUCT_SESSION_MANAGEMENT_V4_BODY_MAX_BYTES))!==expected.originalBodyDigest)bad();
 // decoded contains owned bytes; do not snapshot it as a JSON DTO.
 return recovery(decoded,expected);
}
function recovery(decoded,expected){
 if(types.isProxy(decoded))bad();const ds=Object.getOwnPropertyDescriptors(decoded);
 if(!ds.body?.value||ds.operation?.value!=='recover')bad();const body=snapshot(ds.body.value);
 if(body.operationId!==expected.operationId)bad();
 return Object.freeze({operationId:expected.operationId,originalBodyDigest:expected.originalBodyDigest,queryOnly:true,retryAuthorized:false,...flags});
}
const responseFields=['version','operation','operationId','requestBodyDigest','originalRequestBodyDigest','state','original','code'];
function responseDATA(value,selection){
 const v=snapshot(value),e=snapshot(selection);exact(v,responseFields);exact(e,['operation','operationId','requestBodyDigest','originalRequestBodyDigest']);operation(e.operation);
 hex(e.requestBodyDigest);if(e.operation==='active'){if(e.operationId!==null)bad();}else opaque(e.operationId);
 if(e.operation==='recover')hex(e.originalRequestBodyDigest);else if(e.originalRequestBodyDigest!==null)bad();
 if(v.version!=='4'||v.operation!==e.operation||v.operationId!==e.operationId||v.requestBodyDigest!==e.requestBodyDigest||!['OBSERVED','UNKNOWN','REJECTED'].includes(v.state))bad();
 if(v.operation==='recover'){
  if(v.originalRequestBodyDigest!==null&&v.originalRequestBodyDigest!==e.originalRequestBodyDigest)bad();
  if(v.state==='OBSERVED'&&v.originalRequestBodyDigest===null)bad();
 }else if(v.originalRequestBodyDigest!==null)bad();
 if(v.state==='OBSERVED'){if(typeof v.original!=='string'||!v.original.length||v.code!==null)bad();text(v.original,PRODUCT_SESSION_MANAGEMENT_V4_BODY_MAX_BYTES);}
 else {if(v.original!==null)bad();if(v.code!==null&&(typeof v.code!=='string'||!/^[A-Z][A-Z0-9_]{0,127}$/.test(v.code)))bad();}
 return v;
}
export function encodeProductSessionManagementV4ResponseDATA(value,selection){
 const body=responseDATA(value,selection),original=new TextEncoder().encode(canonicalJSON(body));if(original.length>PRODUCT_SESSION_MANAGEMENT_V4_BODY_MAX_BYTES)bad();return original;
}
export function decodeProductSessionManagementV4ResponseDATA(original,selection){
 const captured=bytes(original,PRODUCT_SESSION_MANAGEMENT_V4_BODY_MAX_BYTES);let raw,v;
 try{raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(captured);v=JSON.parse(raw);}catch{bad();}
 const response=responseDATA(v,selection);if(canonicalJSON(response)!==raw)bad();
 return Object.freeze({responseOriginal:captured,response,queryOnly:true,retryAuthorized:false,executionVerified:false,...flags});
}
