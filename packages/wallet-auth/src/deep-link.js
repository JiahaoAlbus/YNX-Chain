import { canonicalJSON, WalletAuthError } from "./canonical.js";
import {
  parseAuthorizationRejection,
  parseAuthorizationRequest,
  requestDigest,
  verifyAuthorizationRejection,
} from "./protocol.js";
import { verifyAuthorization } from "./crypto.js";
import { decodeBase64url, encodeBase64url } from "./base64url.js";

export const WALLET_AUTHORIZE_ROUTE = "ynxwallet://authorize";
export const WALLET_AUTHORIZE_REQUEST_PARAMETER = "request";
export const WALLET_CALLBACK_RESPONSE_PARAMETER = "response";

export function encodeRequestDeepLink(request) {
  const encoded = encodeBase64url(new TextEncoder().encode(canonicalJSON(request)));
  return `${WALLET_AUTHORIZE_ROUTE}?${WALLET_AUTHORIZE_REQUEST_PARAMETER}=${encoded}`;
}

export function parseWalletDeepLink(url, platform, options) {
  if (platform !== "android" && platform !== "ios") throw new WalletAuthError("INVALID_PLATFORM", "Deep link platform must be android or ios");
  let parsed;
  try { parsed = new URL(url); } catch { throw new WalletAuthError("INVALID_DEEP_LINK", "Wallet deep link is invalid"); }
  if (parsed.toString() === WALLET_AUTHORIZE_ROUTE || (parsed.protocol === "ynxwallet:" && parsed.hostname === "authorize" && !parsed.searchParams.get(WALLET_AUTHORIZE_REQUEST_PARAMETER))) {
    throw new WalletAuthError("MISSING_AUTHORIZATION_REQUEST", "Wallet authorization deep link must contain the canonical request payload");
  }
  if (parsed.protocol !== "ynxwallet:" || parsed.hostname !== "authorize" || parsed.pathname !== "" || parsed.hash || [...parsed.searchParams.keys()].join(",") !== WALLET_AUTHORIZE_REQUEST_PARAMETER) {
    throw new WalletAuthError("INVALID_DEEP_LINK", "Wallet deep link route or fields are invalid");
  }
  let requestText;
  try { requestText = new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64url(parsed.searchParams.get("request") ?? "", "Wallet deep link request")); } catch { throw new WalletAuthError("INVALID_DEEP_LINK", "Wallet deep link request encoding is invalid"); }
  return Object.freeze({ platform, request: parseAuthorizationRequest(requestText, options) });
}

export function createCallbackURL(response) {
  const callback = new URL(response.callback);
  if (callback.search || callback.hash) throw new WalletAuthError("INVALID_CALLBACK", "Registered callback must not contain query or fragment state");
  callback.searchParams.set(WALLET_CALLBACK_RESPONSE_PARAMETER, encodeBase64url(new TextEncoder().encode(canonicalJSON(response))));
  return callback.toString();
}

export function parseCallbackURL(url, expectedCallback) {
  let parsed, expected;
  try { parsed = new URL(url); expected = new URL(expectedCallback); } catch { throw new WalletAuthError("INVALID_CALLBACK", "Wallet callback is invalid"); }
  const keys = [...parsed.searchParams.keys()];
  const response = keys.length === 1 && keys[0] === WALLET_CALLBACK_RESPONSE_PARAMETER ? parsed.searchParams.get(WALLET_CALLBACK_RESPONSE_PARAMETER) : null;
  if (parsed.hash || parsed.username || parsed.password) throw new WalletAuthError("CALLBACK_MISMATCH", "Callback route was substituted");
  parsed.search = "";
  if (!response || parsed.toString() !== expected.toString()) throw new WalletAuthError("CALLBACK_MISMATCH", "Callback route was substituted");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64url(response, "Wallet callback response"))); } catch { throw new WalletAuthError("INVALID_CALLBACK", "Callback response encoding is invalid"); }
}

export function parseAuthorizationCallbackURL(url, request, at = new Date()) {
  const response = parseCallbackURL(url, request.callback);
  if (response?.decision === "rejected") return verifyAuthorizationRejection(parseAuthorizationRejection(response), request, at);
  return verifyAuthorization(response, { ...request, requestDigest: requestDigest(request), now: at });
}
