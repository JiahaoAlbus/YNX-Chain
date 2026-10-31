import type{OriginalDeviceIdentityInputDATA}from'./original-device-create-intent.js';
import type{ProductDeviceV4PendingReviewDATA}from'./original-product-device-v4-pending-review-data.js';
import type{ProductSessionAccountPolicyObservation}from'./product-session-account-policy.js';
import type{ProductSessionDeviceChallengeV4}from'./product-session-pq-v4-codec.js';
declare const originalPairPacket:unique symbol;
export interface OriginalDeviceV4PairPacket {readonly [originalPairPacket]:never}
export interface OriginalDeviceV4RegistrationSelectionDATA {
 readonly identityBinding:OriginalDeviceIdentityInputDATA;
 readonly generation:string;
 readonly publicPair:Readonly<{pkA:Uint8Array;pkB:Uint8Array}>;
}
export type OriginalDeviceV4RegistrationAbortContext=Readonly<{signal:AbortSignal}>;
export interface OriginalDeviceV4PairRequestDATA {
 readonly operationId:string;readonly originalBody:string;readonly requestDigest:string;readonly registrationOriginal:string;
 readonly dataOnly:true;readonly registered:false;readonly SourceAdmission:false;readonly NativeAdmission:false;
}
export interface OriginalDeviceV4PairResponseDATA {
 readonly operationId:string;readonly responseOriginal:string;readonly registrationOriginal:string;readonly challenge:ProductSessionDeviceChallengeV4;
 readonly dataOnly:true;readonly operationVerified:false;readonly registered:false;readonly connected:false;readonly newSession:false;readonly SourceAdmission:false;readonly NativeAdmission:false;
}
export interface OriginalDeviceV4RegistrationClient {
 readOriginalRegistrationReviewDATA(independentSelection:OriginalDeviceV4RegistrationSelectionDATA):ProductDeviceV4PendingReviewDATA;
 prepareOriginalPairSubmission(input:Readonly<{approvalOriginal:string;policyRef:ProductSessionAccountPolicyObservation;abortContext:OriginalDeviceV4RegistrationAbortContext}>):Promise<OriginalDeviceV4PairPacket>;
 /** Main persists this original whole body and its original effect-entry marker
  * in its existing protected outbox before submitPreparedPair. This DATA read
  * cannot attest the caller's storage or authorize replay after a restart. */
 readOriginalPairRequestDATA(originalPacket:OriginalDeviceV4PairPacket):OriginalDeviceV4PairRequestDATA;
 submitPreparedPair(originalPacket:OriginalDeviceV4PairPacket,sameOriginalContext:OriginalDeviceV4RegistrationAbortContext):Promise<OriginalDeviceV4PairResponseDATA>;
 readStatusDATA():Readonly<{proofSelected:boolean;originalMemberRetained:boolean;httpEntered:boolean;originalResponseRetained:boolean;originalResponse:unknown;firstCausePresent:boolean;firstCause:unknown;registered:false;newSession:false;SourceAdmission:false;NativeAdmission:false}>;
 close():Promise<void>;
}
/** Fixed same-image Native pending Source and fixed Auth origin. No account
 * approval, endpoint, key, signer or provider can be supplied here. */
export function openOriginalProductDeviceV4RegistrationClient():Promise<OriginalDeviceV4RegistrationClient>;
