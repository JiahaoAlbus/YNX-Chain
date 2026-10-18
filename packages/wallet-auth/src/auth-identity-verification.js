// One Auth contract, one shared dual-PQ verifier. No Node callee substitute,
// root/issuer factory, new signing domain or protected-key capability.
import {AUTH_IDENTITY_PURPOSES,inspectOriginalAuthIdentityRequest,encodeOriginalAuthIdentityRequest,inspectOriginalAuthIdentityContinuity} from '../native/original-auth-identity-v2-contract.mjs';
import {verifyPQRegisteredMemberData,assertPQRegisteredRecoveryBindingData} from './pq-registered-member.js';
import {pqError} from './pq-wallet-contract.js';

/** Source provenance, actual current checks, trusted credentials and business
 * permissions remain with original Auth. Even valid math here is DATA only. */
export function verifyOriginalAuthIdentityMemberData(snapshot,wire,requestRaw,expectedRequestRaw,purpose,atMs){
 const inspected=inspectOriginalAuthIdentityRequest(requestRaw,expectedRequestRaw,purpose,atMs),body=inspected.body;
 // Shared verifier copies/refuses unsafe wire once; use its verified metadata.
 const verified=verifyPQRegisteredMemberData(snapshot,wire,{chainId:body.networkId,owner:body.owner,keyVersion:body.keyVersion,executionHeight:body.executionHeight,purpose:body.purpose,message:encodeOriginalAuthIdentityRequest(body)});
 if(verified.memberCount!==1||verified.memberIndex!==0)throw pqError('AUTH_IDENTITY_V2_N1_REQUIRED');
 return Object.freeze({...inspected,verification:verified,authorized:false});
}

/** Keeps original principal/account continuity and full active registered pair.
 * Does not recover/export keys, reset revocation or return login authority. */
export function verifyOriginalAuthIdentityRecoveryData(snapshot,wire,binding,originalRequestRaw,recoveryRequestRaw,expectedRecoveryRequestRaw,atMs){
 const continuity=inspectOriginalAuthIdentityContinuity(originalRequestRaw,recoveryRequestRaw);
 const verified=verifyOriginalAuthIdentityMemberData(snapshot,wire,recoveryRequestRaw,expectedRecoveryRequestRaw,AUTH_IDENTITY_PURPOSES.recover,atMs),body=verified.body;
 const registered=assertPQRegisteredRecoveryBindingData(snapshot,binding,{chainId:body.networkId,owner:body.owner,keyVersion:body.keyVersion,executionHeight:body.executionHeight});
 return Object.freeze({...verified,continuity,registered,authorized:false});
}
