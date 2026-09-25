import registry from "../vendor/product-session-registry-b754ffc42.json" with { type: "json" };

export const HOSTED_PROTOCOL = "ynx-hosted-wallet/v1";
export const HOSTED_WALLET_ORIGIN = "https://wallet.ynxweb4.com";
export const HOSTED_WALLET_PATH = "/hosted/";
export const HOSTED_CHAIN_ID = "0x1917";
export const HOSTED_TIMEOUT_MS = 120_000;
export const HOSTED_SESSION_MS = 60 * 60_000;
const ID = /^[A-Za-z0-9_-]{22,64}$/u;
const MAX_REQUEST_BYTES = 4096;

function fail(code) { throw Object.assign(new Error(code), { code }); }
export function registeredProduct(origin) {
  if (typeof origin !== "string" || !/^https:\/\/[a-z0-9.-]+$/u.test(origin)) return null;
  return registry.products.find(product => product.webOrigin === origin && product.evmCompatible === true) ?? null;
}
export function randomHostedId(cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.getRandomValues) fail("HOSTED_CRYPTO_UNAVAILABLE");
  const bytes = cryptoProvider.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
export function encodeHostedConnect(request) {
  const bytes = new TextEncoder().encode(JSON.stringify(request));
  if (bytes.length > MAX_REQUEST_BYTES) fail("HOSTED_REQUEST_INVALID");
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
export function parseHostedConnect(encoded, now = Date.now()) {
  if (typeof encoded !== "string" || encoded.length > 6000 || !/^[A-Za-z0-9_-]+$/u.test(encoded)) fail("HOSTED_REQUEST_INVALID");
  let value;
  try {
    const raw = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
    if (raw.length > MAX_REQUEST_BYTES) fail("HOSTED_REQUEST_INVALID");
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(raw, character => character.charCodeAt(0))));
  } catch { fail("HOSTED_REQUEST_INVALID"); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "chainId,expiresAt,nonce,origin,requestId,version" || value.version !== 1 || value.chainId !== HOSTED_CHAIN_ID || !registeredProduct(value.origin) || !ID.test(value.requestId ?? "") || !ID.test(value.nonce ?? "") || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now || value.expiresAt - now > HOSTED_TIMEOUT_MS) fail("HOSTED_REQUEST_INVALID");
  return Object.freeze(value);
}
export function validateHostedMessage(event, opener, request, seen, now = Date.now()) {
  if (!opener || event?.source !== opener || event.origin !== request.origin) fail("HOSTED_ORIGIN_MISMATCH");
  const message = event.data;
  if (!message || typeof message !== "object" || Array.isArray(message) || message.protocol !== HOSTED_PROTOCOL || message.requestId !== request.requestId || message.nonce !== request.nonce || !ID.test(message.messageId ?? "") || !Number.isSafeInteger(message.expiresAt) || message.expiresAt <= now || message.expiresAt > request.expiresAt || seen.has(message.messageId)) fail("HOSTED_MESSAGE_INVALID");
  seen.add(message.messageId);
  return message;
}
export function hostedEnvelope(request, type, extra = {}, now = Date.now()) {
  if (now >= request.expiresAt) fail("HOSTED_REQUEST_EXPIRED");
  return { protocol: HOSTED_PROTOCOL, requestId: request.requestId, nonce: request.nonce, messageId: randomHostedId(), expiresAt: Math.min(request.expiresAt, now + 30_000), type, ...extra };
}
