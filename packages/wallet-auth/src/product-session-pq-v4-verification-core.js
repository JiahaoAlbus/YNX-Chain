// Sole existing V4 approval/member/completion DATA orchestration. No Source,
// new math, signature domain, key, signer or current/permission provider API.
// Internal fixed compile wrappers choose existing Node or verification-only ESM.
import{canonicalJSON,WalletAuthError}from'./canonical.js';
import{exactPQRecord,pqDecodeBase64url}from'./pq-wallet-contract.js';
import{parseProductSessionRequest,parseProductSessionChallenge,productSessionRequestDigest,createProductSessionChallenge,deriveProductSessionV4TargetData}from'./product-session-v2.js';
import{readAccountPolicyObservation,accountAuthorizationFromView,registerVerifiedPQSessionApproval}from'./product-session-account-private.js';
import{inspectProductSessionDeviceRegistrationOriginalV4Data}from'./product-session-device-registration-v4.js';
import{originalV4RegistrationForRequestDATA as recordFor,encodeOriginalProductSessionV4E5DATA as E5,encodeProductSessionDeviceChallengeV4Message,encodeProductSessionDeviceRegistrationV4Message,PRODUCT_SESSION_APPROVAL_DOMAIN_V4}from'./product-session-pq-v4-message-data.js';
const fail=code=>{throw new WalletAuthError(code,code);};
export function createOriginalV4VerificationDATAFromFixedMath({verifyMember,copyMessage}){
function prepareProductSessionApprovalV4Data(registry,request,input,policyRef,registrationOriginal,at=new Date()){
 const r=parseProductSessionRequest(registry,request,at);exactPQRecord(input,['account','expiresAt']);if(r.version!=='4')fail('PQ_SESSION_V4_REQUIRED');const view=readAccountPolicyObservation(policyRef,input.account,at),authorization=accountAuthorizationFromView(view),registration=recordFor(r,registrationOriginal,input.account,at);
 if(authorization.networkId!==registration.networkId||authorization.canonicalOwner!==registration.canonicalOwner||typeof input.expiresAt!=='string'||new Date(input.expiresAt).toISOString()!==input.expiresAt||input.expiresAt<=at.toISOString()||input.expiresAt>r.expiresAt||input.expiresAt>registration.expiresAt)fail('INVALID_APPROVAL_TIME');
 const {purpose,issuedAt,expiresAt,...bound}=r,unsigned=Object.freeze({...bound,version:'4',result:'approved',requestDigest:productSessionRequestDigest(registry,r,at),account:input.account,accountAuthorization:authorization,issuedAt:at.toISOString(),expiresAt:input.expiresAt});
 const message=E5(PRODUCT_SESSION_APPROVAL_DOMAIN_V4,authorization.networkId,authorization.canonicalOwner,{request:r,approval:unsigned});
 return Object.freeze({unsigned,get message(){return copyMessage(message);},purpose:'PRODUCT-SESSION-APPROVAL',dataOnly:true,SourceAdmission:false,NativeAdmission:false,approval:false});
}
function verifyProductSessionApprovalV4Data(registry,request,approval,policyRef,registrationOriginal,at=new Date()){
 const proofAt=new Date(approval?.issuedAt);if(!Number.isFinite(+proofAt)||+proofAt>+at)fail('INVALID_APPROVAL_TIME');
 const prepared=prepareProductSessionApprovalV4Data(registry,request,{account:approval.account,expiresAt:approval.expiresAt},policyRef,registrationOriginal,proofAt),{walletProof,...unsigned}=approval;
 if(canonicalJSON(unsigned)!==canonicalJSON(prepared.unsigned)||approval.expiresAt<=at.toISOString())fail('SESSION_BINDING_MISMATCH');const a=prepared.unsigned.accountAuthorization;
 // Fresh original account policy is independent of the separate device pair.
 const fresh=accountAuthorizationFromView(readAccountPolicyObservation(policyRef,approval.account,at));if(canonicalJSON(fresh)!==canonicalJSON(a))fail('ACCOUNT_POLICY_CHANGED');
 verifyMember(pqDecodeBase64url(walletProof,{max:98304}),a.networkId,a.canonicalOwner,'PRODUCT-SESSION-APPROVAL',prepared.message,a.pkA,a.pkB);
 const value=Object.freeze({...prepared.unsigned,walletProof});return Object.freeze({approval:value,verifiedApproval:registerVerifiedPQSessionApproval(value,value.requestDigest,policyRef),signatureVerified:true,dataOnly:true,NativeAdmission:false,SourceAdmission:false});
}
function verifyProductSessionDeviceChallengeV4Data(challenge,registrationOriginal,member,at=new Date()){
 const c=parseProductSessionChallenge(challenge),r=recordFor(c,registrationOriginal,c.account,at);if(c.version!=='4'||c.issuedAt>at.toISOString()||c.expiresAt<=at.toISOString())fail('SESSION_EXPIRED');
 verifyMember(member,r.networkId,r.canonicalOwner,'PRODUCT-SESSION-DEVICE-CHALLENGE',encodeProductSessionDeviceChallengeV4Message(c,registrationOriginal),r.pkA,r.pkB);
 return Object.freeze({signatureVerified:true,dataOnly:true,registered:false,current:false,NativeAdmission:false,SourceAdmission:false});
}
function verifyProductSessionV4CompletionData(registry,request,approval,completion,policyRef,registrationOriginal,at=new Date()){
 exactPQRecord(completion,['challenge','deviceMember']);const verified=verifyProductSessionApprovalV4Data(registry,request,approval,policyRef,registrationOriginal,at),c=parseProductSessionChallenge(completion.challenge),expected=createProductSessionChallenge(registry,request,approval,{challenge:c.challenge},new Date(c.issuedAt),verified.verifiedApproval,at);
 if(canonicalJSON(expected)!==canonicalJSON(c))fail('SESSION_BINDING_MISMATCH');verifyProductSessionDeviceChallengeV4Data(c,registrationOriginal,pqDecodeBase64url(completion.deviceMember,{max:98304}),at);
 return deriveProductSessionV4TargetData(registry,request,verified.approval,c);
}
function verifyProductSessionDeviceRegistrationProofV4Data(registrationOriginal,member,at=new Date()){const r=inspectProductSessionDeviceRegistrationOriginalV4Data(registrationOriginal).record;if(r.revokedAt!==null||r.registeredAt>at.toISOString()||r.expiresAt<=at.toISOString())fail('PQ_DEVICE_REGISTRATION_INACTIVE');verifyMember(member,r.networkId,r.canonicalOwner,'PRODUCT-SESSION-DEVICE-REGISTRATION',encodeProductSessionDeviceRegistrationV4Message(registrationOriginal),r.pkA,r.pkB);return Object.freeze({signatureVerified:true,dataOnly:true,registered:false,current:false,NativeAdmission:false,SourceAdmission:false});}
return Object.freeze({prepareProductSessionApprovalV4Data,verifyProductSessionApprovalV4Data,verifyProductSessionDeviceChallengeV4Data,verifyProductSessionV4CompletionData,verifyProductSessionDeviceRegistrationProofV4Data});
}
