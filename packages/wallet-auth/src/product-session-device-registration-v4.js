// Original Auth's exact20-key device record. Decoding/digest and proof math do
// not allocate an ID, register/activate a pair, admit Source or consume replay.
import {sha256} from '@noble/hashes/sha2.js';import {bytesToHex} from '@noble/hashes/utils.js';
import {canonicalJSON} from './canonical.js';import {evmAddressFromYNX} from './crypto.js';
import {exactPQRecord,pqError} from './pq-wallet-contract.js';import {pqHexBytes as pqHex,pqU64} from './pq-public-bytes.js';
import {parseProductSessionHTTPProofV4Unsigned,inspectProductSessionHTTPProofHeaderV4Data} from './product-session-proof-v4.js';
const F=['version','registrationId','networkId','canonicalOwner','productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId','generation','revision','pkA','pkB','registeredAt','expiresAt','revokedAt'];
const bad=()=>{throw pqError('PRODUCT_SESSION_DEVICE_REGISTRATION_V4_INVALID');};
const str=(s,re,max)=>{if(typeof s!=='string'||s.length>max||s.match(re)?.[0]!==s)bad();return s;};
const time=s=>{str(s,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,24);if(!Number.isFinite(Date.parse(s))||new Date(s).toISOString()!==s)bad();return s;};
const identity=s=>str(s,/^[A-Za-z][A-Za-z0-9.-]{2,131}$/,132);
function url(s,origin=false){str(s,/^(https|app|[a-z][a-z0-9+.-]*):\/\/[^\s#?]+$/,2048);let u;try{u=new URL(s);}catch{bad();}if(['http:','file:','javascript:','data:'].includes(u.protocol)||u.username||u.password||(origin&&u.protocol==='https:'?u.origin!==s:u.toString()!==s))bad();return s;}
function positive(s){if(typeof s!=='string'||!pqU64(s))bad();return s;}
export function parseProductSessionDeviceRegistrationV4Data(value){
 exactPQRecord(value,F);if(value.version!=='4')bad();
 const r={version:'4',registrationId:str(value.registrationId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,36),networkId:bytesToHex(pqHex(value.networkId,32)),canonicalOwner:str(value.canonicalOwner,/^0x[0-9a-f]{40}$/,42),productId:str(value.productId,/^[a-z][a-z0-9-]{1,31}$/,32),clientId:str(value.clientId,/^[a-z][a-z0-9._-]{2,63}$/,64),platform:str(value.platform,/^(android|ios|linux|macos|web|windows)$/,7),applicationId:identity(value.applicationId),bundleId:value.bundleId===null?null:identity(value.bundleId),packageId:value.packageId===null?null:identity(value.packageId),origin:url(value.origin,true),callback:url(value.callback),deviceId:str(value.deviceId,/^[A-Za-z0-9._:-]{8,128}$/,128),generation:positive(value.generation),revision:positive(value.revision),pkA:bytesToHex(pqHex(value.pkA,2592)),pkB:bytesToHex(pqHex(value.pkB,64)),registeredAt:time(value.registeredAt),expiresAt:time(value.expiresAt),revokedAt:value.revokedAt===null?null:time(value.revokedAt)};
 if(r.expiresAt<=r.registeredAt||r.revokedAt!==null&&r.revokedAt<r.registeredAt||r.bundleId!==null&&r.bundleId!==r.applicationId||r.packageId!==null&&r.packageId!==r.applicationId||r.bundleId!==null&&r.packageId!==null)bad();
 return Object.freeze(r);
}
/** Record original must be exact canonical JSON UTF8, not a re-encoded DTO
 * claimed to be an original. No status bit is inferred from dates or bytes. */
export function inspectProductSessionDeviceRegistrationOriginalV4Data(original){
 if(!(original instanceof Uint8Array)||(typeof SharedArrayBuffer!=='undefined'&&original.buffer instanceof SharedArrayBuffer)||!original.length||original.length>16384)bad();
 const bytes=Uint8Array.from(original);let raw,value;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);value=JSON.parse(raw);}catch{bad();}
 const record=parseProductSessionDeviceRegistrationV4Data(value);if(canonicalJSON(record)!==raw)bad();
 return Object.freeze({record,registrationDigest:bytesToHex(sha256(bytes)),dataOnly:true,registered:false,current:false,nativeAdmission:false});
}
/** Server-side math binding to ONE selected original device record. The caller
 * must independently require the SAME active latest original Auth registration
 * before/after this call. Neither an account pair nor an owner-only cache is
 * accepted. These inputs never establish that registration's authenticity. */
export function inspectProductSessionHTTPProofForDeviceRecordV4Data(header,registrationOriginal,expected){
 exactPQRecord(expected,['networkId','unsigned','at']);const unsigned=parseProductSessionHTTPProofV4Unsigned(expected.unsigned),at=time(expected.at),data=inspectProductSessionDeviceRegistrationOriginalV4Data(registrationOriginal),r=data.record;
 if(r.networkId!==bytesToHex(pqHex(expected.networkId,32))||r.canonicalOwner!==evmAddressFromYNX(unsigned.account)||r.canonicalOwner!==unsigned.canonicalOwner||r.registrationId!==unsigned.deviceRegistrationId||r.revision!==unsigned.deviceRegistrationRevision||data.registrationDigest!==unsigned.deviceRegistrationDigest||r.revokedAt!==null||r.registeredAt>at||r.expiresAt<=at||unsigned.issuedAt>at||unsigned.expiresAt<=at||unsigned.issuedAt<r.registeredAt||unsigned.expiresAt>r.expiresAt)bad();
 for(const k of ['productId','clientId','applicationId','bundleId','packageId','origin','callback','deviceId'])if(r[k]!==unsigned[k])bad();
 return inspectProductSessionHTTPProofHeaderV4Data(header,{networkId:r.networkId,unsigned,pkA:r.pkA,pkB:r.pkB});
}
