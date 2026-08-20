import {discoverEIP6963} from "./ynx-dapp-connect-sdk/discovery.js";
import {DAppConnectError} from "./ynx-dapp-connect-sdk/errors.js";
import {StandardWalletConnection} from "./ynx-dapp-connect-sdk/provider.js";

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

function isYNX(detail) {
  return `${detail?.info?.name ?? ""} ${detail?.info?.rdns ?? ""}`.toLowerCase().includes("ynx");
}

function injectedFallback(windowLike) {
  const provider = windowLike?.ethereum;
  if (!provider?.request) return null;
  return {provider, info: {name: provider.isMetaMask ? "MetaMask" : "Injected EVM Wallet", rdns: provider.isMetaMask ? "io.metamask" : "injected.wallet", uuid: "legacy-injected-provider"}};
}

export async function connectVideoWallet(windowLike = window, {timeoutMs = 250} = {}) {
  const announced = await discoverEIP6963(windowLike, {timeoutMs});
  const ynx = announced.filter(isYNX);
  if (ynx.length > 1) throw new DAppConnectError("AMBIGUOUS_YNX_WALLET", "More than one YNX Wallet provider was announced. Disable duplicate installations and retry.");
  const selected = ynx[0] ?? (announced.length === 1 ? announced[0] : injectedFallback(windowLike));
  if (!selected) throw new DAppConnectError("WALLET_NOT_INSTALLED", "No standard EVM Wallet was discovered.", {details: WALLET_INSTALLATION_OPTIONS});
  const connection = new StandardWalletConnection(selected.provider);
  const connected = await connection.connect();
  await connection.ensureYNXTestnet({addChain: YNX_TESTNET_ADD_CHAIN});
  const chainId = await selected.provider.request({method: "eth_chainId"});
  if (String(chainId).toLowerCase() !== "0x1917") throw new DAppConnectError("WRONG_CHAIN", "Wallet did not finish switching to YNX Testnet.");
  return Object.freeze({
    account: connected.account,
    chainId,
    connection,
    productSession: "PRIVATE_SERVICE_DEGRADED",
    standardConnection: "CONNECTED",
    walletName: selected.info?.name || "EVM Wallet",
  });
}
