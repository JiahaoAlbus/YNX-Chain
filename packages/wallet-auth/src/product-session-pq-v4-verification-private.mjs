// Fixed verification-only original ESM primitive. No key/sign/provider switch,
// Source grant or alternative mathematical implementation is introduced.
import{decodeMember,createVerifier,VERSION}from'@ynx/batch-v01-candidate/browser';
import{WalletAuthError}from'./canonical.js';
import{pqHexBytes,publicBytesEqual}from'./pq-public-bytes.js';
import{createOriginalV4VerificationDATAFromFixedMath}from'./product-session-pq-v4-verification-core.js';
import registry from '../product-session-registry.json' with { type: 'json' };
import {
  HISTORICAL_APPROVAL_FIELDS,
  inspectHistoricalApprovalDATA,
  storedIssueRaw,
} from './product-session-pq-v4-historical-approval-data.js';
const fail=code=>{throw new WalletAuthError(code,code);};
const ta=Object.getPrototypeOf(Uint8Array.prototype),tag=Object.getOwnPropertyDescriptor(ta,Symbol.toStringTag).get,len=Object.getOwnPropertyDescriptor(ta,'byteLength').get,buf=Object.getOwnPropertyDescriptor(ta,'buffer').get,abl=Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'byteLength').get,set=Uint8Array.prototype.set;
function copy(v,max=98304){let n,b;try{if(tag.call(v)!=='Uint8Array')fail('PQ_SESSION_MEMBER_INVALID');n=len.call(v);b=buf.call(v);abl.call(b);}catch{fail('PQ_SESSION_MEMBER_INVALID');}if(!n||n>max)fail('PQ_SESSION_MEMBER_INVALID');const out=new Uint8Array(n);try{set.call(out,v);}catch{fail('PQ_SESSION_MEMBER_INVALID');}return out;}
function verifyMember(wire,networkId,owner,purpose,message,pkA,pkB){
 const b=copy(wire),m=decodeMember(b),c=m.certificate,network=pqHexBytes(networkId,32),a=pqHexBytes(pkA,2592),z=pqHexBytes(pkB,64);
 if(c.N!==1||m.index!==0||m.pathA.length||m.pathB.length||c.owner!==owner||c.purpose!==purpose||!publicBytesEqual(c.chainId,network)||!publicBytesEqual(c.pkA,a)||!publicBytesEqual(c.pkB,z)||!publicBytesEqual(m.message,message))fail('PQ_SESSION_MEMBER_BINDING_MISMATCH');
 const verifier=createVerifier({chainId:network,purpose,cacheEntries:0,resolveTrustedOwner:()=>({algorithmVersion:VERSION,enabled:true,chainId:network,owner,pkA:a,pkB:z,purpose,policyRevision:'v4-math-only',activeFrom:0,revokedAt:null})});try{if(!verifier.verifyOne(b,{height:0}))fail('PQ_SESSION_MEMBER_SIGNATURE_INVALID');}finally{verifier.clear();}
}
export const originalV4PrivateVerificationDATA=createOriginalV4VerificationDATAFromFixedMath(Object.freeze({verifyMember,copyMessage:b=>copy(b,16384)}));

// Each inner original has its own byte cap. The outer canonical JSON can
// escape quotes and backslashes from those three original strings.
const MAX_HISTORICAL_APPROVAL_WRAPPER = 2 * (16384 + 196608 + 16384) + 256;

export function inspectOriginalProductSessionV4ApprovalDATA(canonicalOriginal) {
  const code = 'PQ_STORED_V4_ISSUE_DATA_INVALID';
  if (arguments.length !== 1) fail(code);
  const originals = storedIssueRaw(canonicalOriginal, MAX_HISTORICAL_APPROVAL_WRAPPER);
  if (!originals || Object.getPrototypeOf(originals) !== Object.prototype ||
      Object.keys(originals).length !== HISTORICAL_APPROVAL_FIELDS.length ||
      !HISTORICAL_APPROVAL_FIELDS.every(field => Object.hasOwn(originals, field))) fail(code);
  return inspectHistoricalApprovalDATA(verifyMember, registry, Object.freeze(originals));
}
