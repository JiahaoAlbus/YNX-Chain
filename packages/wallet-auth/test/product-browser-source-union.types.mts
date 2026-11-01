import type{OriginalAuthSourceV2Service,OriginalAuthSourceV2Operations}from'../native/original-auth-identity-source-v2-verifier.mjs';
import{WALLET_NATIVE_PRODUCT_SOURCE_PURPOSE,WALLET_NATIVE_PRODUCT_OPERATIONS}from'../native/original-wallet-product-source-contract.mjs';
import type{WalletProductSourceScopeV1}from'../native/original-wallet-product-source-contract.mjs';
import{BROWSER_SELECTED_PAGES_SOURCE_PURPOSE,BROWSER_SELECTED_PAGES_SOURCE_OPERATIONS}from'../native/original-browser-selected-pages-source-contract.mjs';
import type{BrowserSelectedPagesScopeV1,BrowserSelectedPagesDATAOnly}from'../native/original-browser-selected-pages-source-contract.mjs';
const product:OriginalAuthSourceV2Service=WALLET_NATIVE_PRODUCT_SOURCE_PURPOSE;
const browser:OriginalAuthSourceV2Service=BROWSER_SELECTED_PAGES_SOURCE_PURPOSE;
const opsProduct:OriginalAuthSourceV2Operations=WALLET_NATIVE_PRODUCT_OPERATIONS;
const opsBrowser:OriginalAuthSourceV2Operations=BROWSER_SELECTED_PAGES_SOURCE_OPERATIONS;
declare const scope:BrowserSelectedPagesScopeV1,data:BrowserSelectedPagesDATAOnly;
// @ts-expect-error independent Browser scope cannot become ProductScope.
const exchanged:WalletProductSourceScopeV1=scope;
const archiveOps:OriginalAuthSourceV2Operations=['readOriginalArchiveReceipt'];
// @ts-expect-error no universal family or Root capability is introduced.
const anyFamily:OriginalAuthSourceV2Service='any-root-source';
// @ts-expect-error successful comparison is never a Source grant.
const permit:{authorized:true}=data;
void[product,browser,opsProduct,opsBrowser,exchanged,archiveOps,anyFamily,permit];
