import { WalletAuthError } from "./canonical.js";
import { encodeRequestDeepLink } from "./deep-link.js";
import {
  discoverWalletProviders,
  WALLET_PROVIDER_DISCOVERY_STATUS,
  walletAvailabilityFromDiscovery,
} from "./wallet-provider-discovery.js";

export const OFFICIAL_YNX_WALLET_DOWNLOAD_URL = "https://www.ynxweb4.com/dapp/download";
export const STANDARD_METAMASK_DOWNLOAD_URL = "https://metamask.io/download/";

export const AUTHORIZATION_LAUNCH_PLATFORM_MATRIX = Object.freeze({
  android: Object.freeze({ strategy: "native-resolver", requiresPreflight: true }),
  ios: Object.freeze({ strategy: "native-resolver", requiresPreflight: true }),
  macos: Object.freeze({ strategy: "native-resolver", requiresPreflight: true }),
  windows: Object.freeze({ strategy: "native-resolver", requiresPreflight: true }),
  web: Object.freeze({ strategy: "standard-provider-discovery", requiresPreflight: true }),
  extension: Object.freeze({ strategy: "standard-provider-discovery", requiresPreflight: true }),
});

function freeze(value) { return Object.freeze(value); }

function fallbackActions() {
  return Object.freeze([
    freeze({ id: "official-ynx-wallet-download", label: "Download YNX Wallet", url: OFFICIAL_YNX_WALLET_DOWNLOAD_URL }),
    freeze({ id: "standard-metamask", label: "Use MetaMask", url: STANDARD_METAMASK_DOWNLOAD_URL }),
  ]);
}

function result(status, detail, input = {}) {
  return freeze({
    status,
    detail,
    transport: input.transport ?? null,
    uri: input.uri ?? null,
    providerCandidate: input.providerCandidate ?? null,
    discovery: input.discovery ?? null,
    recoveryActions: input.recoveryActions ?? Object.freeze([]),
    fallbackActions: fallbackActions(),
  });
}

function platformDefinition(platform) {
  const definition = AUTHORIZATION_LAUNCH_PLATFORM_MATRIX[platform];
  if (!definition) throw new WalletAuthError("INVALID_PLATFORM", "Authorization launcher platform is not supported");
  return definition;
}

function discoveryWait(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_000) throw new WalletAuthError("INVALID_TIMEOUT", "Wallet provider discovery wait must be between 0 and 2000 milliseconds");
  return value;
}

/**
 * Builds the sole allowed native YNX Wallet custom-scheme target. Web callers
 * must not navigate this URI and instead use standard provider discovery.
 */
export function createCanonicalAuthorizeLaunch(request) {
  return freeze({ uri: encodeRequestDeepLink(request), fallbackActions: fallbackActions() });
}

/**
 * Web and extension transports never probe a custom scheme. They discover an
 * already-injected EIP-6963/EIP-1193 provider and return it as an unverified
 * candidate for the existing standard-Wallet flow. No account method is called.
 */
export async function launchWebAuthorization(_request, options = {}) {
  let discovery;
  try {
    discovery = await discoverWalletProviders(options.scope ?? globalThis, discoveryWait(options.waitMs ?? 160));
    walletAvailabilityFromDiscovery(discovery);
  } catch {
    return result("unsupported", "PROVIDER_DISCOVERY_FAILED");
  }
  if (discovery.ambiguities.length || discovery.conflictedAnnouncements > 0) return result("unsupported", "PROVIDER_DISCOVERY_AMBIGUOUS", { discovery, recoveryActions: Object.freeze(["disable-duplicate-provider", "retry", "return-to-product"]) });
  const providerCandidate = discovery.ynx ?? discovery.metamask;
  if (!providerCandidate) {
    const detail = discovery.status === WALLET_PROVIDER_DISCOVERY_STATUS.NOT_INJECTED ? "PROVIDER_NOT_INJECTED" : "UNSUPPORTED_INJECTED_PROVIDER";
    return result("unsupported", detail, { discovery, recoveryActions: Object.freeze(["unlock-extension", "grant-site-access", "enable-extension", "retry", "return-to-product"]) });
  }
  return result("provider-ready", providerCandidate.kind === "ynx-wallet" ? "YNX_PROVIDER_DISCOVERED" : "METAMASK_PROVIDER_DISCOVERED", {
    transport: "eip-1193",
    providerCandidate,
    discovery,
  });
}

/**
 * Native callers must resolve the exact canonical URI before opening it. A
 * positive resolver result proves only that a handler is registered.
 */
export async function launchNativeAuthorization(request, platform, resolver) {
  const { uri } = createCanonicalAuthorizeLaunch(request);
  const definition = platformDefinition(platform);
  if (definition.strategy !== "native-resolver") throw new WalletAuthError("INVALID_PLATFORM", "Native authorization launcher requires a native platform");
  if (typeof resolver !== "function") return result("unsupported", "NATIVE_RESOLVER_UNAVAILABLE", { uri, transport: "native-custom-scheme" });
  try {
    return (await resolver(uri)) === true
      ? result("installed", "HANDLER_RESOLVED", { uri, transport: "native-custom-scheme" })
      : result("unsupported", "HANDLER_NOT_FOUND", { uri, transport: "native-custom-scheme" });
  } catch {
    return result("unsupported", "HANDLER_RESOLUTION_FAILED", { uri, transport: "native-custom-scheme" });
  }
}

export function launchCanonicalAuthorization(request, options) {
  const definition = platformDefinition(options?.platform);
  if (definition.strategy === "standard-provider-discovery") return launchWebAuthorization(request, options);
  return launchNativeAuthorization(request, options.platform, options.resolver);
}
