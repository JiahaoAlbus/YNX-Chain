import{planNormalProduct,stageDiagnosticAssets,type SourceRoles,type ComponentRole}from'./normal-product.mjs';
const p=planNormalProduct();const noNative:false=p.NativeLoaded;const noRoot:false=p.RootAdmission;const role:ComponentRole='APPROVED125A_HELPER13';void role;void noNative;void noRoot;
// @ts-expect-error historical public source is not the diagnostic source cohort
const old:SourceRoles['SDKPublic']='795991c5f2877b4abe7b555b34f0b8ffec7eea13';
// @ts-expect-error no Source authority is returned from ordinary staging
const grant:true=stageDiagnosticAssets('/owned').SourceAdmission;
// @ts-expect-error build metadata remains readonly
p.roles.SDKPublic='98956ed2bbac8bb5c86de83c4f1df24314e19bf0';void old;void grant;
