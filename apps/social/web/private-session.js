import { createBrowserProductSessionClient, ProductSessionGatewayFetchAdapter } from "./vendor/product-session-browser.mjs";

export const SOCIAL_AUTHORITY = "https://wallet-auth.ynxweb4.com";
export const SOCIAL_PRIVATE_SCOPES = Object.freeze(["account:read", "profile:link"]);

// No provider detection can establish OS scheme registration. Until an actual
// supported launcher supplies this capability, report unknown, not installed.
async function unverifiedLaunch() {
  throw Object.assign(new Error("This browser cannot verify the installed YNX Wallet launcher. Standard wallet connection remains available."), { code: "WALLET_LAUNCH_UNVERIFIED" });
}

export function createSocialPrivateSession({ environment = globalThis, detectWalletEnvironment = unverifiedLaunch, factory = createBrowserProductSessionClient } = {}) {
  let adapterPromise;
  let operation = Promise.resolve();
  async function adapter() {
    if (!adapterPromise) {
      adapterPromise = (async () => {
        const response = await environment.fetch(new URL("./vendor/product-session-registry.json", import.meta.url), { credentials: "omit", cache: "no-store", redirect: "error" });
        if (!response.ok) throw new Error("Social Product Session registry is unavailable.");
        const registry = await response.json();
        const gateway = new ProductSessionGatewayFetchAdapter({
          endpoint: SOCIAL_AUTHORITY, fetch: environment.fetch.bind(environment), timeoutMs: 10000,
          walletInstalled: async () => (await detectWalletEnvironment()).walletInstalled,
          schemeRegistered: async () => (await detectWalletEnvironment()).schemeRegistered,
        });
        return factory({ registry, productId: "social", scopes: [...SOCIAL_PRIVATE_SCOPES], purpose: "Link your account to YNX Social. This does not authorize messages or payments.", gateway, environment });
      })().catch(error => { adapterPromise = undefined; throw error; });
    }
    return adapterPromise;
  }
  // Serialize private-session intents independently of the standard EVM state.
  function run(action) {
    const next = operation.then(async () => action(await adapter()));
    operation = next.catch(() => {});
    return next;
  }
  return Object.freeze({
    begin: () => run(async ({ client }) => {
      const availability = await detectWalletEnvironment();
      return client.begin(availability);
    }),
    restore: () => run(({ client }) => client.restore(environment.navigator?.onLine !== false)),
    handleReturn: (url) => run(({ client }) => {
      const parsed = new URL(url);
      if (parsed.origin !== "https://social.ynxweb4.com" || parsed.pathname !== "/wallet-auth/callback") throw new Error("Unexpected Social Wallet callback origin or path.");
      return client.handleReturn(url);
    }),
    disconnect: () => run(({ client }) => client.disconnect()),
  });
}
