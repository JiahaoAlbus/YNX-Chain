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
let activeCandidate = null;
let activeListeners = null;
let activePermissionRevocation = null;

const LATE_INJECTION_REDISCOVERY_MS = Object.freeze([250, 750, 1500]);

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

function unsupportedMethod(error) {
  return Number(error?.code) === 4200
    || Number(error?.code) === -32601
    || /unsupported|not implemented|method not found/i.test(String(error?.message || ""));
}

function transitionProviderEvent(provider, event) {
  if (activePermissionRevocation?.provider === provider) {
    activePermissionRevocation.suppressedEventCount = Math.min(1024, activePermissionRevocation.suppressedEventCount + 1);
    return;
  }
  try { transition(event); } catch {}
}

function removeProviderListeners() {
  if (!activeProvider || !activeListeners) return;
  for (const [event, listener] of Object.entries(activeListeners)) {
    try { activeProvider.removeListener?.(event, listener); } catch {}
  }
  activeProvider = null;
  activeCandidate = null;
  activeListeners = null;
}

function listen(provider, candidate) {
  if (provider === activeProvider) {
    activeCandidate = candidate;
    return;
  }
  removeProviderListeners();
  const listeners = {
    accountsChanged: (accounts) => transitionProviderEvent(provider, {type: "ACCOUNTS_CHANGED", accounts}),
    chainChanged: (chainId) => transitionProviderEvent(provider, {type: "CHAIN_CHANGED", chainId}),
    disconnect: () => transitionProviderEvent(provider, {type: "PROVIDER_DISCONNECT"}),
  };
  for (const [event, listener] of Object.entries(listeners)) {
    try { provider.on?.(event, listener); } catch {}
  }
  activeProvider = provider;
  activeCandidate = candidate;
  activeListeners = listeners;
}

async function discover(windowLike, timeoutMs) {
  const result = await discoverWalletProviders(windowLike, timeoutMs);
  if (result.ambiguities.length || result.conflictedAnnouncements) {
    throw new DAppConnectError("PROVIDER_DISCOVERY_AMBIGUOUS", "More than one matching Wallet provider was discovered. Disable duplicate extensions and retry.", {details: result});
  }
  return result;
}

function waitForLateProviderSignal(windowLike, milliseconds) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      try { windowLike.removeEventListener?.("eip6963:announceProvider", finish); } catch {}
      try { windowLike.removeEventListener?.("ethereum#initialized", finish); } catch {}
      resolve();
    };
    try { windowLike.addEventListener?.("eip6963:announceProvider", finish); } catch {}
    try { windowLike.addEventListener?.("ethereum#initialized", finish, {once: true}); } catch {}
    timer = setTimeout(finish, milliseconds);
  });
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
      transition({type: "DISCONNECT"});
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
    listen(selected.provider, selected);
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
  if (!selected) {
    removeProviderListeners();
    transition({type: "DISCONNECT"});
    return Object.freeze({status: "not-restored", connectionState: walletState});
  }
  try {
    const [accounts, chainId] = await Promise.all([
      selected.provider.request({method: "eth_accounts"}),
      selected.provider.request({method: "eth_chainId"}),
    ]);
    transition({type: "RESTORE", providerKind: selected.kind, accounts, chainId});
    if (walletState.status !== STANDARD_WALLET_CONNECT_STATUS.CONNECTED) return Object.freeze({status: "not-restored", connectionState: walletState});
    listen(selected.provider, selected);
    return connectedResult(selected, selected.provider);
  } catch (error) {
    removeProviderListeners();
    transition({type: "DISCONNECT"});
    return Object.freeze({status: "not-restored", code: errorCode(error), connectionState: walletState});
  }
}

export async function restoreCalendarWalletAfterLateInjection(windowLike = window, {
  timeoutMs = 160,
  providerKind = null,
  retryDelays = LATE_INJECTION_REDISCOVERY_MS,
} = {}) {
  if (!Array.isArray(retryDelays) || retryDelays.some((value, index) => !Number.isSafeInteger(value) || value < 0 || (index > 0 && value <= retryDelays[index - 1]))) {
    throw new TypeError("Calendar Wallet rediscovery delays must be ascending non-negative integers");
  }
  const startedAt = Date.now();
  let restored = await restoreCalendarWallet(windowLike, {timeoutMs, providerKind});
  if (restored?.standardConnection === "CONNECTED") return restored;

  for (const checkpoint of retryDelays) {
    while (Date.now() - startedAt < checkpoint) {
      await waitForLateProviderSignal(windowLike, checkpoint - (Date.now() - startedAt));
      restored = await restoreCalendarWallet(windowLike, {timeoutMs, providerKind});
      if (restored?.standardConnection === "CONNECTED") return restored;
    }
  }
  return restored;
}

export async function disconnectCalendarWallet() {
  if (!activeProvider || !activeCandidate) {
    return Object.freeze({status: "disconnected", permissionRevoked: false, connectionState: transition({type: "DISCONNECT"})});
  }
  if (activePermissionRevocation) {
    throw new DAppConnectError("WALLET_PERMISSION_REVOKE_PENDING", "A Wallet permission revocation is already pending.");
  }

  const provider = activeProvider;
  const revocation = {provider, suppressedEventCount: 0};
  activePermissionRevocation = revocation;
  let revokeSupported = true;
  try {
    try {
      await provider.request({method: "wallet_revokePermissions", params: [{eth_accounts: {}}]});
    } catch (error) {
      if (Number(error?.code) === 4001) throw error;
      if (!unsupportedMethod(error)) throw error;
      revokeSupported = false;
    }

    const accounts = await provider.request({method: "eth_accounts"});
    if (!Array.isArray(accounts)) {
      throw new DAppConnectError("WALLET_PERMISSION_READBACK_INVALID", "Wallet returned an invalid account-permission readback. The current connection was kept.");
    }
    if (accounts.length !== 0) {
      const code = revokeSupported ? "WALLET_PERMISSION_STILL_ACTIVE" : "WALLET_PERMISSION_REVOKE_UNSUPPORTED";
      const message = revokeSupported
        ? "Wallet still exposes an approved account after the revoke request. The current connection was kept."
        : "This Wallet does not support site-permission revocation and still exposes an approved account. Revoke this site in Wallet settings, then retry.";
      throw new DAppConnectError(code, message, {details: {approvedAccountCount: accounts.length}});
    }

    activePermissionRevocation = null;
    removeProviderListeners();
    return Object.freeze({
      status: "disconnected",
      permissionRevoked: revokeSupported,
      revokeMethodSupported: revokeSupported,
      connectionState: transition({type: "DISCONNECT"}),
    });
  } catch (error) {
    activePermissionRevocation = null;
    throw publicError(error);
  }
}

export async function switchCalendarWalletAccount() {
  if (!activeProvider || !activeCandidate) {
    throw new DAppConnectError("WALLET_NOT_CONNECTED", "Connect a Wallet before switching accounts.");
  }
  try {
    try {
      await activeProvider.request({method: "wallet_requestPermissions", params: [{eth_accounts: {}}]});
    } catch (error) {
      if (Number(error?.code) === 4001) throw error;
      if (Number(error?.code) !== 4200 && !/unsupported|not implemented/i.test(String(error?.message || ""))) throw error;
      await activeProvider.request({method: "eth_requestAccounts"});
    }
    const [accounts, chainId] = await Promise.all([
      activeProvider.request({method: "eth_accounts"}),
      activeProvider.request({method: "eth_chainId"}),
    ]);
    transition({type: "RESTORE", providerKind: activeCandidate.kind, accounts, chainId});
    if (walletState.status !== STANDARD_WALLET_CONNECT_STATUS.CONNECTED) {
      throw new DAppConnectError("WALLET_NOT_AUTHORIZED", "Wallet returned no approved YNX Testnet account.");
    }
    return connectedResult(activeCandidate, activeProvider);
  } catch (error) {
    throw publicError(error);
  }
}

export function calendarWalletState() { return walletState; }
