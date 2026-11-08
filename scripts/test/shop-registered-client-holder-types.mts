import {captureOriginalRegisteredClientReadHolder,type OriginalRegisteredClientReadHolder} from '../../packages/wallet-auth/src/original-shop-registered-client-holder-private.js';
const loan=captureOriginalRegisteredClientReadHolder({});
loan.assertCurrent();loan.release();
loan.createBusinessProof({method:'GET',path:'/PUBLIC',body:'',requiredScopes:[]});
// @ts-expect-error no POST authorization
loan.createBusinessProof({method:'POST',path:'/PUBLIC',body:'',requiredScopes:[]});
// @ts-expect-error empty object has no private holder brand
const fake:OriginalRegisteredClientReadHolder={};
// @ts-expect-error read-only capability cannot become Native admission
const native:true=loan.statusDATA().NativeAdmission;
// @ts-expect-error no arbitrary signer/provider method
loan.sign(new Uint8Array());
void fake;void native;
