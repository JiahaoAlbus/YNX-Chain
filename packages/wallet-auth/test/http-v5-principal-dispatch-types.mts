import type{ProductSessionGatewayNodeHost,OriginalDeveloperHTTPBinaryRequestV5}from'../src/product-session-gateway-node-host.js';
declare const h:ProductSessionGatewayNodeHost,r:OriginalDeveloperHTTPBinaryRequestV5;
const v=await h.currentExistingDeveloperPrincipalV5(r);const no:false=v.authorized;const version:'YNX-ORIGINAL-DEVELOPER-HTTP-PRINCIPAL/v5'=v.version;void no;void version;await h.recheckExistingDeveloperPrincipalV5(r);
// @ts-expect-error text body cannot enter V5
h.currentExistingDeveloperPrincipalV5({requestId:'x',method:'POST',path:'/api/v1/ide/deployments',body:'x',proofHeader:'x'});
