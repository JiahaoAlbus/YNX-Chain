import { exactFields, WalletAuthError } from "./canonical.js";
import { parseProductSessionRegistry } from "./product-session-registry.js";

export const METAMASK_EVM_CONNECTION_STATUS = Object.freeze({
  CONNECTED: "connected-evm",
});

export const METAMASK_EVM_CHAIN_ID = 6423;
export const METAMASK_EVM_CHAIN_QUANTITY = "0x1917";
export const METAMASK_EVM_CHAIN = Object.freeze({
  chainId: METAMASK_EVM_CHAIN_QUANTITY,
  chainName: "YNX Testnet",
  nativeCurrency: Object.freeze({ name: "YNX Testnet", symbol: "YNXT", decimals: 18 }),
  rpcUrls: Object.freeze(["https://evm.ynxweb4.com"]),
  blockExplorerUrls: Object.freeze(["https://explorer.ynxweb4.com"]),
});

const LIMITATIONS = Object.freeze([
  "evm-provider-only",
  "no-ynx-product-session",
  "no-wallet-ai-gateway-session",
  "no-native-ynx-account-authority",
]);

/**
 * Connects an explicitly supplied MetaMask EIP-1193 provider to YNX chain 6423.
 * This is deliberately not a YNX Product Session approval or authentication path.
 */
export class MetaMaskEvmConnectionAdapter {
  #productId;
  #provider;

  constructor(config) {
    exactFields(config, ["registry", "productId", "provider"], "MetaMask EVM adapter configuration");
    const registry = parseProductSessionRegistry(config.registry);
    const product = registry.products.find((item) => item.productId === config.productId);
    if (!product) fail("UNKNOWN_PRODUCT", "Product is not registered for Wallet connection");
    if (!product.evmCompatible) fail("EVM_NOT_SUPPORTED", "Product is not registered for an EVM Wallet connection");
    if (typeof config.productId !== "string") fail("INVALID_METAMASK_CONFIG", "MetaMask productId is invalid");
    this.#productId = product.productId;
    this.#provider = config.provider;
  }

  async connect() {
    const provider = this.#provider;
    if (provider === null || provider === undefined) fail("METAMASK_NOT_INSTALLED", "MetaMask EIP-1193 provider was not detected");
    if (!isExplicitMetaMaskProvider(provider)) {
      fail("INVALID_METAMASK_PROVIDER", "Detected provider is not an explicit MetaMask EIP-1193 provider");
    }

    let chainId = parseChainQuantity(await providerRequest(provider, "eth_chainId"));
    if (chainId !== METAMASK_EVM_CHAIN_ID) {
      try {
        await providerRequest(provider, "wallet_switchEthereumChain", [{ chainId: METAMASK_EVM_CHAIN_QUANTITY }], true);
      } catch (error) {
        if (!(error instanceof WalletAuthError) || error.code !== "CHAIN_NOT_AVAILABLE") throw error;
        try { await providerRequest(provider, "wallet_addEthereumChain", [METAMASK_EVM_CHAIN]); }
        catch (addError) {
          if (addError instanceof WalletAuthError && addError.code === "USER_REJECTED") throw addError;
          fail("CHAIN_NOT_AVAILABLE", "YNX EVM chain 6423 could not be added to MetaMask");
        }
        await providerRequest(provider, "wallet_switchEthereumChain", [{ chainId: METAMASK_EVM_CHAIN_QUANTITY }], true);
      }
      chainId = parseChainQuantity(await providerRequest(provider, "eth_chainId"));
    }
    if (chainId !== METAMASK_EVM_CHAIN_ID) fail("WRONG_NETWORK", "MetaMask did not switch to YNX EVM chain 6423");

    const address = firstAccount(await providerRequest(provider, "eth_requestAccounts"));
    return Object.freeze({
      status: METAMASK_EVM_CONNECTION_STATUS.CONNECTED,
      wallet: "metamask",
      connectionMode: "evm-only",
      authority: "eip-1193-provider-only",
      productId: this.#productId,
      chainId: METAMASK_EVM_CHAIN_ID,
      chainQuantity: METAMASK_EVM_CHAIN_QUANTITY,
      address,
      ynxProductSession: false,
      productSession: null,
      limitations: LIMITATIONS,
    });
  }
}

async function providerRequest(provider, method, params, switching = false) {
  try {
    return await provider.request(params === undefined ? { method } : { method, params });
  } catch (error) {
    if (error instanceof WalletAuthError) throw error;
    const code = providerErrorCode(error);
    if (code === 4001 || code === "4001") fail("USER_REJECTED", "MetaMask connection was rejected by the user");
    if (switching && (code === 4902 || code === "4902")) fail("CHAIN_NOT_AVAILABLE", "YNX EVM chain 6423 is not configured in MetaMask");
    if (code === 4900 || code === "4900" || code === 4901 || code === "4901") fail("WALLET_UNAVAILABLE", "MetaMask is disconnected from the requested chain");
    fail("WALLET_UNAVAILABLE", "MetaMask EIP-1193 request failed closed");
  }
}

function isExplicitMetaMaskProvider(provider) {
  if (typeof provider !== "object" || provider === null) return false;
  try { return typeof provider.request === "function" && provider.isMetaMask === true; } catch { return false; }
}

function providerErrorCode(error) {
  if (typeof error !== "object" || error === null) return undefined;
  try { return error.code; } catch { return undefined; }
}

function parseChainQuantity(value) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    fail("INVALID_WALLET_RESPONSE", "MetaMask returned a non-canonical chain quantity");
  }
  const chainId = Number(BigInt(value));
  if (!Number.isSafeInteger(chainId)) fail("INVALID_WALLET_RESPONSE", "MetaMask returned an unsupported chain quantity");
  return chainId;
}

function normalizeAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail("INVALID_WALLET_RESPONSE", "MetaMask returned an invalid EVM account address");
  }
  return value.toLowerCase();
}

function firstAccount(value) {
  try {
    if (!Array.isArray(value) || value.length < 1 || value.length > 1024) fail("INVALID_WALLET_RESPONSE", "MetaMask returned an invalid account list");
    return normalizeAddress(value[0]);
  } catch (error) {
    if (error instanceof WalletAuthError) throw error;
    fail("INVALID_WALLET_RESPONSE", "MetaMask returned an invalid account list");
  }
}

function fail(code, message) { throw new WalletAuthError(code, message); }
