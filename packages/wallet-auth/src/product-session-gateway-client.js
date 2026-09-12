import { decodeBase64url, encodeBase64url } from "./base64url.js";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { parseProductSessionProofV2 } from "./product-session-proof-v2.js";
import { PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION } from "./product-session-gateway.js";

export const PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2 = "x-ynx-product-session-proof-v2";
const MAX_RESPONSE_BYTES = 1_048_576;
// Only this constructor can associate an adapter with its actual private endpoint.
// A public property or duck-typed transport must not choose a persisted authority.
const gatewayAuthorities = new WeakMap();

export function productSessionGatewayAuthority(adapter) {
  if (!gatewayAuthorities.has(adapter)) fail("INVALID_GATEWAY", "Browser storage requires an authority-bound Product Session Gateway fetch adapter");
  return gatewayAuthorities.get(adapter);
}

export class ProductSessionGatewayFetchAdapter {
  #endpoint; #fetch; #walletInstalled; #schemeRegistered; #timeoutMs;
  constructor(config) {
    exactFields(config, ["endpoint", "fetch", "walletInstalled", "schemeRegistered", "timeoutMs"], "Product Session Gateway fetch adapter configuration");
    this.#endpoint = endpoint(config.endpoint);
    if (typeof config.fetch !== "function" || typeof config.walletInstalled !== "function" || typeof config.schemeRegistered !== "function") fail("INVALID_GATEWAY", "Product Session Gateway fetch adapter dependencies are invalid");
    if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1_000 || config.timeoutMs > 30_000) fail("INVALID_GATEWAY", "Product Session Gateway timeout must be between one and thirty seconds");
    this.#fetch = config.fetch; this.#walletInstalled = config.walletInstalled; this.#schemeRegistered = config.schemeRegistered; this.#timeoutMs = config.timeoutMs;
    gatewayAuthorities.set(this, this.#endpoint);
  }

  async walletInstalled() { return capability(await this.#walletInstalled(), "Wallet installation detection"); }
  async schemeRegistered() { return capability(await this.#schemeRegistered(), "Wallet scheme detection"); }

  // Use a fresh HTTPS authority sample, without extrapolating the device clock or
  // adding half the network RTT. This instant has already passed at the authority.
  async currentTime(input) {
    exactFields(input, ["requestId"], "Product Session Gateway time request");
    try {
      const result = await this.#request(input.requestId, "/v2/product-sessions/time", null, null, "GET");
      exactFields(result, ["serverTime"], "Product Session Gateway time response");
      const now = new Date(result.serverTime);
      if (typeof result.serverTime !== "string" || !Number.isFinite(now.getTime()) || now.toISOString() !== result.serverTime) fail("INVALID_GATEWAY_RESPONSE", "Product Session Gateway time is invalid");
      return now;
    } catch (error) {
      if (error instanceof WalletAuthError && error.code === "NETWORK_UNAVAILABLE") throw error;
      fail("CLOCK_UNAVAILABLE", "Product Session authority time could not be verified; Retry when Auth is available");
    }
  }

  async challenge(input) {
    exactFields(input, ["requestId", "request", "approval"], "Product Session Gateway challenge request");
    return this.#request(input.requestId, "/v2/product-sessions/challenge", { request: input.request, approval: input.approval }, null);
  }

  async complete(input) {
    exactFields(input, ["requestId", "request", "approval", "completion"], "Product Session Gateway completion request");
    return this.#request(input.requestId, "/v2/product-sessions/complete", { request: input.request, approval: input.approval, completion: input.completion }, null);
  }

  async introspect(input) {
    exactFields(input, ["requestId", "sessionBinding", "requiredScopes", "proof"], "Product Session Gateway introspection request");
    const proof = parseProductSessionProofV2(input.proof);
    if (proof.sessionBinding !== input.sessionBinding) fail("CROSS_PRODUCT_SESSION", "Product Session proof does not match the requested session binding");
    return this.#request(input.requestId, "/v2/product-sessions/introspect", { requiredScopes: input.requiredScopes }, proof);
  }

  async revoke(input) {
    exactFields(input, ["requestId", "sessionBinding", "proof"], "Product Session Gateway revoke request");
    const proof = parseProductSessionProofV2(input.proof);
    if (proof.sessionBinding !== input.sessionBinding) fail("CROSS_PRODUCT_SESSION", "Product Session proof does not match the requested session binding");
    return this.#request(input.requestId, "/v2/product-sessions/revoke", {}, proof);
  }

  async #request(requestId, path, body, proof, method = "POST") {
    if (typeof requestId !== "string" || !/^req_[A-Za-z0-9_-]{12,80}$/.test(requestId)) fail("INVALID_REQUEST_ID", "Product Session Gateway request ID is invalid");
    const encodedBody = method === "GET" ? undefined : canonicalJSON(body);
    const headers = { "accept": "application/json", "x-request-id": requestId };
    if (method === "POST") headers["content-type"] = "application/json";
    if (proof !== null) headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2] = encodeProductSessionGatewayProofHeaderV2(proof);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response;
    try {
      response = await this.#fetch(`${this.#endpoint}${path}`, { method, headers, body: encodedBody, cache: "no-store", credentials: "omit", redirect: "error", signal: controller.signal });
    } catch {
      clearTimeout(timeout);
      fail("NETWORK_UNAVAILABLE", "Product Session Gateway is unavailable; no local response was substituted");
    }
    try {
      if (!response || typeof response.status !== "number" || !response.headers || typeof response.headers.get !== "function" || typeof response.text !== "function") fail("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response is invalid");
      const contentType = response.headers.get("content-type") ?? "";
      const responseRequestId = response.headers.get("x-request-id");
      const cacheControl = response.headers.get("cache-control") ?? "";
      const contentLength = response.headers.get("content-length");
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType) || responseRequestId !== requestId || !/(^|,)\s*no-store\s*(,|$)/i.test(cacheControl)) fail("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response headers are invalid");
      if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) fail("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response exceeds policy");
      let text; try { text = await response.text(); } catch { fail("NETWORK_UNAVAILABLE", "Product Session Gateway response stream was interrupted; no local response was substituted"); }
      if (new TextEncoder().encode(text).length > MAX_RESPONSE_BYTES) fail("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response exceeds policy");
      let payload; try { payload = JSON.parse(text); } catch { fail("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response is not JSON"); }
      if (canonicalJSON(payload) !== text) fail("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response is not canonical JSON");
      if (response.status >= 200 && response.status < 300) {
        exactFields(payload, ["ok", "requestId", "result", "schemaVersion"], "Product Session Gateway success response");
        if (payload.ok !== true || payload.requestId !== requestId || payload.schemaVersion !== PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION) fail("INVALID_GATEWAY_RESPONSE", "Product Session Gateway success response binding is invalid");
        return payload.result;
      }
      exactFields(payload, ["error", "ok", "requestId", "schemaVersion"], "Product Session Gateway error response");
      exactFields(payload.error, ["code", "message"], "Product Session Gateway public error");
      if (payload.ok !== false || payload.requestId !== requestId || payload.schemaVersion !== PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION || typeof payload.error.code !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(payload.error.code) || typeof payload.error.message !== "string" || payload.error.message.length > 300) fail("INVALID_GATEWAY_RESPONSE", "Product Session Gateway error response binding is invalid");
      throw new WalletAuthError(payload.error.code, payload.error.message);
    } finally { clearTimeout(timeout); }
  }
}

export function decodeProductSessionGatewayProofHeaderV2(value) {
  if (typeof value !== "string" || value.length > 16_384) fail("INVALID_PROOF_HEADER", "Product Session proof header is invalid");
  let parsed; try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64url(value, "Product Session proof header"))); } catch { fail("INVALID_PROOF_HEADER", "Product Session proof header is invalid"); }
  return parseProductSessionProofV2(parsed);
}

export function encodeProductSessionGatewayProofHeaderV2(value) {
  const proof = parseProductSessionProofV2(value);
  const encoded = encodeBase64url(new TextEncoder().encode(canonicalJSON(proof)));
  if (encoded.length > 16_384) fail("INVALID_PROOF_HEADER", "Product Session proof header exceeds policy");
  return encoded;
}

function endpoint(value) { if (typeof value !== "string" || value.length > 512) fail("INVALID_GATEWAY", "Product Session Gateway endpoint is invalid"); let parsed; try { parsed = new URL(value); } catch { fail("INVALID_GATEWAY", "Product Session Gateway endpoint is invalid"); } if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash || parsed.pathname !== "/" || value !== parsed.origin) fail("INVALID_GATEWAY", "Product Session Gateway endpoint must be a canonical HTTPS origin"); return parsed.origin; }
function capability(value, label) { if (typeof value !== "boolean") fail("INVALID_GATEWAY", `${label} must return a boolean`); return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
