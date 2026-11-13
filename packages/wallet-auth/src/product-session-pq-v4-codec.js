import{createOriginalV4VerificationDATAFromFixedMath}from'./product-session-pq-v4-verification-core.js';
import{encodeProductSessionDeviceChallengeV4Message as originalChallengeMessageDATA,encodeProductSessionDeviceRegistrationV4Message as originalRegistrationMessageDATA,PRODUCT_SESSION_APPROVAL_DOMAIN_V4,PRODUCT_SESSION_DEVICE_CHALLENGE_DOMAIN_V4,PRODUCT_SESSION_DEVICE_REGISTRATION_DOMAIN_V4}from'./product-session-pq-v4-message-data.js';
export{PRODUCT_SESSION_APPROVAL_DOMAIN_V4,PRODUCT_SESSION_DEVICE_CHALLENGE_DOMAIN_V4,PRODUCT_SESSION_DEVICE_REGISTRATION_DOMAIN_V4};
import{types as storedIssueTypes}from'node:util';
import{productPlatformBinding as storedIssueProductBinding}from'./product-session-registry.js';
import { HISTORICAL_APPROVAL_FIELDS, inspectHistoricalApprovalDATA, storedIssueApproval, storedIssueRaw, storedIssueTime } from './product-session-pq-v4-historical-approval-data.js';
import{parseProductSession as storedIssueParseSession}from'./product-session-v2.js';
// Original fixed domains and sole protocol codec. These functions are DATA
// verification/preparation; actual pairing/issuer/current approval is Auth-owned.
import {Buffer} from 'node:buffer';import {decodeMember,createVerifier,VERSION} from '@ynx/batch-v01-candidate';
import {canonicalJSON,WalletAuthError} from './canonical.js';import {exactPQRecord,pqDecodeBase64url} from './pq-wallet-contract.js';
import {parseProductSessionChallenge,createProductSessionChallenge,deriveProductSessionV4TargetData} from './product-session-v2.js';
import {readAccountPolicyObservation,accountAuthorizationFromView,registerVerifiedPQSessionApproval} from './product-session-account-private.js';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from './product-session-device-registration-v4.js';import {evmAddressFromYNX} from './crypto.js';
import{registerPQProductSessionV4SigningPlan}from'./product-session-pq-v4-signing-private.js';


const fail=code=>{throw new WalletAuthError(code,code);};
function verifyMember(wire,networkId,owner,purpose,message,pkA,pkB){
 if(!(wire instanceof Uint8Array)||wire.buffer instanceof SharedArrayBuffer||!wire.length||wire.length>98304)fail('PQ_SESSION_MEMBER_INVALID');const b=Buffer.from(wire),m=decodeMember(b),c=m.certificate;
 if(c.N!==1||m.index!==0||m.pathA.length||m.pathB.length||c.owner!==owner||c.purpose!==purpose||!c.chainId.equals(Buffer.from(networkId,'hex'))||!c.pkA.equals(Buffer.from(pkA,'hex'))||!c.pkB.equals(Buffer.from(pkB,'hex'))||!m.message.equals(message))fail('PQ_SESSION_MEMBER_BINDING_MISMATCH');
 const verifier=createVerifier({provider:'portable',chainId:Buffer.from(networkId,'hex'),purpose,cacheEntries:0,resolveTrustedOwner:()=>({algorithmVersion:VERSION,enabled:true,chainId:Buffer.from(networkId,'hex'),owner,pkA:Buffer.from(pkA,'hex'),pkB:Buffer.from(pkB,'hex'),purpose,policyRevision:'v4-math-only',activeFrom:0,revokedAt:null})});try{if(!verifier.verifyOne(b,{height:0}))fail('PQ_SESSION_MEMBER_SIGNATURE_INVALID');}finally{verifier.clear();}
}
function verifyHistoricalMember(wire, networkId, owner, purpose, message, pkA, pkB) {
 return verifyMember(wire, networkId, owner, purpose, Buffer.from(message), pkA, pkB);
}
const originalV4Verification=createOriginalV4VerificationDATAFromFixedMath(Object.freeze({verifyMember,copyMessage:b=>Buffer.from(b)}));
export function prepareProductSessionApprovalV4Data(registry,request,input,policyRef,registrationOriginal,at=new Date()){return originalV4Verification.prepareProductSessionApprovalV4Data(registry,request,input,policyRef,registrationOriginal,at);}
export function verifyProductSessionApprovalV4Data(registry,request,approval,policyRef,registrationOriginal,at=new Date()){return originalV4Verification.verifyProductSessionApprovalV4Data(registry,request,approval,policyRef,registrationOriginal,at);}
/** Main-only typed plan after its independent account review. Existing Vault
 * permission/current/journal fences remain required; creation consent cannot
 * supply them. No caller message, key, signer or approved flag is accepted. */
export function preparePQProductSessionApprovalV4(registry,request,input,policyRef,registrationOriginal,at=new Date()){
 const data=prepareProductSessionApprovalV4Data(registry,request,input,policyRef,registrationOriginal,at);
 return registerPQProductSessionV4SigningPlan(Object.freeze({policyRef,unsigned:data.unsigned,message:Buffer.from(data.message),purpose:data.purpose}));
}
export function encodeProductSessionDeviceChallengeV4Message(challenge,registrationOriginal){return Buffer.from(originalChallengeMessageDATA(challenge,registrationOriginal));}
export function verifyProductSessionDeviceChallengeV4Data(challenge,registrationOriginal,member,at=new Date()){return originalV4Verification.verifyProductSessionDeviceChallengeV4Data(challenge,registrationOriginal,member,at);}
export function verifyProductSessionV4CompletionData(registry,request,approval,completion,policyRef,registrationOriginal,at=new Date()){return originalV4Verification.verifyProductSessionV4CompletionData(registry,request,approval,completion,policyRef,registrationOriginal,at);}

export function encodeProductSessionDeviceRegistrationV4Message(registrationOriginal){return Buffer.from(originalRegistrationMessageDATA(registrationOriginal));}
export function verifyProductSessionDeviceRegistrationProofV4Data(registrationOriginal,member,at=new Date()){return originalV4Verification.verifyProductSessionDeviceRegistrationProofV4Data(registrationOriginal,member,at);}

// Historical stored-issuance DATA only. No policy observation/callback/current
// acquisition, capability registration, clock sampling, store or Source access.
function storedIssueRecord(v,keys){
 if(!v||typeof v!=='object'||storedIssueTypes.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail('PQ_STORED_V4_ISSUE_DATA_INVALID');
 const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!ds[k]||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))fail('PQ_STORED_V4_ISSUE_DATA_INVALID');return Object.fromEntries(keys.map(k=>[k,ds[k].value]));
}
/** Original signed approval DATA at an explicit time. Current policy is separate. */
export function inspectOriginalProductSessionV4ApprovalDATA(registry, input) {
 if (arguments.length !== 2) fail('PQ_STORED_V4_ISSUE_DATA_INVALID');
 const originals = Object.freeze(storedIssueRecord(input, HISTORICAL_APPROVAL_FIELDS));
 return inspectHistoricalApprovalDATA(verifyHistoricalMember, registry, originals);
}
/** Verify preserved original PAIR+COMPLETE mathematics against their original
 * signed times and actual store commit timestamps. Supplied PK/JSON/store times
 * do not establish Root/checkpoint/account/current/revoke or store provenance. */
export function inspectStoredProductSessionV4IssueOriginalDATA(registry,input){
 if(arguments.length!==2)fail('PQ_STORED_V4_ISSUE_DATA_INVALID');
 const i=storedIssueRecord(input,['pairInputOriginal','completeInputOriginal','sessionOriginal','challengeOriginal','pairCommittedAtMs','completeCommittedAtMs']),pairAt=storedIssueTime(i.pairCommittedAtMs),completeAt=storedIssueTime(i.completeCommittedAtMs);
 if(+completeAt<+pairAt)fail('PQ_STORED_V4_ISSUE_COMMIT_TIME_INVALID');
 const pair=storedIssueRecord(storedIssueRaw(i.pairInputOriginal,393216),['operationId','request','registrationOriginal','registrationMember','approval']),complete=storedIssueRecord(storedIssueRaw(i.completeInputOriginal,393216),['operationId','request','registrationOriginal','approval','completion']);
 for(const operation of[pair.operationId,complete.operationId])if(typeof operation!=='string'||!/^[a-f0-9]{64}$/.test(operation))fail('PQ_STORED_V4_ISSUE_OPERATION_INVALID');if(pair.operationId===complete.operationId)fail('PQ_STORED_V4_ISSUE_OPERATION_INVALID');
 if(pair.registrationOriginal!==complete.registrationOriginal)fail('PQ_PAIRING_ORIGINAL_MISMATCH');storedIssueRaw(pair.registrationOriginal,16384);
 const original=Buffer.from(pair.registrationOriginal,'utf8'),registration=inspectProductSessionDeviceRegistrationOriginalV4Data(original),pairApproval=storedIssueApproval(verifyHistoricalMember,registry,pair.request,pair.approval,original,pairAt),completionApproval=storedIssueApproval(verifyHistoricalMember,registry,complete.request,complete.approval,original,completeAt);
 if(pairApproval.approval.account!==completionApproval.approval.account)fail('PQ_PAIRING_ORIGINAL_MISMATCH');
 verifyProductSessionDeviceRegistrationProofV4Data(original,pqDecodeBase64url(pair.registrationMember,{max:98304}),pairAt);
 storedIssueRecord(complete.completion,['challenge','deviceMember']);const challenge=parseProductSessionChallenge(storedIssueRaw(i.challengeOriginal,16384));
 if(canonicalJSON(challenge)!==i.challengeOriginal||canonicalJSON(complete.completion.challenge)!==i.challengeOriginal)fail('SESSION_BINDING_MISMATCH');
 const request=completionApproval.request,approval=completionApproval.approval,challengeAt=new Date(challenge.issuedAt),binding=storedIssueProductBinding(registry,request.productId,request.platform);
 if(+challengeAt<Date.parse(approval.issuedAt)||+challengeAt>+completeAt||challenge.expiresAt!==new Date(Math.min(+challengeAt+60000,Date.parse(approval.expiresAt))).toISOString()||challenge.sessionExpiresAt!==new Date(Math.min(Date.parse(approval.expiresAt),+challengeAt+binding.sessionDurationSeconds*1000)).toISOString())fail('SESSION_BINDING_MISMATCH');
 verifyProductSessionDeviceChallengeV4Data(challenge,original,pqDecodeBase64url(complete.completion.deviceMember,{max:98304}),completeAt);
 const target=deriveProductSessionV4TargetData(registry,request,approval,challenge),session=storedIssueParseSession(storedIssueRaw(i.sessionOriginal,16384));
 if(canonicalJSON(target.session)!==i.sessionOriginal||canonicalJSON(session)!==i.sessionOriginal||session.expiresAt<=completeAt.toISOString())fail('SESSION_BINDING_MISMATCH');
 return Object.freeze({version:'4',originals:Object.freeze({...i}),pairOperationId:pair.operationId,completeOperationId:complete.operationId,pairRequest:pairApproval.request,request,pairApproval:pairApproval.approval,completionApproval:approval,registration:registration.record,registrationDigest:registration.registrationDigest,registrationOriginal:pair.registrationOriginal,challenge,session,pairAccountAuthorization:pairApproval.authorization,completionAccountAuthorization:completionApproval.authorization,signatureVerified:true,accountApprovalsVerified:2,registrationPoPVerified:true,deviceCompletionVerified:true,timeBasis:'original-signatures-and-store-commits-only',historical:true,dataOnly:true,SourceAdmission:false,RootAdmission:false,NativeAdmission:false,nativeAdmission:false,authorized:false,registered:false,current:false,newSession:false,connected:false});
}
