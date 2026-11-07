import{openOriginalSocialDirectoryResponseLoanV4,type AuthSocialPrincipalResponseLoanV4}from'../../src/original-social-directory-response-loan-private.js';
const l=openOriginalSocialDirectoryResponseLoanV4({}, {},'currentExistingSocialDeviceDirectoryPrincipalV4');
// @ts-expect-error arbitrary Source operation/Developer branch not accepted
openOriginalSocialDirectoryResponseLoanV4({}, {},'currentExistingDeveloperPrincipalV5');
// @ts-expect-error caller Boolean is not W same original bytes
l.releaseAfterOriginalRead(true);
// @ts-expect-error lifecycle notification cannot grant Native
const grant:true=l.statusDATA().NativeAdmission;void grant;
const owner:AuthSocialPrincipalResponseLoanV4={} as AuthSocialPrincipalResponseLoanV4;void owner;
