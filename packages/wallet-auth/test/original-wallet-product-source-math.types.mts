import {inspectOriginalWalletProductScopeV1DATA,WALLET_NATIVE_PRODUCT_OPERATIONS,type WalletProductSourceScopeV1,type OriginalWalletProductSourceV1Policy} from '../src/original-wallet-product-source-data.js';
const scope:WalletProductSourceScopeV1={version:1,networkId:'a'.repeat(64),account:'0x'+'1'.repeat(40),protectedResourceRef:'PUBLIC-ref',operations:WALLET_NATIVE_PRODUCT_OPERATIONS,products:[{productId:'shop.order',sourceOrder:'PUBLIC-original'}]};
const d=inspectOriginalWalletProductScopeV1DATA(scope,scope.networkId,scope.account,0,20000,10000);
const no:false=d.SourceAdmission;const original:string=d.scopeOriginal;
// @ts-expect-error old WPC sends are not Product operation capability
const bad:WalletProductSourceScopeV1={...scope,operations:['post_terms']};
// @ts-expect-error unregistered product cannot be silently widened
const other:WalletProductSourceScopeV1={...scope,products:[{productId:'wallet',sourceOrder:'PUBLIC'}]};
// @ts-expect-error policy platform has no mobile or implicit default
const policy:OriginalWalletProductSourceV1Policy={rootDigest:'',enrollmentDigest:'',endpoint:'https://wallet-auth.ynxweb4.com/v1/auth-identity/source-current',spki:'',applicationId:'com.public.wallet',productId:'wallet',platform:'ios',signatureContract:{purpose:'wallet-native-product-source-v1',enrollmentFrame:'E',profileFrame:'P',currentFrame:'C'}};
void [no,original,bad,other,policy];
