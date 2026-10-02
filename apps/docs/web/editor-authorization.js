// The SDK owns durable pending requests, completion and revocation. UI epochs
// prevent stale rendering; disconnect fences an already prepared late approval.
export function createDocsAuthorization({adapter, discover, environment, changed = () => {}}) {
  let epoch = 0, pending = false, provider, listener, cancellation, preparedIntent = false, revokePending = false;
  const detach = () => { if (listener) provider?.removeListener?.('accountsChanged', listener); listener = undefined; provider = undefined; };
  const report = () => changed(adapter.client.current);
  return {
    get pending() { return pending; },
    get revocationPending() { return revokePending || adapter.client.current?.revocationPending === true; },
    async approve() {
      if (pending) return null;
      if (cancellation) await cancellation;
      if (pending) return null;
      if (this.revocationPending) throw Object.assign(new Error('Retry sign-out before approving again.'), {code:'REVOCATION_PENDING'});
      const intent = ++epoch; pending = true;
      let prepared = false;
      const current = () => intent === epoch;
      try {
        const wallets = await discover(environment, 160);
        if (!current()) return null;
        if (!wallets.ynx?.provider) throw Object.assign(new Error('Install or enable YNX Wallet, then retry.'), {code:'WALLET_UNAVAILABLE'});
        detach(); provider = wallets.ynx.provider;
        listener = () => { void this.cancel(true).catch(() => {}); };
        provider.on?.('accountsChanged', listener);
        // Mark before awaiting begin: Cancel can race the SDK's durable prepare.
        prepared = true; preparedIntent = true;
        const request = await adapter.client.beginExplicit();
        if (!current()) return null;
        if (request.route?.status !== 'ready') throw Object.assign(new Error('Wallet approval could not be opened.'), {code:'WALLET_UNAVAILABLE'});
        const result = await provider.request({method:'ynx_requestProductSessionV2', params:[request.route.url]});
        if (!current()) return null;
        if (result?.version !== 2 || typeof result.returnUrl !== 'string') throw Object.assign(new Error('Wallet returned no verifiable approval.'), {code:'INVALID_WALLET_RETURN'});
        const state = await adapter.client.handleReturn(result.returnUrl);
        if (!current()) return null;
        preparedIntent = false; report(); return state;
      } catch (error) {
        if (current() && prepared) {
          await this.cancel(true);
          throw error;
        }
        if (current()) throw error;
        return null;
      } finally { if (current()) pending = false; }
    },
    async cancel(revoke = false) {
      const mustRevoke = preparedIntent || revoke; ++epoch; pending = false; detach();
      if (!mustRevoke) return null;
      // Persist the SDK revocation intent before a completion can install a grant.
      preparedIntent = false; revokePending = true;
      changed({status:'retry-required',revocationPending:true});
      cancellation = adapter.client.disconnect();
      try { const state = await cancellation; revokePending = state?.status !== 'disconnected' || state?.revocationPending === true; report(); return state; }
      finally { cancellation = undefined; }
    },
    async restore() {
      if (pending || cancellation || revokePending) return null;
      const intent = epoch, state = await adapter.client.restore();
      if (intent !== epoch) return null;
      if (state?.status === 'connected' && !listener) {
        const wallets = await discover(environment,160);
        if (intent !== epoch || pending || cancellation) return null;
        if (wallets.ynx?.provider) {
          detach(); provider = wallets.ynx.provider;
          listener = () => { void this.cancel(true).catch(() => {}); };
          provider.on?.('accountsChanged',listener);
        }
      }
      report(); return state;
    },
    close() { ++epoch; pending = false; detach(); adapter.close(); },
  };
}
