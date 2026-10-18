import type {PQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
export const PQ_TYPED_QUERY_MAX_BYTES: number;
export type PQTypedActionHTTPResponse=Readonly<{method:'GET';requestPath:string;status:number;contentType:string;cacheControl:string;body:Uint8Array}>;
export type PQTypedQueryEffect=string|boolean|null|readonly PQTypedQueryEffect[]|{readonly [key:string]:PQTypedQueryEffect};
export type PQTypedActionNodeView=Readonly<{
 type:string;status:'committed'|'rejected'|'unknown';committed:boolean;source:'comet-rpc';
 nativeTransactionHash:string;abciTransactionHash?:string;wire?:string;transport?:string;
 executionHeight:string;cometIndex?:number;from?:string;to?:string;amount:string;fee:string;nonce:string;
 effects?:{readonly [key:string]:PQTypedQueryEffect};readbackUrl:string;abciReadbackUrl?:string;error?:string;
}>;
export type PQTypedActionDecodedResponse=Readonly<{requestPath:string;httpStatus:200|202;view:PQTypedActionNodeView;dataOnly:true;proofVerification:'not-performed';independentFinality:false}>;
export type PQTypedActionQueryObservation=Readonly<{
 kind:'pq-typed-action';operationId:string;account:string;networkId:string;memberHash:string;transportHash:string;requestDigest:string;
 actionKind:string;nonce:string;policyRevision:string;reviewExecutionHeight:string;signingExecutionHeight:string;
 memberCount:1;memberIndex:0;signatureVerified:true;classicWitnessValidationRequired:boolean;
 source:'comet-rpc';observedStatus:'committed'|'rejected'|'unknown';observedExecutionHeight:string;cometIndex:number|null;
 requestPath:string;httpStatus:200|202;originalBytesObserved:boolean;httpResponseInspected:true;
 dataOnly:true;observationOnly:true;effectsVerified:false;proofVerification:'not-performed';independentFinality:false;
 nativeAdmission:false;permissionGranted:false;submitted:false;canRetry:false;clearsOriginal:false;consensusFinality:false;
}>;
/** HTTP DATA only; no signature verification, journal mutation or network I/O. */
export function decodePQTypedActionQueryResponse(response:PQTypedActionHTTPResponse):PQTypedActionDecodedResponse;
/** Node/Main only; both snapshots must come from original retained custody. */
export function inspectPQReviewedTypedActionQuery(archivedReview:unknown,rawTransport:Uint8Array,original:PQReviewedTypedTransportOriginal,response:PQTypedActionHTTPResponse):PQTypedActionQueryObservation;
