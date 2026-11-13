import{createOriginalV4VerificationDATAFromFixedMath}from'./product-session-pq-v4-verification-core.js';
import{originalV4RegistrationForRequestDATA as recordFor,encodeOriginalProductSessionV4E5DATA,encodeProductSessionDeviceChallengeV4Message as originalChallengeMessageDATA,encodeProductSessionDeviceRegistrationV4Message as originalRegistrationMessageDATA,PRODUCT_SESSION_APPROVAL_DOMAIN_V4,PRODUCT_SESSION_DEVICE_CHALLENGE_DOMAIN_V4,PRODUCT_SESSION_DEVICE_REGISTRATION_DOMAIN_V4}from'./product-session-pq-v4-message-data.js';
export{PRODUCT_SESSION_APPROVAL_DOMAIN_V4,PRODUCT_SESSION_DEVICE_CHALLENGE_DOMAIN_V4,PRODUCT_SESSION_DEVICE_REGISTRATION_DOMAIN_V4};
import{types as storedIssueTypes}from'node:util';
import{productPlatformBinding as storedIssueProductBinding}from'./product-session-registry.js';
import{parseSessionAccountAuthorization as storedIssueAccountAuthorization}from'./product-session-account-private.js';
import{parseProductSession as storedIssueParseSession}from'./product-session-v2.js';
// Original fixed domains and sole protocol codec. These functions are DATA
// verification/preparation; actual pairing/issuer/current approval is Auth-owned.
import {Buffer} from 'node:buffer';import {encodeFields,u32,decodeMember,createVerifier,VERSION} from '@ynx/batch-v01-candidate';
import {canonicalJSON,WalletAuthError} from './canonical.js';import {exactPQRecord,pqDecodeBase64url} from './pq-wallet-contract.js';
import {parseProductSessionRequest,parseProductSessionChallenge,productSessionRequestDigest,productSessionApprovalDigest,createProductSessionChallenge,deriveProductSessionV4TargetData} from './product-session-v2.js';
import {readAccountPolicyObservation,accountAuthorizationFromView,registerVerifiedPQSessionApproval} from './product-session-account-private.js';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from './product-session-device-registration-v4.js';import {evmAddressFromYNX} from './crypto.js';
import{registerPQProductSessionV4SigningPlan}from'./product-session-pq-v4-signing-private.js';


const fail=code=>{throw new WalletAuthError(code,code);};
function E5(domain,networkId,owner,body){return Buffer.from(encodeOriginalProductSessionV4E5DATA(domain,networkId,owner,body));}
function verifyMember(wire,networkId,owner,purpose,message,pkA,pkB){
 if(!(wire instanceof Uint8Array)||wire.buffer instanceof SharedArrayBuffer||!wire.length||wire.length>98304)fail('PQ_SESSION_MEMBER_INVALID');const b=Buffer.from(wire),m=decodeMember(b),c=m.certificate;
 if(c.N!==1||m.index!==0||m.pathA.length||m.pathB.length||c.owner!==owner||c.purpose!==purpose||!c.chainId.equals(Buffer.from(networkId,'hex'))||!c.pkA.equals(Buffer.from(pkA,'hex'))||!c.pkB.equals(Buffer.from(pkB,'hex'))||!m.message.equals(message))fail('PQ_SESSION_MEMBER_BINDING_MISMATCH');
 const verifier=createVerifier({provider:'portable',chainId:Buffer.from(networkId,'hex'),purpose,cacheEntries:0,resolveTrustedOwner:()=>({algorithmVersion:VERSION,enabled:true,chainId:Buffer.from(networkId,'hex'),owner,pkA:Buffer.from(pkA,'hex'),pkB:Buffer.from(pkB,'hex'),purpose,policyRevision:'v4-math-only',activeFrom:0,revokedAt:null})});try{if(!verifier.verifyOne(b,{height:0}))fail('PQ_SESSION_MEMBER_SIGNATURE_INVALID');}finally{verifier.clear();}
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
function storedIssueRaw(raw,max){
 if(typeof raw!=='string'||!raw.length||!raw.isWellFormed()||Buffer.byteLength(raw)>max)fail('PQ_STORED_V4_ISSUE_ORIGINAL_INVALID');
 let v;try{v=JSON.parse(raw);const bounded=(x,depth=0)=>{if(depth>16)fail('PQ_STORED_V4_ISSUE_ORIGINAL_INVALID');if(typeof x==='string'){if(!x.isWellFormed())fail('PQ_STORED_V4_ISSUE_ORIGINAL_INVALID');return}if(x&&typeof x==='object'){if(Array.isArray(x)&&x.length>1024||!Array.isArray(x)&&Object.keys(x).length>128)fail('PQ_STORED_V4_ISSUE_ORIGINAL_INVALID');for(const value of Object.values(x))bounded(value,depth+1)}};bounded(v);if(canonicalJSON(v)!==raw)fail('PQ_STORED_V4_ISSUE_ORIGINAL_INVALID');}catch{fail('PQ_STORED_V4_ISSUE_ORIGINAL_INVALID')}return v;
}
function storedIssueTime(ms){if(!Number.isSafeInteger(ms)||ms<0||!Number.isFinite(+new Date(ms)))fail('PQ_STORED_V4_ISSUE_COMMIT_TIME_INVALID');return new Date(ms)}
function storedIssueApproval(registry,requestInput,approval,registrationOriginal,committedAt){
 const proofAt=new Date(approval?.issuedAt);if(!Number.isFinite(+proofAt)||+proofAt>+committedAt)fail('INVALID_APPROVAL_TIME');
 const r=parseProductSessionRequest(registry,requestInput,proofAt);if(r.version!=='4')fail('PQ_SESSION_V4_REQUIRED');
 const authorization=storedIssueAccountAuthorization(approval.accountAuthorization,approval.account),registration=recordFor(r,registrationOriginal,approval.account,proofAt);
 // Reconstruct the SAME original unsigned approval and E5. Authorization is
 // the signed original DATA, never a manufactured historical policyRef/view.
 if(authorization.networkId!==registration.networkId||authorization.canonicalOwner!==registration.canonicalOwner||typeof approval.expiresAt!=='string'||new Date(approval.expiresAt).toISOString()!==approval.expiresAt||approval.expiresAt<=proofAt.toISOString()||approval.expiresAt>r.expiresAt||approval.expiresAt>registration.expiresAt)fail('INVALID_APPROVAL_TIME');
 const {purpose,issuedAt,expiresAt,...bound}=r,unsigned=Object.freeze({...bound,version:'4',result:'approved',requestDigest:productSessionRequestDigest(registry,r,proofAt),account:approval.account,accountAuthorization:authorization,issuedAt:proofAt.toISOString(),expiresAt:approval.expiresAt});
 const value=Object.freeze({...unsigned,walletProof:approval.walletProof});if(canonicalJSON(value)!==canonicalJSON(approval)||approval.expiresAt<=committedAt.toISOString())fail('SESSION_BINDING_MISMATCH');
 // The original issuer also required the request/record to be alive at its
 // actual commit fence. This is not a fresh observation at today's clock.
 parseProductSessionRequest(registry,r,committedAt);recordFor(r,registrationOriginal,approval.account,committedAt);
 verifyMember(pqDecodeBase64url(approval.walletProof,{max:98304}),authorization.networkId,authorization.canonicalOwner,'PRODUCT-SESSION-APPROVAL',E5(PRODUCT_SESSION_APPROVAL_DOMAIN_V4,authorization.networkId,authorization.canonicalOwner,{request:r,approval:unsigned}),authorization.pkA,authorization.pkB);
 return Object.freeze({request:r,approval:value,authorization});
}
/**
 * Verify the original signed approval and its request and device record at
 * the supplied check time. The issuer still owns the current policy check.
 */
export function inspectOriginalProductSessionV4ApprovalDATA(registry, input) {
 const invalid = 'PQ_STORED_V4_ISSUE_DATA_INVALID';
 if (arguments.length !== 2) fail(invalid);
 const originals = Object.freeze(storedIssueRecord(input, [
  'requestOriginal', 'approvalOriginal', 'registrationOriginal', 'checkedAtMs',
 ]));
 const checkedAt = storedIssueTime(originals.checkedAtMs);
 const request = storedIssueRaw(originals.requestOriginal, 16384);
 const approval = storedIssueRaw(originals.approvalOriginal, 196608);
 storedIssueRaw(originals.registrationOriginal, 16384);
 const verified = storedIssueApproval(
  registry, request, approval, Buffer.from(originals.registrationOriginal, 'utf8'), checkedAt,
 );
 return Object.freeze({
  originals,
  request: verified.request,
  approval: verified.approval,
  accountAuthorization: verified.authorization,
  signatureVerified: true,
  dataOnly: true,
  authorized: false,
  registered: false,
  current: false,
  SourceAdmission: false,
  RootAdmission: false,
  NativeAdmission: false,
 });
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
 const original=Buffer.from(pair.registrationOriginal,'utf8'),registration=inspectProductSessionDeviceRegistrationOriginalV4Data(original),pairApproval=storedIssueApproval(registry,pair.request,pair.approval,original,pairAt),completionApproval=storedIssueApproval(registry,complete.request,complete.approval,original,completeAt);
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
