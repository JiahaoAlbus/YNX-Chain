import { createBrowserProductSessionClient, ProductSessionGatewayFetchAdapter } from "./vendor/product-session-browser.mjs";

export const SOCIAL_AUTHORITY = "https://wallet-auth.ynxweb4.com";
export const SOCIAL_PRIVATE_SCOPES = Object.freeze(["account:read", "profile:link"]);
export const SOCIAL_CHAT_SCOPES = Object.freeze(["account:read", "profile:link", "social.messaging", "social.profile"]);

// No provider detection can establish OS scheme registration. Until an actual
// supported launcher supplies this capability, report unknown, not installed.
async function unverifiedLaunch() {
  throw Object.assign(new Error("This browser cannot verify the installed YNX Wallet launcher. Standard wallet connection remains available."), { code: "WALLET_LAUNCH_UNVERIFIED" });
}

export function createSocialPrivateSession({ environment = globalThis, detectWalletEnvironment = unverifiedLaunch, factory = createBrowserProductSessionClient, scopes = SOCIAL_PRIVATE_SCOPES } = {}) {
  if (JSON.stringify(scopes)!==JSON.stringify(SOCIAL_PRIVATE_SCOPES)&&JSON.stringify(scopes)!==JSON.stringify(SOCIAL_CHAT_SCOPES))throw new Error("Unsupported Social permission selection");
  let adapterPromise;
  let operation = Promise.resolve();
  let suspended=false;
  let current={status:"guest"};
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
        return factory({ registry, productId: "social", scopes: [...scopes], purpose: scopes.includes("social.messaging")?"Authorize your Social profile and encrypted chat on this browser device. No payments or recovery keys.":"Link your account to YNX Social. This does not authorize messages or payments.", gateway, environment });
      })().catch(error => { adapterPromise = undefined; throw error; });
    }
    return adapterPromise;
  }
  // Serialize private-session intents independently of the standard EVM state.
  function run(action) {
    const next = operation.then(async () => {const result=await action(await adapter());if(result?.status)current=result;return result;});
    operation = next.catch(() => {});
    return next;
  }
  return Object.freeze({
    get current(){return current;},
    begin: () => {suspended=false;return run(({ client }) => client.beginExplicit());},
    restore: () => run(async ({ client, storage }) => {
      const pending = await storage.get(`${client.storageKey}:pending`);
      if (pending !== null) return {status:"connecting",automatic:false,message:"A Wallet approval request is pending. Return from Wallet to finish it, or explicitly start a new identity link. Retry has not replaced the request."};
      return client.restore(environment.navigator?.onLine !== false);
    }),
    handleReturn: (url) => run(({ client }) => {
      const parsed = new URL(url);
      if (parsed.origin !== "https://social.ynxweb4.com" || parsed.pathname !== "/wallet-auth/callback") throw new Error("Unexpected Social Wallet callback origin or path.");
      return client.handleReturn(url);
    }),
    disconnect: () => {suspended=true;current={status:"retry-required"};return run(({ client }) => client.disconnect());},
    proof: required => run(async ({createIntrospectionProof})=>{if(suspended)throw new Error("Social authorization is suspended");const proof=await createIntrospectionProof(required);if(suspended)throw new Error("Social authorization is suspended");return proof;}),
  });
}
