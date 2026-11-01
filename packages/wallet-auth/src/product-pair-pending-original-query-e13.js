// Node-only E13 DATA/math, matching the original Core typed pending-query
// message. No signer, Root/Source factory, HTTP21 fallback or replay authority.
import {decodeFields} from '@ynx-chain/open-protocol/framing';
import {types} from 'node:util';import {createHash} from 'node:crypto';
import {encodeFields,u32,decodeMember,createVerifier,VERSION} from '@ynx/batch-v01-candidate/browser';
import {canonicalJSON} from './canonical.js';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from './product-session-device-registration-v4.js';
import {decodePendingPairOriginalQueryDATA,PENDING_ORIGINAL_QUERY_CONTRACT} from './product-pair-pending-original-query-data.mjs';
import {inspectPendingPairQueryTransportDATA} from './product-pair-pending-query-transport-data.mjs';
import {pqHexBytes} from './pq-public-bytes.js';
export const PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_DOMAIN=PENDING_ORIGINAL_QUERY_CONTRACT.domain;
export const PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_PURPOSE=PENDING_ORIGINAL_QUERY_CONTRACT.purpose;
export const PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_MESSAGE_MAX_BYTES=16384;
export const PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_MEMBER_MAX_BYTES=98304;
export const PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_PROOF_HEADER_V1='x-ynx-product-pair-original-query-proof-v1';
export const PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_PROOF_HEADER_MAX_CHARS_V1=131072;
const fail=()=>{throw Object.assign(Error('PENDING_ORIGINAL_QUERY_E13_INVALID'),{code:'PENDING_ORIGINAL_QUERY_E13_INVALID'});};
const expectedKeys=['networkId','canonicalOwner','pkA','pkB','actorDigest','serviceOrigin','nonce','issuedAt','expiresAt','atMs','sourceIssuedAtMs','sourceExpiresAtMs'];
function exact(v,keys){if(!v||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail();const d=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!d[k]||!d[k].enumerable||!Object.hasOwn(d[k],'value')))fail();return Object.fromEntries(keys.map(k=>[k,d[k].value]));}
const TA=Object.getPrototypeOf(Uint8Array.prototype),getBuffer=Object.getOwnPropertyDescriptor(TA,'buffer').get,getLength=Object.getOwnPropertyDescriptor(TA,'byteLength').get,set=Uint8Array.prototype.set;
function bytes(value,max){if(types.isProxy(value)||!types.isUint8Array(value))fail();try{const b=getBuffer.call(value),n=getLength.call(value);if(types.isSharedArrayBuffer(b)||n<1||n>max)fail();const out=new Uint8Array(n);set.call(out,value);return out;}catch{fail();}}
const sha=b=>createHash('sha256').update(b).digest('hex');
const equal=(a,b)=>Buffer.from(a).equals(Buffer.from(b));
function canonicalOriginal(raw){let text,value;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);value=JSON.parse(text);if(canonicalJSON(value)!==text)fail();}catch{fail();}return {text,value};}
function prepareEnvelope(input){
 const v=exact(input,['queryOriginal','registrationOriginal','expected']),e=exact(v.expected,expectedKeys);
 // Capture every byte source before invoking parsers or hashing.
 const query=bytes(v.queryOriginal,1024),registration=bytes(v.registrationOriginal,16384);
 const network=pqHexBytes(e.networkId,32),pkA=pqHexBytes(e.pkA,2592),pkB=pqHexBytes(e.pkB,64),actor=pqHexBytes(e.actorDigest,32);
 if(typeof e.canonicalOwner!=='string'||!/^0x[0-9a-f]{40}$/.test(e.canonicalOwner)||e.canonicalOwner.length!==42||typeof e.nonce!=='string'||e.nonce.match(/^[A-Za-z0-9_-]{32,64}$/)?.[0]!==e.nonce)fail();
 if(![e.atMs,e.sourceIssuedAtMs,e.sourceExpiresAtMs].every(n=>Number.isSafeInteger(n)&&n>=0)||e.sourceExpiresAtMs<=e.sourceIssuedAtMs)fail();
 inspectPendingPairQueryTransportDATA({nonce:e.nonce,issuedAt:e.issuedAt,expiresAt:e.expiresAt,serviceOrigin:e.serviceOrigin},e.serviceOrigin,e.atMs);
 const issued=Date.parse(e.issuedAt),expires=Date.parse(e.expiresAt);if(issued<0||expires<0||issued<e.sourceIssuedAtMs||expires>e.sourceExpiresAtMs)fail();
 const q=decodePendingPairOriginalQueryDATA(Buffer.from(query));canonicalOriginal(registration);
 const view=inspectProductSessionDeviceRegistrationOriginalV4Data(registration),r=view.record;
 if(r.networkId!==e.networkId||r.canonicalOwner!==e.canonicalOwner||r.pkA!==e.pkA||r.pkB!==e.pkB||r.revokedAt!==null||e.issuedAt<r.registeredAt||e.expiresAt>r.expiresAt)fail();
 const actorDTO=Object.fromEntries(['applicationId','bundleId','callback','canonicalOwner','clientId','deviceId','networkId','origin','packageId','platform','productId'].map(k=>[k,r[k]]));
 if(sha(new TextEncoder().encode(canonicalJSON(actorDTO)))!==e.actorDigest)fail();
 const message=encodeFields([PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_DOMAIN,u32(1),network,e.canonicalOwner,actor,e.serviceOrigin,PENDING_ORIGINAL_QUERY_CONTRACT.method,PENDING_ORIGINAL_QUERY_CONTRACT.path,e.nonce,e.issuedAt,e.expiresAt,query,registration]);
 if(message.length>PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_MESSAGE_MAX_BYTES)fail();
 return {e,network,pkA,pkB,query,registration,q,message};
}
function prepare(input){
 const v=exact(input,['queryOriginal','registrationOriginal','originalPairPost','expected']);
 const pairPost=bytes(v.originalPairPost,393216),prepared=prepareEnvelope({queryOriginal:v.queryOriginal,registrationOriginal:v.registrationOriginal,expected:v.expected});
 const {q,registration}=prepared;
 const original=canonicalOriginal(pairPost).value;exact(original,['approval','operationId','registrationMember','registrationOriginal','request']);
 if(original.operationId!==q.operationId||original.registrationOriginal!==new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(registration)||typeof original.registrationMember!=='string'||!original.registrationMember.length||!original.approval||Object.getPrototypeOf(original.approval)!==Object.prototype||!original.request||Object.getPrototypeOf(original.request)!==Object.prototype||sha(pairPost)!==q.originalRequestBodyDigest)fail();
 return prepared;
}
/** Complete original PAIR bytes are checked/hashed, never embedded in E13. */
export function encodeProductPairPendingOriginalQueryMessageDATA(input){return prepare(input).message;}
const flags=Object.freeze({dataOnly:true,RootAdmission:false,SourceAdmission:false,NativeAdmission:false,registered:false,current:false,authorized:false,connected:false,newSession:false,retryAuthorized:false});
function result(v,signatureVerified,originalPostVerified){return Object.freeze({version:'1',purpose:PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_PURPOSE,operationId:v.q.operationId,actorDigest:v.e.actorDigest,originalRequestBodyDigest:v.q.originalRequestBodyDigest,queryBodyDigest:v.q.queryBodyDigest,messageOriginal:new Uint8Array(v.message),queryOriginal:new Uint8Array(v.query),registrationOriginal:new Uint8Array(v.registration),signatureVerified,originalPostVerified,...flags});}
export function inspectProductPairPendingOriginalQueryMessageDATA(messageOriginal,input){const captured=bytes(messageOriginal,PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_MESSAGE_MAX_BYTES),v=prepare(input);if(!equal(captured,v.message))fail();return result(v,false,true);}
/** Independently selected registered pair is REQUIRED; 'Registered' describes
 * the input's required provenance, never a registry/Source result from DATA.
 * Full existing ML-DSA87 AND SLH256f math, no new crypto implementation. */
function memberShape(wire){
 const member=decodeMember(wire),c=member.certificate;
 if(c.N!==1||member.index!==0||member.pathA.length||member.pathB.length||c.purpose!==PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_PURPOSE)fail();return member;
}
function verifyN1(wire,v){
 const member=memberShape(wire),c=member.certificate;
 if(c.owner!==v.e.canonicalOwner||!equal(c.chainId,v.network)||!equal(c.pkA,v.pkA)||!equal(c.pkB,v.pkB)||!equal(member.message,v.message))fail();
 const verifier=createVerifier({chainId:v.network,purpose:PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_PURPOSE,cacheEntries:0,resolveTrustedOwner:()=>({enabled:true,algorithmVersion:VERSION,owner:v.e.canonicalOwner,chainId:v.network,pkA:v.pkA,pkB:v.pkB,purpose:PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_PURPOSE,policyRevision:'pending-original-query-data-only',activeFrom:0,revokedAt:null})});
 try{if(!verifier.verifyOne(wire,{height:0}))fail();}finally{verifier.clear();}
}
export function inspectRegisteredProductPairPendingOriginalQueryN1DATA(memberOriginal,input){
 const wire=bytes(memberOriginal,PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_MEMBER_MAX_BYTES),v=prepare(input);verifyN1(wire,v);
 return Object.freeze({...result(v,true,true),memberCount:1,memberIndex:0});
}
/** Stage before DB row lookup: full registered N1/E13/query3/time/actor math,
 * but the complete original PAIR POST is not yet available or verified.
 * Caller must AND actual Source/current before lookup, then run full exact4. */
export function inspectRegisteredProductPairPendingOriginalQueryEnvelopeN1DATA(memberOriginal,input){
 const wire=bytes(memberOriginal,PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_MEMBER_MAX_BYTES),v=prepareEnvelope(input);verifyN1(wire,v);
 return Object.freeze({...result(v,true,false),memberCount:1,memberIndex:0});
}
/** Serialization + fixed N1 shape only. No outer JSON/expected fields, no math
 * or HTTP budget qualification. Registered inspection remains mandatory. */
export function encodeProductPairPendingOriginalQueryProofHeaderV1(memberOriginal){
 const wire=bytes(memberOriginal,PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_MEMBER_MAX_BYTES);memberShape(wire);const header=Buffer.from(wire).toString('base64url');if(header.length>PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_PROOF_HEADER_MAX_CHARS_V1)fail();return header;
}
export function decodeProductPairPendingOriginalQueryProofHeaderV1(header){
 if(typeof header!=='string'||!header.length||header.length>PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_PROOF_HEADER_MAX_CHARS_V1||header.match(/^[A-Za-z0-9_-]+$/)?.[0]!==header)fail();
 const wire=bytes(Buffer.from(header,'base64url'),PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_MEMBER_MAX_BYTES);if(Buffer.from(wire).toString('base64url')!==header)fail();memberShape(wire);return wire;
}

/** Sole UNTRUSTED claim extraction. It never fills independent expected from
 * certificate keys/owner/network. Root/current/registered N1 and original POST
 * binding are separate later stages, with explicit authority clock inputs. */
export function extractProductPairPendingOriginalQueryClaimsDATA(memberOriginal){
 const wire=bytes(memberOriginal,PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_MEMBER_MAX_BYTES),member=memberShape(wire),message=bytes(member.message,PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_MESSAGE_MAX_BYTES),f=decodeFields(message,13);
 const caps=[PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_DOMAIN.length,4,32,42,32,2048,4,PENDING_ORIGINAL_QUERY_CONTRACT.path.length,64,24,24,1024,16384];
 for(let i=0;i<13;i++)if(!f[i].length||f[i].length>caps[i])fail();
 if(f[1].length!==4||!equal(f[1],u32(1))||f[2].length!==32||f[3].length!==42||f[4].length!==32)fail();
 const utf8=b=>{try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);}catch{fail();}};
 if(utf8(f[0])!==PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_DOMAIN||utf8(f[6])!=='POST'||utf8(f[7])!==PENDING_ORIGINAL_QUERY_CONTRACT.path)fail();
 const nonce=utf8(f[8]),issuedAt=utf8(f[9]),expiresAt=utf8(f[10]),serviceOrigin=utf8(f[5]);
 if(nonce.match(/^[A-Za-z0-9_-]{32,64}$/)?.[0]!==nonce)fail();
 // Only the original issued instant is used as a SYNTAX window basis, never
 // as an independent current observation or Source clock.
 inspectPendingPairQueryTransportDATA({nonce,issuedAt,expiresAt,serviceOrigin},serviceOrigin,Date.parse(issuedAt));
 const queryOriginal=bytes(f[11],1024),registrationOriginal=bytes(f[12],16384);canonicalOriginal(registrationOriginal);
 const q=decodePendingPairOriginalQueryDATA(Buffer.from(queryOriginal)),r=inspectProductSessionDeviceRegistrationOriginalV4Data(registrationOriginal).record,c=member.certificate;
 const canonicalOwner=utf8(f[3]),networkId=Buffer.from(f[2]).toString('hex');
 if(r.networkId!==networkId||r.canonicalOwner!==canonicalOwner||c.owner!==canonicalOwner||!equal(c.chainId,f[2])||!equal(c.pkA,pqHexBytes(r.pkA,2592))||!equal(c.pkB,pqHexBytes(r.pkB,64))||r.revokedAt!==null||issuedAt<r.registeredAt||expiresAt>r.expiresAt)fail();
 const actor=Object.fromEntries(['applicationId','bundleId','callback','canonicalOwner','clientId','deviceId','networkId','origin','packageId','platform','productId'].map(k=>[k,r[k]]));
 if(sha(new TextEncoder().encode(canonicalJSON(actor)))!==Buffer.from(f[4]).toString('hex'))fail();
 return Object.freeze({version:'1',purpose:PRODUCT_PAIR_PENDING_ORIGINAL_QUERY_E13_PURPOSE,nonce,issuedAt,expiresAt,operationId:q.operationId,originalRequestBodyDigest:q.originalRequestBodyDigest,queryBodyDigest:q.queryBodyDigest,queryOriginal,registrationOriginal,messageOriginal:message,untrusted:true,signatureVerified:false,originalPostVerified:false,...flags});
}
