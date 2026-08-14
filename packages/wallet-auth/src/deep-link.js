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
  const keys = [...parsed.searchParams.keys()];
  const encoded = keys.length === 1 && keys[0] === "request" ? parsed.searchParams.get("request") : null;
  if (parsed.protocol !== "ynxwallet:" || parsed.hostname !== "authorize" || parsed.username || parsed.password || parsed.port || parsed.pathname !== "" || parsed.hash || !encoded || url !== `ynxwallet://authorize?request=${encoded}`) {
    throw new WalletAuthError("INVALID_DEEP_LINK", "Wallet deep link route or fields are invalid");
  }
  let requestText;
  try { requestText = new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64url(encoded, "Wallet deep link request")); } catch { throw new WalletAuthError("INVALID_DEEP_LINK", "Wallet deep link request encoding is invalid"); }
  return Object.freeze({ platform, request: parseAuthorizationRequest(requestText, options) });
}

export function createCallbackURL(response) {
  const callback = new URL(response.callback);
  if (callback.search || callback.hash || callback.username || callback.password || callback.port || callback.toString() !== response.callback) throw new WalletAuthError("INVALID_CALLBACK", "Registered callback must be canonical and contain no authority, query or fragment ambiguity");
  const encoded = encodeBase64url(new TextEncoder().encode(canonicalJSON(response)));
  return `${response.callback}?response=${encoded}`;
}

export function parseCallbackURL(url, expectedCallback) {
  let parsed, expected;
  try { parsed = new URL(url); expected = new URL(expectedCallback); } catch { throw new WalletAuthError("INVALID_CALLBACK", "Wallet callback is invalid"); }
  const keys = [...parsed.searchParams.keys()];
  const response = keys.length === 1 && keys[0] === "response" ? parsed.searchParams.get("response") : null;
  if (expected.search || expected.hash || expected.username || expected.password || expected.port || expected.toString() !== expectedCallback || parsed.hash || parsed.username || parsed.password || parsed.port || !response || url !== `${expectedCallback}?response=${response}`) throw new WalletAuthError("CALLBACK_MISMATCH", "Callback route was substituted");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64url(response, "Wallet callback response"))); } catch { throw new WalletAuthError("INVALID_CALLBACK", "Callback response encoding is invalid"); }
}
