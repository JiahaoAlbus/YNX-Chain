import { StandardWalletConnection, discoverWalletProviders } from "./vendor/standard-wallet-browser.mjs";

export const YNX_CHAIN = Object.freeze({
  chainId: "0x1917", chainName: "YNX Testnet",
  nativeCurrency: Object.freeze({ name: "YNX Testnet", symbol: "YNXT", decimals: 18 }),
  rpcUrls: Object.freeze(["https://rpc.ynxweb4.com/evm"]),
  blockExplorerUrls: Object.freeze(["https://explorer.ynxweb4.com"]),
});
export const WALLET_LINKS = Object.freeze({ ynx: "https://www.ynxweb4.com/dapp/download", metamask: "https://metamask.io/download/" });
const connections = new WeakMap();
function connectionFor(provider, target) {
  let connection = connections.get(provider);
  if (!connection) {
    const origin = target.location?.origin;
    connection = new StandardWalletConnection({ provider, origin, metadata: { name: "YNX Social", url: origin } });
    connections.set(provider, connection);
  }
  return connection;
}
export function discoverProviders(target = window, waitMs = 160) {
  return discoverWalletProviders(target, waitMs);
}
export function selectProvider(discovery, wallet) {
  const kind = wallet === "ynx" ? "ynx-wallet" : wallet === "metamask" ? "metamask" : null;
  if (!kind) return Object.freeze({ ok: false, code: "INVALID_WALLET_KIND" });
  if (discovery.ambiguities.includes(kind) || discovery.conflictedAnnouncements > 0) return Object.freeze({ ok: false, code: "AMBIGUOUS_WALLET_PROVIDER" });
  const detail = wallet === "ynx" ? discovery.ynx : discovery.metamask;
  return detail ? Object.freeze({ ok: true, detail }) : Object.freeze({ ok: false, code: wallet === "ynx" ? "YNX_WALLET_NOT_FOUND" : "METAMASK_NOT_FOUND" });
}
function snapshot(wallet, provider, session) {
  return session ? Object.freeze({ ok: true, wallet, provider, account: session.selectedAccount, chainId: session.selectedChain }) : Object.freeze({ ok: false, code: "NO_APPROVED_ACCOUNT" });
}
async function establish(wallet, target, mode, isCurrent) {
  const selected = selectProvider(await discoverProviders(target), wallet);
  if (!selected.ok) return selected;
  if (!isCurrent()) return Object.freeze({ ok: false, code: "SUPERSEDED" });
  const provider = selected.detail.provider;
  const session = await connectionFor(provider, target)[mode]();
  if (!isCurrent()) return Object.freeze({ ok: false, code: "SUPERSEDED" });
  return snapshot(wallet, provider, session);
}
export function connectWallet(wallet, target = window, isCurrent = () => true) {
  return establish(wallet, target, "connect", isCurrent);
}
export function restoreWallet(wallet, target = window, isCurrent = () => true) {
  return establish(wallet, target, "restore", isCurrent);
}
export function attachWalletLifecycle(provider, handlers = {}) {
  const connection = connections.get(provider);
  if (!connection) throw new Error("Select and establish the shared Wallet connection first.");
  return connection.subscribe(({ event, value }) => {
    const current = connection.current;
    if (event === "accountsChanged") handlers.onAccountsChanged?.(current ? [current.selectedAccount] : []);
    if (event === "chainChanged") {
      if (current) handlers.onChainChanged?.(current.selectedChain);
      else handlers.onDisconnect?.(value);
    }
    if (event === "disconnect") handlers.onDisconnect?.(value);
  });
}
export function disconnectWallet(provider) {
  connections.get(provider)?.disconnect();
}
export async function ensureYNXChain(provider) {
  const current = await provider.request({ method: "eth_chainId" });
  if (String(current).toLowerCase() !== YNX_CHAIN.chainId) {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: YNX_CHAIN.chainId }] });
    } catch (error) {
      if (Number(error?.code) !== 4902) throw error;
      await provider.request({ method: "wallet_addEthereumChain", params: [YNX_CHAIN] });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: YNX_CHAIN.chainId }] });
    }
    const verified = await provider.request({ method: "eth_chainId" });
    if (String(verified).toLowerCase() !== YNX_CHAIN.chainId) throw Object.assign(new Error("Wallet did not switch to YNX Testnet."), { code: "WRONG_CHAIN" });
  }
  const connection = connections.get(provider);
  if (connection) {
    const session = await connection.restore();
    if (!session || session.selectedChain !== YNX_CHAIN.chainId) throw Object.assign(new Error("Wallet network or account changed during readback."), { code: "WRONG_CHAIN" });
  }
  return YNX_CHAIN.chainId;
}
export async function switchWalletAccount(provider) {
  const connection = connections.get(provider);
  if (!connection) throw new Error("No selected shared Wallet connection.");
  let session;
  try {
    await provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
    session = await connection.restore();
  } catch (error) {
    if (![4200, -32601].includes(Number(error?.code))) throw error;
    session = await connection.connect();
  }
  if (!session) throw Object.assign(new Error("No approved account was returned."), { code: 4100 });
  return Object.freeze({ account: session.selectedAccount, chainId: session.selectedChain });
}
export function revokeWallet(provider) {
  const connection = connections.get(provider);
  if (!connection) throw new Error("No selected shared Wallet connection.");
  return connection.revoke();
}
