import type {ProductBusinessReadInput} from './index.js';
import type {ProductSessionBusinessReadProofV4} from './product-session-device-v4.js';
/** Original cleanup custody only. A type/shape is never Native or Root admission. */
export interface OriginalIDEHeldSessionReadCleanupOwner {
 retire():void;
 status():Readonly<{closed:boolean;retired:boolean}>;
 /** Same retained promise/result; ambiguity retains debt and blocks parent close. */
 close():Promise<void>;
}
export interface OriginalIDEHeldSessionReadStatus {
 readonly retired:boolean;readonly closed:boolean;readonly opening:boolean;
 readonly activeOperations:number;readonly firstCausePresent:boolean;
 readonly cleanupPending:boolean;readonly RootAdmission:false;
 readonly SourceAdmission:false;readonly newSession:false;readonly connected:false;
}
/** Full original read owner, still no Source/Root/session creation capability. */
export interface OriginalIDEHeldSessionReadOwner extends OriginalIDEHeldSessionReadCleanupOwner {
 status():Readonly<OriginalIDEHeldSessionReadStatus>;
 assertCurrent():Promise<void>;
 createBusinessProof(input:ProductBusinessReadInput):Promise<ProductSessionBusinessReadProofV4>;
}
/** Success is the three explicit false discriminants, never error truthiness.
 * Even this read owner grants no Root, Source, connected state or new session. */
export interface OriginalIDEHeldSessionReadSuccess {
 readonly owner:OriginalIDEHeldSessionReadOwner;
 readonly error:null;
 readonly failed:false;readonly errorPresent:false;readonly cleanupOnly:false;
}
/** Adopt any non-null partial BEFORE interpreting the ORIGINAL unknown error.
 * A loader/pre-acquisition refusal has owner:null. Falsy null/undefined/false/0
 * errors remain failures via explicit flags; partial has cleanup custody only. */
export interface OriginalIDEHeldSessionReadFailure {
 readonly owner:OriginalIDEHeldSessionReadCleanupOwner|null;
 readonly error:unknown;
 readonly failed:true;readonly errorPresent:true;readonly cleanupOnly:true;
}
export type OriginalIDEHeldSessionReadOutcome=
 Readonly<OriginalIDEHeldSessionReadSuccess>|Readonly<OriginalIDEHeldSessionReadFailure>;
/** Node-only fixed Native/preload/Root-selected original acquisition. No caller
 * config, session, registry, paths, Source, provider, callback or abort override.
 * Fixed-loader/resource failures return explicit failure outcomes; invalid
 * caller arguments may reject. Reviewed/native admission remains independent. */
export function acquireOriginalIDEHeldSessionRead():Promise<OriginalIDEHeldSessionReadOutcome>;
