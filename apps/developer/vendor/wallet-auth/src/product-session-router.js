import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { decodeBase64url, encodeBase64url } from "./base64url.js";
import { parseProductSessionRegistry, productPlatformBinding } from "./product-session-registry.js";
import { parseProductSessionApproval, parseProductSessionRequest } from "./product-session-v2.js";

export const WALLET_ROUTE_STATUS = Object.freeze({
  READY: "ready",
  WALLET_NOT_INSTALLED: "wallet-not-installed",
  SCHEME_NOT_REGISTERED: "scheme-not-registered",
  SESSION_EXPIRED: "session-expired",
  CALLBACK_MISMATCH: "callback-mismatch",
  USER_REJECTED: "user-rejected",
  NETWORK_UNAVAILABLE: "network-unavailable",
});

export function walletConnectionChoices(registryInput, productId, availability) {
  const registry = parseProductSessionRegistry(registryInput);
  exactFields(availability, ["ynxWalletInstalled", "metaMaskAvailable"], "Wallet availability");
  if (typeof availability.ynxWalletInstalled !== "boolean" || typeof availability.metaMaskAvailable !== "boolean") fail("INVALID_WALLET_AVAILABILITY", "Wallet availability flags must be boolean");
  const product = registry.products.find((item) => item.productId === productId);
  if (!product) fail("UNKNOWN_PRODUCT", "Product is not registered for Wallet connection");
  const choices = [];
  if (availability.ynxWalletInstalled) {
    choices.push(Object.freeze({ id: "ynx-wallet", action: "open", label: "Open YNX Wallet", authoritative: true }));
  } else {
    choices.push(Object.freeze({ id: "download-ynx-wallet", action: "download", label: "Download YNX Wallet", url: registry.wallet.downloadUrl, authoritative: true }));
    if (product.evmCompatible) choices.push(Object.freeze(availability.metaMaskAvailable
      ? { id: "metamask", action: "open-evm", label: "Use MetaMask", chainId: 6423, installed: true, authoritative: true, connectionMode: "evm-only", authority: "eip-1193-provider-only", ynxProductSession: false }
      : { id: "metamask", action: "download-evm-wallet", label: "Use MetaMask (install if needed)", url: registry.wallet.metaMaskDownloadUrl, chainId: 6423, installed: false, authoritative: true, connectionMode: "evm-only", authority: "none", ynxProductSession: false }));
  }
  choices.push(Object.freeze({
    id: "guest", action: "guest", label: "Continue in Guest / Try mode", authoritative: false,
    limitations: Object.freeze(["not-signed-in", "no-wallet-balance", "no-transactions", "no-chain-authority"]),
  }));
  return Object.freeze(choices);
}

export function encodeProductSessionWalletURL(registryInput, requestInput, at = new Date()) {
  const registry = parseProductSessionRegistry(registryInput);
  const request = parseProductSessionRequest(registry, requestInput, at);
  const target = new URL(registry.wallet.authorizeCallback);
  target.searchParams.set("request", encodeBase64url(new TextEncoder().encode(canonicalJSON(request))));
  return target.toString();
}

export function parseProductSessionWalletURL(registryInput, url, at = new Date()) {
  const registry = parseProductSessionRegistry(registryInput);
  const parsed = safeURL(url, "SCHEME_NOT_REGISTERED", "Wallet URL is invalid");
  const expected = new URL(registry.wallet.authorizeCallback);
  const keys = [...parsed.searchParams.keys()];
  if (parsed.protocol !== expected.protocol || parsed.hostname !== expected.hostname || parsed.pathname !== expected.pathname || parsed.hash || parsed.username || parsed.password || keys.length !== 1 || keys[0] !== "request") fail("SCHEME_NOT_REGISTERED", "Wallet scheme, route or parameters are not registered");
  const raw = decodeJSON(parsed.searchParams.get("request"), "Wallet request");
  return parseProductSessionRequest(registry, raw, at);
}

export function prepareWalletOpen(registryInput, requestInput, environment, at = new Date()) {
  exactFields(environment, ["networkAvailable", "walletInstalled", "schemeRegistered"], "Wallet open environment");
  if (!environment.networkAvailable) return routeState(WALLET_ROUTE_STATUS.NETWORK_UNAVAILABLE, "Retry when network connectivity returns", ["retry", "return-to-product"]);
  let request;
  try { request = parseProductSessionRequest(registryInput, requestInput, at); } catch (error) {
    if (error instanceof WalletAuthError && (error.code === "SESSION_EXPIRED" || error.code === "EXPIRED")) return routeState(WALLET_ROUTE_STATUS.SESSION_EXPIRED, "Start a new Wallet connection request", ["retry", "return-to-product"]);
    throw error;
  }
  if (!environment.walletInstalled) return routeState(WALLET_ROUTE_STATUS.WALLET_NOT_INSTALLED, "Install YNX Wallet or return to Guest / Try mode", ["download", "guest", "return-to-product"]);
  if (!environment.schemeRegistered) return routeState(WALLET_ROUTE_STATUS.SCHEME_NOT_REGISTERED, "Repair or reinstall YNX Wallet, then retry", ["download", "retry", "return-to-product"]);
  return Object.freeze({ status: WALLET_ROUTE_STATUS.READY, url: encodeProductSessionWalletURL(registryInput, request, at), request, actions: Object.freeze([]) });
}

export function createProductSessionReturnURL(registryInput, requestInput, result, at = new Date()) {
  const request = parseProductSessionRequest(registryInput, requestInput, at);
  exactFields(result, result.result === "approved" ? ["result", "approval"] : ["result", "reason"], "Product Session return result");
  const target = new URL(request.callback);
  if (result.result === "approved") {
    const approval = parseProductSessionApproval(registryInput, request, result.approval, at);
    target.searchParams.set("result", "approved");
    target.searchParams.set("approval", encodeBase64url(new TextEncoder().encode(canonicalJSON(approval))));
  } else if (result.result === "rejected" && result.reason === "user_rejected") {
    target.searchParams.set("result", "rejected");
    target.searchParams.set("reason", "user_rejected");
  } else {
    fail("INVALID_RETURN_RESULT", "Wallet return result is unsupported");
  }
  target.searchParams.set("nonce", request.nonce);
  target.searchParams.set("state", request.state);
  return target.toString();
}

export function parseProductSessionReturnURL(registryInput, pendingRequest, url, at = new Date()) {
  let request;
  try { request = parseProductSessionRequest(registryInput, pendingRequest, at); } catch (error) {
    if (error instanceof WalletAuthError && error.code === "SESSION_EXPIRED") return routeState(WALLET_ROUTE_STATUS.SESSION_EXPIRED, "The Wallet approval request expired", ["retry", "return-to-product"]);
    throw error;
  }
  const parsed = safeURL(url, "CALLBACK_MISMATCH", "Wallet callback is invalid");
  const expected = new URL(request.callback);
  const result = parsed.searchParams.get("result");
  const allowed = result === "approved" ? ["approval", "nonce", "result", "state"] : ["nonce", "reason", "result", "state"];
  const keys = [...parsed.searchParams.keys()].sort();
  parsed.search = "";
  if (parsed.toString() !== expected.toString() || parsed.hash || parsed.username || parsed.password || keys.join("\n") !== allowed.join("\n") || parsed.protocol === "http:" || parsed.protocol === "file:" || parsed.protocol === "javascript:") return routeState(WALLET_ROUTE_STATUS.CALLBACK_MISMATCH, "Return to the product and start a new Wallet request", ["retry", "return-to-product"]);
  if (new URL(url).searchParams.get("nonce") !== request.nonce || new URL(url).searchParams.get("state") !== request.state) return routeState(WALLET_ROUTE_STATUS.CALLBACK_MISMATCH, "Wallet callback nonce or state did not match", ["retry", "return-to-product"]);
  if (result === "rejected" && new URL(url).searchParams.get("reason") === "user_rejected") return routeState(WALLET_ROUTE_STATUS.USER_REJECTED, "No Product Session was created", ["guest", "retry", "return-to-product"]);
  if (result !== "approved") return routeState(WALLET_ROUTE_STATUS.CALLBACK_MISMATCH, "Wallet callback result was not recognized", ["retry", "return-to-product"]);
  try {
    const approval = parseProductSessionApproval(registryInput, request, decodeJSON(new URL(url).searchParams.get("approval"), "Wallet approval"), at);
    return Object.freeze({ status: WALLET_ROUTE_STATUS.READY, request, approval, actions: Object.freeze([]) });
  } catch (error) {
    if (error instanceof WalletAuthError) return routeState(WALLET_ROUTE_STATUS.CALLBACK_MISMATCH, "Wallet approval did not match the pending product request", ["retry", "return-to-product"]);
    throw error;
  }
}

export function canonicalReturnTarget(registryInput, productId, platform) {
  const binding = productPlatformBinding(registryInput, productId, platform);
  return Object.freeze({ productId, platform, origin: binding.origin, callback: binding.callback, applicationId: binding.applicationId, bundleId: binding.bundleId, packageId: binding.packageId });
}

function routeState(status, message, actions) { return Object.freeze({ status, message, actions: Object.freeze(actions) }); }
function decodeJSON(value, label) { try { const bytes = decodeBase64url(value ?? "", label); return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail("INVALID_ROUTE_PAYLOAD", `${label} encoding is invalid`); } }
function safeURL(value, code, message) { if (typeof value !== "string" || value.length > 4096) fail(code, message); try { return new URL(value); } catch { fail(code, message); } }
function fail(code, message) { throw new WalletAuthError(code, message); }
