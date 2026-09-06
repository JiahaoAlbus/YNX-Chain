import {createBrowserProductSessionClient, ProductSessionGatewayFetchAdapter, encodeProductSessionWalletURL} from './product-session-sdk.js';

export const VIDEO_ORIGIN = 'https://video.ynxweb4.com';
export const VIDEO_SCOPES = Object.freeze(['video:account', 'video:library', 'video:playback']);

export function videoScope(path, method = 'GET') {
  method = method.toUpperCase();
  if (path.includes('..') || path.includes('//')) throw new Error('Invalid Video API route.');
  const id = '[A-Za-z0-9_-]+';
  if (['GET', 'HEAD'].includes(method)) {
    if (/^\/v1\/(history|playlists|subscriptions)$/.test(path)) return 'video:library';
    if (new RegExp(`^/v1/(videos|videos/${id}(/comments)?|channels/${id})$`).test(path) || /^\/media\/[A-Za-z0-9_./-]+$/.test(path) && !path.includes('..')) return 'video:playback';
  }
  if (method === 'POST') {
    if (path === '/v1/playlists' || new RegExp(`^/v1/(playlists/${id}/videos|channels/${id}/subscription|videos/${id}/watch)$`).test(path)) return 'video:library';
    if (new RegExp(`^/v1/(videos/${id}/(comments|reports)|reports/${id}/appeals)$`).test(path)) return 'video:account';
  }
  if (method === 'DELETE') {
    if (new RegExp(`^/v1/(channels/${id}/subscription|playlists/${id}(/videos/${id})?)$`).test(path)) return 'video:library';
    if (path === '/v1/privacy/account-data') return 'video:account';
  }
  throw new Error('This operation is not available to a Video account.');
}

// Dependencies are explicit so protocol behavior can be tested without a browser
// or substituting a production Gateway. The default uses the frozen Auth SDK.
export function createVideoProductSession({environment = globalThis,
  createBrowserClient = createBrowserProductSessionClient,
  GatewayAdapter = ProductSessionGatewayFetchAdapter,
  encodeWalletURL = encodeProductSessionWalletURL} = {}) {
  let pendingClient;
  const atRegisteredOrigin = () => environment.location?.origin === VIDEO_ORIGIN;
  async function productSession() {
    if (!atRegisteredOrigin()) throw new Error('Open video.ynxweb4.com to sign in securely.');
    if (!pendingClient) pendingClient = (async () => {
      const response = await environment.fetch(new URL('./product-session-registry.json', import.meta.url), {cache: 'no-cache'});
      if (!response.ok) throw new Error('Video sign-in configuration is unavailable. Please retry.');
      const registry = await response.json();
      const gateway = new GatewayAdapter({endpoint: 'https://wallet-auth.ynxweb4.com', fetch: environment.fetch.bind(environment),
        walletInstalled: () => false, schemeRegistered: () => false, timeoutMs: 15000});
      const browser = await createBrowserClient({registry, productId: 'video', scopes: [...VIDEO_SCOPES],
        purpose: 'Save Video playlists, subscriptions and watch history, and manage your comments and privacy', gateway});
      return {...browser, registry};
    })().catch(error => {pendingClient = null; throw error;});
    return pendingClient;
  }
  return {
    atRegisteredOrigin,
    async prepare() {
      const browser = await productSession();
      // A pending request is protected before offering an explicit launch link.
      // Web cannot detect installation; no automatic navigation or fake capability.
      const state = await browser.client.begin({walletInstalled: false, schemeRegistered: false});
      if (!state.request) throw new Error(state.message);
      return {url: encodeWalletURL(browser.registry, state.request), expiresAt: state.request.expiresAt};
    },
    async restore() {return (await productSession()).client.restore(environment.navigator?.onLine !== false);},
    async authorization(path, method = 'GET') {
      const scope = videoScope(path, method);
      const browser = await productSession();
      const {proofHeader} = await browser.createIntrospectionProof([scope]);
      return {'X-YNX-Product-Session-Proof-V2': proofHeader};
    },
    async finishReturn(url) {return (await productSession()).client.handleReturn(url);},
    async disconnect() {return (await productSession()).client.disconnect();},
  };
}

export const videoProductSession = createVideoProductSession();
