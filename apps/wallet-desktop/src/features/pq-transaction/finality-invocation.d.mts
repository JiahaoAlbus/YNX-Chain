import type {PQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
import type {PQFinalityProofData} from './typed-action-finality.mjs';
export type PQFinalityStatement=Readonly<{chainId:string;headerHeight:string;blockHash:string;stateHeight:string;stateAppHash:string}>;
export type PQFinalityTarget<T extends 'pq_transfer'|'pq_action'='pq_transfer'|'pq_action'>=Readonly<{
 block:PQFinalityStatement;successor:PQFinalityStatement;transactionType:T;
 envelope:string;nativeWire:string;transactionHash:string;nativeWireHash:string;index:string;
}>;
export type PQFinalityInvocation<T extends 'pq_transfer'|'pq_action'>=Readonly<{expected:PQFinalityTarget<T>;stdin:string;stdinByteLength:number;stdinSha256:string}>;
export type PQFinalityBinding=Readonly<{account:string;networkId:string}>;
export function preparePQTransferFinalityTarget(original:unknown,binding:PQFinalityBinding,hostExpectedTransaction:PQFinalityTarget<'pq_transfer'>):PQFinalityTarget<'pq_transfer'>;
export function preparePQTransferFinalityInvocation(original:unknown,binding:PQFinalityBinding,hostExpectedTransaction:PQFinalityTarget<'pq_transfer'>,collectorProof:PQFinalityProofData):PQFinalityInvocation<'pq_transfer'>;
/** Full original transport and Member, not a reconstructed transfer envelope. */
export function preparePQReviewedTypedActionFinalityTarget(review:unknown,raw:Uint8Array,original:PQReviewedTypedTransportOriginal,hostExpectedTransaction:PQFinalityTarget<'pq_action'>):PQFinalityTarget<'pq_action'>;
export function preparePQReviewedTypedActionFinalityInvocation(review:unknown,raw:Uint8Array,original:PQReviewedTypedTransportOriginal,hostExpectedTransaction:PQFinalityTarget<'pq_action'>,collectorProof:PQFinalityProofData):PQFinalityInvocation<'pq_action'>;
