import {recheckPQTypedActionReview} from './features/pq-transaction/typed-action-caller.mjs';
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value)}return value};
/** Main builds DATA only from its original live typed review and the current
 * original policy snapshot. Auth must still recognize the actual IPC capsule
 * and Main private borrow; this object alone grants nothing. */
export function pqTypedSignPermissionRequest(review,refreshed,at=Date.now()){
 const plan=recheckPQTypedActionReview(review,refreshed,{account:review.account,networkId:review.networkId},at);
 return freeze({action:'sign',purpose:'TX-BATCH',memberCount:1,memberIndex:0,networkId:review.networkId,nativeChainId:'6423',account:review.account,
  operationId:review.operationId,origin:'ynx-wallet:local-pq',typedAction:plan.action,requestDigest:review.requestDigest,
  policyRevision:review.policyRevision,pair:review.pair,reviewExecutionHeight:review.executionHeight,
  executionHeight:plan.policy.executionHeight,expiresAt:review.expiresAt});
}
