import type {ProductWalletBusinessReadConfiguration} from './product-wallet-connection.js';
import type {ProductSessionBusinessReadClientV4} from './product-session-device-v4.js';
import type {ProductDeviceV4PendingReviewDATA} from './original-product-device-v4-pending-review-data.js';
import type {OriginalDeviceV4RegistrationSelectionDATA,OriginalDeviceV4CompletionSelectionDATA,OriginalDeviceV4PairRequestDATA,OriginalDeviceV4PairResponseDATA,OriginalDeviceV4CompletionRequestDATA,OriginalDeviceV4CompletionResponseDATA,OriginalDeviceV4RegistrationAbortContext} from './original-product-device-v4-registration-client.js';
import type {ProductSessionAccountPolicyObservation} from './product-session-account-policy.js';
import type {OriginalRegisteredFinalizationOutcomeDATAV4,OriginalRegisteredFinalizationReviewDATAV4} from './original-product-device-v4-registered-finalization.js';
export type OriginalWalletIDEV4ApprovalInput=Readonly<{approvalOriginal:string;policyRef:ProductSessionAccountPolicyObservation;abortContext:OriginalDeviceV4RegistrationAbortContext}>;
/** Main's actual Native-held peer is recognized by Native, never by a DATA
 * shape, object cast or this declaration. This module neither brands nor clones it. */
export type OriginalWalletIDEV4BusinessReadConfiguration=Readonly<Pick<ProductWalletBusinessReadConfiguration,'registry'|'productId'|'platform'|'storage'|'gatewayTimeoutMs'>>;
export type OriginalWalletIDEV4PhaseStatus=Readonly<{closed:boolean;cleanupDebt:boolean;cleanupComplete:boolean;firstCausePresent:boolean;firstCause:unknown}>;
export interface OriginalWalletIDEV4BusinessReadOwner {
 createBusinessProof(input:Parameters<ProductSessionBusinessReadClientV4['createBusinessProof']>[0]):ReturnType<ProductSessionBusinessReadClientV4['createBusinessProof']>;
 close():Promise<void>;capabilities:Readonly<{kind:'existing-native-business-read-v4';connected:false;newSession:false;SourceAdmission:false;NativeAdmission:false}>;
}
export interface OriginalWalletIDEV4HeldSession {
 assertCurrent():Promise<void>;
 readOriginalsDATA():Readonly<{sessionOriginal:string;registrationOriginal:string;dataOnly:true;connected:false;SourceAdmission:false;NativeAdmission:false}>;
 /** Call openBusinessRead with actual Main storage/configuration to select the existing normal fixed-time factory. */
 createBusinessProof():never;openBusinessRead(config:OriginalWalletIDEV4BusinessReadConfiguration):Promise<OriginalWalletIDEV4BusinessReadOwner>;retire():void;close():Promise<void>;
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
 /** Independent normal Native session hold; restore/revoke management producers remain unsupplied. */
 openSession(sameOriginalContext:OriginalDeviceV4RegistrationAbortContext):Promise<OriginalWalletIDEV4HeldSession>;restore():never;revoke():never;
 closePairPhase():Promise<void>;closeCompletionPhase():Promise<void>;closeFinalizationPhase():Promise<void>;
 openBusinessRead(config:OriginalWalletIDEV4BusinessReadConfiguration):Promise<OriginalWalletIDEV4BusinessReadOwner>;
 retire():void;close():Promise<void>;
 statusDATA():Readonly<{phase:string;retired:boolean;firstCausePresent:boolean;firstCause:unknown;activeOperations:number;pairResponseOriginal:OriginalDeviceV4PairResponseDATA|null;completionResponseOriginal:OriginalDeviceV4CompletionResponseDATA|null;finalizationOutcomeOriginal:OriginalRegisteredFinalizationOutcomeDATAV4|null;pairPhase:OriginalWalletIDEV4PhaseStatus;completionPhase:OriginalWalletIDEV4PhaseStatus;finalizationPhase:OriginalWalletIDEV4PhaseStatus;heldPhase:OriginalWalletIDEV4PhaseStatus;pairClientStatusOriginal:Readonly<Record<string,unknown>>|null;completionClientStatusOriginal:Readonly<Record<string,unknown>>|null;cleanupPending:boolean;connected:false;newSession:false;registered:false;RootAdmission:false;SourceAdmission:false;NativeAdmission:false}>;
}
/** Fixed normal imports only; no Source/provider/endpoint/key/dispatcher input. */
export function openOriginalWalletIDEV4Connection():OriginalWalletIDEV4Connection;
