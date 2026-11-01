// Auth private original-bytes DATA binding. This is NOT a Root constructor.
// The Native Source resolves/holds each ref from its private release table.
// Sole SDK remains the only registration/session/derive and management wire.
import{createHash}from'node:crypto';
import{types}from'node:util';
import{canonicalJSON}from'../src/canonical.js';
import{deriveProductSessionV4TargetData,parseProductSession,parseProductSessionChallenge,productSessionRequestDigest}from'../src/product-session-v2.js';
import{inspectProductSessionDeviceRegistrationOriginalV4Data}from'../src/product-session-device-registration-v4.js';
import{evmAddressFromYNX}from'../src/crypto.js';
import{decodeProductSessionManagementV4RequestDATA}from'../src/product-session-management-v4.js';
const fail=c=>{throw Object.assign(Error(c),{code:c});};
const sha=b=>createHash('sha256').update(b).digest('hex');
const kinds=['request','registration','body','session','approval','challenge','targetOperation'];
const TA=Object.getPrototypeOf(Uint8Array.prototype),bufferOf=Object.getOwnPropertyDescriptor(TA,'buffer').get,lengthOf=Object.getOwnPropertyDescriptor(TA,'byteLength').get,setBytes=Uint8Array.prototype.set;
function targetProjection(record){if(!record||Object.getPrototypeOf(record)!==Object.prototype||Object.keys(record).sort().join('|')!==['operationId','originalBodyDigest','originalBodyOriginal'].sort().join('|')||typeof record.operationId!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(record.operationId)||typeof record.originalBodyDigest!=='string'||!/^[0-9a-f]{64}$/.test(record.originalBodyDigest)||typeof record.originalBodyOriginal!=='string'||!record.originalBodyOriginal.isWellFormed()||Buffer.byteLength(record.originalBodyOriginal)<1||Buffer.byteLength(record.originalBodyOriginal)>393216||sha(Buffer.from(record.originalBodyOriginal,'utf8'))!==record.originalBodyDigest)fail('DEVICE_MANAGEMENT_TARGET_OPERATION');return Object.freeze({operationId:record.operationId,originalBodyDigest:record.originalBodyDigest});}
function original(scope,raws,key){const descriptor=scope.originals[key],raw=raws[key];if(descriptor===null){if(raw!==null)fail('DEVICE_MANAGEMENT_ORIGINAL_UNSELECTED');return null;}if(types.isProxy(raw)||!types.isUint8Array(raw))fail('DEVICE_MANAGEMENT_ORIGINAL_BYTES');let owned;try{const n=lengthOf.call(raw);if(types.isSharedArrayBuffer(bufferOf.call(raw))||n!==descriptor.bytes||n<1||n>393216)fail('DEVICE_MANAGEMENT_ORIGINAL_BYTES');owned=new Uint8Array(n);setBytes.call(owned,raw);}catch{fail('DEVICE_MANAGEMENT_ORIGINAL_BYTES');}if(sha(owned)!==descriptor.sha256)fail('DEVICE_MANAGEMENT_ORIGINAL_DIGEST');let s,v;try{s=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(owned);v=JSON.parse(s);}catch{fail('DEVICE_MANAGEMENT_ORIGINAL_CANONICAL');}if(canonicalJSON(v)!==s)fail('DEVICE_MANAGEMENT_ORIGINAL_CANONICAL');return{raw:s,value:v,bytes:owned};}
export function inspectOriginalProductDeviceV4ManagementOriginalsDATA(registry,scope,raws,atMs){
 if(!raws||types.isProxy(raws)||Object.getPrototypeOf(raws)!==Object.prototype)fail('DEVICE_MANAGEMENT_ORIGINAL_SHAPE');const ds=Object.getOwnPropertyDescriptors(raws);if(Reflect.ownKeys(ds).length!==kinds.length||kinds.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable))fail('DEVICE_MANAGEMENT_ORIGINAL_SHAPE');
 const o=Object.fromEntries(kinds.map(k=>[k,original(scope,raws,k)]));
 const e=scope.expected,c=scope.context,r=inspectProductSessionDeviceRegistrationOriginalV4Data(o.registration.bytes).record;
 if(evmAddressFromYNX(e.account)!==e.canonicalOwner||r.revokedAt!==null||!Number.isSafeInteger(atMs)||atMs<Date.parse(r.registeredAt)||atMs>=Date.parse(r.expiresAt)||scope.expiresAtMs>Date.parse(r.expiresAt))fail('DEVICE_MANAGEMENT_REGISTRATION_CURRENT');
 for(const k of['networkId','canonicalOwner','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','generation','registrationId','revision'])if(r[k]!==e[k])fail('DEVICE_MANAGEMENT_REGISTRATION_BINDING');
 if(sha(o.registration.bytes)!==e.registrationDigest)fail('DEVICE_MANAGEMENT_REGISTRATION_BINDING');
 let session;
 if(scope.mode==='registered-session'){
  session=parseProductSession(o.session.value);if(canonicalJSON(session)!==o.session.raw||session.version!=='4'||session.deviceAlgorithm!==c.algorithm||session.accountAuthorization.pkA===r.pkA||session.accountAuthorization.pkB===r.pkB||atMs<Date.parse(session.issuedAt)||atMs>=Date.parse(session.expiresAt)||scope.expiresAtMs>Date.parse(session.expiresAt))fail('DEVICE_MANAGEMENT_SESSION_CURRENT');
 }else{
  if(scope.mode!=='completion-query-original'||scope.operations.length!==1||scope.operations[0]!=='completion.recover'||o.session!==null||!o.approval||!o.challenge||!o.targetOperation)fail('DEVICE_MANAGEMENT_INTENDED_QUERY_ONLY');
  session=deriveProductSessionV4TargetData(registry,o.request.value,o.approval.value,o.challenge.value).session;
 }
 for(const k of['account','clientId','productId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','sessionBinding'])if(session[k]!==e[k])fail('DEVICE_MANAGEMENT_SESSION_BINDING');
 if(session.accountAuthorization.pkA===r.pkA||session.accountAuthorization.pkB===r.pkB)fail('DEVICE_MANAGEMENT_INDEPENDENT_DEVICE_PAIR_REQUIRED');
 if(session.deviceRegistrationId!==e.registrationId||session.deviceRegistrationRevision!==e.revision||session.deviceRegistrationDigest!==e.registrationDigest||session.accountAuthorization.networkId!==e.networkId||canonicalJSON(session.scopes)!==canonicalJSON(c.scopes))fail('DEVICE_MANAGEMENT_SESSION_BINDING');
 const b=o.body.value;if(canonicalJSON(b.request)!==o.request.raw||b.registrationOriginal!==o.registration.raw||b.account!==e.account)fail('DEVICE_MANAGEMENT_BODY_ORIGINAL_BINDING');
 const operation=Object.hasOwn(b,'challengeId')?'cancel':Object.hasOwn(b,'sessionBinding')?(Object.hasOwn(b,'operationId')?'revoke':'active'):'recover';
 const action={active:'session.active',revoke:'session.revoke',cancel:'challenge.cancel',recover:'completion.recover'}[operation];if(!scope.operations.includes(action)||scope.mode==='registered-session'&&operation==='recover')fail('DEVICE_MANAGEMENT_BODY_OPERATION');
 const recovery=operation==='recover'?{kind:'completion',operationId:b.operationId,approvalOriginal:o.approval?.raw,challengeOriginal:o.challenge?.raw}:undefined;
 const wire=decodeProductSessionManagementV4RequestDATA(registry,operation,o.body.bytes,recovery);
 if(operation==='recover'&&wire.intendedSessionBinding!==e.sessionBinding)fail('DEVICE_MANAGEMENT_BODY_SESSION_BINDING');
 if(operation==='cancel'&&(!o.challenge||b.challengeId!==o.challenge.value.challenge))fail('DEVICE_MANAGEMENT_CHALLENGE_BINDING');
 if(operation==='cancel'){const challenge=parseProductSessionChallenge(o.challenge.value);for(const k of['chainId','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','deviceAlgorithm','deviceRegistrationId','deviceRegistrationRevision','deviceRegistrationDigest','nonce','state'])if(challenge[k]!==o.request.value[k])fail('DEVICE_MANAGEMENT_CHALLENGE_IDENTITY');if(challenge.version!=='4'||challenge.account!==e.account||canonicalJSON(challenge.scopes)!==canonicalJSON(o.request.value.scopes)||canonicalJSON(challenge.accountAuthorization)!==canonicalJSON(session.accountAuthorization)||challenge.requestDigest!==productSessionRequestDigest(registry,o.request.value,new Date(o.request.value.issuedAt)))fail('DEVICE_MANAGEMENT_CHALLENGE_IDENTITY');}
 if(Object.hasOwn(b,'sessionBinding')&&b.sessionBinding!==e.sessionBinding)fail('DEVICE_MANAGEMENT_BODY_SESSION_BINDING');
 const target=o.targetOperation?targetProjection(o.targetOperation.value):null;
 if(scope.mode==='completion-query-original'&&(!target||b.operationId!==target.operationId))fail('DEVICE_MANAGEMENT_TARGET_OPERATION_BINDING');
 return Object.freeze({devicePublic:Object.freeze({pkA:r.pkA,pkB:r.pkB}),sessionBinding:e.sessionBinding,mode:scope.mode,operation:action,method:wire.method,path:wire.path,bodyDigest:wire.bodyDigest,targetOperation:target,originalDigests:Object.freeze(Object.fromEntries(kinds.map(k=>[k,o[k]?sha(o[k].bytes):null]))),dataOnly:true,signatureVerified:false,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,authorized:false});
}
/** SAME original raw record and scope descriptor only. Not a public DB row or Source constructor. */
export function readOriginalDeviceV4ManagementTargetOperationDATA(scope,originalRaw){if(scope.mode!=='completion-query-original')fail('DEVICE_MANAGEMENT_TARGET_QUERY_ONLY');return targetProjection(original(scope,{targetOperation:originalRaw},'targetOperation').value);}
