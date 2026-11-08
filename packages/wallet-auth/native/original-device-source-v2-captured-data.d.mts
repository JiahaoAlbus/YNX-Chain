import type {OriginalAuthSourceV2CurrentData,OriginalAuthSourceV2Previous,OriginalPrimaryDeviceV4SourcePolicy} from './original-auth-identity-source-v2-verifier.mjs';
/** Existing policy families only. Android requires a separate SAME-source Root
 * selected exact policy registration; this collector does not enable it. */
export type CapturedDeviceSourcePolicyV2=OriginalPrimaryDeviceV4SourcePolicy|Readonly<{rootDigest:string;enrollmentDigest:string;endpoint:string;spki:string;applicationId:string;productId:string;signatureContract:Readonly<{purpose:'product-session-device-provisioning-source-v4'|'product-session-device-query-source-v4';enrollmentFrame:string;profileFrame:string;currentFrame:string}>;platform?:never}>;
/** Private detached capture DATA. Native must supply independent Root/release
 * context; a matching JS value does not establish captured provenance. */
export interface DeviceSourceCapturedV2DATA {
 readonly input:Readonly<{operation:'auth-source-v2-native-node/v1';node:Readonly<{origin:string;spki:string;nativeChainId:string}>;rootRaw:string;enrollmentRaw:string;profileRaw:string;headRaw:string;policy:CapturedDeviceSourcePolicyV2;previous:OriginalAuthSourceV2Previous}>;
 /** Exact root/profile/current/subject original DTO JSON, in that order. */
 readonly beforeRaw4:readonly[string,string,string,string];
 readonly afterRaw4:readonly[string,string,string,string];
 readonly currentRaw:string;readonly nonce:string;
 readonly baselineAtMs:number;readonly currentAtMs:number;readonly afterAtMs:number;
}
export function collectOriginalDeviceSourceV2CapturedDATA(captureOriginal:string):Readonly<{projection:Readonly<OriginalAuthSourceV2CurrentData>;currentRaw:string;captureSHA256:string;dataOnly:true;RootAdmission:false;SourceAdmission:false;nativeAdmission:false;platformRuntimeVerified:false}>;
