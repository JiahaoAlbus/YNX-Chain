// Versioned public HTTP-device proof DATA. This module has no private key,
// signer, device registrar, Source/current acquisition or activation switch.
import {encodeBase64url,decodeBase64url} from './base64url.js';
import {utf8ToBytes} from '@noble/hashes/utils.js';
import {encodeFields,u32,decodeMember,createVerifier,VERSION} from '@ynx/batch-v01-candidate/browser';
import {canonicalJSON} from './canonical.js';
import {evmAddressFromYNX} from './crypto.js';
import {exactPQRecord,pqError} from './pq-wallet-contract.js';
import {pqHexBytes as pqHex,pqU64,publicBytesEqual} from './pq-public-bytes.js';
export const PRODUCT_SESSION_PROOF_HEADER_V4='x-ynx-product-session-proof-v4';
export const PRODUCT_SESSION_HTTP_PROOF_DOMAIN_V4='YNX-PRODUCT-SESSION-HTTP-PROOF/v4';
export const PRODUCT_SESSION_HTTP_PROOF_PURPOSE_V4='PRODUCT-SESSION-HTTP-PROOF';
export const PRODUCT_SESSION_V4_MEMBER_MAX_BYTES=98304;
export const PRODUCT_SESSION_V4_HEADER_MAX_BYTES=196608;
export const PRODUCT_SESSION_V4_TOTAL_HEADERS_MAX_BYTES=262144;
export const PRODUCT_SESSION_V4_MESSAGE_MAX_BYTES=16384;
const fields=Object.freeze(['version','sessionBinding','productId','clientId','applicationId','bundleId','packageId','origin','callback','account','canonicalOwner','deviceId','deviceRegistrationId','deviceRegistrationRevision','deviceRegistrationDigest','method','path','bodyDigest','nonce','issuedAt','expiresAt']);
const bad=()=>{throw pqError('PRODUCT_SESSION_PROOF_V4_INVALID');};
const text=(s,re,max)=>{if(typeof s!=='string'||s.length>max||s.match(re)?.[0]!==s)bad();return s;};
const digest=s=>text(s,/^[0-9a-f]{64}$/,64);
const identity=s=>text(s,/^[A-Za-z][A-Za-z0-9.-]{2,131}$/,132);
const opaque=s=>text(s,/^[A-Za-z0-9._:-]{8,128}$/,128);
function url(s,origin=false){text(s,/^(https|app|[a-z][a-z0-9+.-]*):\/\/[^\s#?]+$/,2048);let u;try{u=new URL(s);}catch{bad();}if(['http:','file:','javascript:','data:'].includes(u.protocol)||u.username||u.password||(origin&&u.protocol==='https:'?u.origin!==s:u.toString()!==s))bad();return s;}
function time(s){text(s,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,24);if(!Number.isFinite(Date.parse(s))||new Date(s).toISOString()!==s)bad();return s;}
function bytes(v,cap){if(!(v instanceof Uint8Array)||(typeof SharedArrayBuffer!=='undefined'&&v.buffer instanceof SharedArrayBuffer)||!v.length||v.length>cap)bad();return Uint8Array.from(v);}
function b64(s,cap){text(s,/^[A-Za-z0-9_-]+$/,Math.ceil(cap*4/3));const b=decodeBase64url(s);if(!b.length||b.length>cap||encodeBase64url(b)!==s)bad();return b;}
export function parseProductSessionHTTPProofV4Unsigned(value){
 exactPQRecord(value,fields);if(value.version!=='4')bad();
 const out={version:'4',sessionBinding:digest(value.sessionBinding),productId:text(value.productId,/^[a-z][a-z0-9-]{1,31}$/,32),clientId:text(value.clientId,/^[a-z][a-z0-9._-]{2,63}$/,64),applicationId:identity(value.applicationId),bundleId:value.bundleId===null?null:identity(value.bundleId),packageId:value.packageId===null?null:identity(value.packageId),origin:url(value.origin,true),callback:url(value.callback),account:text(value.account,/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/,42),canonicalOwner:text(value.canonicalOwner,/^0x[0-9a-f]{40}$/,42),deviceId:opaque(value.deviceId),deviceRegistrationId:opaque(value.deviceRegistrationId),deviceRegistrationRevision:value.deviceRegistrationRevision,deviceRegistrationDigest:digest(value.deviceRegistrationDigest),method:text(value.method,/^(DELETE|GET|PATCH|POST|PUT)$/,6),path:text(value.path,/^\/[A-Za-z0-9._~!$&'()*+,;=:@\/-]{1,255}$/,256),bodyDigest:digest(value.bodyDigest),nonce:text(value.nonce,/^[A-Za-z0-9_-]{32,64}$/,64),issuedAt:time(value.issuedAt),expiresAt:time(value.expiresAt)};
 if(typeof out.deviceRegistrationRevision!=='string'||!pqU64(out.deviceRegistrationRevision)||evmAddressFromYNX(out.account)!==out.canonicalOwner||out.bundleId!==null&&out.bundleId!==out.applicationId||out.packageId!==null&&out.packageId!==out.applicationId||out.bundleId!==null&&out.packageId!==null)bad();
 if(out.path.includes('//')||out.path.endsWith('/')||out.path.split('/').some(x=>x==='.'||x==='..')||out.expiresAt<=out.issuedAt||Date.parse(out.expiresAt)-Date.parse(out.issuedAt)>30000||out.method==='GET'&&out.bodyDigest!=='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')bad();
 return Object.freeze(out);
}
/** Root-approved E5 ordering: domain, u32 version, raw network32, owner42,
 * canonical complete unsigned request. Registration ID/digest are only DATA. */
export function encodeProductSessionHTTPProofV4Message(value,networkId){
 const v=parseProductSessionHTTPProofV4Unsigned(value),network=pqHex(networkId,32),wire=encodeFields([PRODUCT_SESSION_HTTP_PROOF_DOMAIN_V4,u32(4),network,v.canonicalOwner,canonicalJSON(v)]);
 if(wire.length>PRODUCT_SESSION_V4_MESSAGE_MAX_BYTES)bad();return wire;
}
export function inspectProductSessionHTTPProofV4Data(memberOriginal,expected){
 exactPQRecord(expected,['networkId','unsigned','pkA','pkB']);
 const unsigned=parseProductSessionHTTPProofV4Unsigned(expected.unsigned),network=pqHex(expected.networkId,32),pkA=pqHex(expected.pkA,2592),pkB=pqHex(expected.pkB,64),wire=bytes(memberOriginal,PRODUCT_SESSION_V4_MEMBER_MAX_BYTES),member=decodeMember(wire),c=member.certificate;
 if(c.N!==1||member.index!==0||member.pathA.length||member.pathB.length||c.purpose!==PRODUCT_SESSION_HTTP_PROOF_PURPOSE_V4||c.owner!==unsigned.canonicalOwner||!publicBytesEqual(c.chainId,network)||!publicBytesEqual(c.pkA,pkA)||!publicBytesEqual(c.pkB,pkB)||!publicBytesEqual(member.message,encodeProductSessionHTTPProofV4Message(unsigned,expected.networkId)))bad();
 // Local math adapter only, never a real device registration or active policy.
 // Auth/server independently acquire the pair and current/revoke before/after.
 const verifier=createVerifier({chainId:network,purpose:PRODUCT_SESSION_HTTP_PROOF_PURPOSE_V4,cacheEntries:0,resolveTrustedOwner:()=>({enabled:true,algorithmVersion:VERSION,owner:unsigned.canonicalOwner,chainId:network,pkA,pkB,purpose:PRODUCT_SESSION_HTTP_PROOF_PURPOSE_V4,policyRevision:'http-v4-data-only',activeFrom:0,revokedAt:null})});
 try{if(!verifier.verifyOne(wire,{height:0}))bad();}finally{verifier.clear();}
 return Object.freeze({version:'4',sessionBinding:unsigned.sessionBinding,deviceRegistrationId:unsigned.deviceRegistrationId,deviceRegistrationRevision:unsigned.deviceRegistrationRevision,deviceRegistrationDigest:unsigned.deviceRegistrationDigest,purpose:PRODUCT_SESSION_HTTP_PROOF_PURPOSE_V4,signatureVerified:true,memberCount:1,memberIndex:0,dataOnly:true,trusted:false,authorized:false,registered:false,current:false,nativeAdmission:false});
}
/** Bounded serialization only. Does not sign or authenticate the given Member.
 * The original server MUST inspect it against independently acquired expected. */
export function encodeProductSessionProofHeaderV4(value,memberOriginal){
 const v=parseProductSessionHTTPProofV4Unsigned(value),wire=bytes(memberOriginal,PRODUCT_SESSION_V4_MEMBER_MAX_BYTES),header=encodeBase64url(utf8ToBytes(canonicalJSON({...v,member:encodeBase64url(wire)})));
 if(header.length>PRODUCT_SESSION_V4_HEADER_MAX_BYTES)bad();return header;
}
export function decodeProductSessionProofHeaderV4(header){
 text(header,/^[A-Za-z0-9_-]+$/,PRODUCT_SESSION_V4_HEADER_MAX_BYTES);const raw=b64(header,Math.floor(PRODUCT_SESSION_V4_HEADER_MAX_BYTES*3/4));let value,s;
 try{s=new TextDecoder('utf-8',{fatal:true}).decode(raw);value=JSON.parse(s);}catch{bad();}
 exactPQRecord(value,[...fields,'member']);const {member,...input}=value,v=parseProductSessionHTTPProofV4Unsigned(input);b64(member,PRODUCT_SESSION_V4_MEMBER_MAX_BYTES);
 if(canonicalJSON({...v,member})!==s)bad();return Object.freeze({...v,member});
}
export function inspectProductSessionHTTPProofHeaderV4Data(header,expected){
 const {member,...unsigned}=decodeProductSessionProofHeaderV4(header);
 exactPQRecord(expected,['networkId','unsigned','pkA','pkB']);
 if(canonicalJSON(unsigned)!==canonicalJSON(parseProductSessionHTTPProofV4Unsigned(expected.unsigned)))bad();
 return inspectProductSessionHTTPProofV4Data(b64(member,PRODUCT_SESSION_V4_MEMBER_MAX_BYTES),expected);
}
