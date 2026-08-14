import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { httpBodyDigest } from "./session-proof.js";
import { parseProductSessionRegistry } from "./product-session-registry.js";
import { ProductSessionAuthority, parseProductSessionAuthoritySnapshot } from "./product-session-v2.js";
import { productSessionProofV2Digest, verifyProductSessionProofV2 } from "./product-session-proof-v2.js";

export const PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION = 1;
const INPUT_FIELDS = ["requestId", "method", "path", "body", "proof", "networkAvailable"];
const SNAPSHOT_FIELDS = ["schemaVersion", "authority", "consumedProofs", "audit"];

export class ProductSessionGatewayKernel {
  #registry; #authority; #tokens; #proofs; #audit;
  constructor(registryInput, tokenFactory, snapshot) {
    this.#registry = parseProductSessionRegistry(registryInput);
    if (typeof tokenFactory !== "function") fail("INVALID_RANDOM_SOURCE", "Product Session Gateway requires a cryptographic challenge source");
    this.#tokens = () => { const value = tokenFactory(); if (typeof value !== "string" || !/^[A-Za-z0-9_-]{32,64}$/.test(value)) fail("INVALID_RANDOM_SOURCE", "Gateway challenge source returned an invalid token"); return value; };
    const parsed = snapshot === undefined
      ? Object.freeze({ schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION, authority: new ProductSessionAuthority(this.#registry).snapshot(), consumedProofs: Object.freeze([]), audit: Object.freeze([]) })
      : parseProductSessionGatewaySnapshot(snapshot);
    this.#authority = new ProductSessionAuthority(this.#registry, parsed.authority);
    this.#proofs = [...parsed.consumedProofs]; this.#audit = [...parsed.audit];
  }

  dispatch(input, at = new Date()) {
    let requestId = "req_invalid_request_000";
    const beforeAuthority = this.#authority.snapshot();
    const beforeProofs = [...this.#proofs];
    try {
      const request = parseInput(input); requestId = request.requestId;
      if (!request.networkAvailable) fail("NETWORK_UNAVAILABLE", "Product Session Gateway network dependency is unavailable");
      const result = this.#route(request, at);
      this.#record(requestId, request.path, "ok", null, result?.sessionBinding ?? result?.session?.sessionBinding ?? result?.revoked ?? result?.challenge ?? "none", at);
      return response(200, requestId, { ok: true, result });
    } catch (error) {
      this.#authority = new ProductSessionAuthority(this.#registry, beforeAuthority);
      this.#proofs = beforeProofs;
      const publicError = normalizeError(error);
      this.#record(requestId, auditPath(input?.path), "rejected", publicError.code, "none", at);
      return response(publicError.status, requestId, { ok: false, error: { code: publicError.code, message: publicError.message } });
    }
  }

  snapshot() { return Object.freeze({ schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION, authority: this.#authority.snapshot(), consumedProofs: Object.freeze([...this.#proofs]), audit: Object.freeze([...this.#audit]) }); }

  #route(request, at) {
    if (request.path === "/v2/product-sessions/challenge") {
      if (request.proof !== null) fail("UNEXPECTED_PROOF", "Challenge issuance does not accept a Product Session proof");
      exactFields(request.body, ["request", "approval"], "Product Session Gateway challenge body");
      return this.#authority.issueChallenge({ request: request.body.request, approval: request.body.approval, challenge: this.#tokens() }, at);
    }
    if (request.path === "/v2/product-sessions/complete") {
      if (request.proof !== null) fail("UNEXPECTED_PROOF", "Session completion does not accept an existing Product Session proof");
      exactFields(request.body, ["request", "approval", "completion"], "Product Session Gateway completion body");
      return this.#authority.complete(request.body, at);
    }
    if (request.path === "/v2/product-sessions/introspect") {
      exactFields(request.body, ["requiredScopes"], "Product Session introspection body");
      return this.#authorize(request, request.body.requiredScopes, at);
    }
    if (request.path === "/v2/product-sessions/revoke") {
      exactFields(request.body, [], "Product Session revoke body");
      const authorized = this.#authorize(request, [], at); this.#authority.revokeSession(authorized.session.sessionBinding); return Object.freeze({ revoked: authorized.session.sessionBinding });
    }
    if (request.path === "/v2/product-sessions/devices/revoke") {
      exactFields(request.body, [], "Product Session device revoke body");
      const authorized = this.#authorize(request, [], at); this.#authority.revokeDevice(authorized.session.deviceBinding); return Object.freeze({ revoked: authorized.session.deviceBinding });
    }
    fail("ROUTE_NOT_FOUND", "Product Session Gateway route is not registered");
  }

  #authorize(request, requiredScopes, at) {
    if (request.proof === null) fail("PROOF_REQUIRED", "A sender-constrained Product Session proof is required");
    const session = this.#authority.snapshot().sessions.find((item) => item.sessionBinding === request.proof?.sessionBinding);
    if (!session) fail("SESSION_NOT_FOUND", "Product Session was not found");
    const proof = verifyProductSessionProofV2(request.proof, session, { method: request.method, path: request.path, bodyDigest: httpBodyDigest(canonicalJSON(request.body)) }, at);
    const proofDigest = productSessionProofV2Digest(proof);
    if (this.#proofs.includes(proofDigest)) fail("REPLAY", "Product Session proof was already consumed");
    if (this.#proofs.length >= 20_000) fail("CAPACITY", "Product Session proof replay store is at capacity");
    const result = this.#authority.introspect(session.sessionBinding, { chainId: session.chainId, productId: session.productId, clientId: session.clientId, platform: session.platform, applicationId: session.applicationId, bundleId: session.bundleId, packageId: session.packageId, origin: session.origin, callback: session.callback, account: session.account, deviceId: session.deviceId, deviceKey: session.deviceKey, requiredScopes }, at);
    this.#proofs.push(proofDigest); this.#proofs.sort(); return result;
  }

  #record(requestId, path, outcome, code, subject, at) {
    if (this.#audit.length >= 20_000) {
      this.#audit.shift();
      this.#audit = this.#audit.map((event, index) => Object.freeze({ ...event, sequence: index + 1 }));
    }
    this.#audit.push(Object.freeze({ sequence: this.#audit.length + 1, requestId, path, outcome, code, subject, at: validDate(at).toISOString() }));
  }
}

export function parseProductSessionGatewaySnapshot(input) {
  exactFields(input, SNAPSHOT_FIELDS, "Product Session Gateway snapshot");
  if (input.schemaVersion !== PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION) fail("INVALID_GATEWAY_STORE", "Product Session Gateway snapshot version is unsupported");
  const authority = parseProductSessionAuthoritySnapshot(input.authority);
  const consumedProofs = stringSet(input.consumedProofs, /^[0-9a-f]{64}$/, "consumedProofs");
  if (!Array.isArray(input.audit) || input.audit.length > 20_000) fail("INVALID_GATEWAY_STORE", "Product Session Gateway audit is invalid");
  const audit = input.audit.map((item, index) => { exactFields(item, ["sequence", "requestId", "path", "outcome", "code", "subject", "at"], "Product Session Gateway audit event"); if (item.sequence !== index + 1 || !/^req_[A-Za-z0-9_-]{12,80}$/.test(item.requestId) || !/^\/[A-Za-z0-9/_-]{1,255}$/.test(item.path) || !["ok", "rejected"].includes(item.outcome) || (item.code !== null && (typeof item.code !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(item.code))) || typeof item.subject !== "string" || item.subject.length > 128 || !isCanonicalIsoDate(item.at)) fail("INVALID_GATEWAY_STORE", "Product Session Gateway audit event is invalid"); return Object.freeze({ ...item }); });
  return Object.freeze({ schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION, authority, consumedProofs: Object.freeze(consumedProofs), audit: Object.freeze(audit) });
}

function parseInput(input) { exactFields(input, INPUT_FIELDS, "Product Session Gateway input"); if (typeof input.requestId !== "string" || !/^req_[A-Za-z0-9_-]{12,80}$/.test(input.requestId)) fail("INVALID_REQUEST_ID", "Product Session Gateway request ID is invalid"); if (input.method !== "POST") fail("METHOD_NOT_ALLOWED", "Product Session Gateway accepts POST only"); if (typeof input.path !== "string" || !/^\/[A-Za-z0-9/_-]{1,255}$/.test(input.path) || input.path.includes("//") || input.path.endsWith("/")) fail("INVALID_PATH", "Product Session Gateway path is invalid"); if (!input.body || typeof input.body !== "object" || Array.isArray(input.body)) fail("INVALID_BODY", "Product Session Gateway body must be an object"); if (input.proof !== null && (!input.proof || typeof input.proof !== "object" || Array.isArray(input.proof))) fail("INVALID_PROOF", "Product Session Gateway proof is invalid"); if (typeof input.networkAvailable !== "boolean") fail("INVALID_NETWORK_STATE", "Product Session Gateway network state is invalid"); return Object.freeze(input); }
function response(status, requestId, payload) { return Object.freeze({ status, headers: Object.freeze({ "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-request-id": requestId }), body: canonicalJSON({ ...payload, requestId, schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION }) }); }
function normalizeError(error) { if (!(error instanceof WalletAuthError)) return { status: 500, code: "INTERNAL", message: "Product Session Gateway failed closed" }; const forbidden = ["CROSS_PRODUCT_SESSION", "INVALID_DEVICE_PROOF", "SESSION_REVOKED", "SESSION_EXPIRED", "SCOPE_WIDENING", "PROOF_REQUIRED"]; const conflict = ["REPLAY", "ALREADY_REVOKED"]; const status = error.code === "NETWORK_UNAVAILABLE" ? 503 : error.code === "ROUTE_NOT_FOUND" || error.code === "SESSION_NOT_FOUND" ? 404 : conflict.includes(error.code) ? 409 : forbidden.includes(error.code) ? 403 : 400; return { status, code: error.code, message: error.message.length <= 300 ? error.message : "Product Session Gateway rejected the request" }; }
function auditPath(value) { return typeof value === "string" && /^\/[A-Za-z0-9/_-]{1,255}$/.test(value) && !value.includes("//") && !value.endsWith("/") ? value : "/invalid"; }
function stringSet(value, regex, label) { if (!Array.isArray(value) || value.length > 20_000 || value.some((item) => typeof item !== "string" || !regex.test(item)) || new Set(value).size !== value.length || [...value].sort().join("\n") !== value.join("\n")) fail("INVALID_GATEWAY_STORE", `${label} must be unique and sorted`); return [...value]; }
function isCanonicalIsoDate(value) { if (typeof value !== "string") return false; const parsed = new Date(value); return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value; }
function validDate(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("INVALID_TIME", "Product Session Gateway time is invalid"); return value; }
function fail(code, message) { throw new WalletAuthError(code, message); }
