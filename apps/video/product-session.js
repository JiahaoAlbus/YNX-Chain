import {videoScope} from './business-scope.js';
export {videoScope} from './business-scope.js';
import {mediaBusinessAuthorization} from './business-wire.js';
import {createMediaSessionEvents, createMediaReturnLocation} from './session-events.js';
import {createBrowserProductSessionClient, ProductSessionGatewayFetchAdapter, encodeProductSessionWalletURL} from './product-session-sdk.js';

export const VIDEO_ORIGIN = 'https://video.ynxweb4.com';
export const VIDEO_SCOPES = Object.freeze(['video:account', 'video:library', 'video:playback']);



// Dependencies are explicit so protocol behavior can be tested without a browser
// or substituting a production Gateway. The default uses the frozen Auth SDK.
export function createVideoProductSession({environment = globalThis,
  createBrowserClient = createBrowserProductSessionClient,
  GatewayAdapter = ProductSessionGatewayFetchAdapter,
  encodeWalletURL = encodeProductSessionWalletURL} = {}) {
  let pendingClient;
  const events = createMediaSessionEvents('video', environment);
  const returnLocation = createMediaReturnLocation('video', ['discover','subscriptions','playlists','history','settings','channel'], environment);
  const atRegisteredOrigin = () => environment.location?.origin === VIDEO_ORIGIN;
  async function productSession() {
    if (!atRegisteredOrigin()) throw new Error('Open video.ynxweb4.com to sign in securely.');
    if (!pendingClient) pendingClient = (async () => {
      const normal = createBrowserClient === createBrowserProductSessionClient;
      const sdk = normal ? await import('./product-session-sdk-r9.js') : null;
      if (normal && sdk.MEDIA_SDK_SOURCE_COMMIT !== '2689bece12fddd991c2ecd7a024f6aa4e8b1afbd') throw Error('Matching current Media SDK build required');
      const createClient = sdk?.createBrowserProductSessionClient || createBrowserClient;
      const Adapter = sdk?.ProductSessionGatewayFetchAdapter || GatewayAdapter;
      const response = await environment.fetch(new URL(normal ? './product-session-registry-r9.json' : './product-session-registry.json', import.meta.url), {cache: 'no-cache'});
      if (!response.ok) throw new Error('Video sign-in configuration is unavailable. Please retry.');
      const registry = await response.json();
      const gateway = new Adapter({endpoint: 'https://wallet-auth.ynxweb4.com', fetch: environment.fetch.bind(environment),
        walletInstalled: () => false, schemeRegistered: () => false, timeoutMs: 15000});
      const browser = await createClient({registry, productId: 'video', scopes: [...VIDEO_SCOPES],
        purpose: 'Save Video playlists, subscriptions and watch history, and manage your comments and privacy', gateway, environment});
      return {...browser, registry, encodeWalletURL: sdk?.encodeProductSessionWalletURL || encodeWalletURL};
    })().catch(error => {pendingClient = null; throw error;});
    return pendingClient;
  }
  return {
    atRegisteredOrigin,
    subscribe: events.subscribe, announce: events.announce, rememberReturn: returnLocation.remember, consumeReturn: returnLocation.consume,
    async prepare() {
      const browser = await productSession();
      // A pending request is protected before offering an explicit launch link.
      // Web cannot detect installation; no automatic navigation or fake capability.
      const state = await browser.client.begin({walletInstalled: false, schemeRegistered: false});
      if (!state.request) throw Object.assign(new Error(state.message), {productSessionState: state});
      // Serialize at the authority time just used by begin; Wallet checks expiry
      // on arrival. A skewed product device clock must not block the launch link.
      return {url: browser.encodeWalletURL(browser.registry, state.request, new Date(state.request.issuedAt)), expiresAt: state.request.expiresAt, state: state.request.state};
    },
    async restoreNativeReturn(expectedState) {
      const browser = await productSession();
      const raw = await browser.storage.get(browser.client.storageKey);
      // Stored correlation only avoids re-preparing an unfinished request.
      // It never authorizes: restore still performs SDK authority introspection.
      if (raw === null || JSON.parse(raw).state !== expectedState) return null;
      return browser.client.restore(environment.navigator?.onLine !== false);
    },
    async restore() {return (await productSession()).client.restore(environment.navigator?.onLine !== false);},
    async authorization(path, method = 'GET', body = '') {
      const scope = videoScope(path, method);
      const browser = await productSession();
      return mediaBusinessAuthorization(browser,path,method.toUpperCase(),body,scope);
    },
    async finishReturn(url) {return (await productSession()).client.handleReturn(url);},
    async disconnect() {return (await productSession()).client.disconnect();},
  };
}

export const videoProductSession = createVideoProductSession();

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
