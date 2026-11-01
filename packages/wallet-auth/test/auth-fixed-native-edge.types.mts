import {generateOriginalAuthFixedNativeEdgeMetadataDATA, type OriginalAuthFixedNativeEdgeInputDATA} from '../scripts/auth-fixed-native-edge.mjs';
declare const input:OriginalAuthFixedNativeEdgeInputDATA;
const result=generateOriginalAuthFixedNativeEdgeMetadataDATA('/independently-selected/normal/packages/wallet-auth',input);
const data:true=result.dataOnly;
const closed:false=result.runtimeClosureComplete;
const instance:false=result.sameModuleInstanceVerified;
// @ts-expect-error DATA never grants Native admission
const admitted:true=result.NativeAdmission;
// @ts-expect-error normal namespace and qualification are mandatory
const missing:OriginalAuthFixedNativeEdgeInputDATA={runtimeManifest:input.runtimeManifest,implementingImage:input.implementingImage};
void [data,closed,instance,admitted,missing];
