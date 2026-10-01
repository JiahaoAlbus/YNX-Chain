import {canonicalJSON,exactFields, WalletAuthError} from './canonical.js';
import {parseProductSessionRegistry} from './product-session-registry.js';

export const CENTRAL_BROWSER_ISSUER='https://wallet-auth.ynxweb4.com';
// Explicit first-party adoption, not suffix matching or permission expansion.
const ADOPTED=Object.freeze(['finance','exchange','quant','social','ai','developer']);
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

// Only these complete, reviewed rollout rosters may be negotiated. The list
// is signed verbatim; no arbitrary subset or unknown client is acceptable.
const PROFILE_PRODUCTS=Object.freeze([['finance','exchange','quant'],['finance','exchange','quant','social','ai'],['finance','exchange','quant','social','ai','developer']]);
export function centralBrowserProfiles(registry){return PROFILE_PRODUCTS.filter(ids=>ids.every(id=>registry.some(c=>c.productId===id))).map(ids=>({id:ids.length,clients:ids.map(id=>{const c=registry.find(c=>c.productId===id);return {clientId:c.clientId,origin:c.origin,audience:c.audience,scopes:[...c.scopes]};}).sort((a,b)=>a.clientId.localeCompare(b.clientId))}));}
export function centralBrowserApprovedProfile(registry,clients,initiatorClientId){const profile=centralBrowserProfiles(registry).find(p=>canonicalJSON(p.clients)===canonicalJSON(clients));if(!profile||!profile.clients.some(c=>c.clientId===initiatorClientId))throw new WalletAuthError('SSO_CLIENTS_MISMATCH','Central browser roster is not an approved complete profile');return profile;}
