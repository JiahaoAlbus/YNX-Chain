import {DAppConnectError, classifyWalletError} from "./ynx-dapp-connect-sdk/errors.js";

export const SHARED_PROVIDER_AUTHORITY = Object.freeze({
  sourceCommit: "98c6d5d784d212df8981a53b17118a511e246ad2",
  sourceTree: "51a60a362d4ad5dd748bcdefb101f71b1d9e0cee",
  evidenceCommit: "c3ab255c32bdeb9c8e056882c315f8ad43c29c7f",
  discoveryAuthority: "unverified-injected-candidate",
  reducerAuthority: "standard-wallet-eip1193-state-only",
});

export const STANDARD_WALLET_CHAIN_ID = "0x1917";
export const STANDARD_WALLET_CONNECT_STATUS = Object.freeze({
  IDLE: "idle", DISCOVERING: "discovering", AWAITING_ACCOUNT: "awaiting-account",
  SWITCHING_CHAIN: "switching-chain", CONNECTED: "connected", WRONG_CHAIN: "wrong-chain",
  DISCONNECTED: "disconnected", FAILED: "failed",
});
export const WALLET_PROVIDER_KIND = Object.freeze({YNX: "ynx-wallet", METAMASK: "metamask"});
export const WALLET_DISCOVERY_SCHEDULE_MS = Object.freeze([0, 250, 750, 1500]);
export const YNX_TESTNET_ADD_CHAIN = Object.freeze({
  chainId: STANDARD_WALLET_CHAIN_ID,
  chainName: "YNX Testnet",
  nativeCurrency: Object.freeze({name: "YNX Testnet", symbol: "YNXT", decimals: 18}),
  rpcUrls: Object.freeze(["https://rpc.ynxweb4.com/evm"]),
  blockExplorerUrls: Object.freeze(["https://explorer.ynxweb4.com"]),
});
export const WALLET_INSTALLATION_OPTIONS = Object.freeze({
  ynxWallet: "https://www.ynxweb4.com/dapp/download",
  metaMask: "https://metamask.io/download/",
});

const EMPTY = Object.freeze([]);
const CONNECTED_ACTIONS = Object.freeze(["disconnect", "switch-account", "close"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const YNX_RDNS = new Set(["com.ynx.wallet", "com.ynx.wallet.companion"]);
const METAMASK_RDNS = new Set(["io.metamask", "io.metamask.flask"]);
const registries = new WeakMap();

export function createStandardWalletConnectState() {
  return walletState({status: STANDARD_WALLET_CONNECT_STATUS.IDLE});
}

export function reduceStandardWalletConnectState(current, event) {
  const previous = parseWalletState(current);
  if (!event || typeof event.type !== "string") throw new DAppConnectError("INVALID_STANDARD_WALLET_EVENT", "Standard Wallet transition event is invalid.");
  switch (event.type) {
    case "BEGIN":
      return walletState({status: STANDARD_WALLET_CONNECT_STATUS.DISCOVERING, chooserOpen: true, chooserMode: "connect", pendingIntent: intent(event.pendingIntent)});
    case "PROVIDER_SELECTED":
      requireStatus(previous, STANDARD_WALLET_CONNECT_STATUS.DISCOVERING);
      return walletState({...previous, status: STANDARD_WALLET_CONNECT_STATUS.AWAITING_ACCOUNT, providerKind: providerKind(event.providerKind)});
    case "ACCOUNT_APPROVED":
      requireStatus(previous, STANDARD_WALLET_CONNECT_STATUS.AWAITING_ACCOUNT);
      return walletState({...previous, status: STANDARD_WALLET_CONNECT_STATUS.SWITCHING_CHAIN, account: evmAccount(event.account)});
    case "CHAIN_CONFIRMED": {
      requireStatus(previous, STANDARD_WALLET_CONNECT_STATUS.SWITCHING_CHAIN);
      const chainId = chain(event.chainId);
      if (chainId !== STANDARD_WALLET_CHAIN_ID) return walletState({...previous, status: STANDARD_WALLET_CONNECT_STATUS.WRONG_CHAIN, chainId, chooserOpen: true, chooserMode: "wrong-chain"});
      return connectedState(previous.providerKind, previous.account, previous.privateService);
    }
    case "RESTORE": {
      const accounts = accountList(event.accounts);
      if (!accounts.length) return disconnectedState("accounts-empty");
      const chainId = chain(event.chainId);
      if (chainId !== STANDARD_WALLET_CHAIN_ID) return walletState({status: STANDARD_WALLET_CONNECT_STATUS.WRONG_CHAIN, providerKind: providerKind(event.providerKind), account: accounts[0], chainId});
      return connectedState(providerKind(event.providerKind), accounts[0], "not-requested");
    }
    case "OPEN_CHOOSER":
      if (previous.status === STANDARD_WALLET_CONNECT_STATUS.CONNECTED) return walletState({...previous, chooserOpen: true, chooserMode: "connection-details", chooserActions: CONNECTED_ACTIONS});
      return walletState({...previous, chooserOpen: true, chooserMode: "connect"});
    case "CLOSE_CHOOSER":
      return walletState({...previous, chooserOpen: false, chooserMode: "closed", focusRestoreTarget: "wallet-connect-trigger"});
    case "PRIVATE_SESSION_DEGRADED":
      requireStatus(previous, STANDARD_WALLET_CONNECT_STATUS.CONNECTED);
      return walletState({...previous, privateService: "degraded", privateServiceCode: safeCode(event.code), chooserOpen: false, chooserMode: "closed"});
    case "ACCOUNTS_CHANGED": {
      const accounts = accountList(event.accounts);
      if (!accounts.length) return disconnectedState("accounts-empty");
      if (![STANDARD_WALLET_CONNECT_STATUS.CONNECTED, STANDARD_WALLET_CONNECT_STATUS.WRONG_CHAIN].includes(previous.status)) throw new DAppConnectError("INVALID_STANDARD_WALLET_TRANSITION", "Account changes require a prior Wallet connection.");
      return walletState({...previous, account: accounts[0]});
    }
    case "CHAIN_CHANGED": {
      const chainId = chain(event.chainId);
      if (!previous.providerKind || !previous.account) throw new DAppConnectError("INVALID_STANDARD_WALLET_TRANSITION", "Chain changes require a prior Wallet connection.");
      if (chainId !== STANDARD_WALLET_CHAIN_ID) return walletState({...previous, status: STANDARD_WALLET_CONNECT_STATUS.WRONG_CHAIN, chainId, standardPermissions: EMPTY, productAccess: "guest-or-public-only", chooserOpen: false, chooserMode: "closed"});
      return connectedState(previous.providerKind, previous.account, previous.privateService);
    }
    case "NO_PROVIDER":
      return disconnectedState("provider-not-injected");
    case "PROVIDER_DISCONNECT":
    case "DISCONNECT":
      return disconnectedState(event.type === "PROVIDER_DISCONNECT" ? "provider-disconnect" : "user-disconnect");
    case "FAIL":
      return walletState({status: STANDARD_WALLET_CONNECT_STATUS.FAILED, chooserOpen: true, chooserMode: "error", errorCode: safeCode(event.code)});
    default:
      throw new DAppConnectError("INVALID_STANDARD_WALLET_EVENT", "Standard Wallet transition event is unknown.");
  }
}

export function createWalletProviderRegistry(scope = window, {scheduleMs = WALLET_DISCOVERY_SCHEDULE_MS, deadlineMs = 1750} = {}) {
  if (!scope?.addEventListener || !scope?.dispatchEvent) throw new DAppConnectError("DISCOVERY_ENVIRONMENT_REQUIRED", "Wallet discovery requires a browser event target.");
  if (!Array.isArray(scheduleMs) || scheduleMs.some(value => !Number.isSafeInteger(value) || value < 0) || !Number.isSafeInteger(deadlineMs) || deadlineMs < Math.max(...scheduleMs, 0)) throw new TypeError("Wallet discovery schedule is invalid.");
  const announced = new Map();
  const timers = new Set();
  let stopped = false;
  let initializedSeen = false;
  const receive = event => {
    const detail = event?.detail;
    const uuid = canonicalUuid(detail?.info?.uuid);
    if (!uuid || !detail?.provider?.request) return;
    const previous = announced.get(uuid);
    if (previous && previous.provider !== detail.provider) return void announced.delete(uuid);
    announced.set(uuid, detail);
  };
  const requestProviders = () => {
    if (stopped) return;
    const EventConstructor = scope.Event || globalThis.Event;
    if (typeof EventConstructor === "function") scope.dispatchEvent(new EventConstructor("eip6963:requestProvider"));
  };
  const initialized = () => {
    if (initializedSeen) return;
    initializedSeen = true;
    requestProviders();
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    scope.removeEventListener?.("eip6963:announceProvider", receive);
    scope.removeEventListener?.("ethereum#initialized", initialized);
  };
  scope.addEventListener("eip6963:announceProvider", receive);
  scope.addEventListener("ethereum#initialized", initialized, {once: true});
  for (const at of scheduleMs) {
    const timer = setTimeout(() => { timers.delete(timer); requestProviders(); }, at);
    timers.add(timer);
  }
  const deadlineTimer = setTimeout(() => { timers.delete(deadlineTimer); stop(); }, deadlineMs);
  timers.add(deadlineTimer);
  return Object.freeze({
    snapshot: () => listCandidatesFromWindow(scope, [...announced.values()]),
    wait: milliseconds => new Promise(resolve => setTimeout(() => resolve(listCandidatesFromWindow(scope, [...announced.values()])), milliseconds)),
    requestProviders, stop, authority: SHARED_PROVIDER_AUTHORITY.discoveryAuthority,
  });
}

export function getWalletProviderRegistry(scope = window) {
  let registry = registries.get(scope);
  if (!registry) { registry = createWalletProviderRegistry(scope); registries.set(scope, registry); }
  return registry;
}

export function listCandidatesFromWindow(scope = window, details = []) {
  const output = [];
  const seen = new Set();
  const add = (detail, provider, source) => {
    const candidate = normalizeProvider(detail, provider, source);
    if (!candidate || seen.has(candidate.provider)) return;
    seen.add(candidate.provider);
    output.push(candidate);
  };
  for (const detail of details) add(detail, detail?.provider, "eip6963");
  const ethereum = safely(() => scope.ethereum);
  const providers = safely(() => ethereum?.providers);
  if (Array.isArray(providers)) for (const provider of providers) add({info: provider?.providerInfo}, provider, "legacy-injected");
  else if (ethereum) add({info: ethereum?.providerInfo}, ethereum, "legacy-injected");
  return output;
}

export async function discoverWalletCandidates(scope = window, {timeoutMs = 160} = {}) {
  const registry = getWalletProviderRegistry(scope);
  registry.requestProviders();
  const candidates = await registry.wait(timeoutMs);
  if (!candidates.length) throw new DAppConnectError("PROVIDER_NOT_INJECTED", "No supported Wallet provider was injected. The extension may be locked, disabled, denied site access, or not installed.", {details: WALLET_INSTALLATION_OPTIONS});
  return candidates;
}

export async function connectVideoWallet(scope = window, {timeoutMs = 160, walletId, pendingIntent = createPendingIntent(scope)} = {}) {
  let state = reduceStandardWalletConnectState(createStandardWalletConnectState(), {type: "BEGIN", pendingIntent});
  let candidates;
  try { candidates = await discoverWalletCandidates(scope, {timeoutMs}); }
  catch (error) { reduceStandardWalletConnectState(state, {type: "NO_PROVIDER"}); throw error; }
  const selected = selectCandidate(candidates, walletId);
  state = reduceStandardWalletConnectState(state, {type: "PROVIDER_SELECTED", providerKind: selected.kind});
  let accounts;
  try { accounts = await selected.provider.request({method: "eth_requestAccounts"}); }
  catch (error) { throw classifyWalletError(error); }
  if (!Array.isArray(accounts) || !accounts[0]) throw new DAppConnectError("INVALID_EVM_ACCOUNT", "Wallet did not return an approved 0x EVM account.");
  state = reduceStandardWalletConnectState(state, {type: "ACCOUNT_APPROVED", account: accounts[0]});
  await ensureYNXTestnet(selected.provider);
  const chainId = String(await selected.provider.request({method: "eth_chainId"})).toLowerCase();
  state = reduceStandardWalletConnectState(state, {type: "CHAIN_CONFIRMED", chainId});
  state = reduceStandardWalletConnectState(state, {type: "PRIVATE_SESSION_DEGRADED", code: "PRIVATE_SERVICE_DEGRADED"});
  return Object.freeze({account: state.account, chainId: state.chainId, provider: selected.provider, connection: Object.freeze({provider: selected.provider}), connectState: state, productSession: "PRIVATE_SERVICE_DEGRADED", walletId: selected.id, walletName: selected.label, walletLabel: selected.label, walletBrand: selected.label, walletKind: selected.kind, providerInfo: Object.freeze({name: selected.label, rdns: selected.rdns, isMetaMask: selected.kind === WALLET_PROVIDER_KIND.METAMASK, isYNXWallet: selected.kind === WALLET_PROVIDER_KIND.YNX, icon: selected.icon, uuid: selected.id}), standardConnection: "CONNECTED"});
}

export async function restoreVideoWallet(scope, saved) {
  const candidates = await discoverWalletCandidates(scope, {timeoutMs: 160});
  const selected = candidates.find(candidate => candidate.id === saved?.walletId || candidate.rdns === saved?.providerRdns);
  if (!selected) return null;
  const accounts = await selected.provider.request({method: "eth_accounts"});
  const chainId = await selected.provider.request({method: "eth_chainId"});
  const state = reduceStandardWalletConnectState(createStandardWalletConnectState(), {type: "RESTORE", providerKind: selected.kind, accounts, chainId});
  if (state.status !== STANDARD_WALLET_CONNECT_STATUS.CONNECTED) return null;
  return Object.freeze({provider: selected.provider, connection: Object.freeze({provider: selected.provider}), connectState: state, account: state.account, chainId: state.chainId, walletId: selected.id, walletName: selected.label, walletLabel: selected.label, walletBrand: selected.label, walletKind: selected.kind, providerInfo: Object.freeze({name: selected.label, rdns: selected.rdns, isMetaMask: selected.kind === WALLET_PROVIDER_KIND.METAMASK, isYNXWallet: selected.kind === WALLET_PROVIDER_KIND.YNX, icon: selected.icon, uuid: selected.id})});
}

export async function requestWalletAccountSwitch(provider) {
  if (!provider?.request) throw new DAppConnectError("PROVIDER_REQUIRED", "A selected Wallet provider is required.");
  try {
    await provider.request({method: "wallet_requestPermissions", params: [{eth_accounts: {}}]});
    const accounts = await provider.request({method: "eth_accounts"});
    if (!Array.isArray(accounts) || !accounts[0]) throw new DAppConnectError("ACCOUNT_REQUIRED", "Wallet did not return an approved account after account selection.");
    return evmAccount(accounts[0]);
  } catch (error) { throw classifyWalletError(error); }
}

export async function revokeWalletPermissions(provider) {
  if (!provider?.request) return Object.freeze({providerRevoked: false, localDisconnected: true});
  try { await provider.request({method: "wallet_revokePermissions", params: [{eth_accounts: {}}]}); return Object.freeze({providerRevoked: true, localDisconnected: true}); }
  catch { return Object.freeze({providerRevoked: false, localDisconnected: true}); }
}

export function walletChoiceNeedsResolution(error) { return error instanceof DAppConnectError && error.code === "WALLET_SELECTION_REQUIRED"; }
export function walletCandidatesFromError(error) { return error instanceof DAppConnectError && Array.isArray(error.details?.candidates) ? error.details.candidates : []; }

function normalizeProvider(detail, provider, source) {
  if (!provider?.request) return null;
  const info = detail?.info || {};
  const rdns = canonicalRdns(info.rdns || provider?.providerInfo?.rdns || provider?.rdns);
  const ynxFlag = info.isYNXWallet === true || provider.isYNXWallet === true || provider.isYnxWallet === true;
  const metaMaskFlag = info.isMetaMask === true || provider.isMetaMask === true;
  const ynx = ynxFlag && YNX_RDNS.has(rdns);
  const metamask = !ynx && !ynxFlag && (METAMASK_RDNS.has(rdns) || metaMaskFlag);
  if (!ynx && !metamask || ynxFlag && metaMaskFlag) return null;
  const kind = ynx ? WALLET_PROVIDER_KIND.YNX : WALLET_PROVIDER_KIND.METAMASK;
  const id = source === "eip6963" ? canonicalUuid(info.uuid) : `${kind}:${rdns}`;
  if (!id) return null;
  const icon = safeIcon(info.icon);
  return Object.freeze({provider, kind, id, label: ynx ? "YNX Wallet" : "MetaMask", rdns, icon, source, isYNXWallet: ynx, isMetaMask: metamask, info: Object.freeze({uuid: id, name: ynx ? "YNX Wallet" : "MetaMask", rdns, icon}), authority: SHARED_PROVIDER_AUTHORITY.discoveryAuthority});
}

function selectCandidate(candidates, walletId) {
  if (walletId) {
    const selected = candidates.find(candidate => candidate.id === walletId || candidate.label === walletId);
    if (!selected) throw new DAppConnectError("WALLET_NOT_FOUND", "The selected Wallet is no longer available.");
    return selected;
  }
  if (candidates.length === 1) return candidates[0];
  throw new DAppConnectError("WALLET_SELECTION_REQUIRED", "Choose YNX Wallet or MetaMask explicitly.", {details: {candidates}});
}

async function ensureYNXTestnet(provider) {
  const current = String(await provider.request({method: "eth_chainId"})).toLowerCase();
  if (current === STANDARD_WALLET_CHAIN_ID) return;
  try { await provider.request({method: "wallet_switchEthereumChain", params: [{chainId: STANDARD_WALLET_CHAIN_ID}]}); }
  catch (error) {
    const code = Number(error?.code ?? error?.data?.originalError?.code);
    if (code !== 4902) throw classifyWalletError(error);
    await provider.request({method: "wallet_addEthereumChain", params: [YNX_TESTNET_ADD_CHAIN]});
    await provider.request({method: "wallet_switchEthereumChain", params: [{chainId: STANDARD_WALLET_CHAIN_ID}]});
  }
}

function connectedState(kind, account, privateService) { return walletState({status: STANDARD_WALLET_CONNECT_STATUS.CONNECTED, providerKind: kind, account, chainId: STANDARD_WALLET_CHAIN_ID, chooserActions: CONNECTED_ACTIONS, focusRestoreTarget: "wallet-connect-trigger", privateService, standardPermissions: Object.freeze(["account:read", "chain:read"]), productAccess: "standard-wallet-connected"}); }
function disconnectedState(reason) { return walletState({status: STANDARD_WALLET_CONNECT_STATUS.DISCONNECTED, disconnectReason: reason, focusRestoreTarget: "wallet-connect-trigger"}); }
function walletState(input) { return Object.freeze({status: input.status, chooserOpen: input.chooserOpen ?? false, chooserMode: input.chooserMode ?? "closed", chooserActions: input.chooserActions ?? EMPTY, pendingIntent: input.pendingIntent ?? null, providerKind: input.providerKind ?? null, account: input.account ?? null, chainId: input.chainId ?? null, privateService: input.privateService ?? "not-requested", privateServiceCode: input.privateServiceCode ?? null, standardPermissions: input.standardPermissions ?? EMPTY, productAccess: input.productAccess ?? "guest-or-public-only", focusRestoreTarget: input.focusRestoreTarget ?? null, errorCode: input.errorCode ?? null, disconnectReason: input.disconnectReason ?? null, authority: SHARED_PROVIDER_AUTHORITY.reducerAuthority}); }
function parseWalletState(value) { if (!value || value.authority !== SHARED_PROVIDER_AUTHORITY.reducerAuthority) throw new DAppConnectError("INVALID_STANDARD_WALLET_STATE", "Standard Wallet state is invalid."); return value; }
function requireStatus(value, expected) { if (value.status !== expected) throw new DAppConnectError("INVALID_STANDARD_WALLET_TRANSITION", `Standard Wallet transition requires ${expected}.`); }
function providerKind(value) { if (!Object.values(WALLET_PROVIDER_KIND).includes(value)) throw new DAppConnectError("INVALID_STANDARD_WALLET_PROVIDER", "Standard Wallet provider kind is invalid."); return value; }
function evmAccount(value) { if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new DAppConnectError("INVALID_STANDARD_WALLET_ACCOUNT", "Standard Wallet account is invalid."); return value.toLowerCase(); }
function accountList(value) { if (!Array.isArray(value)) throw new DAppConnectError("INVALID_STANDARD_WALLET_ACCOUNT", "Standard Wallet account list is invalid."); return value.map(evmAccount); }
function chain(value) { if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) throw new DAppConnectError("INVALID_STANDARD_WALLET_CHAIN", "Standard Wallet chain is invalid."); return value.toLowerCase(); }
function safeCode(value) { if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(value)) throw new DAppConnectError("INVALID_STANDARD_WALLET_ERROR", "Standard Wallet error code is invalid."); return value; }
function intent(value) { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) throw new DAppConnectError("INVALID_STANDARD_WALLET_INTENT", "Standard Wallet pending intent is invalid."); return value; }
function createPendingIntent(scope) { const bytes = new Uint8Array(16); (scope?.crypto || globalThis.crypto).getRandomValues(bytes); return [...bytes].map(value => value.toString(16).padStart(2, "0")).join(""); }
function canonicalUuid(value) { return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null; }
function canonicalRdns(value) { return typeof value === "string" ? value.toLowerCase() : ""; }
function safeIcon(value) { return typeof value === "string" && (/^data:image\/(?:svg\+xml|png|webp);/i.test(value) || /^https:\/\//.test(value)) ? value : ""; }
function safely(read) { try { return read(); } catch { return undefined; } }
