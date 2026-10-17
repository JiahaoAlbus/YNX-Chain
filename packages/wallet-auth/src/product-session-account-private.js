// Package-private bridge. No public package export or source/grant setter.
// The Node-only V3 verifier registers successful verification here, allowing the
// existing browser-safe session state machine to consume the same opaque result
// without importing a Node crypto provider into every legacy SDK entry point.
import {canonicalJSON, exactFields, WalletAuthError} from './canonical.js';
import {evmAddressFromYNX} from './crypto.js';
const policies=new WeakMap(),approvals=new WeakMap(),plans=new WeakMap();
const fail=code=>{throw new WalletAuthError(code,code)};
export function registerAccountPolicyObservation(view,assertCurrent){const ref=Object.freeze({});policies.set(ref,{view,assertCurrent});return ref;}
export function readAccountPolicyObservation(ref,account,at){
  const s=policies.get(ref);if(!s)fail('ACCOUNT_POLICY_SOURCE_NOT_SUPPLIED');
  s.assertCurrent(at);
  if(evmAddressFromYNX(account)!==s.view.canonicalOwner)fail('ACCOUNT_POLICY_OWNER_MISMATCH');
  return s.view;
}
export function registerVerifiedPQSessionApproval(approval,requestDigest,policyRef){
  const ref=Object.freeze({});approvals.set(ref,{approval,requestDigest,policyRef,bytes:canonicalJSON(approval)});return ref;
}
export function captureVerifiedPQSessionApproval(ref,input,requestDigest,at){
  const s=approvals.get(ref);if(!s||s.requestDigest!==requestDigest||s.bytes!==canonicalJSON(input))fail('PQ_SESSION_VERIFICATION_REQUIRED');
  if(s.approval.issuedAt>at.toISOString()||s.approval.expiresAt<=at.toISOString())fail('SESSION_EXPIRED');
  const view=readAccountPolicyObservation(s.policyRef,s.approval.account,at);
  assertSessionAccountPolicy(s.approval,view);return s.approval;
}
export function assertSessionAccountPolicy(subject,view){
  if(view.algorithmVersion==='legacy'){
    if(subject.version!=='2')fail('ACCOUNT_POLICY_CHANGED');
    return undefined;
  }
  if(subject.version!=='3')fail('ACTIVE_PQ_CLASSIC_SESSION_REFUSED');
  const expected=accountAuthorizationFromView(view);
  if(canonicalJSON(subject.accountAuthorization)!==canonicalJSON(expected))fail('ACCOUNT_POLICY_CHANGED');
  return undefined;
}
export function accountAuthorizationFromView(view){
  if(view.algorithmVersion!=='YNX-BATCH/v0.1'||!view.activeRecord)fail('ACTIVE_PQ_ACCOUNT_REQUIRED');
  return Object.freeze({policyVersion:'YNX-ACCOUNT-POLICY/v1',algorithmVersion:'YNX-BATCH/v0.1',networkId:view.networkId,canonicalOwner:view.canonicalOwner,...view.activeRecord});
}
export function parseSessionAccountAuthorization(value,account){
  exactFields(value,['policyVersion','algorithmVersion','networkId','canonicalOwner','revision','registeredAt','activeFrom','pkA','pkB'],'PQ session account authorization');
  const hex=(text,n)=>typeof text==='string'&&new RegExp('^[a-f0-9]{'+n*2+'}$').test(text);
  const integer=text=>typeof text==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(text)&&BigInt(text)<(1n<<64n);
  if(value.policyVersion!=='YNX-ACCOUNT-POLICY/v1'||value.algorithmVersion!=='YNX-BATCH/v0.1'||!hex(value.networkId,32)||
    value.canonicalOwner!==evmAddressFromYNX(account)||!hex(value.pkA,2592)||!hex(value.pkB,64)||
    ![value.revision,value.registeredAt,value.activeFrom].every(integer)||BigInt(value.revision)===0n||BigInt(value.registeredAt)>=BigInt(value.activeFrom))fail('PQ_SESSION_ACCOUNT_BINDING_INVALID');
  return Object.freeze({...value});
}
export function registerPQSessionSigningPlan(data){const ref=Object.freeze({});plans.set(ref,data);return ref;}
export function capturePQSessionSigningPlan(ref,at){
  const s=plans.get(ref);if(!s)fail('PQ_SESSION_REVIEW_PLAN_REQUIRED');
  readAccountPolicyObservation(s.policyRef,s.unsigned.account,at);
  if(s.unsigned.issuedAt>at.toISOString()||s.unsigned.expiresAt<=at.toISOString())fail('SESSION_EXPIRED');
  assertSessionAccountPolicy(s.unsigned,readAccountPolicyObservation(s.policyRef,s.unsigned.account,at));return s;
}
