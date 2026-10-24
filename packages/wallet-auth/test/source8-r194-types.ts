import type {ProductSessionGatewayNodeHost,OriginalDeveloperHTTPRequest,OriginalDeveloperHTTPCredential,OriginalDeveloperHTTPPrincipalDATA} from '@ynx-chain/wallet-auth/product-session-gateway-node-host';
declare const host:ProductSessionGatewayNodeHost;
declare const request:OriginalDeveloperHTTPRequest;
const credential:Promise<OriginalDeveloperHTTPCredential>=host.authenticateOriginalDeveloperHTTPRequest(request);
const principal:Promise<OriginalDeveloperHTTPPrincipalDATA>=host.currentExistingDeveloperPrincipal(request);
// @ts-expect-error A plain object is not an original Host credential.
const forged:OriginalDeveloperHTTPCredential={};
// @ts-expect-error The original signed request body is required.
host.currentExistingDeveloperPrincipal({requestId:'PUBLIC',method:'POST',path:'/',proofHeader:'PUBLIC'});
async function inspect(){const p=await principal;const a:false=p.authorized,n:false=p.nativeAdmission,d:true=p.dataOnly;return[a,n,d,p.principalOriginal]}
void credential;void forged;void inspect;
