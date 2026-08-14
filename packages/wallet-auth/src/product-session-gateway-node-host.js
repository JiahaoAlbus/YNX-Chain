import { createHash, randomBytes, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2 } from "./product-session-gateway-client.js";
import { ProductSessionGatewayHttpHandler, PRODUCT_SESSION_GATEWAY_HTTP_MAX_BODY_BYTES } from "./product-session-gateway-http.js";
import { parseProductSessionRegistry } from "./product-session-registry.js";

export const PRODUCT_SESSION_GATEWAY_NODE_STATE_SCHEMA_VERSION = 1;
export const PRODUCT_SESSION_GATEWAY_NODE_SERVICE = "ynx-product-session-gatewayd";
const STATE_FIELDS = ["registrySha256", "schemaVersion", "snapshot", "snapshotSha256"];
const MAX_STATE_BYTES = 64 * 1024 * 1024;
const JSON_HEADERS = Object.freeze({ "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" });
const PRODUCT_SESSION_PATHS = Object.freeze(new Set([
  "/v2/product-sessions/challenge",
  "/v2/product-sessions/complete",
  "/v2/product-sessions/devices/revoke",
  "/v2/product-sessions/introspect",
  "/v2/product-sessions/revoke",
]));
const CORS_REQUEST_HEADERS = Object.freeze(new Set(["accept", "content-type", "x-request-id", PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2]));
const CORS_ALLOW_HEADERS = "Accept, Content-Type, X-Request-Id, X-YNX-Product-Session-Proof-V2";

export class ProductSessionGatewayNodeHost {
  #build;
  #browserOrigins;
  #emitEvent;
  #handler;
  #now;
  #ready = true;
  #registry;
  #registrySha256;
  #remoteDeployed;
  #statePath;
  #stateIdentity;
  #tail = Promise.resolve();
  #tokenFactory;

  constructor(registryInput, options, deployment = { remoteDeployed: false }) {
    const runtime = runtimeOptions(options);
    const deploy = deploymentOptions(deployment);
    this.#registry = parseProductSessionRegistry(registryInput);
    this.#browserOrigins = new Set(this.#registry.products.map((product) => product.webOrigin));
    this.#registrySha256 = sha256(canonicalJSON(this.#registry));
    this.#statePath = secureStatePath(runtime.statePath);
    this.#now = runtime.now;
    this.#emitEvent = runtime.emitEvent;
    this.#tokenFactory = runtime.tokenFactory;
    this.#remoteDeployed = deploy.remoteDeployed;
    this.#build = deploy.build;
    const stored = loadState(this.#statePath, this.#registrySha256);
    this.#stateIdentity = stored?.identity ?? null;
    this.#handler = new ProductSessionGatewayHttpHandler(this.#registry, this.#tokenFactory, stored?.envelope.snapshot);
    if (!stored) this.#persist();
  }

  handler() {
    return async (request, response) => {
      const startedAt = Date.now();
      const requestId = requestIdHeader(request.headers["x-request-id"]);
      let browserOrigin = null;
      let status = 500;
      let errorCode = null;
      try {
        browserOrigin = this.#browserOrigin(request.headers.origin);
        if (request.method === "OPTIONS") {
          const preflight = await this.#enqueue(() => {
            this.#assertState();
            return this.#preflight(request, browserOrigin);
          });
          status = preflight.status;
          write(response, preflight);
          return;
        }
        const administrative = await this.#enqueue(() => {
          this.#assertState();
          return this.#administrative(request);
        });
        if (administrative) {
          status = administrative.status;
          write(response, withCors(administrative, browserOrigin));
          return;
        }
        const body = await boundedBody(request);
        const result = await this.#enqueue(() => this.#dispatch({
          body,
          contentType: header(request.headers["content-type"]),
          method: request.method ?? "",
          networkAvailable: true,
          path: request.url ?? "",
          proofHeader: optionalHeader(request.headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2]),
          requestId,
        }));
        status = result.status;
        errorCode = responseErrorCode(result.body);
        write(response, withCors(result, browserOrigin));
      } catch (error) {
        const normalized = hostError(error);
        status = normalized.status;
        errorCode = normalized.code;
        write(response, withCors(jsonResponse(status, requestId, { error: { code: normalized.code, message: normalized.message }, ok: false, requestId, schemaVersion: 2 }), browserOrigin));
      } finally {
        this.#emit({
          at: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAt),
          errorCode,
          event: "request",
          method: observableMethod(request.method),
          path: observablePath(request.url),
          remoteDeployed: this.#remoteDeployed,
          requestId,
          service: PRODUCT_SESSION_GATEWAY_NODE_SERVICE,
          sourceCommit: this.#build?.sourceCommit ?? null,
          status,
        });
      }
    };
  }

  snapshot() { return this.#handler.snapshot(); }
  stateDigest() { return sha256(canonicalJSON(this.#handler.snapshot())); }
  waitForIdle() { return this.#tail; }

  #dispatch(input) {
    if (!this.#ready) throw new WalletAuthError("SERVICE_NOT_READY", "Product Session Gateway is not ready");
    this.#assertState();
    const before = this.#handler.snapshot();
    const result = this.#handler.handle(input, this.#now());
    try {
      this.#assertState(sha256(canonicalJSON(before)));
      this.#persist();
    } catch (error) {
      this.#handler = new ProductSessionGatewayHttpHandler(this.#registry, this.#tokenFactory, before);
      this.#ready = false;
      if (error instanceof WalletAuthError) throw error;
      throw new WalletAuthError("STATE_PERSISTENCE_FAILED", "Product Session Gateway could not persist authoritative state");
    }
    return result;
  }

  #enqueue(action) {
    const pending = this.#tail.then(action, action);
    this.#tail = pending.catch(() => undefined);
    return pending;
  }

  #administrative(request) {
    if (request.method !== "GET" || request.headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2] !== undefined || request.headers["content-length"] !== undefined || request.headers["transfer-encoding"] !== undefined) return null;
    const stateSha256 = this.stateDigest();
    if (request.url === "/health") return jsonResponse(200, "req_administrative_health", { ok: true, remoteDeployed: this.#remoteDeployed, service: PRODUCT_SESSION_GATEWAY_NODE_SERVICE, stateSha256, truthfulStatus: this.#remoteDeployed ? "remote-product-session-v2-gateway" : "local-product-session-v2-gateway" });
    if (request.url === "/ready") return jsonResponse(this.#ready ? 200 : 503, "req_administrative_ready_", { ok: this.#ready, remoteDeployed: this.#remoteDeployed, runtimeReady: this.#ready, service: PRODUCT_SESSION_GATEWAY_NODE_SERVICE, stateSha256 });
    if (request.url === "/version") return jsonResponse(200, "req_administrative_version", { build: this.#build, nodeStateSchemaVersion: PRODUCT_SESSION_GATEWAY_NODE_STATE_SCHEMA_VERSION, ok: true, productSessionGatewaySchemaVersion: 2, registrySchemaVersion: 2, registrySha256: this.#registrySha256, remoteDeployed: this.#remoteDeployed, service: PRODUCT_SESSION_GATEWAY_NODE_SERVICE });
    return null;
  }

  #browserOrigin(value) {
    if (value === undefined) return null;
    if (typeof value !== "string" || !this.#browserOrigins.has(value)) throw new WalletAuthError("ORIGIN_NOT_ALLOWED", "Product Session Gateway browser origin is not registered");
    return value;
  }

  #preflight(request, browserOrigin) {
    if (browserOrigin === null) throw new WalletAuthError("ORIGIN_NOT_ALLOWED", "Product Session Gateway preflight requires a registered browser origin");
    if (!PRODUCT_SESSION_PATHS.has(request.url)) throw new WalletAuthError("ROUTE_NOT_FOUND", "Product Session Gateway preflight route is not registered");
    if (header(request.headers["access-control-request-method"]).toUpperCase() !== "POST") throw new WalletAuthError("PREFLIGHT_NOT_ALLOWED", "Product Session Gateway preflight method is not allowed");
    const requestedHeaders = header(request.headers["access-control-request-headers"]);
    for (const item of requestedHeaders.split(",")) {
      const name = item.trim().toLowerCase();
      if (name && !CORS_REQUEST_HEADERS.has(name)) throw new WalletAuthError("PREFLIGHT_NOT_ALLOWED", "Product Session Gateway preflight header is not allowed");
    }
    return Object.freeze({
      body: "",
      headers: Object.freeze({
        "access-control-allow-headers": CORS_ALLOW_HEADERS,
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-origin": browserOrigin,
        "access-control-max-age": "600",
        "cache-control": "no-store",
        "vary": "Origin",
        "x-content-type-options": "nosniff",
      }),
      status: 204,
    });
  }

  #persist() {
    const snapshot = this.#handler.snapshot();
    const envelope = Object.freeze({ registrySha256: this.#registrySha256, schemaVersion: PRODUCT_SESSION_GATEWAY_NODE_STATE_SCHEMA_VERSION, snapshot, snapshotSha256: sha256(canonicalJSON(snapshot)) });
    atomicWrite(this.#statePath, `${canonicalJSON(envelope)}\n`);
    const stored = loadState(this.#statePath, this.#registrySha256);
    if (!stored || stored.envelope.snapshotSha256 !== envelope.snapshotSha256) throw new WalletAuthError("STATE_PERSISTENCE_FAILED", "Product Session Gateway could not verify persisted authoritative state");
    this.#stateIdentity = stored.identity;
  }

  #assertState(expectedSnapshotSha256 = this.stateDigest()) {
    if (!this.#ready) throw new WalletAuthError("SERVICE_NOT_READY", "Product Session Gateway is not ready");
    try {
      const stored = loadState(this.#statePath, this.#registrySha256);
      if (!stored) throw new WalletAuthError("STATE_FILE_CHANGED", "Product Session Gateway state file disappeared at runtime");
      if (!this.#stateIdentity || stored.identity.dev !== this.#stateIdentity.dev || stored.identity.ino !== this.#stateIdentity.ino) throw new WalletAuthError("STATE_FILE_CHANGED", "Product Session Gateway state inode changed at runtime");
      if (stored.envelope.snapshotSha256 !== expectedSnapshotSha256) throw new WalletAuthError("STATE_TAMPERED", "Product Session Gateway persisted and in-memory state diverged");
    } catch (error) {
      this.#ready = false;
      throw error;
    }
  }

  #emit(event) {
    try { this.#emitEvent(Object.freeze(event)); } catch { /* observability cannot change authority */ }
  }
}

export class PersistentProductSessionGatewayNodeHost extends ProductSessionGatewayNodeHost {
  constructor(registry, options) {
    super(registry, {
      emitEvent: options.emitEvent ?? (() => undefined),
      now: options.now,
      statePath: options.statePath,
      tokenFactory: options.tokenFactory ?? defaultProductSessionTokenFactory,
    });
  }
}

function runtimeOptions(value) {
  exactFields(value, ["emitEvent", "now", "statePath", "tokenFactory"], "Product Session Gateway Node options");
  if (typeof value.emitEvent !== "function" || typeof value.now !== "function" || typeof value.tokenFactory !== "function") throw new WalletAuthError("INVALID_HOST_OPTIONS", "Product Session Gateway Node callbacks are invalid");
  return value;
}

function deploymentOptions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WalletAuthError("INVALID_DEPLOYMENT", "Product Session Gateway deployment is invalid");
  const expected = Object.hasOwn(value, "build") ? ["build", "remoteDeployed"] : ["remoteDeployed"];
  exactFields(value, expected, "Product Session Gateway deployment");
  if (typeof value.remoteDeployed !== "boolean") throw new WalletAuthError("INVALID_DEPLOYMENT", "Product Session Gateway deployment flag is invalid");
  const build = value.build === undefined ? null : buildIdentity(value.build);
  if (value.remoteDeployed && !build) throw new WalletAuthError("INVALID_BUILD_IDENTITY", "Remote Product Session Gateway requires exact build identity");
  return Object.freeze({ build, remoteDeployed: value.remoteDeployed });
}

function buildIdentity(value) {
  exactFields(value, ["buildTime", "release", "sourceCommit"], "Product Session Gateway build identity");
  if (typeof value.sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(value.sourceCommit) || typeof value.release !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.release) || typeof value.buildTime !== "string" || new Date(value.buildTime).toISOString() !== value.buildTime) throw new WalletAuthError("INVALID_BUILD_IDENTITY", "Product Session Gateway build identity is invalid");
  return Object.freeze({ ...value });
}

function secureStatePath(value) {
  if (typeof value !== "string" || !isAbsolute(value) || value.length > 1024) throw new WalletAuthError("INVALID_STATE_PATH", "Product Session Gateway state path must be absolute");
  const parent = dirname(value);
  const info = lstatSync(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700 || info.uid !== process.getuid()) throw new WalletAuthError("INSECURE_STATE_DIRECTORY", "Product Session Gateway state directory must be owned by the service account with mode 0700");
  return value;
}

function loadState(path, registrySha256) {
  let info;
  try { info = lstatSync(path); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 || info.uid !== process.getuid() || info.size < 2 || info.size > MAX_STATE_BYTES) throw new WalletAuthError("INSECURE_STATE_FILE", "Product Session Gateway state file is unsafe");
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = fstatSync(descriptor);
    if (current.ino !== info.ino || current.dev !== info.dev) throw new WalletAuthError("STATE_FILE_CHANGED", "Product Session Gateway state file changed during open");
    const text = readFileSync(descriptor, "utf8");
    if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) throw new WalletAuthError("INVALID_GATEWAY_STORE", "Product Session Gateway state envelope is not one canonical line");
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new WalletAuthError("INVALID_GATEWAY_STORE", "Product Session Gateway state envelope is not JSON"); }
    exactFields(parsed, STATE_FIELDS, "Product Session Gateway Node state envelope");
    if (canonicalJSON(parsed) !== text.slice(0, -1) || parsed.schemaVersion !== PRODUCT_SESSION_GATEWAY_NODE_STATE_SCHEMA_VERSION || parsed.registrySha256 !== registrySha256 || typeof parsed.snapshotSha256 !== "string" || !/^[0-9a-f]{64}$/.test(parsed.snapshotSha256) || parsed.snapshotSha256 !== sha256(canonicalJSON(parsed.snapshot))) throw new WalletAuthError("STATE_TAMPERED", "Product Session Gateway state envelope failed integrity or registry binding");
    return Object.freeze({
      envelope: Object.freeze(parsed),
      identity: Object.freeze({ dev: current.dev, ino: current.ino }),
    });
  } finally { closeSync(descriptor); }
}

function atomicWrite(path, text) {
  const parent = dirname(path);
  const temporary = join(parent, `.state-${process.pid}-${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    writeFileSync(descriptor, text, { encoding: "utf8" });
    fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined;
    renameSync(temporary, path);
    const directory = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(directory); } finally { closeSync(directory); }
    const written = statSync(path);
    if (!written.isFile() || written.nlink !== 1 || (written.mode & 0o777) !== 0o600 || written.uid !== process.getuid()) throw new WalletAuthError("INSECURE_STATE_FILE", "Product Session Gateway wrote an unsafe state file");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
}

async function boundedBody(request) {
  const declared = request.headers["content-length"];
  if (declared !== undefined && (typeof declared !== "string" || !/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) > PRODUCT_SESSION_GATEWAY_HTTP_MAX_BODY_BYTES)) throw new WalletAuthError("BODY_TOO_LARGE", "Product Session Gateway body exceeds policy");
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > PRODUCT_SESSION_GATEWAY_HTTP_MAX_BODY_BYTES) throw new WalletAuthError("BODY_TOO_LARGE", "Product Session Gateway body exceeds policy");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length).toString("utf8");
}

function requestIdHeader(value) { return typeof value === "string" ? value : "req_invalid_request_000"; }
function header(value) { return typeof value === "string" ? value : ""; }
function optionalHeader(value) { return value === undefined ? null : typeof value === "string" ? value : "invalid"; }
function observableMethod(value) { return typeof value === "string" && /^[A-Z]{3,10}$/.test(value) ? value : "INVALID"; }
function observablePath(value) { return typeof value === "string" && /^\/[A-Za-z0-9/_-]{1,255}$/.test(value) ? value : "/invalid"; }
function responseErrorCode(body) { try { const value = JSON.parse(body); return typeof value?.error?.code === "string" ? value.error.code : null; } catch { return "INVALID_RESPONSE"; } }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

function hostError(error) {
  if (error instanceof WalletAuthError) {
    const stateFailure = ["INSECURE_STATE_FILE", "INVALID_GATEWAY_STORE", "SERVICE_NOT_READY", "STATE_FILE_CHANGED", "STATE_PERSISTENCE_FAILED", "STATE_TAMPERED"].includes(error.code);
    const status = error.code === "BODY_TOO_LARGE" ? 413 : error.code === "ROUTE_NOT_FOUND" ? 404 : ["ORIGIN_NOT_ALLOWED", "PREFLIGHT_NOT_ALLOWED"].includes(error.code) ? 403 : stateFailure ? 503 : 400;
    return { code: error.code, message: error.message, status };
  }
  return { code: "HOST_FAILURE", message: "Product Session Gateway host failed closed", status: 500 };
}

function jsonResponse(status, requestId, value) { return Object.freeze({ body: canonicalJSON(value), headers: Object.freeze({ ...JSON_HEADERS, "x-request-id": requestId }), status }); }
function withCors(result, origin) {
  if (origin === null) return result;
  return Object.freeze({
    ...result,
    headers: Object.freeze({
      ...result.headers,
      "access-control-allow-origin": origin,
      "access-control-expose-headers": "X-Request-Id",
      "vary": "Origin",
    }),
  });
}
function write(response, result) { response.writeHead(result.status, result.headers); response.end(result.body); }

export function defaultProductSessionTokenFactory() { return randomBytes(32).toString("base64url"); }
