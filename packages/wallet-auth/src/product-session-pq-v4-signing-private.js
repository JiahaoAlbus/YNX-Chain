// Package-private brand for the fixed v4 account plan. This is never a user
// approval, Source admission, private-key provider or generic signing port.
import{registerPQSessionSigningPlan,capturePQSessionSigningPlan}from'./product-session-account-private.js';
import{WalletAuthError}from'./canonical.js';
const originals=new WeakMap();
const entered=new WeakSet();
export function registerPQProductSessionV4SigningPlan(data){const ref=Object.freeze({});originals.set(ref,registerPQSessionSigningPlan(data));return ref;}
export function capturePQProductSessionV4SigningPlan(ref,at){
 if(!originals.has(ref))throw new WalletAuthError('PQ_SESSION_V4_REVIEW_PLAN_REQUIRED','Original v4 account review plan required');
 const plan=capturePQSessionSigningPlan(originals.get(ref),at);
 if(plan.unsigned.version!=='4'||plan.purpose!=='PRODUCT-SESSION-APPROVAL')throw new WalletAuthError('PQ_SESSION_V4_REVIEW_PLAN_REQUIRED','Original v4 account review plan required');
 return plan;
}
export function beginPQProductSessionV4SigningPlan(ref,at){
 const plan=capturePQProductSessionV4SigningPlan(ref,at);
 if(entered.has(ref))throw new WalletAuthError('PQ_SESSION_V4_APPROVAL_ALREADY_ENTERED','Preserve the original v4 account approval; never sign it again');
 entered.add(ref);return plan;
}
