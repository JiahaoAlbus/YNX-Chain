import {type MobileScope,type IndependentMobileSelection,inspectWalletMobileQualifiedSourceScopeV1DATA,captureWalletMobileQualifiedOriginalsV1DATA,inspectWalletMobileQualifiedPhaseV1DATA,type RawOriginals} from '../native/original-wallet-mobile-qualified-source-contract.mjs';
declare const scope:MobileScope;declare const independent:IndependentMobileSelection;declare const originals:RawOriginals;
const s=captureWalletMobileQualifiedOriginalsV1DATA(scope,independent,originals,1);const refused:false=s.SourceAdmission;inspectWalletMobileQualifiedSourceScopeV1DATA(scope);inspectWalletMobileQualifiedPhaseV1DATA(s,5,1,false);
// @ts-expect-error no mode4
inspectWalletMobileQualifiedSourceScopeV1DATA({...scope,mode:4});
// @ts-expect-error no macos branding
inspectWalletMobileQualifiedSourceScopeV1DATA({...scope,context:{...scope.context,platform:'macos'}});
// @ts-expect-error lossless u64 is not number
inspectWalletMobileQualifiedSourceScopeV1DATA({...scope,context:{...scope.context,vaultRevision:9007199254740992}});
// @ts-expect-error phase6 not supplied
inspectWalletMobileQualifiedPhaseV1DATA(s,6,0,false);
// @ts-expect-error no public approval boolean
captureWalletMobileQualifiedOriginalsV1DATA(scope,{...independent,approved:true},originals,1);
// @ts-expect-error DATA never admission
const grant:true=s.SourceAdmission;
