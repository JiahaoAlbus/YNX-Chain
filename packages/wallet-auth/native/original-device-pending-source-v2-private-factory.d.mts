import type{FixedSourceNativeObject}from'./original-auth-source-v2-fixed-core-gates.mjs';
import type{PendingDeviceSourceTypedProjectionDATA}from'./original-device-pending-source-v2-typed-projection.mjs';
import type{OriginalAuthSourceV2CurrentData}from'./original-auth-identity-source-v2-verifier.mjs';
/** Fixed pending-only private realm entry, never a public Source/Root/provider constructor. */
export default function originalPendingDeviceSourceV2PrivateFactory(actualFixedNativeObject:FixedSourceNativeObject):(captureString:string)=>Readonly<{projection:Readonly<OriginalAuthSourceV2CurrentData>;currentRaw:string;captureSHA256:string;typedProjection:PendingDeviceSourceTypedProjectionDATA;dataOnly:true;RootAdmission:false;SourceAdmission:false;nativeAdmission:false;platformRuntimeVerified:false}>;
