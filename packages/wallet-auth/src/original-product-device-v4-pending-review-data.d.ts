import type{ProductSessionRequestV4,ProductSessionAccountAuthorization,ProductSessionPlatform}from'./index.js';
import type{ProductSessionDeviceRegistrationV4}from'./product-session-device-registration-v4.js';
export interface ProductDeviceV4PendingReviewExpectedDATA {
 readonly networkId:string;readonly canonicalOwner:string;readonly account:string;
 readonly productId:string;readonly clientId:string;readonly platform:ProductSessionPlatform;readonly applicationId:string;
 readonly bundleId:string|null;readonly packageId:string|null;readonly origin:string;readonly callback:string;
 readonly deviceId:string;readonly generation:string;readonly registrationId:string;readonly revision:string;readonly registrationDigest:string;
}
export interface ProductDeviceV4PendingReviewScopeDATA {
 readonly version:'4';readonly operation:'registration-pop'|'challenge-completion';readonly pendingId:string;
 readonly expected:ProductDeviceV4PendingReviewExpectedDATA;readonly registrationOriginal:string;readonly requestOriginal:string;
 readonly approvalDigest:string;readonly challengeOriginal:string|null;
}
export type ProductDeviceV4PendingChallengeDATA=Readonly<Omit<ProductSessionRequestV4,'purpose'>&{
 account:string;accountAuthorization:ProductSessionAccountAuthorization;challenge:string;
 requestDigest:string;approvalDigest:string;sessionExpiresAt:string;
}>;
export interface ProductDeviceV4PendingReviewDATA {
 readonly scope:ProductDeviceV4PendingReviewScopeDATA;readonly record:Readonly<ProductSessionDeviceRegistrationV4>;
 readonly request:ProductSessionRequestV4;readonly challenge:ProductDeviceV4PendingChallengeDATA|null;readonly requestDigest:string;
 /** Intersection of original record/request/challenge windows, never the
  * current clock, a Source/profile validity period or an account approval. */
 readonly originalWindow:Readonly<{beginsAt:string;expiresAt:string;dataOnly:true;current:false}>;
 readonly timeBasis:'original-issued-at-data-only';readonly dataOnly:true;readonly approvedAccount:false;readonly authorized:false;
 readonly current:false;readonly registered:false;readonly SourceAdmission:false;readonly NativeAdmission:false;
}
export declare const PRODUCT_DEVICE_V4_PENDING_REVIEW_EXPECTED_FIELDS:readonly string[];
/** Pure DATA decoding and cross-binding only. No current time/profile/Source,
 * Native acquisition, account approval, network, signing or storage I/O. */
export declare function inspectOriginalProductDeviceV4PendingReviewDATA(originalBytes:Uint8Array):ProductDeviceV4PendingReviewDATA;
/** Only accepts a result of this module's immutable DATA inspector. The
 * expected16 must come from independent selection, never review self-fill. */
export declare function assertOriginalProductDeviceV4PendingReviewBindingDATA(review:ProductDeviceV4PendingReviewDATA,expected16:ProductDeviceV4PendingReviewExpectedDATA):Readonly<{bindingMatches:true;dataOnly:true;approvedAccount:false;authorized:false;current:false;registered:false;SourceAdmission:false;NativeAdmission:false}>;
