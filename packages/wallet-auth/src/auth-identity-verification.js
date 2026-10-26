// One Auth contract, one shared dual-PQ verifier. No Node callee substitute,
// root/issuer factory, new signing domain or protected-key capability.
import {AUTH_IDENTITY_PURPOSES,inspectOriginalAuthIdentityRequest,encodeOriginalAuthIdentityRequest,inspectOriginalAuthIdentityContinuity} from '../native/original-auth-identity-v2-contract.mjs';
import {verifyPQRegisteredMemberData,assertPQRegisteredRecoveryBindingData} from './pq-registered-member.js';
import {pqError,exactPQRecord,pqDecodeBase64url} from './pq-wallet-contract.js';
import {canonicalJSON} from './canonical.js';
import {parsePQAccountAuthorization} from './pq-wallet-policy.js';
import {LIMIT} from '@ynx/batch-v01-candidate';
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';

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

/** Bounded canonical transport DATA only. Frame declarations authenticate no
 * Source, expected request, fresh clock, permission, approval or once-only use.
 * Original Native/Wallet must hold and recheck those independent resources. */
export function verifyOriginalAuthIdentityProofFrameData(frameRaw){
 if(arguments.length!==1)throw pqError('AUTH_IDENTITY_PROOF_FRAME_ARGUMENTS');
 if(typeof frameRaw!=='string'||!frameRaw.length||Buffer.byteLength(frameRaw)>2097152)throw pqError('AUTH_IDENTITY_PROOF_FRAME_CAPACITY');
 let frame;try{frame=JSON.parse(frameRaw);}catch{throw pqError('AUTH_IDENTITY_PROOF_FRAME_CANONICAL');}
 if(canonicalJSON(frame)!==frameRaw)throw pqError('AUTH_IDENTITY_PROOF_FRAME_CANONICAL');
 exactPQRecord(frame,['version','requestRaw','expectedRequestRaw','purpose','atMs','registration','network','wireBase64url'],'AUTH_IDENTITY_PROOF_FRAME_SCHEMA');
 if(frame.version!=='YNX-AUTH-IDENTITY-PROOF-DATA/v1')throw pqError('AUTH_IDENTITY_PROOF_FRAME_VERSION');
 if(![AUTH_IDENTITY_PURPOSES.receive,AUTH_IDENTITY_PURPOSES.recover,AUTH_IDENTITY_PURPOSES.keyCall].includes(frame.purpose))throw pqError('AUTH_IDENTITY_PROOF_PURPOSE_UNSUPPORTED');
 exactPQRecord(frame.network,['chainId','nativeChainId','owner'],'AUTH_IDENTITY_PROOF_FRAME_NETWORK');
 if(typeof frame.network.nativeChainId!=='string')throw pqError('AUTH_IDENTITY_PROOF_FRAME_NETWORK');
 const wire=pqDecodeBase64url(frame.wireBase64url,{max:LIMIT.member});
 const snapshot=parsePQAccountAuthorization(frame.registration,frame.network);
 const verified=verifyOriginalAuthIdentityMemberData(snapshot,wire,frame.requestRaw,frame.expectedRequestRaw,frame.purpose,frame.atMs),body=verified.body;
 return Object.freeze({version:frame.version,requestOriginalDigest:verified.requestOriginalDigest,proofDigest:createHash('sha256').update(wire).digest('hex'),networkId:body.networkId,owner:body.owner,keyVersion:body.keyVersion,executionHeight:body.executionHeight,purpose:body.purpose,memberCount:1,memberIndex:0,signatureVerified:true,dataOnly:true,authorized:false,nativeAdmission:false,effectRetryAuthorized:false});
}
