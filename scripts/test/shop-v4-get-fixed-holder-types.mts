import {captureOriginalRegisteredClientReadHolder,createOriginalRegisteredClientGETProof} from '../../packages/wallet-auth/src/original-shop-registered-client-holder-private.js';
const loan=captureOriginalRegisteredClientReadHolder({});
const result=await createOriginalRegisteredClientGETProof(loan,'/PUBLIC/order');
const ms:number=result.issuedAtMs;const iso:string=result.expiresAt;
// @ts-expect-error no fake DTO opaque loan
createOriginalRegisteredClientGETProof({},'/PUBLIC/order');
// @ts-expect-error no external TTL
createOriginalRegisteredClientGETProof(loan,'/PUBLIC/order',30000);
// @ts-expect-error no caller method/body/scopes provider
createOriginalRegisteredClientGETProof(loan,{path:'/PUBLIC/order',method:'POST'});
void ms;void iso;
