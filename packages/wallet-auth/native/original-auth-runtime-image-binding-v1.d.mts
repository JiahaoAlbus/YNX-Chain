export type OriginalAuthRuntimeImageBindingPurposeV1='product-session-device-registered-finalization-source-v4'|'product-session-device-http-binary-source-v5';
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
export const ORIGINAL_AUTH_FIXED_LOADER_SHA256:'04d8bd31b1ab26f9902e67bed062e718c4507242210ea142d7c76e2385e7edb4';
export function inspectOriginalAuthRuntimeImageBindingV1DATA(value:unknown,purpose:OriginalAuthRuntimeImageBindingPurposeV1):OriginalAuthRuntimeImageBindingInspectionV1DATA;
