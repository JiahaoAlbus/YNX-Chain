import{commissionReviewedPairServiceSDK}from'@ynx-chain/wallet-auth/pair-service-commissioning';
const result=commissionReviewedPairServiceSDK();const noRoot:false=result.RootAdmission;
// @ts-expect-error no caller supplied approval/provider/rows
commissionReviewedPairServiceSDK({approved:true});
// @ts-expect-error postprocess is no Native admission
const active:true=result.NativeAdmission;
void [noRoot,active];
