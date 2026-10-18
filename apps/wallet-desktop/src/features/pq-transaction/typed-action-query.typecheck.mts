import {decodePQTypedActionQueryResponse,inspectPQReviewedTypedActionQuery,type PQTypedActionHTTPResponse} from './typed-action-query.mjs';
import type {PQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
import {createPQTypedActionNodeReader} from './typed-action-query-node.mjs';
declare const original:PQReviewedTypedTransportOriginal;
declare const review:unknown;
declare const bytes:Uint8Array;
const response:PQTypedActionHTTPResponse={method:'GET',requestPath:'/transactions/pq/actions/0xabc',status:200,contentType:'application/json',cacheControl:'no-store',body:bytes};
const decoded=decodePQTypedActionQueryResponse(response),observed=inspectPQReviewedTypedActionQuery(review,bytes,original,response);
const finality:false=observed.consensusFinality;
const retry:false=observed.canRetry;
const unknownStatus:'committed'|'rejected'|'unknown'=observed.observedStatus;
const wide:string=decoded.view.nonce;
createPQTypedActionNodeReader().readOriginal(review,bytes,original,()=>{});
createPQTypedActionNodeReader().readOriginal(review,bytes,original,()=>{},async response=>{const method:'GET'=response.method;return {stored:method==='GET'};});
// @ts-expect-error Original capture is a callback, not a caller permission flag.
createPQTypedActionNodeReader().readOriginal(review,bytes,original,()=>{},true);
// @ts-expect-error Readonly facade never exposes submission.
createPQTypedActionNodeReader().submitTransfer;
// @ts-expect-error Main current-account lifecycle guard is required.
createPQTypedActionNodeReader().readOriginal(review,bytes,original);
// @ts-expect-error GET-only observation never accepts a POST callback result.
decodePQTypedActionQueryResponse({...response,method:'POST'});
// @ts-expect-error Original raw bytes are required, not a text roundtrip.
decodePQTypedActionQueryResponse({...response,body:'{}'});
// @ts-expect-error A parsed node status can never be a finality capability.
const granted:true=observed.independentFinality;
// @ts-expect-error Both archived branded snapshots remain required.
inspectPQReviewedTypedActionQuery(review,bytes,{memberHash:'x',transportHash:'y'},response);
// @ts-expect-error The observer intentionally excludes unverified effects.
const effects=observed.effects;
void [finality,retry,unknownStatus,wide,granted,effects];
