import {discoverEIP6963} from "./ynx-dapp-connect-sdk/discovery.js";
import {DAppConnectError} from "./ynx-dapp-connect-sdk/errors.js";
import {StandardWalletConnection} from "./ynx-dapp-connect-sdk/provider.js";

const REDUCE_STATES = Object.freeze({
  RESTORE: "RESTORE",
  CHAIN_CONFIRMED: "CHAIN_CONFIRMED",
  OPEN_CHOOSER: "OPEN_CHOOSER",
  PRIVATE_SERVICE_DEGRADED: "PRIVATE_SERVICE_DEGRADED",
  PRIVATE_SESSION_DEGRADED: "PRIVATE_SESSION_DEGRADED",
  RPC_PROBE_DEGRADED: "RPC_PROBE_DEGRADED",
});

const REDUCE_ACTIONS = Object.freeze({
  ACCOUNT_APPROVED: "ACCOUNT_APPROVED",
  ACCOUNTS_CHANGED: "ACCOUNTS_CHANGED",
  CHAIN_CHANGED: "CHAIN_CHANGED",
  CHAIN_CONFIRMED: "CHAIN_CONFIRMED",
  OPEN_CHOOSER: "OPEN_CHOOSER",
  PROVIDER_DISCONNECT: "PROVIDER_DISCONNECT",
  RESTORE: "RESTORE",
  RPC_PROBE_DEGRADED: "RPC_PROBE_DEGRADED",
  PRIVATE_SERVICE_DEGRADED: "PRIVATE_SERVICE_DEGRADED",
  PRIVATE_SESSION_DEGRADED: "PRIVATE_SESSION_DEGRADED",
});

export const STANDARD_WALLET_CONNECTION_TOKENS = Object.freeze({
  ACCEPTED_CORS_SAFE: "accepted-cors-safe",
});

export function reduceStandardWalletConnectState(state = REDUCE_STATES.RESTORE, action, payload = null) {
  const nextState = String(state ?? REDUCE_STATES.RESTORE);
  if (action === REDUCE_ACTIONS.RESTORE) return Object.freeze({state: REDUCE_STATES.RESTORE, ...payload});
  if (action === REDUCE_ACTIONS.OPEN_CHOOSER) return Object.freeze({state: REDUCE_STATES.OPEN_CHOOSER, ...payload});
  if (action === REDUCE_ACTIONS.ACCOUNT_APPROVED) return Object.freeze({state: REDUCE_STATES.OPEN_CHOOSER, account: payload?.account ?? null, ...payload, source: "walletConnection"});
  if (action === REDUCE_ACTIONS.CHAIN_CONFIRMED) return Object.freeze({state: REDUCE_STATES.CHAIN_CONFIRMED, ...payload});
  if (action === REDUCE_ACTIONS.CHAIN_CHANGED) return Object.freeze({state: REDUCE_STATES.RESTORE, ...payload});
  if (action === REDUCE_ACTIONS.ACCOUNTS_CHANGED) return Object.freeze({state: REDUCE_STATES.RESTORE, ...payload});
  if (action === REDUCE_ACTIONS.PROVIDER_DISCONNECT) return Object.freeze({state: REDUCE_STATES.RESTORE, ...payload});
  if (action === REDUCE_ACTIONS.PRIVATE_SERVICE_DEGRADED) return Object.freeze({state: nextState, privateService: REDUCE_STATES.PRIVATE_SERVICE_DEGRADED, ...payload});
  if (action === REDUCE_ACTIONS.PRIVATE_SESSION_DEGRADED) return Object.freeze({state: nextState, privateSession: REDUCE_STATES.PRIVATE_SESSION_DEGRADED, ...payload});
  if (action === REDUCE_ACTIONS.RPC_PROBE_DEGRADED) return Object.freeze({state: REDUCE_STATES.RPC_PROBE_DEGRADED, ...payload});
  return Object.freeze({state: nextState});
}

export const YNX_TESTNET_ADD_CHAIN = Object.freeze({
  chainId: "0x1917",
  chainName: "YNX Testnet",
  nativeCurrency: Object.freeze({name: "YNX Testnet", symbol: "YNXT", decimals: 18}),
  rpcUrls: Object.freeze(["https://evm.ynxweb4.com"]),
  blockExplorerUrls: Object.freeze(["https://explorer.ynxweb4.com"]),
});

export const WALLET_INSTALLATION_OPTIONS = Object.freeze({
  ynxWallet: "https://www.ynxweb4.com/dapp/download",
  metaMask: "https://metamask.io/download/",
});

const YNX_LOGO = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='10' fill='%230026d6'/%3E%3Cpath d='M20 20h24v24H20z' fill='white'/%3E%3Ctext x='32' y='40' text-anchor='middle' fill='%230026d6' font-size='18' font-family='Arial' font-weight='700'%3EYNX%3C/text%3E%3C/svg%3E";
const METAMASK_LOGO = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='10' fill='%23F6851B'/%3E%3Cpath d='M20 19l12 7.5L44 19l3 4.5-16 10.5-16-10.5z' fill='white'/%3E%3Crect x='20.5' y='31' width='23' height='16' rx='2' fill='white'/%3E%3C/svg%3E";

function isYnxWallet(detail) {
  const name = `${detail?.info?.name ?? ""}`.trim().toLowerCase();
  const rdns = `${detail?.info?.rdns ?? ""}`.toLowerCase();
  return detail?.info?.isYNXWallet === true ||
    detail?.provider?.isYNXWallet === true ||
    detail?.provider?.isYnxWallet === true ||
    name === "ynx wallet" ||
    rdns === "com.ynx.wallet";
}

function isMetaMask(detail) {
  if (detail?.info?.isMetaMask || detail?.provider?.isMetaMask) return true;
  const name = `${detail?.info?.name ?? ""}`.toLowerCase();
  const rdns = `${detail?.info?.rdns ?? ""}`.toLowerCase();
  return name === "metamask" || rdns === "io.metamask";
}

function safeAnnouncedIcon(value) {
  const icon = `${value ?? ""}`;
  return icon.length <= 16384 && /^data:image\/(?:png|svg\+xml|webp);/iu.test(icon) ? icon : "";
}

function normalizeProvider(detail, provider) {
  const ynxWallet = isYnxWallet(detail);
  const metaMask = isMetaMask(detail);
  const name = (detail?.info?.name || "Injected EVM Wallet").trim();
  const safeInfo = detail?.info || {};
  const safeRdns = `${safeInfo.rdns || ""}`.toLowerCase();
  return {
    provider: provider || detail.provider,
    info: {
      name,
      rdns: safeRdns,
      uuid: safeInfo.uuid || `${name}:${provider?.chainId ?? "provider"}`,
      icon: safeInfo.icon,
    },
    isYNXWallet: ynxWallet,
    isMetaMask: metaMask && !ynxWallet,
    icon: ynxWallet ? YNX_LOGO : (metaMask ? safeAnnouncedIcon(detail?.info?.icon) || METAMASK_LOGO : safeAnnouncedIcon(detail?.info?.icon)),
    label: ynxWallet ? "YNX Wallet" : (metaMask ? "MetaMask" : name),
  };
}

function injectedFallback(windowLike) {
  const provider = windowLike?.ethereum;
  if (!provider?.request) return [];
  const detected = normalizeProvider({info:{name: provider.isMetaMask ? "MetaMask" : "Injected EVM Wallet", rdns: provider.isMetaMask ? "io.metamask" : "injected.wallet", icon: provider.icon, uuid: "legacy-injected-provider", isMetaMask: provider.isMetaMask}}, provider);
  return [detected];
}

export function listCandidatesFromWindow(windowLike = window, details = []) {
  const providers = new Map();
  for (const detail of details) {
    const provider = normalizeProvider(detail);
    if (!provider.provider?.request) continue;
    const key = `${provider.info.uuid}:${provider.info.name}`;
    providers.set(key, provider);
  }
  for (const provider of injectedFallback(windowLike)) {
    const key = `${provider.info.uuid}:${provider.info.name}`;
    providers.set(key, provider);
  }
  if (windowLike?.ethereum?.providers) {
    for (const provider of windowLike.ethereum.providers) {
      const normalized = normalizeProvider({info:{name:provider.isMetaMask?"MetaMask":"Injected Wallet",rdns:provider.isMetaMask?"io.metamask":"injected.wallet",uuid:provider.providerId||provider.uuid,isMetaMask:provider.isMetaMask}},provider);
      if (!normalized.provider?.request) continue;
      const key = `${normalized.info.uuid}:${normalized.info.name}`;
      providers.set(key, normalized);
    }
  }
  return [...providers.values()];
}

export async function discoverWalletCandidates(windowLike = window, {timeoutMs = 1500} = {}) {
  const announced = new Map();
  const phases = [...new Set([250, 750, 1500].filter(value => value < timeoutMs).concat(timeoutMs))].sort((a,b)=>a-b);
  let elapsed = 0;
  for (const phase of phases) {
    const batch = await discoverEIP6963(windowLike, {timeoutMs: Math.max(0, phase - elapsed)});
    for (const detail of batch) announced.set(detail.info.uuid, detail);
    elapsed = phase;
  }
  const withInjected = listCandidatesFromWindow(windowLike, [...announced.values()]);
  if (!withInjected.length) throw new DAppConnectError("WALLET_NOT_INSTALLED", "No standard EVM Wallet was discovered.", {details: WALLET_INSTALLATION_OPTIONS});
  return withInjected;
}

function findMatching(candidateList, {walletId}) {
  if (walletId) {
    const found = candidateList.find((entry) => entry.info.uuid === walletId || `${entry.info.uuid}` === `${walletId}` || entry.label === walletId);
    if (!found) throw new DAppConnectError("WALLET_NOT_FOUND", "The selected Wallet was not available.", {details: {walletId, candidates: candidateList.map((entry) => ({uuid: entry.info.uuid, name: entry.label, rdns: entry.info.rdns, isYNXWallet: entry.isYNXWallet, isMetaMask: entry.isMetaMask}))}});
    return found;
  }

  const ynx = candidateList.filter((entry) => entry.isYNXWallet);
  const metamask = candidateList.filter((entry) => entry.isMetaMask);
  if (ynx.length > 1) throw new DAppConnectError("AMBIGUOUS_YNX_WALLET", "More than one YNX Wallet provider was announced. Disable duplicates and retry.");
  if (metamask.length > 1) throw new DAppConnectError("AMBIGUOUS_METAMASK_WALLET", "More than one MetaMask provider was discovered. Disable duplicates and retry.");
  if (ynx.length === 1 && metamask.length === 1) {
    throw new DAppConnectError("WALLET_SELECTION_REQUIRED", "Both YNX Wallet and MetaMask are available. The user must choose a provider.", {
      details: candidateList.map((entry) => ({uuid: entry.info.uuid, name: entry.label, rdns: entry.info.rdns, isYNXWallet: entry.isYNXWallet, isMetaMask: entry.isMetaMask, icon: entry.icon})),
    });
  }
  if (ynx.length === 1) return ynx[0];
  if (metamask.length === 1) return metamask[0];
  if (candidateList.length === 1) return candidateList[0];
  throw new DAppConnectError("WALLET_SELECTION_REQUIRED", "Automatic selection is not safe with ambiguous providers. Show wallet chooser and use explicit selection.", {details: candidateList.map((entry) => ({uuid: entry.info.uuid, name: entry.label, rdns: entry.info.rdns, isYNXWallet: entry.isYNXWallet, isMetaMask: entry.isMetaMask, icon: entry.icon}))});
}

export async function connectVideoWallet(windowLike = window, {timeoutMs = 250, walletId} = {}) {
  const candidates = await discoverWalletCandidates(windowLike, {timeoutMs});
  reduceStandardWalletConnectState(undefined, "OPEN_CHOOSER", {candidates: candidates.length});
  const selected = findMatching(candidates, {walletId});
  if (!selected) throw new DAppConnectError("WALLET_NOT_INSTALLED", "No standard EVM Wallet was discovered.", {details: WALLET_INSTALLATION_OPTIONS});
  const connection = new StandardWalletConnection(selected.provider);
  const connected = await connection.connect();
  reduceStandardWalletConnectState({state: REDUCE_STATES.OPEN_CHOOSER}, "ACCOUNT_APPROVED", {account: connected.account});
  await connection.ensureYNXTestnet({addChain: YNX_TESTNET_ADD_CHAIN});
  const chainId = await selected.provider.request({method: "eth_chainId"});
  if (String(chainId).toLowerCase() !== "0x1917") throw new DAppConnectError("WRONG_CHAIN", "Wallet did not finish switching to YNX Testnet.");
  reduceStandardWalletConnectState({state: REDUCE_STATES.OPEN_CHOOSER}, "CHAIN_CONFIRMED", {chainId});
  return Object.freeze({
    account: connected.account,
    chainId,
    connection,
    productSession: "PRIVATE_SERVICE_DEGRADED",
    walletId: selected.info.uuid,
    walletName: selected.info.name,
    walletLabel: selected.label,
    walletBrand: selected.isYNXWallet ? "YNX Wallet" : selected.isMetaMask ? "MetaMask" : selected.label,
    providerInfo: {
      name: selected.info.name,
      rdns: selected.info.rdns,
      isMetaMask: selected.isMetaMask,
      isYNXWallet: selected.isYNXWallet,
      icon: selected.icon,
      uuid: selected.info.uuid,
    },
    standardConnection: "CONNECTED",
  });
}

export function walletChoiceNeedsResolution(error) {
  return error instanceof DAppConnectError && error.code === "WALLET_SELECTION_REQUIRED";
}

export function walletCandidatesFromError(error) {
  return error instanceof DAppConnectError && Array.isArray(error.details?.candidates) ? error.details.candidates : [];
}
