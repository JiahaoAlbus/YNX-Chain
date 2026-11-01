import type {ProductSessionRequestV4} from '../src/index.js';
import {
 prepareProductSessionApprovalV4Data, verifyProductSessionApprovalV4Data,
 PRODUCT_SESSION_DEVICE_CHALLENGE_DOMAIN_V4, PRODUCT_SESSION_DEVICE_REGISTRATION_DOMAIN_V4,
 type ProductSessionApprovalUnsignedV4,type ProductSessionApprovalV4,
 type ProductSessionDeviceChallengeV4,type ProductSessionDeviceCompletionV4,
 type PreparedProductSessionApprovalV4Data,
} from '../src/product-session-pq-v4-codec.js';
import type {OriginalProductSessionDeviceProofOperationV4} from '../src/product-session-device-v4.js';
declare const prepared:ReturnType<typeof prepareProductSessionApprovalV4Data>;
declare const verified:ReturnType<typeof verifyProductSessionApprovalV4Data>;
const checked:PreparedProductSessionApprovalV4Data=prepared;
const unsigned:ProductSessionApprovalUnsignedV4=prepared.unsigned;
const approval:ProductSessionApprovalV4=verified.approval;
const key:string=approval.accountAuthorization.pkA;
const noNative:false=prepared.NativeAdmission;
const noApproval:false=prepared.approval;
const purpose:'PRODUCT-SESSION-APPROVAL'=prepared.purpose;
const regDomain:'YNX-PRODUCT-SESSION-DEVICE-REGISTRATION/v4'=PRODUCT_SESSION_DEVICE_REGISTRATION_DOMAIN_V4;
const challengeDomain:'YNX-PRODUCT-SESSION-DEVICE-CHALLENGE/v4'=PRODUCT_SESSION_DEVICE_CHALLENGE_DOMAIN_V4;
declare const challenge:ProductSessionDeviceChallengeV4;
const completion:ProductSessionDeviceCompletionV4={challenge,deviceMember:'original-wire'};
const revision:string=completion.challenge.deviceRegistrationRevision;
// @ts-expect-error DATA is not a live original Native operation.
const native:OriginalProductSessionDeviceProofOperationV4=completion;
// @ts-expect-error An unsigned approval does not have an account AND proof.
const signed:ProductSessionApprovalV4=unsigned;
// @ts-expect-error The signing data has no caller-selected request purpose.
unsigned.purpose;
// @ts-expect-error A challenge is not a new session or a request with a purpose.
const request:ProductSessionRequestV4=challenge;
// @ts-expect-error Original approval data cannot be mutated to change a binding.
approval.deviceRegistrationDigest='changed';
// @ts-expect-error Completion requires its same original challenge.
const missing:ProductSessionDeviceCompletionV4={deviceMember:'wire'};
// @ts-expect-error Literal domains cannot be interchanged.
const foreign:typeof regDomain=challengeDomain;
void [checked,key,noNative,noApproval,purpose,regDomain,challengeDomain,revision,native,signed,request,missing,foreign];
