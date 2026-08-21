import {ynxTestnet} from "./ynx-testnet.js";

export class YNXWalletError extends Error {
  constructor(message, {cause, code, method} = {}) {
    super(message, {cause});
    this.name = "YNXWalletError";
    this.code = code;
    this.method = method;
  }
}

export function ynxTestnetAddEthereumChainParameter() {
  return {
    blockExplorerUrls: [...ynxTestnet.blockExplorerUrls],
    chainId: ynxTestnet.chainId,
    chainName: ynxTestnet.chainName,
    nativeCurrency: {...ynxTestnet.nativeCurrency},
    rpcUrls: [...ynxTestnet.rpcUrls],
  };
}

export async function ensureYNXTestnet(provider) {
  if (!provider || typeof provider.request !== "function") throw new YNXWalletError("an EIP-1193 wallet provider is required", {code: "PROVIDER_REQUIRED"});
  const initialChainId = await walletRequest(provider, "eth_chainId");
  if (initialChainId === ynxTestnet.chainId) return Object.freeze({added: false, chainId: initialChainId, switched: false});

  let added = false;
  try {
    await walletRequest(provider, "wallet_switchEthereumChain", [{chainId: ynxTestnet.chainId}]);
  } catch (error) {
    if (error.code !== 4902) throw error;
    await walletRequest(provider, "wallet_addEthereumChain", [ynxTestnetAddEthereumChainParameter()]);
    added = true;
    await walletRequest(provider, "wallet_switchEthereumChain", [{chainId: ynxTestnet.chainId}]);
  }

  const selectedChainId = await walletRequest(provider, "eth_chainId");
  if (selectedChainId !== ynxTestnet.chainId) {
    throw new YNXWalletError(`wallet selected ${selectedChainId || "an unknown chain"} instead of ${ynxTestnet.chainId}`, {code: "CHAIN_MISMATCH", method: "eth_chainId"});
  }
  return Object.freeze({added, chainId: selectedChainId, switched: true});
}

/**
 * Reads the standard EIP-1193 connection state without requesting an account,
 * opening an authorization URL, or consulting a Product Session endpoint.
 *
 * A direct JSON-RPC fetch is intentionally not part of this check. In a Web
 * client it can be blocked by CORS even while the selected wallet has already
 * proved the active chain through eth_chainId.
 */
export async function readYNXWalletConnection(provider) {
  assertProvider(provider);
  const [accounts, chainId] = await Promise.all([
    walletRequest(provider, "eth_accounts"),
    walletRequest(provider, "eth_chainId"),
  ]);
  return connectionState(accounts, chainId);
}

/**
 * Requests accounts only when the calling UI has an explicit user gesture,
 * then re-reads eth_chainId from that same provider. It creates no YNX Product
 * Session and never invents an account on an empty response.
 */
export async function requestYNXWalletConnection(provider) {
  assertProvider(provider);
  const accounts = await walletRequest(provider, "eth_requestAccounts");
  const chainId = await walletRequest(provider, "eth_chainId");
  return connectionState(accounts, chainId);
}

/**
 * Keeps a standard Wallet connection diagnostic current across browser-wallet
 * events. The observer is diagnostic-only: it never requests accounts or
 * creates a private Product Session.
 */
export function observeYNXWalletConnection(provider, onStateChange) {
  assertProvider(provider);
  if (typeof onStateChange !== "function") {
    throw new YNXWalletError("onStateChange must be a function", {code: "INVALID_STATE_LISTENER"});
  }

  let stopped = false;
  let generation = 0;
  let queue = Promise.resolve();
  const emitRead = (reason) => {
    const currentGeneration = ++generation;
    queue = queue.catch(() => undefined).then(async () => {
      const state = await readYNXWalletConnection(provider);
      if (!stopped && currentGeneration === generation) onStateChange(Object.freeze({...state, reason}));
    });
    return queue;
  };
  const emitDisconnected = (event) => {
    generation += 1;
    if (!stopped) {
      onStateChange(Object.freeze({
        account: null,
        chainId: null,
        connected: false,
        event: event ?? null,
        reason: "disconnect",
        state: "PROVIDER_DISCONNECTED",
      }));
    }
  };
  const onAccountsChanged = () => emitRead("accountsChanged");
  const onChainChanged = () => emitRead("chainChanged");
  const onDisconnect = (event) => emitDisconnected(event);

  if (typeof provider.on === "function") {
    provider.on("accountsChanged", onAccountsChanged);
    provider.on("chainChanged", onChainChanged);
    provider.on("disconnect", onDisconnect);
  }
  const ready = emitRead("initial");
  return Object.freeze({
    ready,
    stop() {
      if (stopped) return;
      stopped = true;
      if (typeof provider.removeListener === "function") {
        provider.removeListener("accountsChanged", onAccountsChanged);
        provider.removeListener("chainChanged", onChainChanged);
        provider.removeListener("disconnect", onDisconnect);
      }
    },
  });
}

function assertProvider(provider) {
  if (!provider || typeof provider.request !== "function") {
    throw new YNXWalletError("an EIP-1193 wallet provider is required", {code: "PROVIDER_REQUIRED"});
  }
}

function connectionState(accounts, chainId) {
  const account = Array.isArray(accounts)
    ? accounts.find((candidate) => typeof candidate === "string" && /^0x[0-9a-f]{40}$/i.test(candidate)) || null
    : null;
  if (!account) {
    return Object.freeze({account: null, chainId: typeof chainId === "string" ? chainId : null, connected: false, state: "NO_APPROVED_ACCOUNT"});
  }
  if (chainId !== ynxTestnet.chainId) {
    return Object.freeze({account, chainId: typeof chainId === "string" ? chainId : null, connected: false, state: "WRONG_CHAIN"});
  }
  return Object.freeze({account, chainId, connected: true, state: "CONNECTED"});
}

async function walletRequest(provider, method, params) {
  try {
    return await provider.request(params === undefined ? {method} : {method, params});
  } catch (cause) {
    const code = cause?.code;
    let detail = cause?.message || String(cause);
    if (code === 4001) detail = "wallet user rejected the request";
    if (code === -32601 || code === 4200) detail = `wallet does not support ${method}`;
    throw new YNXWalletError(detail, {cause, code, method});
  }
}
