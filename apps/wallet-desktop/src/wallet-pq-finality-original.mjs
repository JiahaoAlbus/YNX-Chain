import {types} from 'node:util';
import {exactData,preparePQTransferOriginal} from './features/pq-transaction/transfer-binding.mjs';
import {parsePQTypedOriginalRecord,pqTypedFinalityArguments} from './wallet-pq-typed-original.mjs';
import {decodePQActionTransportData} from '@ynx-chain/wallet-auth/pq-action-transport';
import {preparePQTransferFinalityTarget,preparePQTransferFinalityInvocation,preparePQReviewedTypedActionFinalityTarget,preparePQReviewedTypedActionFinalityInvocation} from './features/pq-transaction/finality-invocation.mjs';
import {bindPQTransferFinalityContext,bindSavedPQTransferFinalityInvocation,bindPQReviewedTypedActionFinalityContext,bindSavedPQReviewedTypedActionFinalityInvocation} from './features/pq-transaction/finality-saved-invocation.mjs';
import {parsePQTransferFinalityVerifierResult,parsePQReviewedTypedActionFinalityVerifierResult} from './features/pq-transaction/finality-verifier-result.mjs';
const fail=()=>{throw Object.assign(Error('PQ_TRANSACTION_ORIGINAL_BINDING'),{code:'PQ_TRANSACTION_ORIGINAL_BINDING'})};
// Only the existing private evidence pipeline dispatches here. No sender,
// authorization, trust selection, process factory or journal is introduced.
export function preparePQFinalityOriginal(value,binding){
 if(types.isProxy(value)||types.isProxy(binding))fail();exactData(binding,['account','networkId']);
 if(Object.getOwnPropertyDescriptor(value??{},'kind')?.value!=='pq-typed-action')return preparePQTransferOriginal(value,binding);
 const original=parsePQTypedOriginalRecord(value),typed=pqTypedFinalityArguments(original);
 if(binding.account!==original.account||binding.networkId!==original.typed.networkId)fail();
 return Object.freeze({original,typed,nativeWire:Buffer.from(decodePQActionTransportData(typed.raw).member),request:Object.freeze({body:typed.raw}),binding:Object.freeze({account:original.account,chainId:original.typed.networkId,operationId:original.operationId,kind:original.kind,hash:original.hash,abciTransactionHash:original.hash})});
}
export async function readPQFinalityOriginal(store,hash,{account,networkId,guard}){
 if(typeof hash!=='string'||!/^0x[0-9a-f]{64}$/.test(hash)||guard?.account!==account||typeof guard?.assert!=='function')fail();
 guard.assert();const originals=await store.readPQOriginals(account,()=>guard.assert());guard.assert();
 const original=originals.find(row=>row.hash===hash&&row.account===account);if(!original)fail();
 return preparePQFinalityOriginal(original,{account,networkId});
}
function dispatch(original,binding,legacy,typed,args){
 const plan=preparePQFinalityOriginal(original,binding);
 if(!plan.typed)return legacy(plan.original,binding,...args);
 const t=plan.typed;return typed(t.review,t.raw,t.original,...args);
}
export const preparePQFinalityTarget=(o,b,...a)=>dispatch(o,b,preparePQTransferFinalityTarget,preparePQReviewedTypedActionFinalityTarget,a);
export const preparePQFinalityInvocation=(o,b,...a)=>dispatch(o,b,preparePQTransferFinalityInvocation,preparePQReviewedTypedActionFinalityInvocation,a);
export const bindPQFinalityContext=(o,b,...a)=>dispatch(o,b,bindPQTransferFinalityContext,bindPQReviewedTypedActionFinalityContext,a);
export const bindSavedPQFinalityInvocation=(o,b,...a)=>dispatch(o,b,bindSavedPQTransferFinalityInvocation,bindSavedPQReviewedTypedActionFinalityInvocation,a);
export const parsePQFinalityVerifierResult=(o,b,...a)=>dispatch(o,b,parsePQTransferFinalityVerifierResult,parsePQReviewedTypedActionFinalityVerifierResult,a);
