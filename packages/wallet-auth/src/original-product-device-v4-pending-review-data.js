// Public Node DATA view of the original pending-device scope8. It performs no
// Source/profile/current verification, Native acquisition or account approval.
import{types}from'node:util';import{Buffer}from'node:buffer';
import registry from'../product-session-registry.json' with{type:'json'};
import{canonicalJSON,WalletAuthError}from'./canonical.js';
import{evmAddressFromYNX}from'./crypto.js';
import{inspectProductSessionDeviceRegistrationOriginalV4Data}from'./product-session-device-registration-v4.js';
import{parseProductSessionRequest,parseProductSessionChallenge,productSessionRequestDigest}from'./product-session-v2.js';
import{encodeProductSessionDeviceChallengeV4Message,encodeProductSessionDeviceRegistrationV4Message}from'./product-session-pq-v4-codec.js';
export const PRODUCT_DEVICE_V4_PENDING_REVIEW_EXPECTED_FIELDS=Object.freeze(['networkId','canonicalOwner','account','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','generation','registrationId','revision','registrationDigest']);
const SCOPE=['version','operation','pendingId','expected','registrationOriginal','requestOriginal','approvalDigest','challengeOriginal'];
const ta=Object.getPrototypeOf(Uint8Array.prototype),getLength=Object.getOwnPropertyDescriptor(ta,'byteLength').get,getBuffer=Object.getOwnPropertyDescriptor(ta,'buffer').get,set=Uint8Array.prototype.set;
const heldReviews=new WeakMap(),FLAGS=Object.freeze({dataOnly:true,approvedAccount:false,authorized:false,current:false,registered:false,SourceAdmission:false,NativeAdmission:false});
const fail=()=>{throw new WalletAuthError('PENDING_DEVICE_V4_REVIEW_DATA_INVALID','Original pending-device review DATA is invalid');};
function exact(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail();const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]||!Object.hasOwn(ds[k],'value')))fail();return Object.fromEntries(keys.map(k=>[k,ds[k].value]));}
function capture(v){if(types.isProxy(v))fail();let n,b;try{n=getLength.call(v);b=getBuffer.call(v);}catch{fail()}if(!(v instanceof Uint8Array)||!n||n>131072||b instanceof SharedArrayBuffer)fail();for(const k of ['buffer','byteLength','length',Symbol.iterator]){const d=Object.getOwnPropertyDescriptor(v,k);if(d&&!Object.hasOwn(d,'value'))fail()}const out=new Uint8Array(n);try{set.call(out,v)}catch{fail()}return out;}
function parse(raw,limit){if(typeof raw!=='string'||!raw.length||Buffer.byteLength(raw)>limit)fail();let v;try{v=JSON.parse(raw)}catch{fail()}if(canonicalJSON(v)!==raw)fail();return v;}
function freeze(v){if(v&&typeof v==='object'){for(const k of Object.keys(v))freeze(v[k]);if(!Object.isFrozen(v))Object.freeze(v)}return v;}
function digest(v){if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail();}
/** Times are taken only from the original request/challenge to reuse syntax
 * and message encoders. They are not the current clock or a signed profile. */
export function inspectOriginalProductDeviceV4PendingReviewDATA(originalBytes){
 const original=capture(originalBytes);let raw;try{raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(original)}catch{fail()}
 const scope=parse(raw,131072),s=exact(scope,SCOPE),e=exact(s.expected,PRODUCT_DEVICE_V4_PENDING_REVIEW_EXPECTED_FIELDS);
 if(s.version!=='4'||!['registration-pop','challenge-completion'].includes(s.operation))fail();digest(s.pendingId);digest(s.approvalDigest);
 const registrationValue=parse(s.registrationOriginal,16384),registrationBytes=Buffer.from(s.registrationOriginal,'utf8'),registration=inspectProductSessionDeviceRegistrationOriginalV4Data(registrationBytes),r=registration.record;
 if(canonicalJSON(r)!==s.registrationOriginal||canonicalJSON(registrationValue)!==s.registrationOriginal||r.revokedAt!==null||registration.registrationDigest!==e.registrationDigest||evmAddressFromYNX(e.account)!==e.canonicalOwner)fail();
 for(const k of PRODUCT_DEVICE_V4_PENDING_REVIEW_EXPECTED_FIELDS.filter(k=>!['account','registrationDigest'].includes(k)))if(r[k]!==e[k])fail();
 const requestValue=parse(s.requestOriginal,16384);
 // An explicit original instant, never ambient Date(), is the DATA parse basis.
 if(typeof requestValue?.issuedAt!=='string')fail();
 const request=parseProductSessionRequest(registry,requestValue,new Date(requestValue.issuedAt));
 if(request.version!=='4'||canonicalJSON(request)!==s.requestOriginal||request.deviceRegistrationId!==e.registrationId||request.deviceRegistrationRevision!==e.revision||request.deviceRegistrationDigest!==e.registrationDigest)fail();
 for(const k of ['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId'])if(request[k]!==e[k])fail();
 const requestDigest=productSessionRequestDigest(registry,request,new Date(request.issuedAt));
 let challenge=null,begin=Math.max(Date.parse(r.registeredAt),Date.parse(request.issuedAt)),end=Math.min(Date.parse(r.expiresAt),Date.parse(request.expiresAt));
 if(s.operation==='registration-pop'){
  if(s.challengeOriginal!==null)fail();encodeProductSessionDeviceRegistrationV4Message(registrationBytes);
 }else{
  challenge=parseProductSessionChallenge(parse(s.challengeOriginal,16384));
  if(challenge.version!=='4'||canonicalJSON(challenge)!==s.challengeOriginal||challenge.account!==e.account||challenge.approvalDigest!==s.approvalDigest||challenge.requestDigest!==requestDigest)fail();
  for(const k of ['chainId','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','deviceAlgorithm','deviceRegistrationId','deviceRegistrationRevision','deviceRegistrationDigest','nonce','state'])if(challenge[k]!==request[k])fail();
  if(canonicalJSON(challenge.scopes)!==canonicalJSON(request.scopes)||challenge.accountAuthorization.canonicalOwner!==e.canonicalOwner||challenge.accountAuthorization.networkId!==e.networkId||challenge.accountAuthorization.pkA===r.pkA||challenge.accountAuthorization.pkB===r.pkB)fail();
  encodeProductSessionDeviceChallengeV4Message(challenge,registrationBytes);
  begin=Math.max(begin,Date.parse(challenge.issuedAt));end=Math.min(end,Date.parse(challenge.expiresAt));
 }
 if(!(begin<end))fail();
 const originalWindow=Object.freeze({beginsAt:new Date(begin).toISOString(),expiresAt:new Date(end).toISOString(),dataOnly:true,current:false});
 const review=Object.freeze({scope:freeze(scope),record:freeze(r),request:freeze(request),challenge:freeze(challenge),requestDigest,originalWindow,timeBasis:'original-issued-at-data-only',...FLAGS});
 // This is only provenance for immutable DATA decoded by this module, never a
 // Source/Native brand. Independent selected values are still required below.
 heldReviews.set(review,Object.freeze({...e}));return review;
}
/** The caller must supply independently selected expected16. Reading the same
 * expected values back from the review cannot establish independent consent. */
export function assertOriginalProductDeviceV4PendingReviewBindingDATA(review,expected16){
 if(!review||types.isProxy(review)||!heldReviews.has(review))fail();const e=exact(expected16,PRODUCT_DEVICE_V4_PENDING_REVIEW_EXPECTED_FIELDS),original=heldReviews.get(review);
 for(const k of PRODUCT_DEVICE_V4_PENDING_REVIEW_EXPECTED_FIELDS)if(e[k]!==original[k])throw new WalletAuthError('PENDING_DEVICE_V4_REVIEW_BINDING_MISMATCH','Pending review differs from independently selected DATA');
 return Object.freeze({bindingMatches:true,...FLAGS});
}
