import{collectSocialFiniteJointProviderNormalInputsDATA}from'../../scripts/social-finite-joint-provider-inputs.mjs';const x=collectSocialFiniteJointProviderNormalInputsDATA();const matched:true=x.MainPairClient.finiteCrateMatched;const size:112=x.MainPairClient.sourceBytes;const status:24=x.MainPairClient.statusBytes;const none:null=x.MainPairClient.blocker;void[matched,size,status,none];
// @ts-expect-error same crate source is not Native admission
const grant:true=x.NativeAdmission;
// @ts-expect-error fixed build-time source getter does not accept an owner
collectSocialFiniteJointProviderNormalInputsDATA({owner:{}});void grant;
