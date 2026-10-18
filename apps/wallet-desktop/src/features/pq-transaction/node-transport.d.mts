import type {PQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
import type {PQTypedActionHTTPResponse,PQTypedActionBroadcastHTTPResponse} from './typed-action-query.mjs';
export type PQTransactionNodeTransport=Readonly<{
 submitTransfer(input:unknown,assertCurrent:()=>void):Promise<Readonly<{status:number;text:string}>>;
 readOriginal(hash:string):Promise<Readonly<{status:number;text:string}>>;
 readFinalityProof(original:unknown,binding:Readonly<{account:string;networkId:string}>):Promise<Readonly<{status:number;rawBytes:Uint8Array}>>;
 submitTypedAction(review:unknown,raw:Uint8Array,original:PQReviewedTypedTransportOriginal,assertCurrent:()=>void):Promise<PQTypedActionBroadcastHTTPResponse>;
}>;
export function createPQTransactionNodeTransport():PQTransactionNodeTransport;
/** Original request injection exists for controlled Main transport tests only. */
export class PQTransactionNodeTransportKernel {
 constructor(requestImpl:(...args:any[])=>any,clock?:()=>number);
 submitTransfer:PQTransactionNodeTransport['submitTransfer'];
 readOriginal:PQTransactionNodeTransport['readOriginal'];
 readFinalityProof:PQTransactionNodeTransport['readFinalityProof'];
 submitTypedAction:PQTransactionNodeTransport['submitTypedAction'];
 readTypedActionOriginal(review:unknown,raw:Uint8Array,original:PQReviewedTypedTransportOriginal,assertCurrent:()=>void,captureResponse?:(response:PQTypedActionHTTPResponse)=>unknown|Promise<unknown>):Promise<PQTypedActionHTTPResponse>;
 readTypedActionFinalityProof(review:unknown,raw:Uint8Array,original:PQReviewedTypedTransportOriginal,assertCurrent:()=>void):Promise<PQTypedActionHTTPResponse>;
}
