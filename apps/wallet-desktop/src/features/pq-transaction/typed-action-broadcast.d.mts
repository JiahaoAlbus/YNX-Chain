import type {PQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
import type {PQTypedActionBroadcastHTTPResponse} from './typed-action-query.mjs';
export const PQ_TYPED_ACTION_BROADCAST_PATH:'/transactions/pq/actions/broadcast';
export const PQ_TYPED_ACTION_BROADCAST_RPC_BYTES:792658;
export type PQTypedActionBroadcastPlan=Readonly<{method:'POST';path:'/transactions/pq/actions/broadcast';contentType:'application/json';memberHash:string;transportHash:string;admissionIsFinality:false;body:Uint8Array}>;
export type PQTypedActionBroadcastObservation=Readonly<{
 kind:'pq-typed-action';operationId:string;account:string;networkId:string;memberHash:string;transportHash:string;requestDigest:string;actionKind:string;nonce:string;policyRevision:string;
 reviewExecutionHeight:string;signingExecutionHeight:string;memberCount:1;memberIndex:0;signatureVerified:true;classicWitnessValidationRequired:boolean;
 requestPath:string;httpStatus:200|202|400|413|415|422;outcome:'inclusion-observed'|'rejection-observed'|'outcome-unknown';observedStatus:'committed'|'rejected'|'unknown'|null;
 observedExecutionHeight:string|null;cometIndex:number|null;bodyIdentityObserved:boolean;httpResponseInspected:true;dataOnly:true;observationOnly:true;effectsVerified:false;
 proofVerification:'not-performed';independentFinality:false;nativeAdmission:false;permissionGranted:false;submitted:false;canRetry:false;clearsOriginal:false;consensusFinality:false;
}>;
export function preparePQReviewedTypedActionBroadcast(review:unknown,raw:Uint8Array,original:PQReviewedTypedTransportOriginal):PQTypedActionBroadcastPlan;
export function inspectPQReviewedTypedActionBroadcast(review:unknown,raw:Uint8Array,original:PQReviewedTypedTransportOriginal,response:PQTypedActionBroadcastHTTPResponse):PQTypedActionBroadcastObservation;
