import type { createOriginalDeviceRegistrationAllocationFromSeedCanonicalDATA, createOriginalDeviceRegistrationPublicOriginalsDATA } from './original-device-registration-public-originals-private.mjs';
import type{FixedSourceNativeObject}from'./original-auth-source-v2-fixed-core-gates.mjs';
import type{PendingDeviceSourceTypedProjectionDATA}from'./original-device-pending-source-v2-typed-projection.mjs';
import type{OriginalAuthSourceV2CurrentData}from'./original-auth-identity-source-v2-verifier.mjs';
/** Fixed pending-only private realm entry, never a public Source/Root/provider constructor. */
export interface OriginalPendingCollectorWithCreationIdentityDATA { (captureString:string):Readonly<{projection:Readonly<OriginalAuthSourceV2CurrentData>;currentRaw:string;captureSHA256:string;typedProjection:PendingDeviceSourceTypedProjectionDATA;dataOnly:true;RootAdmission:false;SourceAdmission:false;nativeAdmission:false;platformRuntimeVerified:false}>;readonly inspectOriginalDeviceCreationIdentityDATA:(originalIntentString:string)=>Readonly<OriginalDeviceCreationIdentity8DATA>;
  readonly createOriginalDeviceRegistrationPublicOriginalsDATA: typeof createOriginalDeviceRegistrationPublicOriginalsDATA;
  readonly createOriginalDeviceRegistrationAllocationFromSeedCanonicalDATA: typeof createOriginalDeviceRegistrationAllocationFromSeedCanonicalDATA;
}
export default function originalPendingDeviceSourceV2PrivateFactory(actualFixedNativeObject:FixedSourceNativeObject):OriginalPendingCollectorWithCreationIdentityDATA;
/** Private additive historical DATA method. Neither expiry nor this shape is current/Source permission. */
export interface OriginalDeviceCreationIdentity8DATA{readonly identityBinding:Readonly<{networkId:string;canonicalOwner:string;account:string;productId:string;clientId:string;platform:string;applicationId:string;bundleId:string|null;packageId:string|null;origin:string;callback:string;deviceId:string}>;readonly generation:string;readonly stableDeviceIdentity:string;readonly approvedTerms:string;readonly dataOnly:true;readonly userApproved:false;readonly SourceAdmission:false;readonly NativeAdmission:false}
