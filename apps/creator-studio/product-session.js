import { createBrowserProductSessionClient, ProductSessionGatewayFetchAdapter, encodeProductSessionWalletURL } from './product-session-sdk.js';
const ORIGIN = 'https://creator.ynxweb4.com';
let pendingClient;
export function atRegisteredOrigin() { return location.origin === ORIGIN; }
export function creatorScope(path, method = 'GET') {
  if (/\/(payout-intents|revenue|disputes)/.test(path)) return 'creator:revenue';
  return ['GET', 'HEAD'].includes(method.toUpperCase()) ? 'creator:account' : 'creator:publish';
}
export async function productSession() {
  if (!atRegisteredOrigin()) throw new Error('Open creator.ynxweb4.com to sign in securely.');
  if (!pendingClient) pendingClient = (async () => {
    const response = await fetch(new URL('./product-session-registry.json', import.meta.url), {cache:'no-cache'});
    if (!response.ok) throw new Error('Creator sign-in configuration is unavailable. Please retry.');
    const registry = await response.json();
    const gateway = new ProductSessionGatewayFetchAdapter({
      endpoint: 'https://wallet-auth.ynxweb4.com', fetch: fetch.bind(globalThis),
      // Web pages cannot assert that an operating-system URL handler is installed.
      walletInstalled: () => false, schemeRegistered: () => false, timeoutMs:15000,
    });
    const browser = await createBrowserProductSessionClient({registry, productId:'creator-studio',
      scopes:['creator:account','creator:publish','creator:revenue'],
      purpose:'Manage your Creator Studio channel, uploads, publication reviews and revenue records', gateway});
    return { ...browser, registry };
  })().catch(error => { pendingClient = null; throw error; });
  return pendingClient;
}
export async function prepareProductSignIn() {
  const browser = await productSession();
  const state = await browser.client.begin({walletInstalled:false,schemeRegistered:false});
  if (!state.request) throw new Error(state.message);
  // This is an explicit user-selected launch attempt, never installation detection.
  // begin minted this fresh request using Auth time. Do not revalidate it against
  // a skewed local clock while serializing; Wallet validates expiry at approval.
  return {url:encodeProductSessionWalletURL(browser.registry, state.request, new Date(state.request.issuedAt)),expiresAt:state.request.expiresAt};
}
export async function restoreProductSession() {
  const browser = await productSession();
  return browser.client.restore(navigator.onLine);
}
export async function productAuthorization(path, method='GET') {
  const browser = await productSession();
  const {proofHeader} = await browser.createIntrospectionProof([creatorScope(path,method)]);
  return {'X-YNX-Product-Session-Proof-V2':proofHeader};
}
export async function finishProductReturn(url) {
  const browser = await productSession();
  return browser.client.handleReturn(url);
}
export async function disconnectProductSession() {
  return (await productSession()).client.disconnect();
}
