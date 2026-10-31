// Node-only V5 public HTTP proof DATA/math. No Source, key, signer or HTTP.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {encodeBase64url,decodeBase64url} from './base64url.js';
import {encodeFields,u32,decodeMember,createVerifier,VERSION} from '@ynx/batch-v01-candidate/browser';
import {encodeDeploymentV2Bind} from '@ynx-chain/open-protocol/deployment-v2';
import {canonicalJSON} from './canonical.js';
import {pqError} from './pq-wallet-contract.js';
import {pqHexBytes as pqHex,publicBytesEqual} from './pq-public-bytes.js';
import {parseProductSessionHTTPProofV4Unsigned} from './product-session-proof-v4.js';
export const PRODUCT_SESSION_PROOF_HEADER_V5='x-ynx-product-session-proof-v5';
export const PRODUCT_SESSION_HTTP_PROOF_DOMAIN_V5='YNX-PRODUCT-SESSION-HTTP-PROOF/v5';
export const PRODUCT_SESSION_HTTP_PROOF_PURPOSE_V5='PRODUCT-SESSION-HTTP-PROOF';
export const PRODUCT_SESSION_V5_BODY_MAX_BYTES=68288512;
export const PRODUCT_SESSION_V5_MEMBER_MAX_BYTES=98304;
export const PRODUCT_SESSION_V5_HEADER_MAX_BYTES=196608;
export const PRODUCT_SESSION_V5_TOTAL_HEADERS_MAX_BYTES=262144;
export const PRODUCT_SESSION_V5_MESSAGE_MAX_BYTES=16384;
const legacyFields=Object.freeze(['version','sessionBinding','productId','clientId','applicationId','bundleId','packageId','origin','callback','account','canonicalOwner','deviceId','deviceRegistrationId','deviceRegistrationRevision','deviceRegistrationDigest','method','path','bodyDigest','nonce','issuedAt','expiresAt']);
const fields=Object.freeze([...legacyFields,'contentType','bodyBinding']),prefix='multipart/form-data; boundary=';
const ta=Object.getPrototypeOf(Uint8Array.prototype),getLength=Object.getOwnPropertyDescriptor(ta,'byteLength').get,getBuffer=Object.getOwnPropertyDescriptor(ta,'buffer').get,set=Uint8Array.prototype.set,te=new TextEncoder();
const bad=()=>{throw pqError('PRODUCT_SESSION_PROOF_V5_INVALID')};
function record(value,keys){if(!value||typeof value!=='object'||types.isProxy(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))bad();const d=Object.getOwnPropertyDescriptors(value);if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]||!d[k].enumerable||!Object.hasOwn(d[k],'value')))bad();return Object.fromEntries(keys.map(k=>[k,d[k].value]))}
function bytes(value,cap){if(types.isProxy(value)||!types.isUint8Array(value))bad();let n,b;try{n=getLength.call(value);b=getBuffer.call(value)}catch{bad()}if(types.isSharedArrayBuffer(b)||!n||n>cap)bad();const out=new Uint8Array(n);try{set.call(out,value)}catch{bad()}return out}
const text=(s,re,max)=>{if(typeof s!=='string'||s.length>max||s.match(re)?.[0]!==s)bad();return s};
function contentType(value){return text(value,/^multipart\/form-data; boundary=[A-Za-z0-9_-]{1,70}$/,prefix.length+70)}
function binding(value){const b=record(value,['bytes','sha3_512','sha512']);text(b.bytes,/^[1-9][0-9]{0,7}$/,8);if(Number(b.bytes)>PRODUCT_SESSION_V5_BODY_MAX_BYTES)bad();text(b.sha3_512,/^[0-9a-f]{128}$/,128);text(b.sha512,/^[0-9a-f]{128}$/,128);return Object.freeze(b)}
function b64(s,cap){text(s,/^[A-Za-z0-9_-]+$/,Math.ceil(cap*4/3));let b;try{b=decodeBase64url(s)}catch{bad()}if(!b.length||b.length>cap||encodeBase64url(b)!==s)bad();return b}
/** Legacy identity and <=30s syntactic window are exactly the V4 parser rules.
 * V5 adds only the explicit POST route, canonical Content-Type and full Bind. */
export function parseProductSessionHTTPProofV5Unsigned(value){
 const v=record(value,fields);if(v.version!=='5'||v.method!=='POST'||v.path!=='/api/v1/ide/deployments')bad();
 const legacy=Object.fromEntries(legacyFields.map(k=>[k,k==='version'?'4':v[k]]));let parsed;try{parsed=parseProductSessionHTTPProofV4Unsigned(legacy)}catch{bad()}
 return Object.freeze({...parsed,version:'5',contentType:contentType(v.contentType),bodyBinding:binding(v.bodyBinding)});
}
/** Root-approved E6; shared Bind is raw U64BE + raw dual hashes, not hex text. */
export function encodeProductSessionHTTPProofV5Message(value,networkId){
 const v=parseProductSessionHTTPProofV5Unsigned(value),network=pqHex(networkId,32),bind=encodeDeploymentV2Bind(v.bodyBinding),wire=encodeFields([PRODUCT_SESSION_HTTP_PROOF_DOMAIN_V5,u32(5),network,v.canonicalOwner,canonicalJSON(v),bind]);
 if(wire.length>PRODUCT_SESSION_V5_MESSAGE_MAX_BYTES)bad();return wire;
}
/** One owned actual body capture feeds all three hashes. Does not parse multipart. */
export function createProductSessionHTTPBodyV5DATA(actualBytes,exactContentType){
 const body=bytes(actualBytes,PRODUCT_SESSION_V5_BODY_MAX_BYTES),ctype=contentType(exactContentType),hash=algorithm=>createHash(algorithm).update(body).digest('hex');
 return Object.freeze({contentType:ctype,bodyDigest:hash('sha256'),bodyBinding:Object.freeze({bytes:String(body.length),sha3_512:hash('sha3-512'),sha512:hash('sha512')}),dataOnly:true,SourceAdmission:false,NativeAdmission:false});
}
/** Requires actual held body and exact received Content-Type, never self-report. */
export function assertProductSessionHTTPBodyV5DATA(actualBytes,exactContentType,unsigned){
 const v=parseProductSessionHTTPProofV5Unsigned(unsigned),actual=createProductSessionHTTPBodyV5DATA(actualBytes,exactContentType);
 if(actual.contentType!==v.contentType||actual.bodyDigest!==v.bodyDigest||canonicalJSON(actual.bodyBinding)!==canonicalJSON(v.bodyBinding))bad();return actual;
}
export function inspectProductSessionHTTPProofV5Data(memberOriginal,expected){
 const e=record(expected,['networkId','unsigned','pkA','pkB']),unsigned=parseProductSessionHTTPProofV5Unsigned(e.unsigned),network=pqHex(e.networkId,32),pkA=pqHex(e.pkA,2592),pkB=pqHex(e.pkB,64),wire=bytes(memberOriginal,PRODUCT_SESSION_V5_MEMBER_MAX_BYTES),member=decodeMember(wire),c=member.certificate;
 if(c.N!==1||member.index!==0||member.pathA.length||member.pathB.length||c.purpose!==PRODUCT_SESSION_HTTP_PROOF_PURPOSE_V5||c.owner!==unsigned.canonicalOwner||!publicBytesEqual(c.chainId,network)||!publicBytesEqual(c.pkA,pkA)||!publicBytesEqual(c.pkB,pkB)||!publicBytesEqual(member.message,encodeProductSessionHTTPProofV5Message(unsigned,e.networkId)))bad();
 const verifier=createVerifier({chainId:network,purpose:PRODUCT_SESSION_HTTP_PROOF_PURPOSE_V5,cacheEntries:0,resolveTrustedOwner:()=>({enabled:true,algorithmVersion:VERSION,owner:unsigned.canonicalOwner,chainId:network,pkA,pkB,purpose:PRODUCT_SESSION_HTTP_PROOF_PURPOSE_V5,policyRevision:'http-v5-data-only',activeFrom:0,revokedAt:null})});
 try{if(!verifier.verifyOne(wire,{height:0}))bad()}finally{verifier.clear()}
 return Object.freeze({version:'5',sessionBinding:unsigned.sessionBinding,deviceRegistrationId:unsigned.deviceRegistrationId,deviceRegistrationRevision:unsigned.deviceRegistrationRevision,deviceRegistrationDigest:unsigned.deviceRegistrationDigest,purpose:PRODUCT_SESSION_HTTP_PROOF_PURPOSE_V5,signatureVerified:true,memberCount:1,memberIndex:0,dataOnly:true,trusted:false,authorized:false,registered:false,current:false,nativeAdmission:false});
}
/** Serialization only; a header is not a verified or admitted device. */
export function encodeProductSessionProofHeaderV5(value,memberOriginal){const v=parseProductSessionHTTPProofV5Unsigned(value),wire=bytes(memberOriginal,PRODUCT_SESSION_V5_MEMBER_MAX_BYTES),header=encodeBase64url(te.encode(canonicalJSON({...v,member:encodeBase64url(wire)})));if(header.length>PRODUCT_SESSION_V5_HEADER_MAX_BYTES)bad();return header}
export function decodeProductSessionProofHeaderV5(header){
 text(header,/^[A-Za-z0-9_-]+$/,PRODUCT_SESSION_V5_HEADER_MAX_BYTES);const raw=b64(header,Math.floor(PRODUCT_SESSION_V5_HEADER_MAX_BYTES*3/4));let value,s;
 try{s=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);value=JSON.parse(s)}catch{bad()}
 const held=record(value,[...fields,'member']),{member,...input}=held,v=parseProductSessionHTTPProofV5Unsigned(input);b64(member,PRODUCT_SESSION_V5_MEMBER_MAX_BYTES);
 if(canonicalJSON({...v,member})!==s)bad();return Object.freeze({...v,member});
}
export function inspectProductSessionHTTPProofHeaderV5Data(header,expected){const {member,...unsigned}=decodeProductSessionProofHeaderV5(header),e=record(expected,['networkId','unsigned','pkA','pkB']);if(canonicalJSON(unsigned)!==canonicalJSON(parseProductSessionHTTPProofV5Unsigned(e.unsigned)))bad();return inspectProductSessionHTTPProofV5Data(b64(member,PRODUCT_SESSION_V5_MEMBER_MAX_BYTES),e)}
