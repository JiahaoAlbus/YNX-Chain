import{inspectOriginalAuthRuntimeImageBindingV1DATA,verifyOriginalAuthSourceRuntimeImageBindingCurrentV1DATA as verify,type OriginalAuthRuntimeImageCurrentPolicyV1}from'../native/original-auth-runtime-image-current-v1.mjs';
import type{OriginalAuthRuntimeImageBindingV1}from'../native/original-auth-runtime-image-binding-v1.mjs';
declare const facts:OriginalAuthRuntimeImageBindingV1;
declare const args:Parameters<typeof verify>;
const current=verify(...args);const data:true=current.dataOnly;const noAdmission:false=current.NativeAdmission;
const parsed=inspectOriginalAuthRuntimeImageBindingV1DATA(facts,'product-session-device-http-binary-source-v5');
// @ts-expect-error DATA does not admit image
const admitted:true=current.preLoadQualified;
// @ts-expect-error independent actual facts mandatory
verify(args[0],args[1],args[2],args[3],args[4],args[5],args[6],args[7],args[8]);
// @ts-expect-error old GET purpose cannot gain image qualification
inspectOriginalAuthRuntimeImageBindingV1DATA(facts,'product-session-device-source-v4');
// @ts-expect-error closed version
const wrong:OriginalAuthRuntimeImageBindingV1={...facts,version:'2'};
void [data,noAdmission,parsed,admitted,wrong];
