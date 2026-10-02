import { createBrowserProductSessionClient, ProductSessionGatewayFetchAdapter } from "./vendor/product-session-browser.mjs";

export const SOCIAL_AUTHORITY = "https://wallet-auth.ynxweb4.com";
export const SOCIAL_PRIVATE_SCOPES = Object.freeze(["account:read", "profile:link"]);
export const SOCIAL_CHAT_SCOPES = Object.freeze(["account:read", "profile:link", "social.contacts", "social.messaging", "social.profile"]);

// No provider detection can establish OS scheme registration. Until an actual
// supported launcher supplies this capability, report unknown, not installed.
async function unverifiedLaunch() {
  throw Object.assign(new Error("This browser cannot verify the installed YNX Wallet launcher. Standard wallet connection remains available."), { code: "WALLET_LAUNCH_UNVERIFIED" });
}

export function createSocialPrivateSession({ environment = globalThis, detectWalletEnvironment = unverifiedLaunch, factory = createBrowserProductSessionClient, scopes = SOCIAL_PRIVATE_SCOPES, registryTimeoutMs = 10000 } = {}) {
  if (JSON.stringify(scopes)!==JSON.stringify(SOCIAL_PRIVATE_SCOPES)&&JSON.stringify(scopes)!==JSON.stringify(SOCIAL_CHAT_SCOPES))throw new Error("Unsupported Social permission selection");
  if(!Number.isSafeInteger(registryTimeoutMs)||registryTimeoutMs<1||registryTimeoutMs>10000)throw new Error("Invalid registry read deadline");
  let adapterPromise;
  let operation = Promise.resolve();
  let suspended=false;
  let current={status:"guest"};
  const registryError=(code,message)=>Object.assign(new Error(message),{code,retryable:true});
  async function readRegistry() {
    const controller=new AbortController();let timer,reading=true,expired=false;
    const timeoutError=registryError("SOCIAL_REGISTRY_TIMEOUT","Connection is taking too long. Please try again. Your account data is retained.");
    const check=()=>{if(expired||!reading)throw timeoutError;};
    const deadline=new Promise((resolve,reject)=>{timer=setTimeout(()=>{expired=true;controller.abort();reject(timeoutError);},registryTimeoutMs);});
    const read=(async()=>{
      try {
        const response=await environment.fetch(new URL("./vendor/product-session-registry.json",import.meta.url),{credentials:"omit",cache:"no-store",redirect:"error",signal:controller.signal});check();
        if(!response.ok)throw registryError("SOCIAL_REGISTRY_UNAVAILABLE","Connection is temporarily unavailable. Please try again. Your account data is retained.");
        const registry=await response.json();check();return registry;
      } catch(error) {
        if(expired||!reading)throw timeoutError;
        if(error?.code==="SOCIAL_REGISTRY_UNAVAILABLE")throw error;
        throw registryError(error instanceof SyntaxError?"SOCIAL_REGISTRY_INVALID":"SOCIAL_REGISTRY_NETWORK_UNAVAILABLE","Connection is temporarily unavailable. Please try again. Your account data is retained.");
      }
    })();
    try{return await Promise.race([read,deadline]);}
    finally{reading=false;clearTimeout(timer);controller.abort();}
  }
  async function adapter() {
    if (!adapterPromise) {
      const attempt = (async () => {
        // Only the side-effect-free registry read has a deadline. The factory
        // and its storage mutations stay on the original serial operation.
        const registry = await readRegistry();
        const gateway = new ProductSessionGatewayFetchAdapter({
          endpoint: SOCIAL_AUTHORITY, fetch: environment.fetch.bind(environment), timeoutMs: 10000,
          walletInstalled: async () => (await detectWalletEnvironment()).walletInstalled,
          schemeRegistered: async () => (await detectWalletEnvironment()).schemeRegistered,
        });
        return factory({ registry, productId: "social", scopes: [...scopes], purpose: scopes.includes("social.messaging")?"Authorize your Social profile, contact requests and encrypted chat on this browser device. No payments or recovery keys.":"Link your account to YNX Social. This does not authorize messages or payments.", gateway, environment });
      })().catch(error => { if(adapterPromise===attempt)adapterPromise=undefined; throw error; });
      adapterPromise=attempt;
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
    begin: () => {
      suspended=false;
      // Reserve synchronously at the real click, before registry/challenge IO.
      // This opens only the chosen Wallet transport, never approves a request.
      const wallet=environment.YNXSocialWallet;
      const intentRevision=wallet?.getIntentRevision?.()??wallet?.getRevision?.();
      const assertIntent=()=>{if(suspended||intentRevision!==(wallet?.getIntentRevision?.()??wallet?.getRevision?.()))throw new Error("SOCIAL_CONTEXT_CHANGED")};
      const reservation=wallet?.hasSelection?.()?wallet.reserve():Promise.resolve();
      reservation.catch(()=>{});
      return run(async ({client})=>{
        await reservation;assertIntent();const revision=wallet?.getRevision?.();
        const assertSelected=()=>{if(suspended||revision!==wallet?.getRevision?.())throw new Error('SOCIAL_CONTEXT_CHANGED')};
        assertSelected();let result=await client.beginExplicit();assertSelected();
        if(result.status==='retry-required'&&wallet?.available?.()&&typeof client.retryDetected==='function'){result=await client.retryDetected();assertSelected();}
        if(result.status!=='connecting'||result.route?.status!=='ready'||!wallet?.available?.())return result;
        const response=await wallet.requestProductSessionV2(result.route.url);assertSelected();
        const url=new URL(response.returnUrl);if(url.origin!=='https://social.ynxweb4.com'||url.pathname!=='/wallet-auth/callback')throw new Error('Unexpected Social Wallet callback origin or path.');
        const settled=await client.handleReturn(url.href);assertSelected();
        if(settled.status==='connected'&&!wallet.accountMatches(settled.session.account)){await client.disconnect();throw new Error('SOCIAL_ACCOUNT_MISMATCH');}
        return settled;
      });
    },
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
