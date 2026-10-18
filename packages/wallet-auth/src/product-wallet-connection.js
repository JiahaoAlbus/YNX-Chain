import { hasOriginalWalletServicePrivateBridge } from './original-wallet-service-private-client.js';
import { exactFields, WalletAuthError } from "./canonical.js";
import { encodeBase64url } from "./base64url.js";
import { ProductSessionGatewayFetchAdapter, ProductSessionGatewayPrivateAdapter } from "./product-session-gateway-client.js";
import { RecoverableProductSessionClient } from "./product-session-recovery.js";
import { WalletConnectionCoordinator } from "./wallet-connection-coordinator.js";

const CONFIG_FIELDS = [
  "registry", "productId", "platform",
  "walletInstalled", "schemeRegistered", "gatewayTimeoutMs", "storage",
  "device", "scope", "discoveryWaitMs",
  "openWallet", "openTimeoutMs",
];
export const PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN = "https://wallet-auth.ynxweb4.com";

// Same fixed normal transport as the original product factory. This is only a
// narrow caller, never service/Source/Native qualification or a signing engine.
// The existing Wallet journal owns once-only publish and UNKNOWN reconciliation.
export function createProductWalletReturnPublisher(config){
  exactFields(config,['gatewayTimeoutMs'],'Normal Wallet publication configuration');
  if(typeof globalThis.fetch!=='function')throw new WalletAuthError('INVALID_GATEWAY','Normal publication requires the platform HTTPS transport');
  const inapplicable=()=>{throw new WalletAuthError('PUBLISHER_CAPABILITY_NOT_APPLICABLE','Publication transport does not attest Wallet installation');};
  const gateway=new ProductSessionGatewayFetchAdapter({endpoint:PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN,fetch:globalThis.fetch.bind(globalThis),walletInstalled:inapplicable,schemeRegistered:inapplicable,timeoutMs:config.gatewayTimeoutMs});
  return Object.freeze({
    currentTime:input=>gateway.currentTime(input),
    publishReturn:input=>gateway.publishReturn(input),
    publicationOutcome:input=>gateway.publicationOutcome(input),
  });
}

/**
 * Constructs the only supported product-facing Wallet connection surface.
 * Product code supplies capabilities, never a callback, origin, route or Session.
 */
export function createProductWalletConnection(config) {
  exactFields(config, CONFIG_FIELDS, "Product Wallet connection configuration");
  assertProductRuntime();
  exactFields(config.device, ["id", "key", "sign", "scopes", "purpose"], "Product Wallet secure device signer");
  if (typeof config.device.sign !== "function") throw new WalletAuthError("INVALID_DEVICE", "Product Wallet connection requires a platform secure device signer");
  const privateBridge = hasOriginalWalletServicePrivateBridge();
  const gateway = privateBridge ? new ProductSessionGatewayPrivateAdapter({walletInstalled: config.walletInstalled, schemeRegistered: config.schemeRegistered, timeoutMs: config.gatewayTimeoutMs}) : new ProductSessionGatewayFetchAdapter({
    endpoint: PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN,
    fetch: globalThis.fetch.bind(globalThis),
    walletInstalled: config.walletInstalled,
    schemeRegistered: config.schemeRegistered,
    timeoutMs: config.gatewayTimeoutMs,
  });
  if (typeof gateway.currentTime !== "function") throw new WalletAuthError("CLOCK_UNAVAILABLE", "Product Wallet connection requires the authority-time adapter");
  const sessionClient = new RecoverableProductSessionClient({
    registry: config.registry,
    productId: config.productId,
    platform: config.platform,
    storage: config.storage,
    gateway,
    device: config.device,
    tokenFactory: secureToken,
    clock: authorityClockRequired,
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

// The genuine same-copy adapter above supplies currentTime. Never fall back to
// a local clock if that authority contract is absent or becomes unavailable.
function authorityClockRequired() {
  throw new WalletAuthError("CLOCK_UNAVAILABLE", "Product Wallet connection requires verified Gateway authority time");
}
function assertProductRuntime() {
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") throw new WalletAuthError("INVALID_RANDOM_SOURCE", "Product Wallet connection requires a cryptographic runtime");
  if (!hasOriginalWalletServicePrivateBridge() && typeof globalThis.fetch !== "function") throw new WalletAuthError("INVALID_GATEWAY", "Product Wallet connection requires the platform HTTPS transport");
}
