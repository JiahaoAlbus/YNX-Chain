import {request as httpsRequest} from 'node:https';
import {PQTransactionNodeTransportKernel} from './node-transport.mjs';

/** Original pins and pre-read lifecycle, GET-only proof bytes. Main captures
 * complete HTTP bytes before post-await lock checks/parsing. No verifier/grant. */
export function createPQTypedActionFinalityNodeReader(){
 const kernel=new PQTransactionNodeTransportKernel(httpsRequest);
 return Object.freeze({readOriginalProof:(review,raw,original,assertCurrent)=>kernel.readTypedActionFinalityProof(review,raw,original,assertCurrent)});
}
