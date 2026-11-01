import{commissionReviewedRuntimeImageSDK}from'../scripts/runtime-image-commissioning/commission-sdk.mjs';
const result=await commissionReviewedRuntimeImageSDK();const no:false=result.RootAdmission;
// @ts-expect-error compiled original selector does not accept caller input
commissionReviewedRuntimeImageSDK({approved:true});
// @ts-expect-error source-only result cannot qualify a Native image
const admitted:true=result.NativeAdmission;
void no;
import{materializeReviewedSDKSourceDATA,type ReviewedSDKMaterializationInputDATA}from'../scripts/reviewed-sdk-source-materialization/core.mjs';
declare const build:ReviewedSDKMaterializationInputDATA;
const output=materializeReviewedSDKSourceDATA(build);const root:false=output.RootAdmission;
// @ts-expect-error internal build DATA still cannot be a runtime source owner
const owner:true=output.SourceAdmission;
// @ts-expect-error a source-build identity is not an approval/fake provider
const fake:ReviewedSDKMaterializationInputDATA={approved:true};
void[root,fake];
