const ACCOUNT = /^0x[0-9a-f]{40}$/u;
function fail(code) { throw Object.assign(new Error(code), { code }); }

/** Cross-window per-account exclusion; absence of browser Web Locks is not a fallback. */
export async function withHostedAccountLock(account, action, locks = globalThis.navigator?.locks) {
  if (!ACCOUNT.test(account ?? "") || typeof action !== "function") fail("HOSTED_ACCOUNT_LOCK_INVALID");
  if (!locks || typeof locks.request !== "function") fail("HOSTED_ACCOUNT_LOCK_UNAVAILABLE");
  let callbackError;
  try {
    return await locks.request(`ynx-hosted-wallet-send:${account}`, { mode: "exclusive", ifAvailable: true }, lock => {
      if (!lock) { try { fail("HOSTED_ACCOUNT_BUSY"); } catch (error) { callbackError = error; throw error; } }
      return Promise.resolve().then(action).catch(error => { callbackError = error; throw error; });
    });
  } catch (error) {
    if (error === callbackError) throw error;
    fail("HOSTED_ACCOUNT_LOCK_UNAVAILABLE");
  }
}
