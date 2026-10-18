import {request as httpsRequest} from 'node:https';
import {PQTransactionNodeTransportKernel} from './node-transport.mjs';

/** Original pinned Node transport, exposing only this typed GET operation.
 * Main retains lifecycle guard, custody and independent proof verification.
 * Normal operator pins are unchanged; unavailable/mismatched nodes fail closed. */
export function createPQTypedActionNodeReader(){
 const kernel=new PQTransactionNodeTransportKernel(httpsRequest);
 return Object.freeze({readOriginal:(review,raw,original,assertCurrent)=>kernel.readTypedActionOriginal(review,raw,original,assertCurrent)});
}
