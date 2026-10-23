import {preparePQReviewedTypedActionFinalityTarget,preparePQReviewedTypedActionFinalityInvocation,type PQFinalityTarget} from './finality-invocation.mjs';
import {bindPQReviewedTypedActionFinalityContext,bindSavedPQReviewedTypedActionFinalityInvocation} from './finality-saved-invocation.mjs';
import {parsePQReviewedTypedActionFinalityVerifierResult,type PQFinalityExecution} from './finality-verifier-result.mjs';
import {inspectPQReviewedTypedActionFinalityCollector,type PQTypedActionFinalityHTTPResponse} from './typed-action-finality.mjs';
import type {PQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
declare const review:unknown,raw:Uint8Array,original:PQReviewedTypedTransportOriginal,target:PQFinalityTarget<'pq_action'>,contextBytes:Uint8Array,execution:PQFinalityExecution,response:PQTypedActionFinalityHTTPResponse;
const expected=preparePQReviewedTypedActionFinalityTarget(review,raw,original,target);
const collected=inspectPQReviewedTypedActionFinalityCollector(review,raw,original,response);
if(collected.proof!==null){
 const invocation=preparePQReviewedTypedActionFinalityInvocation(review,raw,original,expected,collected.proof);
 const context=bindPQReviewedTypedActionFinalityContext(review,raw,original,contextBytes);
 const saved=bindSavedPQReviewedTypedActionFinalityInvocation(review,raw,original,contextBytes,new TextEncoder().encode(invocation.stdin));
 const result=parsePQReviewedTypedActionFinalityVerifierResult(review,raw,original,saved.expected,execution);
 const kind:'pq-typed-action'=result.observation.kind;
 const data:'result-data-only'=result.observation.proofVerification;
 const no:false=context.independentFinality;
 // @ts-expect-error A result DATA receipt is not independent finality.
 const finality:true=result.observation.consensusFinality;
 // @ts-expect-error No raw stdout or proof in the public observation.
 result.observation.stdout;
 // @ts-expect-error Stringified raw bytes cannot replace saved exact bytes.
 bindSavedPQReviewedTypedActionFinalityInvocation(review,raw,original,contextBytes,invocation.stdin);
 void [kind,data,no,finality];
}
// @ts-expect-error A transfer target cannot be cast to a typed original.
preparePQReviewedTypedActionFinalityTarget(review,raw,original,{...target,transactionType:'pq_transfer'});
// @ts-expect-error Both archived snapshots and selected binding are required.
preparePQReviewedTypedActionFinalityTarget(review,raw,{memberHash:'x',transportHash:'y'},target);
// @ts-expect-error Caller may not overwrite the returned immutable Host index.
expected.index='0';
