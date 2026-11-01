import type {ProductDeviceV4PendingReviewDATA} from './original-product-device-v4-pending-review-data.js';
import type {OriginalDeviceV4RegistrationSelectionDATA,OriginalDeviceV4CompletionSelectionDATA,OriginalDeviceV4PairRequestDATA,OriginalDeviceV4PairResponseDATA,OriginalDeviceV4CompletionRequestDATA,OriginalDeviceV4CompletionResponseDATA,OriginalDeviceV4RegistrationAbortContext} from './original-product-device-v4-registration-client.js';
import type {ProductSessionAccountPolicyObservation} from './product-session-account-policy.js';
import type {OriginalRegisteredFinalizationOutcomeDATAV4,OriginalRegisteredFinalizationReviewDATAV4} from './original-product-device-v4-registered-finalization.js';
export type OriginalWalletIDEV4ApprovalInput=Readonly<{approvalOriginal:string;policyRef:ProductSessionAccountPolicyObservation;abortContext:OriginalDeviceV4RegistrationAbortContext}>;
/** Main's actual Native-held peer is recognized by Native, never by a DATA
 * shape, object cast or this declaration. This module neither brands nor clones it. */
export interface OriginalWalletIDEV4HeldSession {
 assertCurrent():Promise<void>;
 readOriginalsDATA():Readonly<{sessionOriginal:string;registrationOriginal:string;dataOnly:true;connected:false;SourceAdmission:false;NativeAdmission:false}>;
 /** Original store/revoke-marker and verified authority clock composition are not supplied by the read lease. */
 createBusinessProof():never;retire():void;close():Promise<void>;
}
export interface OriginalWalletIDEV4Connection {
 reviewPair(selection:OriginalDeviceV4RegistrationSelectionDATA,sameOriginalContext:OriginalDeviceV4RegistrationAbortContext):Promise<ProductDeviceV4PendingReviewDATA>;
 preparePair(selection:OriginalDeviceV4RegistrationSelectionDATA,input:OriginalWalletIDEV4ApprovalInput):Promise<OriginalDeviceV4PairRequestDATA>;
 readPreparedPair():OriginalDeviceV4PairRequestDATA;
 /** Explicit entry only after Main retains original request/outbox state. */
 submitPair(sameOriginalContext:OriginalDeviceV4RegistrationAbortContext):Promise<OriginalDeviceV4PairResponseDATA>;
 reviewCompletion(selection:OriginalDeviceV4CompletionSelectionDATA,sameOriginalContext:OriginalDeviceV4RegistrationAbortContext):Promise<ProductDeviceV4PendingReviewDATA>;
 prepareCompletion(selection:OriginalDeviceV4CompletionSelectionDATA,input:OriginalWalletIDEV4ApprovalInput):Promise<OriginalDeviceV4CompletionRequestDATA>;
 readPreparedCompletion():OriginalDeviceV4CompletionRequestDATA;
 submitCompletion(sameOriginalContext:OriginalDeviceV4RegistrationAbortContext):Promise<OriginalDeviceV4CompletionResponseDATA>;
 reviewFinalization(sameOriginalContext:OriginalDeviceV4RegistrationAbortContext):Promise<OriginalRegisteredFinalizationReviewDATAV4>;
 finalizeOriginalAssociation(actualNativeRecognizedMainPeer:object,sameOriginalContext:OriginalDeviceV4RegistrationAbortContext):Promise<OriginalRegisteredFinalizationOutcomeDATAV4>;
 /** Precise missing normal Native producer; these methods never run legacy code. */
 openSession(sameOriginalContext:OriginalDeviceV4RegistrationAbortContext):Promise<OriginalWalletIDEV4HeldSession>;restore():never;revoke():never;
 retire():void;close():Promise<void>;
 statusDATA():Readonly<{phase:string;retired:boolean;firstCausePresent:boolean;firstCause:unknown;activeOperations:number;pairResponseOriginal:OriginalDeviceV4PairResponseDATA|null;completionResponseOriginal:OriginalDeviceV4CompletionResponseDATA|null;finalizationOutcomeOriginal:OriginalRegisteredFinalizationOutcomeDATAV4|null;pairClientStatusOriginal:Readonly<Record<string,unknown>>|null;completionClientStatusOriginal:Readonly<Record<string,unknown>>|null;cleanupPending:boolean;connected:false;newSession:false;registered:false;RootAdmission:false;SourceAdmission:false;NativeAdmission:false}>;
}
/** Fixed normal imports only; no Source/provider/endpoint/key/dispatcher input. */
export function openOriginalWalletIDEV4Connection():OriginalWalletIDEV4Connection;
