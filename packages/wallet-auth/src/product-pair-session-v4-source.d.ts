import type{OriginalProductSessionDeviceCurrentSourceV4}from'./product-session-device-v4.js';
declare const serverCurrentOwner:unique symbol;
export interface OriginalProductSessionDeviceV4ServerCurrentOwner {
 readonly[serverCurrentOwner]:never;readonly deviceCurrent:OriginalProductSessionDeviceCurrentSourceV4;
 retire():void;join():Promise<void>;close():Promise<void>;drainPartial():Promise<void>;status():Readonly<{retired:boolean;pending:number;held:number;unknown:boolean;firstCausePresent:boolean;firstCause:unknown}>;
}
export interface OriginalProductPairSessionV4PartialOwner {retire():void;join():void|Promise<void>;close():void|Promise<void>;drainPartial?():Promise<void>}
export interface OriginalProductPairSessionV4IssuerOwner extends OriginalProductPairSessionV4PartialOwner {pair(original:string):Promise<unknown>;complete(original:string):Promise<unknown>;challenge(original:string):Promise<unknown>;revoke(original:string):Promise<unknown>;cancel(original:string):Promise<unknown>;active(original:string):Promise<unknown>;recover(original:string):Promise<unknown>}
export function acquireOriginalProductSessionDeviceV4ServerCurrent():Promise<Readonly<{owner:OriginalProductSessionDeviceV4ServerCurrentOwner|OriginalProductPairSessionV4PartialOwner;deviceCurrent:OriginalProductSessionDeviceCurrentSourceV4|null;error:unknown}>>;
export function assertOriginalProductSessionDeviceV4ServerCurrentOwner(owner:unknown):OriginalProductSessionDeviceV4ServerCurrentOwner;
/** First adopt any non-null owner; only an own error:null plus exact private owner/provider is success. */
export function assertOriginalProductSessionDeviceV4ServerCurrentResult(outcome:unknown):OriginalProductSessionDeviceV4ServerCurrentOwner;
/** Existing original issuer callee retained unchanged; no caller configuration. */
export function acquireOriginalProductPairSessionV4Issuer():Promise<Readonly<{owner:OriginalProductPairSessionV4IssuerOwner|OriginalProductPairSessionV4PartialOwner;error:unknown}>>;
export function assertOriginalProductPairIssuerOwnerV4(owner:unknown):OriginalProductPairSessionV4IssuerOwner;
/** Candidate DATA only; no signed PROFILE, CURRENT registration or Root grant. */
export interface OriginalPendingCompletionProfileCandidateDATA {
 readonly kind:2;readonly profileBodyOriginal:string;readonly profileBodySHA256:string;readonly scopeOriginal:string;readonly currentHead:string;readonly originalProfileBodySHA256:string;
 readonly pairOperationId:string;readonly operationId:string;readonly expiresAtMs:number;readonly newIssuancePlanRequired:true;readonly dataOnly:true;readonly authorized:false;readonly SourceAdmission:false;readonly nativeAdmission:false;
}
export interface OriginalPendingCompletionCandidateInput {
 readonly profileBodyOriginal:string;readonly queryOriginal:import('node:buffer').Buffer;readonly originalPairPost:import('node:buffer').Buffer;
 /** Independently supplied next-PROFILE constraint; this API never allocates it. */
 readonly completionOperationId:string;
}
export interface OriginalProductPairPendingCompletionReaderV4 {
 readOriginalCompletionCandidateDATA(input:OriginalPendingCompletionCandidateInput):Promise<Readonly<{candidate:OriginalPendingCompletionProfileCandidateDATA;errorPresent:false}>|Readonly<{candidate:OriginalPendingCompletionProfileCandidateDATA|null;errorPresent:true;error:unknown}>>;
 retire():void;join():Promise<void>;close():Promise<void>;
 statusDATA():Readonly<{retired:boolean;closed:boolean;active:number;childDebts:number;firstCausePresent:boolean;firstCause:unknown;SourceAdmission:false}>;
}
/** Retain a nonnull partial before inspecting errorPresent (including error=0). */
export function acquireOriginalProductPairPendingCompletionReaderV4():Promise<Readonly<{owner:OriginalProductPairPendingCompletionReaderV4;errorPresent:false}>|Readonly<{owner:OriginalProductPairSessionV4PartialOwner|null;errorPresent:true;error:unknown}>>;
