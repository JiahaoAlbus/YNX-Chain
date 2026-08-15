export const METAMASK_MOBILE_DAPP_ORIGIN = "https://metamask.app.link";
export const OFFICIAL_WALLET_URL = "https://www.ynxweb4.com/dapp/wallet";

export function isMobileWalletBrowser(navigatorLike = {}) {
  const ua = String(navigatorLike.userAgent || "");
  return /Android|iPhone|iPod|Mobile/i.test(ua)
    || (/Macintosh/i.test(ua) && Number(navigatorLike.maxTouchPoints) > 1);
}

export function metaMaskMobileDappUrl() {
  const target = new URL(OFFICIAL_WALLET_URL);
  return `${METAMASK_MOBILE_DAPP_ORIGIN}/dapp/${target.host}${target.pathname}`;
}

export function validateCanonicalYNXWalletRoute(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw Object.assign(new Error("Wallet authorization route is invalid."), {code:"INVALID_WALLET_ROUTE"}); }
  const keys = [...parsed.searchParams.keys()];
  const request = keys.length === 1 && keys[0] === "request" ? parsed.searchParams.get("request") : null;
  if (parsed.protocol !== "ynxwallet:" || parsed.hostname !== "authorize" || parsed.pathname !== "" || parsed.hash || parsed.username || parsed.password || !request || !/^[A-Za-z0-9_-]+$/.test(request)) {
    throw Object.assign(new Error("Wallet authorization route does not match the frozen launcher contract."), {code:"INVALID_WALLET_ROUTE"});
  }
  return parsed.toString();
}

export function openCanonicalYNXWalletRoute(value, locationLike = globalThis.location) {
  const route = validateCanonicalYNXWalletRoute(value);
  if (!locationLike || typeof locationLike.assign !== "function") {
    throw Object.assign(new Error("The browser cannot open the Wallet authorization route."), {code:"WALLET_APP_UNAVAILABLE"});
  }
  locationLike.assign(route);
  return Object.freeze({status:"handoff-started",authoritative:false,providerInjected:false,route});
}

export function canonicalYNXAuthorizationState(binding, publicCallback = null) {
  const callback = binding?.webCallbacks?.length === 1 ? binding.webCallbacks[0] : null;
  const available = binding?.enabled === true && binding?.reviewState === "approved" && typeof publicCallback === "string" && callback === publicCallback;
  return Object.freeze({route:available?"canonical-auth":"canonical-auth-unavailable",available,callback:available?callback:null,error:available?null:"CANONICAL_AUTH_UNAVAILABLE"});
}

export function mobileWalletPresentation(availability = {}, mobile = false, coreBinding = null, publicCallback = null) {
  const ynxPresent = Boolean(availability.ynx);
  const metamaskPresent = Boolean(availability.metamask);
  const ynxAuth = canonicalYNXAuthorizationState(coreBinding, publicCallback);
  return Object.freeze({
    ynxRoute: ynxPresent ? "injected-provider" : mobile ? ynxAuth.route : "hidden",
    metaMaskRoute: metamaskPresent ? "injected-provider" : mobile ? "mobile-dapp" : "official-download",
    metaMaskHref: metamaskPresent ? null : mobile ? metaMaskMobileDappUrl() : "https://metamask.io/download",
    canonicalYNXAuthAvailable: ynxPresent ? false : ynxAuth.available,
  });
}
