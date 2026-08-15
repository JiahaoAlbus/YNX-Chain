import { exactFields, WalletAuthError } from "./canonical.js";
import { encodeBase64url } from "./base64url.js";
import { ProductSessionGatewayFetchAdapter } from "./product-session-gateway-client.js";
import { RecoverableProductSessionClient } from "./product-session-recovery.js";
import { WalletConnectionCoordinator } from "./wallet-connection-coordinator.js";

const CONFIG_FIELDS = [
  "registry", "productId", "platform", "gatewayEndpoint", "fetch",
  "walletInstalled", "schemeRegistered", "gatewayTimeoutMs", "storage",
  "device", "scope", "discoveryWaitMs",
  "openWallet", "openTimeoutMs",
];

/**
 * Constructs the only supported product-facing Wallet connection surface.
 * Product code supplies capabilities, never a callback, origin, route or Session.
 */
export function createProductWalletConnection(config) {
  exactFields(config, CONFIG_FIELDS, "Product Wallet connection configuration");
  assertSecureRuntime();
  const gateway = new ProductSessionGatewayFetchAdapter({
    endpoint: config.gatewayEndpoint,
    fetch: config.fetch,
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
  assertSecureRuntime();
  return encodeBase64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

function systemClock() { return new Date(); }
function assertSecureRuntime() { if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") throw new WalletAuthError("INVALID_RANDOM_SOURCE", "Product Wallet connection requires a cryptographic runtime"); }
