import type {ProductSessionDeviceAbortContextV4} from './product-session-device-v4.js';

export type ProductDeviceV4PendingProofKind='registration-pop'|'challenge-completion';
declare const originalPendingOperation:unique symbol,originalPendingSource:unique symbol;
/** Original tagged Native operation. No JSON/DTO/software constructor can
 * create this identity. A returned operation can already contain a late error. */
export interface OriginalProductDeviceV4PendingOperation<K extends ProductDeviceV4PendingProofKind> {
 readonly [originalPendingOperation]:K;
 /** PUBLIC original partial remains readable; this does not retry/sign. */
 readOriginalMember():Uint8Array;
 readOriginalStatus():Readonly<{
  result:number;cleanup:number;reportedLengthExact:string;reportedLength?:number;
  entered:boolean;mathCompleted:boolean;authorized:false;nativeAdmission:false;
 }>;
 assertCurrent():undefined;retire():undefined;join():undefined;close():undefined;
}
/** Original acquisition error.partial, when supplied by Native. Preserve it
 * before inspecting the error and retain it if cleanup is UNKNOWN. */
export interface OriginalProductDeviceV4PendingSourceOwner {
 readonly [originalPendingSource]:never;
 readOriginalReview():Uint8Array;assertCurrent():undefined;
 produceRegistrationProof(context:ProductSessionDeviceAbortContextV4):OriginalProductDeviceV4PendingOperation<'registration-pop'>;
 produceChallengeProof(context:ProductSessionDeviceAbortContextV4):OriginalProductDeviceV4PendingOperation<'challenge-completion'>;
 retire():undefined;join():undefined;close():undefined;
}
export interface OriginalProductDeviceV4PendingProofClient {
 readonly capabilities:Readonly<{
  kind:'original-native-device-v4-pending-proof-client';identityGrant:false;
  nativeAdmission:false;connected:false;newSession:false;management:false;
 }>;
 /** Original canonical scope8 bytes for visible review. DATA is not approval. */
 readOriginalReview():Uint8Array;
  /** SAME original Source fence around visible review or asynchronous work. */
  assertCurrent():undefined;
 /** Return the SAME operation before assertCurrent can expose a late error.
  * The client retains its cleanup. No other proof can enter on this client. */
 produceRegistrationProof(context:ProductSessionDeviceAbortContextV4):Promise<OriginalProductDeviceV4PendingOperation<'registration-pop'>>;
 produceChallengeProof(context:ProductSessionDeviceAbortContextV4):Promise<OriginalProductDeviceV4PendingOperation<'challenge-completion'>>;
 retire():undefined;
 /** Drains only the original child. Joining never closes child or parent. */
 join():Promise<undefined>;
 /** Caller aborts its original controller first. Drain child before parent;
  * keep parent custody on child-close UNKNOWN. Exact first close Promise. */
 close():Promise<undefined>;
 status():Readonly<{
  selected:boolean;retired:boolean;operationRetained:boolean;sourceRetained:boolean;
  closed:boolean;unknown:boolean;cleanupFailurePresent:boolean;firstCleanupCause:unknown;
  boundaryFailurePresent:boolean;firstBoundaryCause:unknown;sourceFailurePresent:boolean;
  /** Call original operation.assertCurrent and the fixed proof codec. Resource
   * cleanup/status never asserts that a business proof succeeded. */
  proofOutcome:'not-inspected';
 }>;
}
/** Zero-input Node-only entry using the existing sole fixed Native image.
 * Does not choose a path/provider/Source or convert DATA into authority.
 * Acquisition failures and original error.partial are rethrown unchanged. */
export function openOriginalProductSessionDeviceV4PendingProofClient():Promise<OriginalProductDeviceV4PendingProofClient>;
