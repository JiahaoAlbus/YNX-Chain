import type {PQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
import type {PQFinalityBinding,PQFinalityTarget,PQFinalityTransactionType,PQStandaloneFinalityTransactionType} from './finality-invocation.mjs';
export const PQ_FINALITY_VERIFIER_RESULT_LIMITS:Readonly<{stdoutBytes:number;stderrBytes:number}>;
export type PQFinalityExecution=Readonly<{stdout:Uint8Array;stderr:Uint8Array;exitCode:number|null;signal:string|null}>;
export type PQFinalityVerifierObservation<T extends PQFinalityTransactionType>=Readonly<{
 account:string;operationId:string;kind:T extends 'pq_action'?'pq-typed-action':T extends 'account_migration'?'pq-migration':'pq-transfer';transactionType:T;
 nativeTransactionHash:string;abciTransactionHash:string;executionHeight:string;cometIndex:number;
 status:'verifier-result-data'|'verifier-error-data';verifierCode:'VERIFIED_TRANSACTION_DATA'|'VERIFIED_TRANSACTION_REJECTED_DATA'|'INVALID_ARGUMENTS'|'INVALID_REQUEST'|'TRUST_CONTEXT_INVALID'|'TRUST_SOURCE_INVALID'|'PROOF_REJECTED';
 reportedOutcome:'succeeded'|'rejected'|null;reportedExecutionSuccessful:boolean|null;executionCode:string|null;
 proofVerification:'result-data-only';independentFinality:false;consensusFinality:false;nativeGrant:false;canRetry:false;clearsOriginal:false;
}>;
export type PQFinalityVerifierResult<T extends PQFinalityTransactionType>=Readonly<{observation:PQFinalityVerifierObservation<T>;stdoutSha256:string;stdoutByteLength:number;stderrSha256:string;stderrByteLength:number}>;
export function parsePQTransferFinalityVerifierResult<T extends PQStandaloneFinalityTransactionType>(original:unknown,binding:PQFinalityBinding,hostExpectedTransaction:PQFinalityTarget<T>,execution:PQFinalityExecution):PQFinalityVerifierResult<T>;
export function parsePQReviewedTypedActionFinalityVerifierResult(review:unknown,raw:Uint8Array,original:PQReviewedTypedTransportOriginal,hostExpectedTransaction:PQFinalityTarget<'pq_action'>,execution:PQFinalityExecution):PQFinalityVerifierResult<'pq_action'>;
