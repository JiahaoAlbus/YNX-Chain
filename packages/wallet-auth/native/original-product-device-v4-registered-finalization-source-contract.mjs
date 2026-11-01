// Sole signed selection DATA; no registered/current authority, write or issuer.
import{types}from'node:util';import{canonicalJSON}from'../src/canonical.js';
import{inspectOriginalDeviceCreateIntentDATA}from'../src/original-device-create-intent.js';
import{inspectProductSessionDeviceRegistrationOriginalV4Data}from'../src/product-session-device-registration-v4.js';
export const PRODUCT_DEVICE_V4_REGISTERED_FINALIZATION_PURPOSE='product-session-device-registered-finalization-source-v4';
export const PRODUCT_DEVICE_V4_REGISTERED_FINALIZATION_OPERATIONS=Object.freeze(['device.registered-finalize']);
const expectedFields=['networkId','canonicalOwner','account','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','generation','registrationId','revision','registrationDigest'],identityFields=expectedFields.slice(0,12);
const fail=()=>{throw Object.assign(Error('AUTH_SOURCE_V2_DEVICE_REGISTERED_FINALIZATION_SCOPE'),{code:'AUTH_SOURCE_V2_DEVICE_REGISTERED_FINALIZATION_SCOPE'})};
function exact(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail();const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]||!d[k].enumerable||!Object.hasOwn(d[k],'value')))fail()}
function string(v,max,empty=false){if(typeof v!=='string'||!empty&&!v.length||v.length>max||!v.isWellFormed()||Buffer.byteLength(v)>max)fail();return v}
export function inspectOriginalProductDeviceV4RegisteredFinalizationScopeDATA(scope,association,networkId,subjectOwner,issued,expires,at){
 exact(scope,['version','expected','originalCreationTerms19','originalCreationOperation','originalRegistrationOperation','registrationOriginal','associationOriginal']);exact(scope.expected,expectedFields);exact(association,['account','clientId','productId','platform','applicationId','deviceId']);
 if(scope.version!=='4'||![issued,expires,at].every(Number.isSafeInteger)||issued<0||expires<=issued||expires-issued>86400000||at<issued||at>=expires)fail();
 const e=scope.expected;if(e.networkId!==networkId||e.canonicalOwner!==subjectOwner)fail();
 const terms=inspectOriginalDeviceCreateIntentDATA(Buffer.from(string(scope.originalCreationTerms19,16384),'utf8')).terms;
 // Original creation grammar/window is historical DATA only. Its expired
 // approval is neither revived nor used to clamp the fresh finalization lease.
 for(const k of identityFields)if(terms[k]!==e[k])fail();
 if(terms.generation!==e.generation||terms.operationId!==string(scope.originalCreationOperation,128))fail();
 if(scope.originalRegistrationOperation!==null){const operation=scope.originalRegistrationOperation;if(typeof operation!=='string'||!operation.length||operation.length>128||!operation.isWellFormed())fail()}
 const original=string(scope.registrationOriginal,16384),view=inspectProductSessionDeviceRegistrationOriginalV4Data(Buffer.from(original,'utf8')),r=view.record;
 for(const k of expectedFields)if(!['account','registrationDigest'].includes(k)&&r[k]!==e[k])fail();
 for(const k of Object.keys(association))if(association[k]!==e[k])fail();
 if(view.registrationDigest!==e.registrationDigest||r.revokedAt!==null||r.networkId!==networkId||r.canonicalOwner!==subjectOwner)fail();
 const begin=Date.parse(r.registeredAt),end=Date.parse(r.expiresAt);if(!Number.isSafeInteger(begin)||!Number.isSafeInteger(end)||issued<begin||expires>end||at<begin||at>=end)fail();
 string(scope.associationOriginal,65536);
 // Complete terms/gen/op/registered pair/association are covered by the
 // ORIGINAL Root/profile envelope. Native must still verify actual same item,
 // registered/association evidence and fresh current qualification separately.
 return Object.freeze({version:'4',registrationDigest:view.registrationDigest,originalGeneration:e.generation,originalCreationOperation:scope.originalCreationOperation,originalRegistrationOperation:scope.originalRegistrationOperation,devicePublic:Object.freeze({pkA:r.pkA,pkB:r.pkB}),accountAuthorization:null,expiresAtMs:Math.min(expires,end),historicalCreationTerms:true,registered:false,current:false,localAssociationFinalized:false,dataOnly:true,authorized:false,nativeAdmission:false});
}
