import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { decodeProductSessionGatewayProofHeaderV2 } from "./product-session-gateway-client.js";
import { PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION, ProductSessionGatewayKernel } from "./product-session-gateway.js";

export const PRODUCT_SESSION_GATEWAY_HTTP_MAX_BODY_BYTES = 1_048_576;
const INPUT_FIELDS = ["requestId", "method", "path", "contentType", "body", "proofHeader", "networkAvailable"];

export class ProductSessionGatewayHttpHandler {
  #kernel;
  constructor(registry, tokenFactory, snapshot) { this.#kernel = new ProductSessionGatewayKernel(registry, tokenFactory, snapshot); }

  handle(input, at = new Date()) {
    let requestId = validRequestId(input?.requestId) ? input.requestId : "req_invalid_request_000";
    try {
      exactFields(input, INPUT_FIELDS, "Product Session Gateway HTTP request");
      requestId = requestIdValue(input.requestId);
      if (input.contentType !== "application/json") fail("UNSUPPORTED_MEDIA_TYPE", "Product Session Gateway requires application/json");
      if (typeof input.body !== "string") fail("INVALID_BODY", "Product Session Gateway body must be a canonical JSON string");
      if (new TextEncoder().encode(input.body).length > PRODUCT_SESSION_GATEWAY_HTTP_MAX_BODY_BYTES) fail("BODY_TOO_LARGE", "Product Session Gateway body exceeds policy");
      let body; try { body = JSON.parse(input.body); } catch { fail("INVALID_BODY", "Product Session Gateway body is not JSON"); }
      if (canonicalJSON(body) !== input.body) fail("NON_CANONICAL_BODY", "Product Session Gateway body must be canonical JSON");
      if (input.proofHeader !== null && typeof input.proofHeader !== "string") fail("INVALID_PROOF_HEADER", "Product Session proof header must be a string or null");
      const proof = input.proofHeader === null ? null : decodeProductSessionGatewayProofHeaderV2(input.proofHeader);
      return this.#kernel.dispatch({ requestId, method: input.method, path: input.path, body, proof, networkAvailable: input.networkAvailable }, at);
    } catch (error) {
      const normalized = normalize(error);
      return response(normalized.status, requestId, { ok: false, error: { code: normalized.code, message: normalized.message } });
    }
  }

  snapshot() { return this.#kernel.snapshot(); }
}

function normalize(error) {
  if (!(error instanceof WalletAuthError)) return { status: 500, code: "INTERNAL", message: "Product Session Gateway HTTP boundary failed closed" };
  const status = error.code === "UNSUPPORTED_MEDIA_TYPE" ? 415 : error.code === "BODY_TOO_LARGE" ? 413 : error.code === "NETWORK_UNAVAILABLE" ? 503 : 400;
  return { status, code: error.code, message: error.message.length <= 300 ? error.message : "Product Session Gateway HTTP request was rejected" };
}
function response(status, requestId, payload) { return Object.freeze({ status, headers: Object.freeze({ "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-request-id": requestId }), body: canonicalJSON({ ...payload, requestId, schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION }) }); }
function requestIdValue(value) { if (!validRequestId(value)) fail("INVALID_REQUEST_ID", "Product Session Gateway request ID is invalid"); return value; }
function validRequestId(value) { return typeof value === "string" && /^req_[A-Za-z0-9_-]{12,80}$/.test(value); }
function fail(code, message) { throw new WalletAuthError(code, message); }
