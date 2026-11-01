import type{ManagementScope}from'./management-source-contract.mjs';
export interface OwnedOutcome<T>{owner:T|null;errorPresent:boolean;error?:unknown}
export interface OriginalCurrent4{rootOriginal:Uint8Array;enrollmentOriginal:Uint8Array;profileOriginal:Uint8Array;currentOriginal:Uint8Array}
export interface OriginalManagement7{request:Uint8Array;registration:Uint8Array;body:Uint8Array;session:Uint8Array|null;approval:Uint8Array|null;challenge:Uint8Array|null;targetOperation:Uint8Array|null}
export interface RegisteredVerification4{networkId:string;pkA:Uint8Array;pkB:Uint8Array;registrationOriginal:Uint8Array}
export interface DeviceManagementLease6{networkId:string;account:string;sessionBinding:string;registrationId:string;registrationDigest:string;mode:'registered-session'|'completion-query-original'}
export interface OriginalDeviceManagementLease{readOriginal():Readonly<DeviceManagementLease6>;assertCurrent():void;recheck():Promise<void>;retire():void}
export interface ReviewBinding14{version:'4';reviewId:string;networkId:string;canonicalOwner:string;operation:'session.active'|'session.revoke'|'challenge.cancel'|'completion.recover';operationId:string|null;challengeId:string|null;method:'POST';path:string;bodyDigest:string;requestDigest:string;nonce:string;issuedAt:string;expiresAt:string}
export interface ManagementAbortContext{readonly signal:AbortSignal}
export interface OriginalManagementReview{
 readOriginalUnsigned():string;
 readOriginalBody():Uint8Array;
 readOriginalSourceCurrentOriginals():OriginalCurrent4;
 readOriginalSourceSummaryDATA():Readonly<{sourceId:string;instanceId:string;scope:ManagementScope}>;
 readOriginalBindingDATA():Readonly<ReviewBinding14>;
 readOriginalManagementLease():OriginalDeviceManagementLease;
 assertOriginalContext(sameContext:ManagementAbortContext):void;
 assertCurrent():void;recheck():Promise<void>;retire():void;join():Promise<void>;close():Promise<void>;
}
export interface OriginalManagementProof{
 readOriginalUnsigned():string;readOriginalMember():Uint8Array;readOriginalBody():Uint8Array;
 readOriginalOutcomeDATA():Readonly<{result:number;cleanup:number;reportedLength:string;mathCompleted:boolean;usableHTTP:false;businessCommitted:false}>;
 assertCurrent():void;recheck():Promise<void>;retire():void;join():Promise<void>;close():Promise<void>;
}
export interface OriginalManagementSource{
 readOriginalScopeDATA():ManagementScope;
 readOriginalSourceCurrentOriginals():OriginalCurrent4;
 readOriginalManagementOriginals():OriginalManagement7;
 readOriginalManagementRegistry():Uint8Array;
 readOriginalManagementVerificationDATA():RegisteredVerification4;
 assertCurrent():void;recheck():Promise<void>;
 prepareOriginalDeviceV4ManagementReview(sameFrozenContext:ManagementAbortContext):OwnedOutcome<OriginalManagementReview>;
 produceOriginalDeviceV4ManagementProof(sameReview:OriginalManagementReview,sameFrozenContext:ManagementAbortContext):Promise<OwnedOutcome<OriginalManagementProof>>;
 retire():void;join():Promise<void>;close():Promise<void>;
}
/** Direct Native owner; failure throws Error with nonenumerable SAME .partial. No arguments. */
export function acquireOriginalProductSessionDeviceV4ManagementSource():OriginalManagementSource;
export function isOriginalProductSessionDeviceV4ManagementSource(value:unknown):value is OriginalManagementSource;
export function isOriginalProductSessionDeviceV4ManagementReview(value:unknown):value is OriginalManagementReview;
export function isOriginalProductSessionDeviceV4ManagementLease(value:unknown):value is OriginalDeviceManagementLease;
