import type{FixedSourceNativeObject}from'./original-auth-source-v2-fixed-core-gates.mjs';
import type{DeviceSourceTypedProjectionDATA}from'./original-device-source-v2-typed-projection.mjs';
import type{OriginalAuthSourceV2CurrentData}from'./original-auth-identity-source-v2-verifier.mjs';
/** Fixed private realm factory, not a public Native installer/provider. */
export default function originalDeviceSourceV2PrivateFactory(actualFixedNativeObject:FixedSourceNativeObject):(captureString:string)=>Readonly<{projection:Readonly<OriginalAuthSourceV2CurrentData>;currentRaw:string;captureSHA256:string;typedProjection:DeviceSourceTypedProjectionDATA;dataOnly:true;RootAdmission:false;SourceAdmission:false;nativeAdmission:false;platformRuntimeVerified:false}>;
