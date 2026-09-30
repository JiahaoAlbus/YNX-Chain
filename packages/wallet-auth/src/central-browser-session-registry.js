import {exactFields, WalletAuthError} from './canonical.js';
import {parseProductSessionRegistry} from './product-session-registry.js';

export const CENTRAL_BROWSER_ISSUER='https://wallet-auth.ynxweb4.com';
// Explicit first-party adoption, not suffix matching or permission expansion.
const ADOPTED=Object.freeze(['finance','exchange','quant']);
export function createCentralBrowserSessionRegistry(productRegistry){
  const registry=parseProductSessionRegistry(productRegistry);
  return Object.freeze(ADOPTED.map(productId=>{
    const product=registry.products.find(value=>value.productId===productId);
    if(!product)fail('SSO_REGISTRY_INVALID');
    return Object.freeze({productId,clientId:`${product.clientId}-sso-v1`,origin:product.webOrigin,
      redirectUri:`${product.webOrigin}/sso/callback`,audience:`ynx:${productId}:identity`,scopes:Object.freeze(['identity:read'])});
  }));
}
export function centralBrowserClient(registry,input){
  exactFields(input,['clientId','origin','redirectUri'],'Central browser client');
  const client=registry.find(value=>value.clientId===input.clientId);
  if(!client||client.origin!==input.origin||client.redirectUri!==input.redirectUri)fail('SSO_CLIENT_NOT_REGISTERED');
  return client;
}
function fail(code){throw new WalletAuthError(code,'Central browser client is not exactly registered');}
