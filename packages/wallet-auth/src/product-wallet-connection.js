import { exactFields, WalletAuthError } from "./canonical.js";
import { encodeBase64url } from "./base64url.js";
import { ProductSessionGatewayFetchAdapter } from "./product-session-gateway-client.js";
import { RecoverableProductSessionClient } from "./product-session-recovery.js";
import { WalletConnectionCoordinator } from "./wallet-connection-coordinator.js";

const CONFIG_FIELDS = [
  "registry", "productId", "platform",
  "walletInstalled", "schemeRegistered", "gatewayTimeoutMs", "storage",
  "device", "scope", "discoveryWaitMs",
  "openWallet", "openTimeoutMs",
];
export const PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN = "https://wallet-auth.ynxweb4.com";

/**
 * Constructs the only supported product-facing Wallet connection surface.
 * Product code supplies capabilities, never a callback, origin, route or Session.
 */
export function createProductWalletConnection(config) {
  exactFields(config, CONFIG_FIELDS, "Product Wallet connection configuration");
  assertProductRuntime();
  exactFields(config.device, ["id", "key", "sign", "scopes", "purpose"], "Product Wallet secure device signer");
  if (typeof config.device.sign !== "function") throw new WalletAuthError("INVALID_DEVICE", "Product Wallet connection requires a platform secure device signer");
  const gateway = new ProductSessionGatewayFetchAdapter({
    endpoint: PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN,
    fetch: globalThis.fetch.bind(globalThis),
    walletInstalled: config.walletInstalled,
    schemeRegistered: config.schemeRegistered,
    timeoutMs: config.gatewayTimeoutMs,
  });
  const sessionClient = new RecoverableProductSessionClient({
    registry: config.registry,
    productId: config.productId,
    platform: config.platform,
    storage: config.storage,
    gateway,
    device: config.device,
    tokenFactory: secureToken,
    clock: systemClock,
  });
  return new WalletConnectionCoordinator({
    registry: config.registry,
    productId: config.productId,
    sessionClient,
    scope: config.scope,
    discoveryWaitMs: config.discoveryWaitMs,
    openWallet: config.openWallet,
    openTimeoutMs: config.openTimeoutMs,
  });
}

function secureToken() {
  assertProductRuntime();
  return encodeBase64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

function systemClock() { return new Date(); }
function assertProductRuntime() {
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") throw new WalletAuthError("INVALID_RANDOM_SOURCE", "Product Wallet connection requires a cryptographic runtime");
  if (typeof globalThis.fetch !== "function") throw new WalletAuthError("INVALID_GATEWAY", "Product Wallet connection requires the platform HTTPS transport");
}
