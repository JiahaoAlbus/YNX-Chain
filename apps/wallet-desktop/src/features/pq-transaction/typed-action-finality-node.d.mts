import type {PQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
import type {PQTypedActionFinalityHTTPResponse} from './typed-action-finality.mjs';
export type PQTypedActionFinalityNodeReader=Readonly<{
 readOriginalProof(review:unknown,raw:Uint8Array,original:PQReviewedTypedTransportOriginal,assertCurrent:()=>void):Promise<PQTypedActionFinalityHTTPResponse>;
}>;
export function createPQTypedActionFinalityNodeReader():PQTypedActionFinalityNodeReader;
