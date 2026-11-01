// Dedicated signed-profile DATA contract. This does not issue a registration,
// admit a Root/Source, open a key slot or confer signing authority.
import {types} from 'node:util';
import {canonicalJSON} from '../src/canonical.js';
import {evmAddressFromYNX} from '../src/crypto.js';
import {parseProductSession} from '../src/product-session-v2.js';
import {PQ_SUITE} from '../src/pq-wallet-contract.js';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from '../src/product-session-device-registration-v4.js';
export const PRODUCT_DEVICE_V4_SOURCE_PURPOSE='product-session-device-source-v4';
export const PRODUCT_DEVICE_V4_SOURCE_OPERATIONS=Object.freeze(['device.current','device.http-proof']);
const contextFields=['version','algorithm','securityLevel','networkId','account','deviceId','generation','registrationId','revision','registrationDigest','scopes','purpose'];
// Closed metadata shape, checked against the original SDK export in regression.
// Do not import its consumer installer into the verifier's DATA-only process.
const expectedFields=['networkId','canonicalOwner','account','sessionBinding','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','generation','registrationId','revision','registrationDigest'];
const fail=()=>{throw Object.assign(Error('AUTH_SOURCE_V2_DEVICE_SCOPE'),{code:'AUTH_SOURCE_V2_DEVICE_SCOPE'});};
function exact(value,fields){
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail();
 const ds=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(ds);
 if(keys.some(k=>typeof k!=='string')||keys.sort().join('|')!==[...fields].sort().join('|')||Object.values(ds).some(d=>!Object.hasOwn(d,'value')||!d.enumerable))fail();
}
const hex=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
function scopes(value){
 if(types.isProxy(value)||!Array.isArray(value)||value.length<1||value.length>8)fail();
 const d=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(d).length!==value.length+1)fail();
 for(let i=0;i<value.length;i++)if(!d[i]||!Object.hasOwn(d[i],'value')||typeof d[i].value!=='string'||!/^[A-Za-z0-9._:-]{1,64}$/.test(d[i].value))fail();
 if(new Set(value).size!==value.length||[...value].sort().join('\n')!==value.join('\n'))fail();
 return value;
}
export function inspectOriginalProductDeviceV4SourceScopeDATA(scope,association,networkId,subjectOwner,profileIssued,profileExpires,at){
 exact(scope,['version','expected','context','registrationOriginal','sessionOriginal']);
 exact(association,['account','clientId','productId','platform','applicationId','deviceId']);
 exact(scope.expected,expectedFields);exact(scope.context,contextFields);
 const e=scope.expected,c=scope.context;
 if(scope.version!=='4'||!hex(networkId)||e.networkId!==networkId||c.networkId!==networkId||!hex(e.sessionBinding)||!hex(e.registrationDigest))fail();
 if(c.version!=='4'||c.algorithm!==PQ_SUITE||c.securityLevel!=='os-protected'||c.purpose!=='PRODUCT-SESSION-HTTP-PROOF')fail();
 // Hardware-backed must gain its own actual attestation contract, never a
 // caller flag or an inferred property of software Keychain custody.
 if(![profileIssued,profileExpires,at].every(Number.isSafeInteger)||profileIssued<0||profileExpires<=profileIssued||at<profileIssued||at>=profileExpires)fail();
 if(typeof scope.registrationOriginal!=='string'||Buffer.byteLength(scope.registrationOriginal)>16384||typeof scope.sessionOriginal!=='string'||Buffer.byteLength(scope.sessionOriginal)>16384)fail();
 const view=inspectProductSessionDeviceRegistrationOriginalV4Data(Buffer.from(scope.registrationOriginal,'utf8')),r=view.record;
 let session;try{session=parseProductSession(JSON.parse(scope.sessionOriginal));}catch{fail();}
 if(canonicalJSON(session)!==scope.sessionOriginal||session.version!=='4'||session.deviceAlgorithm!==c.algorithm)fail();
 if(r.pkA===session.accountAuthorization.pkA||r.pkB===session.accountAuthorization.pkB)fail();
 if(view.registrationDigest!==e.registrationDigest||r.revokedAt!==null||r.networkId!==networkId||r.canonicalOwner!==subjectOwner||e.canonicalOwner!==subjectOwner||evmAddressFromYNX(e.account)!==subjectOwner)fail();
 for(const k of ['account','clientId','productId','platform','applicationId','deviceId'])if(e[k]!==association[k]||session[k]!==e[k])fail();
 for(const k of ['networkId','canonicalOwner','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','generation','registrationId','revision'])if(r[k]!==e[k])fail();
 for(const k of ['networkId','account','deviceId','generation','registrationId','revision','registrationDigest'])if(c[k]!==e[k])fail();
 for(const k of ['bundleId','packageId','origin','callback'])if(session[k]!==e[k])fail();
 if(session.accountAuthorization.networkId!==networkId||session.sessionBinding!==e.sessionBinding||session.deviceRegistrationId!==e.registrationId||session.deviceRegistrationRevision!==e.revision||session.deviceRegistrationDigest!==e.registrationDigest)fail();
 if(canonicalJSON(scopes(c.scopes))!==canonicalJSON(scopes(session.scopes)))fail();
 const begin=Math.max(Date.parse(r.registeredAt),Date.parse(session.issuedAt)),end=Math.min(Date.parse(r.expiresAt),Date.parse(session.expiresAt));
 if(!Number.isSafeInteger(begin)||!Number.isSafeInteger(end)||profileIssued<begin||profileExpires>end||at<begin||at>=end)fail();
 return Object.freeze({version:'4',registrationDigest:view.registrationDigest,sessionBinding:e.sessionBinding,expiresAtMs:Math.min(profileExpires,end),devicePublic:Object.freeze({pkA:r.pkA,pkB:r.pkB}),accountAuthorization:session.accountAuthorization,dataOnly:true,authorized:false,nativeAdmission:false});
}
