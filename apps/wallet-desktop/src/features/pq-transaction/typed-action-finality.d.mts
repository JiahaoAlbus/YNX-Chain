import type {PQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
import type {PQTypedActionHTTPResponse} from './typed-action-query.mjs';
export type PQTypedActionFinalityHTTPResponse=PQTypedActionHTTPResponse;
export type PQFinalityLightProofData=Readonly<{version:'YNX-PQ-LIGHT-PROOF/v1';commitResult:string;validatorsResult:string}>;
export type PQFinalityProofData=Readonly<{version:'YNX-PQ-TRANSACTION-PROOF/v1';block:PQFinalityLightProofData;successor:PQFinalityLightProofData;transactionProof:string;executionResult:string;executionProof:string}>;
export type PQTypedActionFinalityObservation=Readonly<{
 kind:'pq-typed-action';transactionType:'pq_action';operationId:string;account:string;networkId:string;memberHash:string;transportHash:string;requestDigest:string;
 actionKind:string;nonce:string;policyRevision:string;reviewExecutionHeight:string;signingExecutionHeight:string;
 memberCount:1;memberIndex:0;signatureVerified:true;classicWitnessValidationRequired:boolean;
 source:'configured-comet-rpc';status:'collected'|'pending'|'unavailable';observedExecutionStatus:'committed'|'rejected'|null;
 observedNativeTransactionHash:string;observedABCITransactionHash:string;observedExecutionHeight:string;cometIndex:number|null;requestPath:string;httpStatus:200|202|502;
 dataOnly:true;observationOnly:true;httpResponseInspected:true;proofVerification:'not-performed';independentFinality:false;
 nativeAdmission:false;permissionGranted:false;submitted:false;canRetry:false;clearsOriginal:false;consensusFinality:false;
}>;
export type PQTypedActionFinalityCollection=Readonly<{observation:PQTypedActionFinalityObservation;proof:PQFinalityProofData|null;rawSha256:string;byteLength:number}>;
/** Node/Main-only plan derived from original review, both snapshots and bytes. */
export function planPQReviewedTypedActionFinalityCollector(review:unknown,raw:Uint8Array,original:PQReviewedTypedTransportOriginal):Readonly<{method:'GET';path:string}>;
/** DATA grammar and original binding only. Proof stays Main-only, unverified. */
export function inspectPQReviewedTypedActionFinalityCollector(review:unknown,raw:Uint8Array,original:PQReviewedTypedTransportOriginal,response:PQTypedActionFinalityHTTPResponse):PQTypedActionFinalityCollection;
