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
