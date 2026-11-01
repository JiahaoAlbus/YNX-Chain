// Shared Node verifier mechanics. Parsed policy DATA is not an authenticated
// Source, a credential, an issuer/role grant or a protected-key capability.
import {Buffer} from 'node:buffer';
import {VERSION,LIMIT,decodeMember,createVerifier} from '@ynx/batch-v01-candidate';
import {exactPQRecord,pqError,assertPQPublicBindingMatches} from './pq-wallet-contract.js';
import {pqU64,pqHex,pqCanonicalAddress} from './pq-wallet-authorization.js';
import {inspectPQAuthorizationView,pqRegisteredPublicBinding} from './pq-wallet-policy.js';

function context(snapshot,expected){
  exactPQRecord(expected,['chainId','owner','keyVersion','executionHeight']);
  if(typeof expected.keyVersion!=='string'||typeof expected.executionHeight!=='string')throw pqError('PQ_REGISTERED_DECIMAL_REQUIRED');
  const keyVersion=pqU64(expected.keyVersion).toString(),height=pqU64(expected.executionHeight).toString();
  // This call requires the existing SDK-branded, immutable complete snapshot.
  const view=inspectPQAuthorizationView(snapshot);
  if(snapshot.networkId!==pqHex(expected.chainId,32).toString('hex')||snapshot.owner!==pqCanonicalAddress(expected.owner)||snapshot.executionHeight!==height)throw pqError('PQ_REGISTERED_CONTEXT_MISMATCH');
  if(!snapshot.enabled||!view.pqSigningEnabled||!view.activeRecord||view.authorizationStatus==='revoked')throw pqError('PQ_REGISTERED_KEY_INACTIVE');
  if(view.activeRecord.revision!==keyVersion)throw pqError('PQ_REGISTERED_KEY_VERSION_MISMATCH');
  return {record:view.activeRecord,height,keyVersion,chainId:snapshot.networkId,owner:snapshot.owner};
}
function copyBytes(value,max,min=0){
  if(!(value instanceof Uint8Array)||(typeof SharedArrayBuffer!=='undefined'&&value.buffer instanceof SharedArrayBuffer)||value.length<min||value.length>max)throw pqError('PQ_REGISTERED_BYTES_INVALID');
  return Buffer.from(value);
}
function result(s){return Object.freeze({chainId:s.chainId,owner:s.owner,keyVersion:s.keyVersion,executionHeight:s.height,dataOnly:true,nativeAdmission:false});}

/** Exact registered full-pair match only. Does not restore a key, clear a
 * tombstone, change owner/roles or authorize recovery/export/transaction use. */
export function assertPQRegisteredRecoveryBindingData(snapshot,binding,expected){
  const s=context(snapshot,expected);
  assertPQPublicBindingMatches(binding,pqRegisteredPublicBinding(snapshot,s.keyVersion));
  return result(s);
}

/** Full existing dual-AND certificate + both Merkle paths against the exact
 * supplied registered snapshot. Auth owns purpose/request encoding and genuine
 * Source/trust/current acquisition before AND after this synchronous check.
 * This function supplies no new Auth signing domain or authorization. */
export function verifyPQRegisteredMemberData(snapshot,wire,expected){
  exactPQRecord(expected,['chainId','owner','keyVersion','executionHeight','purpose','message']);
  const s=context(snapshot,{chainId:expected.chainId,owner:expected.owner,keyVersion:expected.keyVersion,executionHeight:expected.executionHeight});
  if(typeof expected.purpose!=='string'||! /^[\x20-\x7e]{1,64}$/.test(expected.purpose))throw pqError('PQ_REGISTERED_PURPOSE_INVALID');
  const purpose=expected.purpose,message=copyBytes(expected.message,LIMIT.message),bytes=copyBytes(wire,LIMIT.member,1),member=decodeMember(bytes),c=member.certificate;
  if(c.owner!==s.owner||c.purpose!==purpose||!c.chainId.equals(Buffer.from(s.chainId,'hex'))||!c.pkA.equals(Buffer.from(s.record.pkA,'hex'))||!c.pkB.equals(Buffer.from(s.record.pkB,'hex'))||!member.message.equals(message))throw pqError('PQ_REGISTERED_MEMBER_BINDING_MISMATCH');
  // Provider API accepts safe JS Number coordinates. All actual U64 height,
  // activation, revision and revocation checks occur above without rounding.
  // Zero is only its local math coordinate, never a reported chain height.
  // No cross-call certificate/key cache can reuse stale policy or purpose.
  const verifier=createVerifier({provider:'portable',chainId:Buffer.from(s.chainId,'hex'),purpose,cacheEntries:0,resolveTrustedOwner:()=>({algorithmVersion:VERSION,enabled:true,owner:s.owner,purpose,policyRevision:s.keyVersion,chainId:Buffer.from(s.chainId,'hex'),pkA:Buffer.from(s.record.pkA,'hex'),pkB:Buffer.from(s.record.pkB,'hex'),activeFrom:0,revokedAt:null})});
  try{if(!verifier.verifyOne(bytes,{height:0}))throw pqError('PQ_REGISTERED_MEMBER_SIGNATURE_INVALID');}
  finally{verifier.clear();}
  return Object.freeze({...result(s),purpose,signatureVerified:true,memberCount:c.N,memberIndex:member.index});
}
