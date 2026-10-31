/** Build-time DATA pins. No type here grants load, Source or release admission. */
export interface FixedNativeEdgeFilePin { readonly path:string; readonly bytes:number; readonly sha256:string }
export interface OriginalAuthFixedNativeEdgeInputDATA {
 readonly normalBinding:{readonly normalPackageRoot:string;readonly normalPrivateModuleURI:string};
 readonly runtimeManifest:FixedNativeEdgeFilePin;
 readonly implementingImage:FixedNativeEdgeFilePin;
 readonly independentQualification:{
  readonly purpose:'product-session-device-http-binary-source-v5';
  readonly qualificationOriginal:FixedNativeEdgeFilePin;
  readonly qualifierImage:FixedNativeEdgeFilePin;
 };
}
export interface OriginalAuthFixedNativeEdgeMetadataDATA extends OriginalAuthFixedNativeEdgeInputDATA {
 readonly version:'YNX-ORIGINAL-AUTH-FIXED-NATIVE-EDGE/v1';
 readonly purpose:'product-session-device-http-binary-source-v5';
 readonly loader:FixedNativeEdgeFilePin & {readonly specifier:'../../../apps/wallet-desktop/native/original-auth-identity.node'};
}
export interface OriginalAuthFixedNativeEdgeResultDATA {
 readonly metadataOriginal:string;readonly metadata:OriginalAuthFixedNativeEdgeMetadataDATA;readonly metadataSHA256:string;
 readonly dataOnly:true;readonly signatureVerified:false;readonly SourceAdmission:false;readonly NativeAdmission:false;
 readonly preLoadQualified:false;readonly sameModuleInstanceVerified:false;readonly runtimeClosureComplete:false;
}
export const FIXED_NATIVE_EDGE_VERSION:'YNX-ORIGINAL-AUTH-FIXED-NATIVE-EDGE/v1';
export const FIXED_NATIVE_LOADER_PATH:'src/original-auth-identity-fixed-native-image.js';
export const FIXED_NATIVE_LOADER_SHA256:'04d8bd31b1ab26f9902e67bed062e718c4507242210ea142d7c76e2385e7edb4';
export const FIXED_NATIVE_SPECIFIER:'../../../apps/wallet-desktop/native/original-auth-identity.node';
export function inspectOriginalAuthFixedNativeLoaderDATA(packageRoot:string):Readonly<{loader:FixedNativeEdgeFilePin;specifier:typeof FIXED_NATIVE_SPECIFIER;implementingImagePath:string;dataOnly:true;SourceAdmission:false;NativeAdmission:false}>;
export function generateOriginalAuthFixedNativeEdgeMetadataDATA(packageRoot:string,input:OriginalAuthFixedNativeEdgeInputDATA):OriginalAuthFixedNativeEdgeResultDATA;
export function validateOriginalAuthFixedNativeEdgeMetadataDATA(packageRoot:string,original:string,input:OriginalAuthFixedNativeEdgeInputDATA):OriginalAuthFixedNativeEdgeResultDATA;
