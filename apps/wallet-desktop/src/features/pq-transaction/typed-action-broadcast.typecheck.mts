import {preparePQReviewedTypedActionBroadcast,inspectPQReviewedTypedActionBroadcast} from './typed-action-broadcast.mjs';
import {decodePQTypedActionBroadcastResponse,type PQTypedActionBroadcastHTTPResponse} from './typed-action-query.mjs';
import {createPQTransactionNodeTransport} from './node-transport.mjs';
import type {PQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
declare const review:unknown,raw:Uint8Array,original:PQReviewedTypedTransportOriginal;
const plan=preparePQReviewedTypedActionBroadcast(review,raw,original);
const content:'application/json'=plan.contentType;
const response:PQTypedActionBroadcastHTTPResponse={method:'POST',requestPath:plan.path,status:422,contentType:content,cacheControl:'no-store',body:raw};
const decoded=decodePQTypedActionBroadcastResponse(response),observed=inspectPQReviewedTypedActionBroadcast(review,raw,original,response);
const nullable:string|null=observed.observedExecutionHeight;
const finality:false=observed.independentFinality;
createPQTransactionNodeTransport().submitTypedAction(review,raw,original,()=>{});
// @ts-expect-error Original effect guard is mandatory.
createPQTransactionNodeTransport().submitTypedAction(review,raw,original);
// @ts-expect-error POST response cannot masquerade as a GET observation.
decodePQTypedActionBroadcastResponse({...response,method:'GET'});
// @ts-expect-error Actual error-only response has no invented body identity.
const v:string=decoded.view.nativeTransactionHash;
// @ts-expect-error Neither HTTP success nor rejection grants retry.
const retry:true=observed.canRetry;
// @ts-expect-error Both original snapshots remain mandatory.
preparePQReviewedTypedActionBroadcast(review,raw,{memberHash:'x',transportHash:'y'});
void [content,nullable,finality,v,retry];
