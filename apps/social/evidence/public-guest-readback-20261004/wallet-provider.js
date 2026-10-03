export const YNX_CHAIN = Object.freeze({
  chainId: "0x1917",
  chainName: "YNX Testnet",
  nativeCurrency: Object.freeze({ name: "YNX Testnet", symbol: "YNXT", decimals: 18 }),
  rpcUrls: Object.freeze(["https://rpc.ynxweb4.com/evm"]),
  blockExplorerUrls: Object.freeze(["https://explorer.ynxweb4.com"]),
});

export const WALLET_LINKS = Object.freeze({
  ynx: "https://www.ynxweb4.com/dapp/download",
  metamask: "https://metamask.io/download/",
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function providerId(detail, index) {
  const info = detail?.info ?? {};
  return text(info.uuid) || text(info.rdns) || text(info.name) || `provider-${index}`;
}

export function classifyProvider(detail) {
  const info = detail?.info ?? {};
  const provider = detail?.provider;
  const name = text(info.name).toLowerCase();
  const rdns = text(info.rdns).toLowerCase();
  const claimsYNX = Boolean(provider?.isYNXWallet) || name === "ynx wallet" || rdns === "com.ynx.wallet";
  const claimsMetaMask = Boolean(provider?.isMetaMask) || name === "metamask" || rdns === "io.metamask";
  const isYNX = claimsYNX && !claimsMetaMask;
  const isMetaMask = claimsMetaMask && !claimsYNX;
  return Object.freeze({ isMetaMask, isYNX });
}

export function selectProvider(details, wallet) {
  const matches = details.filter((detail) => classifyProvider(detail)[wallet === "ynx" ? "isYNX" : "isMetaMask"]);
  if (matches.length === 0) return Object.freeze({ ok: false, code: wallet === "ynx" ? "YNX_WALLET_NOT_FOUND" : "METAMASK_NOT_FOUND" });
  const unique = new Map(matches.map((detail, index) => [providerId(detail, index), detail]));
  if (unique.size !== 1) return Object.freeze({ ok: false, code: "AMBIGUOUS_WALLET_PROVIDER" });
  return Object.freeze({ ok: true, detail: [...unique.values()][0] });
}

const DISCOVERY_DELAYS = Object.freeze([0, 250, 750, 1500]);

function announceLegacyProviders(target, found) {
  const root = target.ethereum;
  const providers = Array.isArray(root?.providers) ? root.providers : [];
  for (const [index, provider] of [...providers, root].entries()) {
    if (!provider || typeof provider.request !== "function") continue;
    const name = provider.isYNXWallet ? "YNX Wallet" : provider.isMetaMask ? "MetaMask" : "Injected wallet";
    const rdns = provider.isYNXWallet ? "com.ynx.wallet" : provider.isMetaMask ? "io.metamask" : "legacy.injected";
    const detail = { info: { uuid: `legacy-${rdns}-${index}`, name, rdns }, provider, source: providers.includes(provider) ? "window.ethereum.providers" : "window.ethereum" };
    found.set(providerId(detail, found.size), detail);
  }
}

export async function discoverProviders(target = window, waitMs = 1500) {
  const found = new Map();
  const listener = (event) => {
    const detail = event?.detail;
    if (!detail?.provider || typeof detail.provider.request !== "function") return;
    found.set(providerId(detail, found.size), detail);
  };
  target.addEventListener("eip6963:announceProvider", listener);
  const request = () => {
    target.dispatchEvent(new Event("eip6963:requestProvider"));
    announceLegacyProviders(target, found);
  };
  const onInitialized = () => request();
  const onReady = () => request();
  target.addEventListener("ethereum#initialized", onInitialized);
  target.document?.addEventListener?.("DOMContentLoaded", onReady, { once: true });
  for (const delay of DISCOVERY_DELAYS.filter((value) => value <= waitMs)) {
    if (delay) await new Promise((resolve) => target.setTimeout(resolve, delay - (DISCOVERY_DELAYS[DISCOVERY_DELAYS.indexOf(delay) - 1] ?? 0)));
    request();
  }
  target.removeEventListener("eip6963:announceProvider", listener);
  target.removeEventListener("ethereum#initialized", onInitialized);
  target.document?.removeEventListener?.("DOMContentLoaded", onReady);
  return [...found.values()];
}

export async function ensureYNXChain(provider) {
  const current = await provider.request({ method: "eth_chainId" });
  if (String(current).toLowerCase() === YNX_CHAIN.chainId) return YNX_CHAIN.chainId;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: YNX_CHAIN.chainId }] });
  } catch (error) {
    if (Number(error?.code) !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [YNX_CHAIN] });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: YNX_CHAIN.chainId }] });
  }
  const verified = await provider.request({ method: "eth_chainId" });
  if (String(verified).toLowerCase() !== YNX_CHAIN.chainId) throw Object.assign(new Error("Wallet did not switch to YNX Testnet."), { code: "WRONG_CHAIN" });
  return YNX_CHAIN.chainId;
}

export async function connectWallet(wallet, target = window) {
  const providers = await discoverProviders(target);
  const selected = selectProvider(providers, wallet);
  if (!selected.ok) return selected;
  const accounts = await selected.detail.provider.request({ method: "eth_requestAccounts" });
  const account = Array.isArray(accounts) ? text(accounts[0]) : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) return Object.freeze({ ok: false, code: "ACCOUNT_NOT_AUTHORIZED" });
  const chainId = await ensureYNXChain(selected.detail.provider);
  return Object.freeze({ ok: true, wallet, account, chainId, provider: selected.detail.provider });
}

export async function restoreWallet(wallet, target = window) {
  const selected = selectProvider(await discoverProviders(target), wallet);
  if (!selected.ok) return selected;
  const accounts = await selected.detail.provider.request({ method: "eth_accounts" });
  const account = Array.isArray(accounts) ? text(accounts[0]) : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) return Object.freeze({ ok: false, code: "NO_APPROVED_ACCOUNT" });
  const chainId = String(await selected.detail.provider.request({ method: "eth_chainId" })).toLowerCase();
  if (chainId !== YNX_CHAIN.chainId) return Object.freeze({ ok: false, code: "WRONG_CHAIN" });
  return Object.freeze({ ok: true, wallet, account, chainId, provider: selected.detail.provider });
}

export function attachWalletLifecycle(provider, handlers = {}) {
  const accountsChanged = (accounts) => handlers.onAccountsChanged?.(Array.isArray(accounts) ? accounts : []);
  const chainChanged = (chainId) => handlers.onChainChanged?.(String(chainId).toLowerCase());
  const disconnected = (error) => handlers.onDisconnect?.(error);
  provider.on?.("accountsChanged", accountsChanged);
  provider.on?.("chainChanged", chainChanged);
  provider.on?.("disconnect", disconnected);
  return () => {
    provider.removeListener?.("accountsChanged", accountsChanged);
    provider.removeListener?.("chainChanged", chainChanged);
    provider.removeListener?.("disconnect", disconnected);
  };
}

export async function switchWalletAccount(provider) {
  let accounts;
  try {
    accounts = await provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  } catch (error) {
    if (Number(error?.code) === 4001) throw error;
  }
  const approved = await provider.request({ method: accounts ? "eth_accounts" : "eth_requestAccounts" });
  const account = Array.isArray(approved) ? text(approved[0]) : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) throw Object.assign(new Error("No approved EVM account was returned."), { code: "ACCOUNT_NOT_AUTHORIZED" });
  return Object.freeze({ account, chainId: await ensureYNXChain(provider) });
}

export async function revokeWallet(provider) {
  try {
    await provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  } catch (error) {
    if (![4100, 4200, -32601].includes(Number(error?.code))) throw error;
  }
}
