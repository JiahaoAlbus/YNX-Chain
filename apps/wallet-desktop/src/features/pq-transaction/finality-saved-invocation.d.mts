import type {PQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
import type {PQFinalityBinding,PQFinalityTarget} from './finality-invocation.mjs';
export type PQFinalityLightTrust=Readonly<{
 version:'YNX-CONSENSUS-PROOF-TRUST/v1';chainId:string;migrationFile:string;genesisFile:string;stateFile:string;scheduleFile:string;
 scheduleHash:string;consensusGenesisSHA256:string;originalGenesisHash:string;migrationStateHash:string;runtimePlanFile:string;runtimePlanHash:string;
 engineHeight:string;engineAppHash:string;expectedHeaderHeight:string;expectedBlockHash:string;expectedStateHeight:string;expectedStateAppHash:string;
 trustedLightBlockFile:string;trustedLightBlockSHA256:string;trustingPeriodNanoseconds:string;maxClockDriftNanoseconds:string;trustLevelNumerator:string;trustLevelDenominator:string;
}>;
type Bound<T extends 'pq_transfer'|'pq_action'>=Readonly<{expected:PQFinalityTarget<T>;contextSha256:string;contextByteLength:number;
 classification:'data';proofVerification:'not-performed';independentFinality:false;consensusFinality:false;nativeGrant:false;canRetry:false;clearsOriginal:false}>;
export type PQFinalityBoundContext<T extends 'pq_transfer'|'pq_action'>=Bound<T>&Readonly<{lightTrust:PQFinalityLightTrust}>;
export type PQFinalitySavedInvocation<T extends 'pq_transfer'|'pq_action'>=Bound<T>&Readonly<{stdinSha256:string;stdinByteLength:number}>;
export function bindPQTransferFinalityContext(original:unknown,binding:PQFinalityBinding,contextBytes:Uint8Array):PQFinalityBoundContext<'pq_transfer'>;
export function bindSavedPQTransferFinalityInvocation(original:unknown,binding:PQFinalityBinding,contextBytes:Uint8Array,stdinBytes:Uint8Array):PQFinalitySavedInvocation<'pq_transfer'>;
export function bindPQReviewedTypedActionFinalityContext(review:unknown,raw:Uint8Array,original:PQReviewedTypedTransportOriginal,contextBytes:Uint8Array):PQFinalityBoundContext<'pq_action'>;
export function bindSavedPQReviewedTypedActionFinalityInvocation(review:unknown,raw:Uint8Array,original:PQReviewedTypedTransportOriginal,contextBytes:Uint8Array,stdinBytes:Uint8Array):PQFinalitySavedInvocation<'pq_action'>;
