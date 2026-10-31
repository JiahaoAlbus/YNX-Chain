declare const nativeRegisteredFinalizationSource:unique symbol;
declare const nativeRegisteredFinalizationPermit:unique symbol;
export type OriginalRegisteredFinalizationIdentityV4=Readonly<{networkId:string;canonicalOwner:string;account:string;productId:string;clientId:string;platform:string;applicationId:string;bundleId:string|null;packageId:string|null;origin:string;callback:string;deviceId:string}>;
/** Historical public originals only. Reading this never finalizes or grants. */
export interface OriginalRegisteredFinalizationReviewDATAV4 {
 readonly identityBinding:OriginalRegisteredFinalizationIdentityV4;
 readonly originalCreationTerms19:string;readonly originalGeneration:string;readonly originalCreationOperation:string;readonly originalRegistrationOperation:string|null;
 readonly dataOnly:true;readonly SourceAdmission:false;readonly NativeAdmission:false;
}
export interface OriginalRegisteredFinalizationOutcomeDATAV4 {
 readonly state:'FINALIZED_LOCAL_ASSOCIATION'|'ALREADY_FINALIZED_SAME_ORIGINAL'|'UNKNOWN'|'EVIDENCE_NOT_SUPPLIED';
 readonly originalGeneration:string;readonly originalCreationOperation:string;readonly originalRegistrationOperation:string|null;
 /** May be true with UNKNOWN after a late current failure. Never replay. */
 readonly localAssociationFinalized:boolean;readonly SourceAdmission:false;readonly newSession:false;readonly connected:false;readonly keyGenerated:false;readonly registrationResent:false;
 readonly [extra:string]:unknown;
}
export interface OriginalRegisteredFinalizationPermitV4 {
 readonly[nativeRegisteredFinalizationPermit]:never;
 assertCurrent():void;recheck():Promise<void>;
 commitOriginalRegisteredAssociation():OriginalRegisteredFinalizationOutcomeDATAV4;
 readOriginalOutcomeDATA():OriginalRegisteredFinalizationOutcomeDATAV4;
 retire():void;join():void|Promise<void>;close():void|Promise<void>;
}
export interface OriginalRegisteredFinalizationSourceV4 {
 readonly[nativeRegisteredFinalizationSource]:never;
 readOriginalReviewDATA():OriginalRegisteredFinalizationReviewDATAV4;assertCurrent():void;
 /** Main must supply its actual private lease-bound peer; ordinary DATA is
  * rejected by Native. On throw retain actual .partial before any cleanup. */
 captureOriginalFinalization(originalMainPeer:object):OriginalRegisteredFinalizationPermitV4;
 retire():void;join():void|Promise<void>;close():void|Promise<void>;
 readOriginalStatus():Readonly<Record<string,unknown>>;
}
/** Exact Native result. Keep nonnull owner before interpreting error; only a
 * null error means no acquisition error. Never coerce error by truthiness. */
export function acquireOriginalProductSessionDeviceV4RegisteredFinalizationSource():Readonly<{owner:OriginalRegisteredFinalizationSourceV4|null;error:unknown}>;
