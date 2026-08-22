// Creator Studio consumes the shared Standard Wallet connect-state contract.
// Authority: 98c6d5d784d212df8981a53b17118a511e246ad2
// Evidence: c3ab255c32bdeb9c8e056882c315f8ad43c29c7f
export const STANDARD_WALLET_CONNECT_STATE_AUTHORITY = Object.freeze({
  sourceCommit: "98c6d5d784d212df8981a53b17118a511e246ad2",
  sourceTree: "51a60a362d4ad5dd748bcdefb101f71b1d9e0cee",
  evidenceCommit: "c3ab255c32bdeb9c8e056882c315f8ad43c29c7f",
  chainId: "0x1917",
});

const INITIAL = Object.freeze({
  status: "idle",
  provider: null,
  providerKind: null,
  account: null,
  chainId: null,
  permissions: Object.freeze([]),
  chooserOpen: false,
  chooserMode: "provider-selection",
  chooserActions: Object.freeze(["close"]),
  pendingIntent: null,
  privateService: "unknown",
  rpcProbe: "unknown",
  error: null,
});

const freeze = value => Object.freeze({ ...value });
const normalizeAccount = value => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) ? value.toLowerCase() : null;
const normalizeChain = value => typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value) ? value.toLowerCase() : null;

export function createStandardWalletConnectState() {
  return freeze(INITIAL);
}

export function reduceStandardWalletConnectState(current = INITIAL, event = {}) {
  switch (event.type) {
    case "OPEN_CHOOSER":
      return freeze({
        ...current,
        chooserOpen: true,
        chooserMode: current.status === "connected" ? "connection-details" : "provider-selection",
        chooserActions: Object.freeze(current.status === "connected" ? ["disconnect", "switch-account", "close"] : ["close"]),
      });
    case "CLOSE_CHOOSER":
      return freeze({ ...current, chooserOpen: false });
    case "BEGIN":
      return freeze({ ...current, status: "connecting", pendingIntent: event.pendingIntent || null, error: null });
    case "PROVIDER_SELECTED":
      return freeze({ ...current, provider: event.provider || null, providerKind: event.providerKind || null });
    case "ACCOUNT_APPROVED": {
      const account = normalizeAccount(event.account);
      return account ? freeze({ ...current, account, permissions: Object.freeze(["eth_accounts"]) }) : freeze({ ...current, status: "error", error: "INVALID_ACCOUNT" });
    }
    case "CHAIN_CONFIRMED": {
      const chainId = normalizeChain(event.chainId);
      if (chainId !== STANDARD_WALLET_CONNECT_STATE_AUTHORITY.chainId || !current.provider || !current.account) {
        return freeze({ ...current, status: "error", chainId, error: chainId ? "WRONG_CHAIN" : "INVALID_CHAIN" });
      }
      return freeze({ ...current, status: "connected", chainId, chooserOpen: false, chooserMode: "connection-details", chooserActions: Object.freeze(["disconnect", "switch-account", "close"]), pendingIntent: null, error: null });
    }
    case "RESTORE": {
      const account = normalizeAccount(event.account);
      const chainId = normalizeChain(event.chainId);
      if (!event.provider || !account || chainId !== STANDARD_WALLET_CONNECT_STATE_AUTHORITY.chainId) return current;
      return freeze({ ...current, status: "connected", provider: event.provider, providerKind: event.providerKind || null, account, chainId, permissions: Object.freeze(["eth_accounts"]), chooserOpen: false, chooserMode: "connection-details", chooserActions: Object.freeze(["disconnect", "switch-account", "close"]), pendingIntent: null, error: null });
    }
    case "ACCOUNTS_CHANGED": {
      const account = normalizeAccount(Array.isArray(event.accounts) ? event.accounts[0] : null);
      if (!account) return reduceStandardWalletConnectState(current, { type: "DISCONNECT" });
      return freeze({ ...current, account, permissions: Object.freeze(["eth_accounts"]), error: null });
    }
    case "CHAIN_CHANGED": {
      const chainId = normalizeChain(event.chainId);
      return chainId === STANDARD_WALLET_CONNECT_STATE_AUTHORITY.chainId
        ? freeze({ ...current, chainId, status: current.provider && current.account ? "connected" : current.status, error: null })
        : freeze({ ...current, chainId, status: "error", error: "WRONG_CHAIN" });
    }
    case "PRIVATE_SESSION_DEGRADED":
      return freeze({ ...current, privateService: "degraded" });
    case "PRIVATE_SESSION_READY":
      return freeze({ ...current, privateService: "ready" });
    case "RPC_PROBE_DEGRADED":
      return freeze({ ...current, rpcProbe: "degraded" });
    case "RPC_PROBE_READY":
      return freeze({ ...current, rpcProbe: "ready" });
    case "FAIL":
      return freeze({ ...current, status: "error", chooserOpen: false, pendingIntent: null, error: event.error || "WALLET_ERROR" });
    case "PROVIDER_DISCONNECT":
    case "DISCONNECT":
      return createStandardWalletConnectState();
    default:
      return current;
  }
}
