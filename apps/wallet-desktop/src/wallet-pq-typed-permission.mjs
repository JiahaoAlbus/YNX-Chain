import {recheckPQTypedActionReview} from './features/pq-transaction/typed-action-caller.mjs';
import {planPQNativeAction} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {exactPQRecord} from '@ynx-chain/wallet-auth/pq-wallet-contract';
import {parsePQTypedOriginalRecord} from './wallet-pq-typed-original.mjs';
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
/** New broadcast review DATA for the already retained original. This is not
 * consent, a capability or an instruction to sign/send. Main must bind its
 * distinct live pending review and Auth's original broadcast capsule. */
export function pqTypedBroadcastPermissionRequest(value,snapshot,options){
 exactPQRecord(options,['at','expiresAt']);const {at,expiresAt}=options;
 const invalid=()=>{throw Object.assign(Error('Review the same original before broadcast.'),{code:'PQ_TYPED_BROADCAST_BINDING_INVALID'})};
 if(!Number.isSafeInteger(at)||typeof expiresAt!=='string'||!Number.isFinite(Date.parse(expiresAt))||new Date(expiresAt).toISOString()!==expiresAt||Date.parse(expiresAt)<=at||Date.parse(expiresAt)>at+30000)invalid();
 const saved=parsePQTypedOriginalRecord(value),review=saved.typed.review;
 if(['contract_deploy','stake_delegate','stake_unbond','stake_withdraw'].includes(review.action.kind))invalid();
 const plan=planPQNativeAction(snapshot,review.action),active=plan.policy.activeRecord;
 if(plan.policy.policyRevision!==review.policyRevision||active.pkA!==review.pair.pkA||active.pkB!==review.pair.pkB||BigInt(plan.policy.executionHeight)<BigInt(saved.typed.signingSnapshot.executionHeight))invalid();
 return freeze({action:'broadcast',purpose:'TX-BATCH',memberCount:1,memberIndex:0,networkId:review.networkId,nativeChainId:'6423',account:review.account,operationId:review.operationId,origin:'ynx-wallet:local-pq',typedAction:plan.action,requestDigest:review.requestDigest,policyRevision:review.policyRevision,pair:review.pair,reviewExecutionHeight:review.executionHeight,executionHeight:plan.policy.executionHeight,expiresAt,transportHash:saved.hash,memberHash:saved.typed.memberHash});
}
