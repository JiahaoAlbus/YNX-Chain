import {captureOriginalRegisteredClientReadHolderForProductSource,readOriginalRegisteredClientSourceReferenceDATA,createOriginalRegisteredClientGETProof} from '../../packages/wallet-auth/src/original-shop-registered-client-holder-private.js';
import {inspectOriginalWalletProductScopeShapeV1DATA,type WalletProductSourceScopeV1} from '../../packages/wallet-auth/native/original-wallet-product-source-contract.mjs';
declare const scope:WalletProductSourceScopeV1;
const loan=captureOriginalRegisteredClientReadHolderForProductSource({},scope),ref=readOriginalRegisteredClientSourceReferenceDATA(loan);
const generation:number=ref.generation;const native:unknown=loan.readOriginalNativeDeviceSource();
createOriginalRegisteredClientGETProof(loan,'/v5/shop/source/shop.order/invoice-intents/PUBLIC-order');
// @ts-expect-error Source generation is not device-generation decimal text
const wrongGeneration:string=ref.generation;
// @ts-expect-error readonly namespace DATA
ref.sourceId='changed';
// @ts-expect-error no generic proof-provider input on the scoped holder
loan.createBusinessProof({method:'POST',path:'/elsewhere'});
// @ts-expect-error fixed getter accepts no Source/namespace/provider argument
loan.readOriginalNativeDeviceSource({});
// @ts-expect-error opaque native reference gives no public signing method
native.produceHTTPProof({});
const shape=inspectOriginalWalletProductScopeShapeV1DATA(scope,scope.networkId,scope.account);
// @ts-expect-error pure shape does not supply a time or effect window
shape.effectExpiresAtMs;
void generation;void wrongGeneration;
