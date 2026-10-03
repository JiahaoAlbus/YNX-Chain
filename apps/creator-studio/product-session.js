import {mediaBusinessAuthorization} from './business-wire.js';
import {createMediaSessionEvents, createMediaReturnLocation} from './session-events.js';
import { createBrowserProductSessionClient, ProductSessionGatewayFetchAdapter, encodeProductSessionWalletURL } from './product-session-sdk.js';
const ORIGIN = 'https://creator.ynxweb4.com';
let pendingClient;
const events = createMediaSessionEvents('creator-studio');
const returnLocation = createMediaReturnLocation('creator-studio', ['overview','channel','team','rights','content','upload','assets','earn','moderation','disputes','ai']);
export const subscribeProductSession = events.subscribe, announceProductSession = events.announce, rememberProductReturn = returnLocation.remember, consumeProductReturn = returnLocation.consume;
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
  if (!state.request) throw Object.assign(new Error(state.message), {productSessionState: state});
  // This is an explicit user-selected launch attempt, never installation detection.
  // begin minted this fresh request using Auth time. Do not revalidate it against
  // a skewed local clock while serializing; Wallet validates expiry at approval.
  return {url:encodeProductSessionWalletURL(browser.registry, state.request, new Date(state.request.issuedAt)),expiresAt:state.request.expiresAt,state:state.request.state};
}
export async function restoreNativeProductReturn(expectedState) {
  const browser = await productSession();
  const raw = await browser.storage.get(browser.client.storageKey);
  // Correlation is a waiting hint; only the SDK's backend introspection authorizes.
  if (raw === null || JSON.parse(raw).state !== expectedState) return null;
  return browser.client.restore(navigator.onLine);
}
export async function restoreProductSession() {
  const browser = await productSession();
  return browser.client.restore(navigator.onLine);
}
export async function productAuthorization(path, method='GET', body='') {
  const browser = await productSession();
  return mediaBusinessAuthorization(browser,path,method.toUpperCase(),body,creatorScope(path,method));
}
export async function finishProductReturn(url) {
  const browser = await productSession();
  return browser.client.handleReturn(url);
}
export async function disconnectProductSession() {
  return (await productSession()).client.disconnect();
}

// Cancellation fences the result; a previous approval must settle before a new
// intent can replace the SDK's protected pending request.
let providerApprovalFlight = false;
export async function dispatchPreparedProductRequest(provider, prepare, finish, isCurrent = () => true, {signal, revoke, onRevocation = () => {}} = {}) {
  if (!provider || typeof provider.request !== 'function') throw new Error('Select an installed YNX Wallet to continue.');
  if (providerApprovalFlight) throw Object.assign(new Error('The previous Wallet approval is still closing. Close it and retry.'), {code: 'PRODUCT_APPROVAL_DRAINING'});
  const assertCurrent = () => {if (!isCurrent()) throw Object.assign(new Error('Wallet selection was cancelled or changed.'), {code: 'PRODUCT_APPROVAL_CANCELLED'});};
  let finishing = false, revocation;
  const cancelCompletion = () => {
    if (!finishing || revocation) return;
    onRevocation({status: 'retry-required', revocationPending: true, message: 'Cancelling sign-in securely. Confirmation is pending.'});
    revocation = Promise.resolve().then(() => {
      if (typeof revoke !== 'function') throw new Error('Secure cancellation requires the original Product Session disconnect.');
      return revoke();
    }).then(state => ({...state, revocationPending: !['disconnected', 'expired'].includes(state.status)}), () => ({status: 'retry-required', revocationPending: true, message: 'Sign-out could not be confirmed. Retry sign out when connected.'}));
  };
  signal?.addEventListener('abort', cancelCompletion);
  providerApprovalFlight = true;
  try {
    assertCurrent();
    const prepared = await prepare();
    assertCurrent();
    const result = await provider.request({method: 'ynx_requestProductSessionV2', params: [prepared.url]});
    assertCurrent();
    if (!result || result.version !== 2 || typeof result.returnUrl !== 'string' || result.returnUrl.length > 16384 || Object.keys(result).sort().join(',') !== 'returnUrl,version')
      throw Object.assign(new Error('Wallet returned an invalid sign-in response. Please retry.'), {code: 'PRODUCT_RETURN_INVALID'});
    finishing = true;
    const state = await finish(result.returnUrl);
    if (!isCurrent() || signal?.aborted) cancelCompletion();
    if (revocation) {
      const revoked = await revocation;
      throw Object.assign(new Error('Wallet selection was cancelled; sign-out confirmation was requested.'), {code: 'PRODUCT_APPROVAL_CANCELLED', productSessionState: revoked});
    }
    assertCurrent();
    return state;
  } finally {signal?.removeEventListener('abort', cancelCompletion); if (revocation) onRevocation(await revocation); providerApprovalFlight = false;}
}
