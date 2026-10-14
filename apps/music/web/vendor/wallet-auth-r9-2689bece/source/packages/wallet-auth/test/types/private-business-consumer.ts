import {parsePrivateBusinessRegistrations,type PrivateBusinessRegistration} from '../../src/index.js';
import {ProductSessionGatewayNodeHost,type ProductSessionGatewayNodeHostOptions} from '../../src/product-session-gateway-node-host.js';
const registrations:readonly PrivateBusinessRegistration[]=[{productId:'music',platform:'android',keyId:'qa',allowedScopes:['music.library']}];
const binding=parsePrivateBusinessRegistrations({},registrations)[0];
const role:string=binding.backendClientId;
const options:ProductSessionGatewayNodeHostOptions={now:()=>new Date(),statePath:'/protected/state',tokenFactory:()=>'',centralBrowser:true,privateBusinessRevalidation:true,privateBackendRegistrations:registrations,centralBackend:{backendClients:[{clientId:role,keyId:'qa',publicKey:'PEM'}],familySealKey:null}};
new ProductSessionGatewayNodeHost({},options);
// @ts-expect-error Native platform selector is exact.
const invalid:PrivateBusinessRegistration={productId:'music',platform:'native',keyId:'qa',allowedScopes:['music.library']};
// @ts-expect-error Registered backend scopes cannot be a wildcard scalar.
const scalar:PrivateBusinessRegistration={productId:'card',platform:'web',keyId:'qa',allowedScopes:'*'};
void invalid;void scalar;
