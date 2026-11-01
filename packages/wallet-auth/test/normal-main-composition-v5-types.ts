import {bindPublicContentBytes, type PublicContentBinding} from '@ynx-chain/wallet-auth/public-content-binding';
import {inspectOriginalProductDeviceV4PendingReviewDATA,assertOriginalProductDeviceV4PendingReviewBindingDATA,type ProductDeviceV4PendingReviewExpectedDATA} from '@ynx-chain/wallet-auth/original-product-device-v4-pending-review-data';
const b:PublicContentBinding=bindPublicContentBytes(new Uint8Array());
// @ts-expect-error only actual bytes, no expected hash input
bindPublicContentBytes('expected');
declare const actual:Uint8Array;declare const independent:ProductDeviceV4PendingReviewExpectedDATA;
const review=inspectOriginalProductDeviceV4PendingReviewDATA(actual);const checked=assertOriginalProductDeviceV4PendingReviewBindingDATA(review,independent);
const denied:false=checked.authorized;const sourceDenied:false=review.SourceAdmission;
// @ts-expect-error DATA must not become authorization
const approved:true=checked.authorized;
void [b,denied,sourceDenied,approved];
