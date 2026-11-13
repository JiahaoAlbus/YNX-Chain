// Private Auth codec producer only. The original Main creation journal owns
// allocation/custody. These public bytes never establish approval or Source.
import {canonicalJSON} from './canonical.js';
import {inspectOriginalDeviceCreateIntentDATA} from './original-device-create-intent-data-core.js';
import {parseProductSessionDeviceRegistrationV4Data,inspectProductSessionDeviceRegistrationOriginalV4Data} from './product-session-device-registration-v4.js';
import {createProductSessionRequest,productSessionRequestDigest} from './product-session-v2.js';
import {PQ_SUITE} from './pq-wallet-contract.js';
import {pqHexBytes} from './pq-public-bytes.js';
import {encodeBase64url} from './base64url.js';
import registry from '../product-session-registry.json' with {type:'json'};
const fail=()=>{throw Object.assign(Error('DEVICE_REGISTRATION_PUBLIC_ORIGINALS_DATA_INVALID'),{code:'DEVICE_REGISTRATION_PUBLIC_ORIGINALS_DATA_INVALID'});};
const own=(v,keys)=>{
 if(!v||Object.getPrototypeOf(v)!==Object.prototype)fail();
 const ds=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(ds);
 if(names.length!==keys.length||names.some(k=>typeof k!=='string')||keys.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value')))fail();
 return Object.fromEntries(keys.map(k=>[k,ds[k].value]));
};
const encoder=new TextEncoder();
const original=(s,keys,max=16384)=>{if(typeof s!=='string'||encoder.encode(s).length>max)fail();let v;try{v=JSON.parse(s);}catch{fail();}const value=own(v,keys);if(canonicalJSON(value)!==s)fail();return value;};
const instant=s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s))fail();const n=Date.parse(s);if(!Number.isSafeInteger(n)||n<0||new Date(n).toISOString()!==s)fail();return n;};
function produce(input){
 const {creationIntentOriginal,publicPair,allocationOriginal}=own(input,['creationIntentOriginal','publicPair','allocationOriginal']);
 if(typeof creationIntentOriginal!=='string')fail();
 const intent=inspectOriginalDeviceCreateIntentDATA(new TextEncoder().encode(creationIntentOriginal)),t=intent.terms;
 const pair=own(publicPair,['pkA','pkB']);
 const a=original(allocationOriginal,['operationId','registrationId','revision','registeredAt','expiresAt','requestIssuedAt','nonce','state','scopes','purpose']);
 if(typeof a.operationId!=='string'||!/^[a-f0-9]{64}$/.test(a.operationId))fail();
 const issued=instant(a.requestIssuedAt),begin=instant(a.registeredAt),end=instant(a.expiresAt);
 // Creation consent is not reused as account consent. Its old time window is
 // not renewed here, and these values are only independently selected DATA.
 if(begin>issued||issued>=end)fail();
 const record=parseProductSessionDeviceRegistrationV4Data({version:'4',registrationId:a.registrationId,networkId:t.networkId,canonicalOwner:t.canonicalOwner,
  ...Object.fromEntries(['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','generation'].map(k=>[k,t[k]])),
  revision:a.revision,pkA:pair.pkA,pkB:pair.pkB,registeredAt:a.registeredAt,expiresAt:a.expiresAt,revokedAt:null});
 const registrationOriginal=canonicalJSON(record),view=inspectProductSessionDeviceRegistrationOriginalV4Data(new TextEncoder().encode(registrationOriginal));
 const request=createProductSessionRequest(registry,{productId:t.productId,platform:t.platform,deviceId:t.deviceId,deviceAlgorithm:PQ_SUITE,
  deviceRegistrationId:record.registrationId,deviceRegistrationRevision:record.revision,deviceRegistrationDigest:view.registrationDigest,
  scopes:a.scopes,purpose:a.purpose,nonce:a.nonce,state:a.state},new Date(issued));
 if(Date.parse(request.expiresAt)>end)fail();
 return Object.freeze({creationOperationId:t.operationId,operationId:a.operationId,creationIntentOriginal,allocationOriginal,
  registrationOriginal,registrationDigest:view.registrationDigest,requestOriginal:canonicalJSON(request),requestDigest:productSessionRequestDigest(registry,request,new Date(issued)),
  dataOnly:true,userApproved:false,registered:false,SourceAdmission:false,NativeAdmission:false});
}
// The VM boundary accepts only canonical primitive JSON. All records below are
// freshly parsed inert values; no Node polyfill or proxy detector is replaced.
export function createOriginalDeviceRegistrationPublicOriginalsCanonicalDATA(raw){
 return produce(original(raw,['creationIntentOriginal','publicPair','allocationOriginal'],32768));
}
// Main's same original journal has already selected and persisted these 112
// PUBLIC bytes and this time. No random, clock, journal or Source is opened.
function allocationFromSeed(v){
 if(typeof v.creationIntentOriginal!=='string'||typeof v.allocatedAtMs!=='string'||!/^(0|[1-9][0-9]{0,15})$/.test(v.allocatedAtMs))fail();
 const at=Number(v.allocatedAtMs);if(!Number.isSafeInteger(at)||at<0)fail();
 let issued;try{issued=new Date(at).toISOString();}catch{fail();}
 const t=inspectOriginalDeviceCreateIntentDATA(encoder.encode(v.creationIntentOriginal)).terms;
 if(at<Date.parse(t.issuedAt))fail();
 const seed=pqHexBytes(v.allocationSeedHex,112),operationId=v.allocationSeedHex.slice(0,64);
 if(typeof v.mainDeviceOperationId!=='string'||!/^[a-f0-9]{64}$/.test(v.mainDeviceOperationId)||v.mainDeviceOperationId===t.operationId||operationId===t.operationId||operationId===v.mainDeviceOperationId)fail();
 const uuid=seed.slice(32,48);uuid[6]=(uuid[6]&15)|64;uuid[8]=(uuid[8]&63)|128;
 const hex=Array.from(uuid,b=>b.toString(16).padStart(2,'0')).join('');
 const registrationId=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
 const nonce=encodeBase64url(seed.slice(48,80)),state=encodeBase64url(seed.slice(80,112));
 // Ask the sole codec for its request window. This temporary DATA template is
 // never retained, sent, signed or treated as a registration; the final request
 // below is rebuilt against the digest of the actual canonical20 record.
 const window=createProductSessionRequest(registry,{productId:t.productId,platform:t.platform,deviceId:t.deviceId,deviceAlgorithm:PQ_SUITE,
  deviceRegistrationId:registrationId,deviceRegistrationRevision:'1',deviceRegistrationDigest:'0'.repeat(64),scopes:['account:read'],purpose:'Register this original app device',nonce,state},new Date(at));
 const allocationOriginal=canonicalJSON({operationId,registrationId,revision:'1',registeredAt:issued,expiresAt:window.expiresAt,requestIssuedAt:issued,nonce,state,scopes:window.scopes,purpose:window.purpose});
 return Object.freeze({creationOperationId:t.operationId,mainDeviceOperationId:v.mainDeviceOperationId,operationId,allocationOriginal,dataOnly:true,userApproved:false,SourceAdmission:false,NativeAdmission:false});
}
export function createOriginalDeviceRegistrationAllocationFromSeedCanonicalDATA(raw){
 return allocationFromSeed(original(raw,['creationIntentOriginal','allocationSeedHex','allocatedAtMs','mainDeviceOperationId'],32768));
}
export function createOriginalDeviceRegistrationPublicOriginalsFromSeedCanonicalDATA(raw){
 const v=original(raw,['creationIntentOriginal','publicPair','allocationSeedHex','allocatedAtMs','mainDeviceOperationId'],32768),a=allocationFromSeed(v);
 return Object.freeze({...produce({creationIntentOriginal:v.creationIntentOriginal,publicPair:v.publicPair,allocationOriginal:a.allocationOriginal}),mainDeviceOperationId:a.mainDeviceOperationId});
}
