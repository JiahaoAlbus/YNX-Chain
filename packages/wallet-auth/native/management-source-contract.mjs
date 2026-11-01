// Private Auth family DATA contract. Root signatures/current and original
// protected readers remain mandatory; this module NEVER admits a Source.
import{types}from'node:util';
import{canonicalJSON}from'./inherited/canonical.js';
export const PRODUCT_DEVICE_MANAGEMENT_V4_SOURCE_PURPOSE='product-device-management-source-v4';
export const PRODUCT_DEVICE_MANAGEMENT_V4_SELECTION_KEY='productDeviceManagementV4';
export const PRODUCT_DEVICE_MANAGEMENT_V4_OPERATIONS=Object.freeze(['session.active','session.revoke','challenge.cancel','completion.recover']);
export const PRODUCT_DEVICE_MANAGEMENT_V4_FACTORY='acquireOriginalProductSessionDeviceV4ManagementSource';
const expectedKeys=['networkId','canonicalOwner','account','sessionBinding','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','generation','registrationId','revision','registrationDigest'];
const contextKeys=['version','algorithm','securityLevel','networkId','account','deviceId','generation','registrationId','revision','registrationDigest','scopes','purpose'];
const originalKeys=['request','registration','body','session','approval','challenge','targetOperation'];
const fail=code=>{throw Object.assign(Error(code),{code});};
function exact(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('DEVICE_MANAGEMENT_SOURCE_EXACT');const d=Object.getOwnPropertyDescriptors(v),k=Reflect.ownKeys(d);if(k.length!==keys.length||k.some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(d[k],'value')||!d[k].enumerable))fail('DEVICE_MANAGEMENT_SOURCE_EXACT');return v;}
function text(v,max=256){if(typeof v!=='string'||!v||!v.isWellFormed()||Buffer.byteLength(v)>max||/[\x00-\x1f\x7f]/.test(v))fail('DEVICE_MANAGEMENT_SOURCE_TEXT');}
function hex(v){if(typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v))fail('DEVICE_MANAGEMENT_SOURCE_HEX');}
function u64(v){if(typeof v!=='string'||!/^[1-9][0-9]{0,19}$/.test(v)||BigInt(v)>18446744073709551615n)fail('DEVICE_MANAGEMENT_SOURCE_U64');}
function array(v,allowed,max){if(types.isProxy(v)||!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype||v.length<1||v.length>max)fail('DEVICE_MANAGEMENT_SOURCE_OPERATIONS');const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).length!==v.length+1)fail('DEVICE_MANAGEMENT_SOURCE_OPERATIONS');for(let i=0;i<v.length;i++)if(!d[i]||!Object.hasOwn(d[i],'value')||!d[i].enumerable||typeof d[i].value!=='string'||allowed&&!allowed.includes(d[i].value))fail('DEVICE_MANAGEMENT_SOURCE_OPERATIONS');if(new Set(v).size!==v.length)fail('DEVICE_MANAGEMENT_SOURCE_OPERATIONS');return [...v];}
function ref(v,max){exact(v,['ref','sha256','bytes']);text(v.ref,1024);hex(v.sha256);if(!Number.isSafeInteger(v.bytes)||v.bytes<1||v.bytes>max)fail('DEVICE_MANAGEMENT_SOURCE_ORIGINAL_BOUND');}
export function inspectOriginalProductDeviceV4ManagementScopeDATA(scope,association,networkId,subjectOwner,sourceId,instanceId,profileIssuedAtMs,profileExpiresAtMs,atMs){
 exact(scope,['version','mode','operations','expected','context','currentSelector','originals','expiresAtMs']);
 if(scope.version!=='4'||!['registered-session','completion-query-original'].includes(scope.mode))fail('DEVICE_MANAGEMENT_SOURCE_MODE');
 if(![profileIssuedAtMs,profileExpiresAtMs,atMs,scope.expiresAtMs].every(Number.isSafeInteger)||profileIssuedAtMs<0||profileIssuedAtMs>=profileExpiresAtMs||scope.expiresAtMs!==profileExpiresAtMs||atMs<profileIssuedAtMs||atMs>=profileExpiresAtMs)fail('DEVICE_MANAGEMENT_SOURCE_WINDOW');
 exact(scope.expected,expectedKeys);exact(scope.context,contextKeys);exact(association,['account','clientId','productId','platform','applicationId','deviceId']);exact(scope.currentSelector,['sourceId','instanceId','resourceKey']);exact(scope.originals,originalKeys);
 hex(networkId);if(!/^0x[0-9a-f]{40}$/.test(subjectOwner))fail('DEVICE_MANAGEMENT_SOURCE_OWNER');const e=scope.expected,c=scope.context;
 if(e.networkId!==networkId||e.canonicalOwner!==subjectOwner||scope.currentSelector.sourceId!==sourceId||scope.currentSelector.instanceId!==instanceId)fail('DEVICE_MANAGEMENT_SOURCE_BINDING');for(const k of['sourceId','instanceId','resourceKey'])text(scope.currentSelector[k],k==='resourceKey'?1024:256);
 for(const k of expectedKeys)if(!['bundleId','packageId'].includes(k))text(e[k],1024);for(const k of['networkId','sessionBinding','registrationDigest'])hex(e[k]);u64(e.generation);u64(e.revision);for(const k of['bundleId','packageId'])if(e[k]!==null)text(e[k],512);
 for(const k of Object.keys(association))if(association[k]!==e[k])fail('DEVICE_MANAGEMENT_SOURCE_ASSOCIATION');
 if(c.version!=='4'||c.algorithm!=='ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512'||c.securityLevel!=='os-protected'||c.purpose!=='PRODUCT-SESSION-HTTP-PROOF')fail('DEVICE_MANAGEMENT_SOURCE_CONTEXT');for(const k of['networkId','account','deviceId','generation','registrationId','revision','registrationDigest'])if(c[k]!==e[k])fail('DEVICE_MANAGEMENT_SOURCE_CONTEXT');const cs=array(c.scopes,null,8);if(cs.some(v=>!/^[A-Za-z0-9._:-]{1,64}$/.test(v))||[...cs].sort().join('|')!==cs.join('|'))fail('DEVICE_MANAGEMENT_SOURCE_CONTEXT');
 const ops=array(scope.operations,PRODUCT_DEVICE_MANAGEMENT_V4_OPERATIONS,4);if(scope.mode==='completion-query-original'&&(ops.length!==1||ops[0]!=='completion.recover'||scope.originals.session!==null))fail('DEVICE_MANAGEMENT_SOURCE_QUERY_ONLY');
 if(scope.mode==='registered-session'&&ops.includes('completion.recover'))fail('DEVICE_MANAGEMENT_SOURCE_REGISTERED_MODE');
 ref(scope.originals.request,393216);ref(scope.originals.registration,16384);ref(scope.originals.body,393216);
 if(scope.mode==='registered-session')ref(scope.originals.session,16384);
 const recovery=ops.includes('completion.recover');for(const k of['approval','challenge','targetOperation']){if(recovery)ref(scope.originals[k],393216);else if(scope.originals[k]!==null)ref(scope.originals[k],393216);}
 if(ops.includes('challenge.cancel')&&!scope.originals.challenge)fail('DEVICE_MANAGEMENT_SOURCE_CHALLENGE_REQUIRED');
 const raw=canonicalJSON(scope);if(Buffer.byteLength(raw)>49152)fail('DEVICE_MANAGEMENT_SOURCE_CAPACITY');
 return Object.freeze({scopeOriginal:raw,scope:JSON.parse(raw),operations:Object.freeze(ops),mode:scope.mode,effectExpiresAtMs:profileExpiresAtMs,originalsVerified:false,dataOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,authorized:false,current:false});
}
