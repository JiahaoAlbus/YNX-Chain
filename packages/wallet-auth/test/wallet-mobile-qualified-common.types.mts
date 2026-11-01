import type{OriginalAuthSourceV2Profile,OriginalWalletMobileQualifiedSourceV1Selection,OriginalAuthSourceV2Service}from'../native/original-auth-identity-source-v2-verifier.mjs';
import type{MobileScope}from'../native/original-wallet-mobile-qualified-source-contract.mjs';
import{inspectWalletMobileQualifiedSourceIssuanceBodyV1DATA}from'../native/original-auth-identity-source-v2-verifier.mjs';
declare const scope:MobileScope;
const selection:OriginalWalletMobileQualifiedSourceV1Selection={walletMobileQualifiedV1:scope};
const service:OriginalAuthSourceV2Service='wallet-mobile-qualified-source-v1';
// @ts-expect-error mobile selection never requires desktop association
selection.association;
// @ts-expect-error no alternate provider or desktop metadata in exact mobile selection
const bad:OriginalWalletMobileQualifiedSourceV1Selection={walletMobileQualifiedV1:scope,association:{}};
// @ts-expect-error readonly query mode is closed
const badmode:MobileScope={...scope,mode:4};
// @ts-expect-error mobile platform cannot become desktop
const badplatform:MobileScope={...scope,context:{...scope.context,platform:'macos'}};
void[selection,service,inspectWalletMobileQualifiedSourceIssuanceBodyV1DATA];
