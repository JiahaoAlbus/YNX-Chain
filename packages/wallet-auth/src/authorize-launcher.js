import { WalletAuthError } from "./canonical.js";
import { encodeRequestDeepLink } from "./deep-link.js";

export const OFFICIAL_YNX_WALLET_DOWNLOAD_URL = "https://www.ynxweb4.com/dapp/download";
export const STANDARD_METAMASK_DOWNLOAD_URL = "https://metamask.io/download/";

export const AUTHORIZATION_LAUNCH_PLATFORM_MATRIX = Object.freeze({
  android: Object.freeze({ strategy: "native-resolver", requiresPreflight: true }),
  ios: Object.freeze({ strategy: "native-resolver", requiresPreflight: true }),
  macos: Object.freeze({ strategy: "native-resolver", requiresPreflight: true }),
  windows: Object.freeze({ strategy: "native-resolver", requiresPreflight: true }),
  web: Object.freeze({ strategy: "controlled-frame-lifecycle", requiresPreflight: false }),
  extension: Object.freeze({ strategy: "controlled-frame-lifecycle", requiresPreflight: false }),
});

function freeze(value) { return Object.freeze(value); }

function fallbackActions() {
  return Object.freeze([
    freeze({ id: "official-ynx-wallet-download", label: "Download YNX Wallet", url: OFFICIAL_YNX_WALLET_DOWNLOAD_URL }),
    freeze({ id: "standard-metamask", label: "Use MetaMask", url: STANDARD_METAMASK_DOWNLOAD_URL }),
  ]);
}

function result(status, uri, detail) {
  return freeze({ status, uri, detail, fallbackActions: fallbackActions() });
}

function platformDefinition(platform) {
  const definition = AUTHORIZATION_LAUNCH_PLATFORM_MATRIX[platform];
  if (!definition) throw new WalletAuthError("INVALID_PLATFORM", "Authorization launcher platform is not supported");
  return definition;
}

function timeout(value) {
  if (!Number.isInteger(value) || value < 1 || value > 30_000) throw new WalletAuthError("INVALID_TIMEOUT", "Authorization launcher timeout must be between 1 and 30000 milliseconds");
  return value;
}

function frame(document, uri) {
  if (!document?.createElement || !document.body?.appendChild) return null;
  const element = document.createElement("iframe");
  element.setAttribute?.("aria-hidden", "true");
  element.setAttribute?.("tabindex", "-1");
  element.style && (element.style.display = "none");
  element.src = uri;
  document.body.appendChild(element);
  return element;
}

/**
 * Builds the sole allowed YNX Wallet custom-scheme target. Callers never
 * concatenate scheme routes or create a Product Session through this helper.
 */
export function createCanonicalAuthorizeLaunch(request) {
  return freeze({ uri: encodeRequestDeepLink(request), fallbackActions: fallbackActions() });
}

/**
 * Invokes a canonical custom-scheme through a hidden frame. It deliberately
 * never navigates the top-level page. A hidden/pagehide transition proves only
 * that the page left visibility; it does not prove a Wallet approval or session.
 */
export function launchWebAuthorization(request, options = {}) {
  const { uri } = createCanonicalAuthorizeLaunch(request);
  const document = options.document ?? globalThis.document;
  const window = options.window ?? document?.defaultView ?? document;
  const timeoutMs = timeout(options.timeoutMs ?? 1_500);
  if (!document?.addEventListener || !window?.addEventListener) return Promise.resolve(result("unsupported", uri, "WEB_LAUNCHER_UNAVAILABLE"));
  const element = frame(document, uri);
  if (!element) return Promise.resolve(result("unsupported", uri, "WEB_LAUNCHER_UNAVAILABLE"));
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (status, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      element.remove?.();
      resolve(result(status, uri, detail));
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") finish("opened", "PAGE_HIDDEN"); };
    const onPageHide = () => finish("opened", "PAGE_HIDE");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    timer = setTimeout(() => finish("timeout", "NO_VISIBILITY_TRANSITION"), timeoutMs);
  });
}

/**
 * Native callers must resolve the exact canonical URI before opening it. A
 * positive resolver result means only that a handler is installed, never that
 * the handler rendered, approved, returned a callback, or created a session.
 */
export async function launchNativeAuthorization(request, platform, resolver) {
  const { uri } = createCanonicalAuthorizeLaunch(request);
  const definition = platformDefinition(platform);
  if (definition.strategy !== "native-resolver") throw new WalletAuthError("INVALID_PLATFORM", "Native authorization launcher requires a native platform");
  if (typeof resolver !== "function") return result("unsupported", uri, "NATIVE_RESOLVER_UNAVAILABLE");
  try {
    return (await resolver(uri)) === true ? result("installed", uri, "HANDLER_RESOLVED") : result("unsupported", uri, "HANDLER_NOT_FOUND");
  } catch {
    return result("unsupported", uri, "HANDLER_RESOLUTION_FAILED");
  }
}

export function launchCanonicalAuthorization(request, options) {
  const definition = platformDefinition(options?.platform);
  if (definition.strategy === "controlled-frame-lifecycle") return launchWebAuthorization(request, options);
  return launchNativeAuthorization(request, options.platform, options.resolver);
}
