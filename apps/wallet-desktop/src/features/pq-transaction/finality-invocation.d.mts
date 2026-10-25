import type {PQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
import type {PQFinalityProofData} from './typed-action-finality.mjs';
export type PQFinalityStatement=Readonly<{chainId:string;headerHeight:string;blockHash:string;stateHeight:string;stateAppHash:string}>;
export type PQStandaloneFinalityTransactionType='pq_transfer'|'account_migration';
export type PQFinalityTransactionType=PQStandaloneFinalityTransactionType|'pq_action';
export type PQFinalityTarget<T extends PQFinalityTransactionType=PQFinalityTransactionType>=Readonly<{
 block:PQFinalityStatement;successor:PQFinalityStatement;transactionType:T;
 envelope:string;nativeWire:string;transactionHash:string;nativeWireHash:string;index:string;
}>;
export type PQFinalityInvocation<T extends PQFinalityTransactionType>=Readonly<{expected:PQFinalityTarget<T>;stdin:string;stdinByteLength:number;stdinSha256:string}>;
export type PQFinalityBinding=Readonly<{account:string;networkId:string}>;
export function preparePQTransferFinalityTarget<T extends PQStandaloneFinalityTransactionType>(original:unknown,binding:PQFinalityBinding,hostExpectedTransaction:PQFinalityTarget<T>):PQFinalityTarget<T>;
export function preparePQTransferFinalityInvocation<T extends PQStandaloneFinalityTransactionType>(original:unknown,binding:PQFinalityBinding,hostExpectedTransaction:PQFinalityTarget<T>,collectorProof:PQFinalityProofData):PQFinalityInvocation<T>;
/** Full original transport and Member, not a reconstructed transfer envelope. */
export function preparePQReviewedTypedActionFinalityTarget(review:unknown,raw:Uint8Array,original:PQReviewedTypedTransportOriginal,hostExpectedTransaction:PQFinalityTarget<'pq_action'>):PQFinalityTarget<'pq_action'>;
export function preparePQReviewedTypedActionFinalityInvocation(review:unknown,raw:Uint8Array,original:PQReviewedTypedTransportOriginal,hostExpectedTransaction:PQFinalityTarget<'pq_action'>,collectorProof:PQFinalityProofData):PQFinalityInvocation<'pq_action'>;
