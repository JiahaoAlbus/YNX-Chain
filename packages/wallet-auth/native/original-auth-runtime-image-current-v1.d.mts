import type{PQAuthorizationSnapshot}from'../src/pq-wallet-policy.js';
import type{OriginalAuthRuntimeImageBindingV1,OriginalAuthRuntimeImageBindingPurposeV1}from'./original-auth-runtime-image-binding-v1.mjs';
export{inspectOriginalAuthRuntimeImageBindingV1DATA}from'./original-auth-runtime-image-binding-v1.mjs';
export interface OriginalAuthRuntimeImageCurrentPolicyV1 {
 readonly rootDigest:string;readonly enrollmentDigest:string;readonly endpoint:string;readonly spki:string;
 readonly applicationId:string;readonly productId:string;
 readonly signatureContract:{readonly purpose:OriginalAuthRuntimeImageBindingPurposeV1;readonly enrollmentFrame:string;readonly profileFrame:string;readonly currentFrame:string};
}
export interface OriginalAuthRuntimeImageCurrentV1DATA {
 readonly runtimeImageBindingV1DATA:OriginalAuthRuntimeImageBindingV1;
 readonly profileDigest:string;readonly currentDigest:string;readonly sourceId:string;readonly instanceId:string;
 readonly generation:number;readonly sequence:number;readonly expiresAtMs:number;
 readonly dataOnly:true;readonly SourceAdmission:false;readonly NativeAdmission:false;readonly preLoadQualified:false;readonly sameModuleInstanceVerified:false;
}
/** Requires original authenticated snapshots; this function verifies mathematics
 * and independent expected facts, never their protected Source provenance. */
export function verifyOriginalAuthSourceRuntimeImageBindingCurrentV1DATA(rootRaw:string,enrollmentRaw:string,profileRaw:string,currentRaw:string,policy:OriginalAuthRuntimeImageCurrentPolicyV1,registrations:Readonly<{root:PQAuthorizationSnapshot;profile:PQAuthorizationSnapshot;current:PQAuthorizationSnapshot;subject:PQAuthorizationSnapshot}>,expectedNonce:string,previous:Readonly<{sequence:number;floor:number;head:string;timeFloor:number;executionHeight:string}>,atMs:number,expectedRuntimeImageBindingV1:OriginalAuthRuntimeImageBindingV1):OriginalAuthRuntimeImageCurrentV1DATA;
