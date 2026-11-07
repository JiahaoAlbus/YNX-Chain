export type OriginalAuthRuntimeImageBindingPurposeV1='product-session-device-registered-finalization-source-v4'|'product-session-device-http-binary-source-v5'|'wallet-native-product-source-v1';
export interface OriginalAuthRuntimeImageFilePinV1 {readonly path:string;readonly bytes:number;readonly sha256:string}
/** Postbuild facts only; no profile/qualification original or self hash. */
export interface OriginalAuthRuntimeImageBindingV1 {
 readonly version:'1';readonly normalPackageRoot:string;
 readonly fixedLoader:OriginalAuthRuntimeImageFilePinV1;
 readonly runtimeManifest:OriginalAuthRuntimeImageFilePinV1;
 readonly implementingImage:OriginalAuthRuntimeImageFilePinV1;
 readonly privateModule:OriginalAuthRuntimeImageFilePinV1&{readonly uri:string};
}
export interface OriginalAuthRuntimeImageBindingInspectionV1DATA {
 readonly runtimeImageBindingV1:OriginalAuthRuntimeImageBindingV1;
 readonly dataOnly:true;readonly SourceAdmission:false;readonly NativeAdmission:false;
 readonly preLoadQualified:false;readonly sameModuleInstanceVerified:false;
}
export const ORIGINAL_AUTH_RUNTIME_IMAGE_BINDING_V1_PURPOSES:readonly OriginalAuthRuntimeImageBindingPurposeV1[];
export const ORIGINAL_AUTH_FIXED_LOADER_SHA256:"3f57e2056d331fba2a15d5d1c5278b7585760881c0e70c9968938f65772844df";
export function inspectOriginalAuthRuntimeImageBindingV1DATA(value:unknown,purpose:OriginalAuthRuntimeImageBindingPurposeV1):OriginalAuthRuntimeImageBindingInspectionV1DATA;
