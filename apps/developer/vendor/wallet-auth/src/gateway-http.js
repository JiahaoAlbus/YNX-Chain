import { canonicalJSON, digestHex, exactFields, WalletAuthError } from "./canonical.js";
import { CanonicalWalletGatewayAdapter } from "./gateway-adapter.js";
import { parseCentralRegistryDocument } from "./registry.js";
import { httpBodyDigest } from "./session-proof.js";

export const CANONICAL_GATEWAY_HTTP_SCHEMA_VERSION = 1;
export const CANONICAL_GATEWAY_HTTP_MAX_BODY_BYTES = 1_048_576;

const REQUEST_FIELDS = ["method", "path", "contentType", "body", "proof"];
const RESPONSE_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
});

const ROUTES = Object.freeze({
  "/v1/wallet/sessions/complete": "complete",
  "/v1/wallet/authorizations/reject": "rejectAuthorization",
  "/v1/wallet/sessions/introspect": "introspect",
  "/v1/wallet/sessions": "sessionInventory",
  "/v1/wallet/sessions/revoke": "revokeSession",
  "/v1/wallet/approvals/revoke": "revokeApproval",
  "/v1/wallet/devices/revoke": "revokeDevice",
  "/v1/wallet/accounts/logout-all": "logoutAllDevices",
  "/v1/wallet/mandates/activate": "activateMandate",
  "/v1/wallet/mandates/authorize-action": "authorizeMandateAction",
  "/v1/wallet/mandates": "mandateInventory",
  "/v1/wallet/mandates/revoke": "revokeMandate",
  "/v1/wallet/mandates/kill": "killMandate",
  "/v1/wallet/mandates/emergency-exit": "emergencyExitMandate",
});

export class CanonicalWalletGatewayHttpKernel {
  #registry;
  #adapter;

  constructor(registry, snapshot) {
    this.#registry = parseCentralRegistryDocument(registry);
    this.#adapter = new CanonicalWalletGatewayAdapter(this.#registry, snapshot);
  }

  dispatch(input, at = new Date()) {
    const before = this.#adapter.snapshot();
    try {
      const request = parseRequest(input);
      const now = validDate(at);
      const payload = parseCanonicalBody(request.body);
      const operation = ROUTES[request.path];
      if (!operation) fail("ROUTE_NOT_FOUND", "Canonical Wallet Gateway route was not found");
      const context = Object.freeze({ method: request.method, path: request.path, bodyDigest: httpBodyDigest(request.body) });
      const result = operation === "complete"
        ? complete(this.#adapter, request.proof, payload, now)
        : operation === "rejectAuthorization"
          ? rejectAuthorization(this.#adapter, request.proof, payload, now)
        : this.#adapter[operation](authenticatedInput(operation, request.proof, payload), context, now);
      const snapshot = this.#adapter.snapshot();
      const stateDigest = gatewayStateDigest(snapshot);
      return response(200, true, { ok: true, result, schemaVersion: CANONICAL_GATEWAY_HTTP_SCHEMA_VERSION, stateDigest });
    } catch (caught) {
      // Route execution is request-atomic. Any unexpected partial mutation is
      // discarded before an error response is returned to the central host.
      this.#adapter = new CanonicalWalletGatewayAdapter(this.#registry, before);
      const error = publicError(caught);
      const stateDigest = gatewayStateDigest(this.#adapter.snapshot());
      return response(error.status, false, {
        error: { code: error.code, message: error.message },
        ok: false,
        schemaVersion: CANONICAL_GATEWAY_HTTP_SCHEMA_VERSION,
        stateDigest,
      });
    }
  }

  snapshot() {
    return this.#adapter.snapshot();
  }
}

export function gatewayStateDigest(snapshot) {
  return digestHex("YNX_CANONICAL_GATEWAY_HTTP_STATE_V1", snapshot);
}

function parseRequest(input) {
  exactFields(input, REQUEST_FIELDS, "Canonical Gateway HTTP input");
  if (input.method !== "POST") fail("METHOD_NOT_ALLOWED", "Canonical Wallet Gateway accepts POST only");
  if (input.contentType !== "application/json") fail("UNSUPPORTED_MEDIA_TYPE", "Canonical Wallet Gateway requires application/json");
  if (typeof input.path !== "string" || !/^\/[A-Za-z0-9/_-]{1,255}$/.test(input.path) || input.path.includes("//") || input.path.endsWith("/")) {
    fail("INVALID_PATH", "Canonical Wallet Gateway path is invalid");
  }
  if (typeof input.body !== "string") fail("INVALID_BODY", "Canonical Wallet Gateway body must be UTF-8 JSON text");
  const bytes = new TextEncoder().encode(input.body).length;
  if (bytes < 2 || bytes > CANONICAL_GATEWAY_HTTP_MAX_BODY_BYTES) fail("INVALID_BODY", "Canonical Wallet Gateway body size is outside policy");
  if (input.proof !== null && (typeof input.proof !== "object" || input.proof === null || Array.isArray(input.proof))) fail("INVALID_PROOF_HEADER", "Product Session proof header must be a JSON object or null");
  return Object.freeze({ method: input.method, path: input.path, contentType: input.contentType, body: input.body, proof: input.proof });
}

function complete(adapter, proof, payload, at) {
  if (proof !== null) fail("UNEXPECTED_PROOF_HEADER", "Session completion must not include a Product Session proof header");
  return adapter.complete(payload, at);
}

function rejectAuthorization(adapter, proof, payload, at) {
  if (proof !== null) fail("UNEXPECTED_PROOF_HEADER", "Authorization rejection must not include a Product Session proof header");
  return adapter.rejectAuthorization(payload, at);
}

function authenticatedInput(operation, proof, payload) {
  if (proof === null) fail("PROOF_REQUIRED", "Product Session proof header is required");
  const fields = operationFields(operation);
  exactFields(payload, fields, `Canonical Gateway ${operation} body`);
  return Object.freeze({ proof, ...payload });
}

function operationFields(operation) {
  if (operation === "introspect") return ["requiredScopes"];
  if (["sessionInventory", "revokeSession", "revokeApproval", "revokeDevice", "logoutAllDevices", "mandateInventory"].includes(operation)) return [];
  if (operation === "activateMandate") return ["mandate"];
  if (operation === "authorizeMandateAction") return ["mandateId", "action"];
  if (operation === "revokeMandate" || operation === "killMandate") return ["mandateId"];
  if (operation === "emergencyExitMandate") return ["mandateId", "reason"];
  fail("ROUTE_NOT_FOUND", "Canonical Wallet Gateway operation is not registered");
}

function parseCanonicalBody(body) {
  let value;
  try { value = JSON.parse(body); } catch { fail("INVALID_JSON", "Canonical Wallet Gateway body is not valid JSON"); }
  let normalized;
  try { normalized = canonicalJSON(value); } catch (caught) {
    if (caught instanceof WalletAuthError) throw caught;
    fail("INVALID_JSON", "Canonical Wallet Gateway body is not canonical JSON");
  }
  if (normalized !== body) fail("NON_CANONICAL_JSON", "Canonical Wallet Gateway body must use canonical JSON without duplicate keys or alternate encodings");
  return value;
}

function response(status, mutated, payload) {
  const body = canonicalJSON(payload);
  return Object.freeze({ status, headers: RESPONSE_HEADERS, body, mutated });
}

function publicError(caught) {
  if (!(caught instanceof WalletAuthError)) return Object.freeze({ status: 500, code: "INTERNAL", message: "Canonical Wallet Gateway failed closed" });
  const status = errorStatus(caught.code);
  return Object.freeze({ status, code: caught.code, message: boundedMessage(caught.message) });
}

function errorStatus(code) {
  if (code === "ROUTE_NOT_FOUND" || code === "SESSION_NOT_FOUND" || code === "MANDATE_NOT_FOUND") return 404;
  if (code === "METHOD_NOT_ALLOWED") return 405;
  if (code === "UNSUPPORTED_MEDIA_TYPE") return 415;
  if (["REPLAY", "ALREADY_REVOKED", "MANDATE_EXISTS", "MANDATE_TERMINAL", "MANDATE_REVOKED", "MANDATE_KILLED", "MANDATE_EXPIRED"].includes(code)) return 409;
  if (code === "CAPACITY") return 503;
  if (["UNKNOWN_PRODUCT", "REGISTRY_DISABLED", "DEVICE_MISMATCH", "INVALID_DEVICE_PROOF", "SESSION_BINDING_MISMATCH", "HTTP_BINDING_MISMATCH", "SCOPE_NOT_GRANTED", "SCOPE_NOT_ALLOWED", "REVOKED", "EXPIRED", "WALLET_CONTROL_REQUIRED", "MANDATE_BINDING_MISMATCH", "MANDATE_POLICY_VIOLATION", "LIMIT_EXCEEDED", "AUTHORIZATION_REJECTED"].includes(code)) return 403;
  return 400;
}

function boundedMessage(value) {
  if (typeof value !== "string" || value.length < 1) return "Canonical Wallet Gateway rejected the request";
  return value.length <= 500 ? value : `${value.slice(0, 497)}...`;
}

function validDate(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("INVALID_TIME", "Canonical Wallet Gateway time is invalid");
  return value;
}

function fail(code, message) {
  throw new WalletAuthError(code, message);
}
