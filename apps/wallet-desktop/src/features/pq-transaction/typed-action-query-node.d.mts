import type {PQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
import type {PQTypedActionHTTPResponse} from './typed-action-query.mjs';
export type PQTypedActionNodeReader=Readonly<{
 readOriginal(review:unknown,rawTransport:Uint8Array,original:PQReviewedTypedTransportOriginal,assertCurrent:()=>void,captureResponse?:(response:PQTypedActionHTTPResponse)=>unknown|Promise<unknown>):Promise<PQTypedActionHTTPResponse>;
}>;
/** Normal original operator endpoint/SPKI/network/build pins; only GET. */
export function createPQTypedActionNodeReader():PQTypedActionNodeReader;
