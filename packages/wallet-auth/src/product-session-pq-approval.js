// Protected Node main only. Uses the unique PQ provider; never a new login engine.
import {Buffer} from 'node:buffer';
import {encodeFields,u32,decodeMember,createVerifier} from '@ynx/batch-v01-candidate';
import {canonicalJSON,WalletAuthError} from './canonical.js';
import {exactPQRecord,pqDecodeBase64url} from './pq-wallet-contract.js';
import {parseProductSessionRequest,productSessionRequestDigest} from './product-session-v2.js';
import {readAccountPolicyObservation,accountAuthorizationFromView,registerPQSessionSigningPlan,registerVerifiedPQSessionApproval} from './product-session-account-private.js';
export const PQ_PRODUCT_SESSION_PURPOSE='PRODUCT-SESSION-APPROVAL';
const fail=code=>{throw new WalletAuthError(code,code)};
function unsigned(registry,request,input,policyRef,at){
  const r=parseProductSessionRequest(registry,request,at);
  const view=readAccountPolicyObservation(policyRef,input.account,at);
  const authorization=accountAuthorizationFromView(view);
  const issuedAt=input.issuedAt,expiresAt=input.expiresAt;
  if(typeof issuedAt!=='string'||typeof expiresAt!=='string'||!Number.isFinite(Date.parse(issuedAt))||!Number.isFinite(Date.parse(expiresAt))||
    new Date(issuedAt).toISOString()!==issuedAt||new Date(expiresAt).toISOString()!==expiresAt||
    issuedAt<r.issuedAt||issuedAt>at.toISOString()||expiresAt>r.expiresAt||expiresAt<=at.toISOString())fail('INVALID_APPROVAL_TIME');
  const {purpose,issuedAt:requestIssuedAt,expiresAt:requestExpiresAt,...bound}=r;
  return Object.freeze({...bound,version:'3',result:'approved',requestDigest:productSessionRequestDigest(registry,r,at),account:input.account,
    accountAuthorization:authorization,issuedAt,expiresAt});
}
function signingBytes(request,value){
  return encodeFields([Buffer.from('YNX-PRODUCT-SESSION-APPROVAL/v3'),u32(3),Buffer.from(canonicalJSON(request)),Buffer.from(canonicalJSON(value))]);
}
export function preparePQProductSessionApproval(registry,request,input,policyRef,at=new Date()){
  const r=parseProductSessionRequest(registry,request,at);
  exactPQRecord(input,['account','expiresAt',...(r.serviceConsent?['approvedServiceConsent']:[])]);
  if(r.serviceConsent&&canonicalJSON(input.approvedServiceConsent)!==canonicalJSON(r.serviceConsent))fail('SERVICE_CONSENT_BINDING_MISMATCH');
  const value=unsigned(registry,r,{...input,issuedAt:at.toISOString()},policyRef,at);
  return registerPQSessionSigningPlan({policyRef,unsigned:value,message:signingBytes(r,value),purpose:PQ_PRODUCT_SESSION_PURPOSE});
}
export function verifyPQProductSessionApproval(registry,request,input,policyRef,at=new Date()){
  // Derive every approved field from the original request and current source.
  // Compare the complete object, rejecting extras and classic signature fields.
  const r=parseProductSessionRequest(registry,request,at);
  const value=unsigned(registry,r,input,policyRef,at);
  const {walletProof,...provided}=input;
  if(canonicalJSON(value)!==canonicalJSON(provided))fail('SESSION_BINDING_MISMATCH');
  const wire=Buffer.from(pqDecodeBase64url(walletProof,{max:262144})),member=decodeMember(wire),a=value.accountAuthorization,c=member.certificate;
  if(c.N!==1||member.index!==0||member.pathA.length||member.pathB.length||c.purpose!==PQ_PRODUCT_SESSION_PURPOSE||
    !c.chainId.equals(Buffer.from(a.networkId,'hex'))||c.owner!==a.canonicalOwner||
    !c.pkA.equals(Buffer.from(a.pkA,'hex'))||!c.pkB.equals(Buffer.from(a.pkB,'hex'))||
    !member.message.equals(signingBytes(r,value)))fail('PQ_SESSION_PROOF_BINDING_INVALID');
  const current=()=>{
    const view=readAccountPolicyObservation(policyRef,value.account,at);
    if(canonicalJSON(accountAuthorizationFromView(view))!==canonicalJSON(a))fail('ACCOUNT_POLICY_CHANGED');
    return {algorithmVersion:a.algorithmVersion,enabled:true,owner:a.canonicalOwner,chainId:Buffer.from(a.networkId,'hex'),
      pkA:Buffer.from(a.pkA,'hex'),pkB:Buffer.from(a.pkB,'hex'),purpose:PQ_PRODUCT_SESSION_PURPOSE,
      policyRevision:a.revision,activeFrom:0,revokedAt:null};
  };
  // Numeric height 0 is only the provider's local proof check coordinate.
  // Full U64 committed height/activation/current authority is enforced above;
  // it is never rounded into the provider's Number API or claimed as finality.
  const verifier=createVerifier({provider:'portable',chainId:Buffer.from(a.networkId,'hex'),purpose:PQ_PRODUCT_SESSION_PURPOSE,resolveTrustedOwner:current,cacheEntries:0});
  current();if(!verifier.verifyOne(wire,{height:0}))fail('INVALID_SIGNATURE');current();
  const approval=Object.freeze({...value,walletProof});
  return Object.freeze({approval,verifiedApproval:registerVerifiedPQSessionApproval(approval,value.requestDigest,policyRef)});
}
