import{inspectOriginalProductDeviceV4IssuanceBodyDATA,verifyOriginalAuthSourceProfileV2,verifyOriginalAuthSourceCurrentV2}from'../native/original-auth-identity-source-v2-verifier.mjs';
import type{OriginalAuthSourceV2Policy,OriginalAuthSourceV2Registrations,OriginalAuthSourceV2Previous}from'../native/original-auth-identity-source-v2-verifier.mjs';
declare const rootRaw:string,enrollmentRaw:string,profileRaw:string,currentRaw:string,policy:OriginalAuthSourceV2Policy,registrations:OriginalAuthSourceV2Registrations,previous:OriginalAuthSourceV2Previous,nonce:string,at:number;
for(const purpose of ['product-session-device-registered-finalization-source-v4','product-session-device-http-binary-source-v5']as const){const selected:OriginalAuthSourceV2Policy={...policy,productId:'developer',applicationId:'com.ynxweb4.developer.testnetpreview',signatureContract:{...policy.signatureContract,purpose}};const pre=inspectOriginalProductDeviceV4IssuanceBodyDATA('profile',rootRaw,enrollmentRaw,profileRaw,selected,registrations,at),profile=verifyOriginalAuthSourceProfileV2(rootRaw,enrollmentRaw,profileRaw,selected,registrations,at),current=verifyOriginalAuthSourceCurrentV2(rootRaw,enrollmentRaw,profileRaw,currentRaw,selected,registrations,nonce,previous,at);const dataOnly:true=pre.dataOnly;const noNative:false=current.nativeAdmission;void[dataOnly,noNative,profile];
// @ts-expect-error DATA verifier never becomes Native admission.
const admitted:true=current.nativeAdmission;void admitted;
}
// @ts-expect-error Pre-issuer role cannot be an effect/device operation.
inspectOriginalProductDeviceV4IssuanceBodyDATA('device.registered-finalize',rootRaw,enrollmentRaw,profileRaw,policy,registrations,at);
// @ts-expect-error Root/current independent registration map cannot be approved DTO.
verifyOriginalAuthSourceProfileV2(rootRaw,enrollmentRaw,profileRaw,policy,{registered:true},at);
