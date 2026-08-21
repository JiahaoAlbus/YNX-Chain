export const YNX_CHAIN = Object.freeze({
  chainId: "0x1917",
  chainName: "YNX Testnet",
  nativeCurrency: Object.freeze({ name: "YNX Testnet", symbol: "YNXT", decimals: 18 }),
  rpcUrls: Object.freeze(["https://evm.ynxweb4.com"]),
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
  const isMetaMask = Boolean(provider?.isMetaMask) || name.includes("metamask") || rdns.includes("metamask");
  const isYNX = Boolean(provider?.isYNXWallet) || name.includes("ynx") || rdns.includes("ynx");
  return Object.freeze({ isMetaMask, isYNX });
}

export function selectProvider(details, wallet) {
  const matches = details.filter((detail) => classifyProvider(detail)[wallet === "ynx" ? "isYNX" : "isMetaMask"]);
  if (matches.length === 0) return Object.freeze({ ok: false, code: wallet === "ynx" ? "YNX_WALLET_NOT_FOUND" : "METAMASK_NOT_FOUND" });
  const unique = new Map(matches.map((detail, index) => [providerId(detail, index), detail]));
  if (unique.size !== 1) return Object.freeze({ ok: false, code: "AMBIGUOUS_WALLET_PROVIDER" });
  return Object.freeze({ ok: true, detail: [...unique.values()][0] });
}

export async function discoverProviders(target = window, waitMs = 350) {
  const found = new Map();
  const listener = (event) => {
    const detail = event?.detail;
    if (!detail?.provider || typeof detail.provider.request !== "function") return;
    found.set(providerId(detail, found.size), detail);
  };
  target.addEventListener("eip6963:announceProvider", listener);
  target.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((resolve) => target.setTimeout(resolve, waitMs));
  target.removeEventListener("eip6963:announceProvider", listener);
  if (found.size === 0 && target.ethereum?.request) {
    const provider = target.ethereum;
    found.set("legacy-injected", { info: { name: provider.isMetaMask ? "MetaMask" : "Injected wallet", rdns: "legacy.injected" }, provider });
  }
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
