// Original fixed domains and sole protocol codec. These functions are DATA
// verification/preparation; actual pairing/issuer/current approval is Auth-owned.
import {Buffer} from 'node:buffer';import {encodeFields,u32,decodeMember,createVerifier,VERSION} from '@ynx/batch-v01-candidate';
import {canonicalJSON,WalletAuthError} from './canonical.js';import {exactPQRecord,pqDecodeBase64url} from './pq-wallet-contract.js';
import {parseProductSessionRequest,parseProductSessionChallenge,productSessionRequestDigest,productSessionApprovalDigest,createProductSessionChallenge,deriveProductSessionV4TargetData} from './product-session-v2.js';
import {readAccountPolicyObservation,accountAuthorizationFromView,registerVerifiedPQSessionApproval} from './product-session-account-private.js';
import {inspectProductSessionDeviceRegistrationOriginalV4Data} from './product-session-device-registration-v4.js';import {evmAddressFromYNX} from './crypto.js';
export const PRODUCT_SESSION_APPROVAL_DOMAIN_V4='YNX-PRODUCT-SESSION-APPROVAL/v4';
export const PRODUCT_SESSION_DEVICE_CHALLENGE_DOMAIN_V4='YNX-PRODUCT-SESSION-DEVICE-CHALLENGE/v4';
const fail=code=>{throw new WalletAuthError(code,code);};
function recordFor(request,original,account,at){
 const view=inspectProductSessionDeviceRegistrationOriginalV4Data(original),r=view.record;
 if(request.version!=='4'||r.canonicalOwner!==evmAddressFromYNX(account)||r.registrationId!==request.deviceRegistrationId||r.revision!==request.deviceRegistrationRevision||view.registrationDigest!==request.deviceRegistrationDigest||r.revokedAt!==null||r.registeredAt>at.toISOString()||r.expiresAt<=at.toISOString())fail('PQ_PAIRING_ORIGINAL_MISMATCH');
 for(const k of ['productId','clientId','platform','applicationId','bundleId','packageId','origin','callback','deviceId'])if(r[k]!==request[k])fail('PQ_PAIRING_ORIGINAL_MISMATCH');return r;
}
function E5(domain,networkId,owner,body){const raw=encodeFields([domain,u32(4),Buffer.from(networkId,'hex'),owner,canonicalJSON(body)]);if(raw.length>16384)fail('PQ_SESSION_MESSAGE_TOO_LARGE');return raw;}
function verifyMember(wire,networkId,owner,purpose,message,pkA,pkB){
 if(!(wire instanceof Uint8Array)||wire.buffer instanceof SharedArrayBuffer||!wire.length||wire.length>98304)fail('PQ_SESSION_MEMBER_INVALID');const b=Buffer.from(wire),m=decodeMember(b),c=m.certificate;
 if(c.N!==1||m.index!==0||m.pathA.length||m.pathB.length||c.owner!==owner||c.purpose!==purpose||!c.chainId.equals(Buffer.from(networkId,'hex'))||!c.pkA.equals(Buffer.from(pkA,'hex'))||!c.pkB.equals(Buffer.from(pkB,'hex'))||!m.message.equals(message))fail('PQ_SESSION_MEMBER_BINDING_MISMATCH');
 const verifier=createVerifier({provider:'portable',chainId:Buffer.from(networkId,'hex'),purpose,cacheEntries:0,resolveTrustedOwner:()=>({algorithmVersion:VERSION,enabled:true,chainId:Buffer.from(networkId,'hex'),owner,pkA:Buffer.from(pkA,'hex'),pkB:Buffer.from(pkB,'hex'),purpose,policyRevision:'v4-math-only',activeFrom:0,revokedAt:null})});try{if(!verifier.verifyOne(b,{height:0}))fail('PQ_SESSION_MEMBER_SIGNATURE_INVALID');}finally{verifier.clear();}
}
export function prepareProductSessionApprovalV4Data(registry,request,input,policyRef,registrationOriginal,at=new Date()){
 const r=parseProductSessionRequest(registry,request,at);exactPQRecord(input,['account','expiresAt']);if(r.version!=='4')fail('PQ_SESSION_V4_REQUIRED');const view=readAccountPolicyObservation(policyRef,input.account,at),authorization=accountAuthorizationFromView(view),registration=recordFor(r,registrationOriginal,input.account,at);
 if(authorization.networkId!==registration.networkId||authorization.canonicalOwner!==registration.canonicalOwner||typeof input.expiresAt!=='string'||new Date(input.expiresAt).toISOString()!==input.expiresAt||input.expiresAt<=at.toISOString()||input.expiresAt>r.expiresAt||input.expiresAt>registration.expiresAt)fail('INVALID_APPROVAL_TIME');
 const {purpose,issuedAt,expiresAt,...bound}=r,unsigned=Object.freeze({...bound,version:'4',result:'approved',requestDigest:productSessionRequestDigest(registry,r,at),account:input.account,accountAuthorization:authorization,issuedAt:at.toISOString(),expiresAt:input.expiresAt});
 const message=E5(PRODUCT_SESSION_APPROVAL_DOMAIN_V4,authorization.networkId,authorization.canonicalOwner,{request:r,approval:unsigned});
 return Object.freeze({unsigned,get message(){return Buffer.from(message);},purpose:'PRODUCT-SESSION-APPROVAL',dataOnly:true,SourceAdmission:false,NativeAdmission:false,approval:false});
}
export function verifyProductSessionApprovalV4Data(registry,request,approval,policyRef,registrationOriginal,at=new Date()){
 const proofAt=new Date(approval?.issuedAt);if(!Number.isFinite(+proofAt)||+proofAt>+at)fail('INVALID_APPROVAL_TIME');
 const prepared=prepareProductSessionApprovalV4Data(registry,request,{account:approval.account,expiresAt:approval.expiresAt},policyRef,registrationOriginal,proofAt),{walletProof,...unsigned}=approval;
 if(canonicalJSON(unsigned)!==canonicalJSON(prepared.unsigned)||approval.expiresAt<=at.toISOString())fail('SESSION_BINDING_MISMATCH');const a=prepared.unsigned.accountAuthorization;
 // Fresh original account policy is independent of the separate device pair.
 const fresh=accountAuthorizationFromView(readAccountPolicyObservation(policyRef,approval.account,at));if(canonicalJSON(fresh)!==canonicalJSON(a))fail('ACCOUNT_POLICY_CHANGED');
 verifyMember(pqDecodeBase64url(walletProof,{max:98304}),a.networkId,a.canonicalOwner,'PRODUCT-SESSION-APPROVAL',prepared.message,a.pkA,a.pkB);
 const value=Object.freeze({...prepared.unsigned,walletProof});return Object.freeze({approval:value,verifiedApproval:registerVerifiedPQSessionApproval(value,value.requestDigest,policyRef),signatureVerified:true,dataOnly:true,NativeAdmission:false,SourceAdmission:false});
}
export function encodeProductSessionDeviceChallengeV4Message(challenge,registrationOriginal){
 const c=parseProductSessionChallenge(challenge),r=recordFor(c,registrationOriginal,c.account,new Date(c.issuedAt));if(c.version!=='4'||c.expiresAt>r.expiresAt||c.sessionExpiresAt>r.expiresAt||c.accountAuthorization.networkId!==r.networkId)fail('PQ_PAIRING_ORIGINAL_MISMATCH');
 return E5(PRODUCT_SESSION_DEVICE_CHALLENGE_DOMAIN_V4,r.networkId,r.canonicalOwner,{challenge:c,registration:r});
}
export function verifyProductSessionDeviceChallengeV4Data(challenge,registrationOriginal,member,at=new Date()){
 const c=parseProductSessionChallenge(challenge),r=recordFor(c,registrationOriginal,c.account,at);if(c.version!=='4'||c.issuedAt>at.toISOString()||c.expiresAt<=at.toISOString())fail('SESSION_EXPIRED');
 verifyMember(member,r.networkId,r.canonicalOwner,'PRODUCT-SESSION-DEVICE-CHALLENGE',encodeProductSessionDeviceChallengeV4Message(c,registrationOriginal),r.pkA,r.pkB);
 return Object.freeze({signatureVerified:true,dataOnly:true,registered:false,current:false,NativeAdmission:false,SourceAdmission:false});
}
export function verifyProductSessionV4CompletionData(registry,request,approval,completion,policyRef,registrationOriginal,at=new Date()){
 exactPQRecord(completion,['challenge','deviceMember']);const verified=verifyProductSessionApprovalV4Data(registry,request,approval,policyRef,registrationOriginal,at),c=parseProductSessionChallenge(completion.challenge),expected=createProductSessionChallenge(registry,request,approval,{challenge:c.challenge},new Date(c.issuedAt),verified.verifiedApproval,at);
 if(canonicalJSON(expected)!==canonicalJSON(c))fail('SESSION_BINDING_MISMATCH');verifyProductSessionDeviceChallengeV4Data(c,registrationOriginal,pqDecodeBase64url(completion.deviceMember,{max:98304}),at);
 return deriveProductSessionV4TargetData(registry,request,verified.approval,c);
}
export const PRODUCT_SESSION_DEVICE_REGISTRATION_DOMAIN_V4='YNX-PRODUCT-SESSION-DEVICE-REGISTRATION/v4';
export function encodeProductSessionDeviceRegistrationV4Message(registrationOriginal){const r=inspectProductSessionDeviceRegistrationOriginalV4Data(registrationOriginal).record;return E5(PRODUCT_SESSION_DEVICE_REGISTRATION_DOMAIN_V4,r.networkId,r.canonicalOwner,r);}
export function verifyProductSessionDeviceRegistrationProofV4Data(registrationOriginal,member,at=new Date()){const r=inspectProductSessionDeviceRegistrationOriginalV4Data(registrationOriginal).record;if(r.revokedAt!==null||r.registeredAt>at.toISOString()||r.expiresAt<=at.toISOString())fail('PQ_DEVICE_REGISTRATION_INACTIVE');verifyMember(member,r.networkId,r.canonicalOwner,'PRODUCT-SESSION-DEVICE-REGISTRATION',encodeProductSessionDeviceRegistrationV4Message(registrationOriginal),r.pkA,r.pkB);return Object.freeze({signatureVerified:true,dataOnly:true,registered:false,current:false,NativeAdmission:false,SourceAdmission:false});}
