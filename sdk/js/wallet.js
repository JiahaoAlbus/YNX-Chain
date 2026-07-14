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
