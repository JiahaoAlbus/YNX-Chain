import {
  discoverWalletProviders,
  WALLET_PROVIDER_DISCOVERY_STATUS,
  WALLET_PROVIDER_KIND,
} from "./ynx-wallet-contract/wallet-provider-discovery.js";
import {
  createStandardWalletConnectState,
  reduceStandardWalletConnectState,
  STANDARD_WALLET_CONNECT_STATUS,
} from "./ynx-wallet-contract/standard-wallet-connect-state.js";
import {DAppConnectError} from "./ynx-dapp-connect-sdk/errors.js";

export const YNX_TESTNET_ADD_CHAIN = Object.freeze({
  chainId: "0x1917",
  chainName: "YNX Testnet",
  nativeCurrency: Object.freeze({name: "YNX Testnet", symbol: "YNXT", decimals: 18}),
  rpcUrls: Object.freeze(["https://rpc.ynxweb4.com/"]),
  blockExplorerUrls: Object.freeze(["https://explorer.ynxweb4.com"]),
});

export const WALLET_INSTALLATION_OPTIONS = Object.freeze({
  ynxWallet: "https://www.ynxweb4.com/dapp/download",
  metaMask: "https://metamask.io/download/",
});

let walletState = createStandardWalletConnectState();
let activeProvider = null;
let activeListeners = null;

function transition(event) {
  walletState = reduceStandardWalletConnectState(walletState, event);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ynx-calendar-standard-wallet-state", {detail: walletState}));
  return walletState;
}

function intent() {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  return random && random.length >= 16 ? random : `calendar_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function errorCode(error) {
  if (Number(error?.code) === 4001) return "WALLET_USER_REJECTED";
  const value = String(error?.code || "WALLET_CONNECT_FAILED").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(value) ? value : "WALLET_CONNECT_FAILED";
}

function publicError(error) {
  if (Number(error?.code) === 4001) {
    return new DAppConnectError("WALLET_USER_REJECTED", "Wallet connection was rejected. No account or Calendar session was created.", {cause: error});
  }
  return error;
}

function removeProviderListeners() {
  if (!activeProvider || !activeListeners) return;
  for (const [event, listener] of Object.entries(activeListeners)) {
    try { activeProvider.removeListener?.(event, listener); } catch {}
  }
  activeProvider = null;
  activeListeners = null;
}

function listen(provider) {
  if (provider === activeProvider) return;
  removeProviderListeners();
  const listeners = {
    accountsChanged: (accounts) => { try { transition({type: "ACCOUNTS_CHANGED", accounts}); } catch {} },
    chainChanged: (chainId) => { try { transition({type: "CHAIN_CHANGED", chainId}); } catch {} },
    disconnect: () => { try { transition({type: "PROVIDER_DISCONNECT"}); } catch {} },
  };
  for (const [event, listener] of Object.entries(listeners)) {
    try { provider.on?.(event, listener); } catch {}
  }
  activeProvider = provider;
  activeListeners = listeners;
}

async function discover(windowLike, timeoutMs) {
  const result = await discoverWalletProviders(windowLike, timeoutMs);
  if (result.ambiguities.length || result.conflictedAnnouncements) {
    throw new DAppConnectError("PROVIDER_DISCOVERY_AMBIGUOUS", "More than one matching Wallet provider was discovered. Disable duplicate extensions and retry.", {details: result});
  }
  return result;
}

function selectProvider(discovery, preferred) {
  if (preferred === WALLET_PROVIDER_KIND.YNX) return discovery.ynx;
  if (preferred === WALLET_PROVIDER_KIND.METAMASK) return discovery.metamask;
  return discovery.ynx ?? discovery.metamask;
}

async function ensureYNXTestnet(provider) {
  let chainId = await provider.request({method: "eth_chainId"});
  if (String(chainId).toLowerCase() === "0x1917") return "0x1917";
  try {
    await provider.request({method: "wallet_switchEthereumChain", params: [{chainId: "0x1917"}]});
  } catch (error) {
    if (Number(error?.code) !== 4902) throw error;
    await provider.request({method: "wallet_addEthereumChain", params: [YNX_TESTNET_ADD_CHAIN]});
    await provider.request({method: "wallet_switchEthereumChain", params: [{chainId: "0x1917"}]});
  }
  chainId = await provider.request({method: "eth_chainId"});
  return String(chainId).toLowerCase();
}

function connectedResult(candidate, provider) {
  return Object.freeze({
    account: walletState.account,
    chainId: walletState.chainId,
    connection: Object.freeze({provider}),
    connectionState: walletState,
    productSession: "PRIVATE_SERVICE_DEGRADED",
    standardConnection: "CONNECTED",
    walletName: candidate.name || (candidate.kind === WALLET_PROVIDER_KIND.YNX ? "YNX Wallet" : "MetaMask"),
  });
}

export async function connectCalendarWallet(windowLike = window, {timeoutMs = 160, providerKind = null} = {}) {
  transition({type: "BEGIN", pendingIntent: intent()});
  try {
    const discovery = await discover(windowLike, timeoutMs);
    const selected = selectProvider(discovery, providerKind);
    if (!selected) {
      transition({type: "CLOSE_CHOOSER"});
      const code = discovery.status === WALLET_PROVIDER_DISCOVERY_STATUS.NOT_INJECTED ? "PROVIDER_NOT_INJECTED" : "UNSUPPORTED_INJECTED_PROVIDER";
      throw new DAppConnectError(code, "No supported Wallet provider was injected into this page. Unlock the extension, grant site access, enable it, then retry.", {details: {discovery, downloads: WALLET_INSTALLATION_OPTIONS}});
    }
    transition({type: "PROVIDER_SELECTED", providerKind: selected.kind});
    const accounts = await selected.provider.request({method: "eth_requestAccounts"});
    if (!Array.isArray(accounts) || typeof accounts[0] !== "string") throw new DAppConnectError("WALLET_NOT_AUTHORIZED", "The selected Wallet returned no approved account.");
    transition({type: "ACCOUNT_APPROVED", account: accounts[0]});
    const chainId = await ensureYNXTestnet(selected.provider);
    transition({type: "CHAIN_CONFIRMED", chainId});
    if (walletState.status !== STANDARD_WALLET_CONNECT_STATUS.CONNECTED) throw new DAppConnectError("WRONG_CHAIN", "Wallet did not finish switching to YNX Testnet.");
    transition({type: "PRIVATE_SESSION_DEGRADED", code: "PRIVATE_SERVICE_UNAVAILABLE"});
    listen(selected.provider);
    return connectedResult(selected, selected.provider);
  } catch (error) {
    const normalized = publicError(error);
    const terminalWithoutChooser = normalized?.code === "PROVIDER_NOT_INJECTED" || normalized?.code === "UNSUPPORTED_INJECTED_PROVIDER";
    if (!terminalWithoutChooser && walletState.status !== STANDARD_WALLET_CONNECT_STATUS.IDLE && walletState.status !== STANDARD_WALLET_CONNECT_STATUS.DISCONNECTED && walletState.status !== STANDARD_WALLET_CONNECT_STATUS.FAILED) {
      try { transition({type: "FAIL", code: errorCode(normalized)}); } catch {}
    }
    throw normalized;
  }
}

export async function restoreCalendarWallet(windowLike = window, {timeoutMs = 160, providerKind = null} = {}) {
  const discovery = await discover(windowLike, timeoutMs);
  const selected = selectProvider(discovery, providerKind);
  if (!selected) return Object.freeze({status: "not-restored", connectionState: walletState});
  try {
    const [accounts, chainId] = await Promise.all([
      selected.provider.request({method: "eth_accounts"}),
      selected.provider.request({method: "eth_chainId"}),
    ]);
    transition({type: "RESTORE", providerKind: selected.kind, accounts, chainId});
    if (walletState.status !== STANDARD_WALLET_CONNECT_STATUS.CONNECTED) return Object.freeze({status: "not-restored", connectionState: walletState});
    listen(selected.provider);
    return connectedResult(selected, selected.provider);
  } catch (error) {
    return Object.freeze({status: "not-restored", code: errorCode(error), connectionState: walletState});
  }
}

export function disconnectCalendarWallet() {
  removeProviderListeners();
  return transition({type: "DISCONNECT"});
}

export function calendarWalletState() { return walletState; }
