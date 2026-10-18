import {inspectPQReviewedTypedActionFinalityCollector,planPQReviewedTypedActionFinalityCollector,type PQTypedActionFinalityHTTPResponse} from './typed-action-finality.mjs';
import {createPQTypedActionFinalityNodeReader} from './typed-action-finality-node.mjs';
import type {PQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
declare const original:PQReviewedTypedTransportOriginal,review:unknown,raw:Uint8Array;
const response:PQTypedActionFinalityHTTPResponse={method:'GET',requestPath:'/txs/0xhash/pq-action-finality-proof',status:502,contentType:'application/json',cacheControl:'no-store',body:raw};
const result=inspectPQReviewedTypedActionFinalityCollector(review,raw,original,response);
const height:string=result.observation.observedExecutionHeight;
const index:number|null=result.observation.cometIndex;
const finality:false=result.observation.independentFinality;
const retry:false=result.observation.canRetry;
const proof:string|undefined=result.proof?.transactionProof;
const plan=planPQReviewedTypedActionFinalityCollector(review,raw,original);
const method:'GET'=plan.method;
createPQTypedActionFinalityNodeReader().readOriginalProof(review,raw,original,()=>{});
// @ts-expect-error Only Main proof result, never public observation.
result.observation.proof;
// @ts-expect-error A collected proof DTO does not grant independent finality.
const grant:true=result.observation.consensusFinality;
// @ts-expect-error Separate guard is mandatory before and across network I/O.
createPQTypedActionFinalityNodeReader().readOriginalProof(review,raw,original);
// @ts-expect-error Readonly factory cannot send a transaction.
createPQTypedActionFinalityNodeReader().submitTransfer;
// @ts-expect-error Both retained original snapshots are required.
inspectPQReviewedTypedActionFinalityCollector(review,raw,{memberHash:'x',transportHash:'y'},response);
// @ts-expect-error Original HTTP byte response, never a text round trip.
inspectPQReviewedTypedActionFinalityCollector(review,raw,original,{...response,body:'{}'});
void [height,index,finality,retry,proof,method,grant];
