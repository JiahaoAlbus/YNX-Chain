/** Original fixed zero-input commissioning. Root/registered source-review pins
 * are still required; empty compiled selection refuses before postprocessing.
 * Source-only output never qualifies a new image or signed postbuild profile. */
export function commissionReviewedRuntimeImageSDK():Promise<Readonly<{status:string;output:string;sourcePackageRoot:string;RootAdmission:false;SourceAdmission:false;NativeAdmission:false;runtimeImageProfile:'POSTBUILD_INDEPENDENT_ROOT_PENDING'}>>;
