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
/** Main-only typed plan after its independent account review. Existing Vault
 * permission/current/journal fences remain required; creation consent cannot
 * supply them. No caller message, key, signer or approved flag is accepted. */
export function preparePQProductSessionApprovalV4(registry,request,input,policyRef,registrationOriginal,at=new Date()){
 const data=prepareProductSessionApprovalV4Data(registry,request,input,policyRef,registrationOriginal,at);
 return registerPQProductSessionV4SigningPlan(Object.freeze({policyRef,unsigned:data.unsigned,message:Buffer.from(data.message),purpose:data.purpose}));
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
