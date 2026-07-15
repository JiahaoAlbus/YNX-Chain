import { canonicalJSON, WalletAuthError } from "./canonical.js";
import { parseAuthorizationRequest } from "./protocol.js";
import { decodeBase64url, encodeBase64url } from "./base64url.js";

export function encodeRequestDeepLink(request) {
  const encoded = encodeBase64url(new TextEncoder().encode(canonicalJSON(request)));
  return `ynxwallet://authorize?request=${encoded}`;
}

export function parseWalletDeepLink(url, platform, options) {
  if (platform !== "android" && platform !== "ios") throw new WalletAuthError("INVALID_PLATFORM", "Deep link platform must be android or ios");
  let parsed;
  try { parsed = new URL(url); } catch { throw new WalletAuthError("INVALID_DEEP_LINK", "Wallet deep link is invalid"); }
  if (parsed.protocol !== "ynxwallet:" || parsed.hostname !== "authorize" || parsed.pathname !== "" || parsed.hash || [...parsed.searchParams.keys()].join(",") !== "request") {
    throw new WalletAuthError("INVALID_DEEP_LINK", "Wallet deep link route or fields are invalid");
  }
  let requestText;
  try { requestText = new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64url(parsed.searchParams.get("request") ?? "", "Wallet deep link request")); } catch { throw new WalletAuthError("INVALID_DEEP_LINK", "Wallet deep link request encoding is invalid"); }
  return Object.freeze({ platform, request: parseAuthorizationRequest(requestText, options) });
}

export function createCallbackURL(response) {
  const callback = new URL(response.callback);
  if (callback.search || callback.hash) throw new WalletAuthError("INVALID_CALLBACK", "Registered callback must not contain query or fragment state");
  callback.searchParams.set("response", encodeBase64url(new TextEncoder().encode(canonicalJSON(response))));
  return callback.toString();
}

export function parseCallbackURL(url, expectedCallback) {
  const parsed = new URL(url);
  const expected = new URL(expectedCallback);
  const response = parsed.searchParams.get("response");
  parsed.search = "";
  if (!response || parsed.toString() !== expected.toString()) throw new WalletAuthError("CALLBACK_MISMATCH", "Callback route was substituted");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64url(response, "Wallet callback response"))); } catch { throw new WalletAuthError("INVALID_CALLBACK", "Callback response encoding is invalid"); }
}
