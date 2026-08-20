import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { canonicalJSON, exactFields, isPlainObject, WalletAuthError } from "./canonical.js";
import { forwardedClient, GatewayAdmissionController } from "./gateway-admission.js";
import { CANONICAL_GATEWAY_HTTP_SCHEMA_VERSION, CanonicalWalletGatewayHttpKernel, gatewayStateDigest } from "./gateway-http.js";
import { parseCentralRegistryDocument } from "./registry.js";

export const CANONICAL_GATEWAY_PROOF_HEADER = "x-ynx-product-session-proof";
export const CANONICAL_GATEWAY_NODE_STATE_SCHEMA_VERSION = 2;
export const CANONICAL_GATEWAY_OBSERVABILITY_SCHEMA_VERSION = 1;
const STATE_FIELDS = ["registrySha256", "schemaVersion", "stateDigest", "snapshot"];
const LEGACY_STATE_FIELDS = ["schemaVersion", "stateDigest", "snapshot"];
const MAX_PROOF_HEADER_BYTES = 16_384;
const MAX_STATE_BYTES = 64 * 1024 * 1024;
const MAX_STATE_LOCK_BYTES = 1024;
const STATE_LOCK_WAIT_MS = 2_000;
const STATE_LOCK_RETRY_MS = 5;
const STATE_LOCK_FIELDS = ["acquiredAt", "pid", "schemaVersion", "token"];
const STATE_LOCK_SCHEMA_VERSION = 1;
const JSON_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
});
const OBSERVABLE_ROUTES = Object.freeze(new Map([
  ["/health", "health"],
  ["/ready", "ready"],
  ["/version", "version"],
  ["/metrics", "metrics"],
  ["/v1/wallet/sessions/complete", "session_complete"],
  ["/v1/wallet/sessions/introspect", "session_introspect"],
  ["/v1/wallet/sessions", "session_inventory"],
  ["/v1/wallet/sessions/revoke", "session_revoke"],
  ["/v1/wallet/approvals/revoke", "approval_revoke"],
  ["/v1/wallet/devices/revoke", "device_revoke"],
  ["/v1/wallet/accounts/logout-all", "account_logout_all"],
  ["/v1/wallet/mandates/activate", "mandate_activate"],
  ["/v1/wallet/mandates/authorize-action", "mandate_authorize_action"],
  ["/v1/wallet/mandates", "mandate_inventory"],
  ["/v1/wallet/mandates/revoke", "mandate_revoke"],
  ["/v1/wallet/mandates/kill", "mandate_kill"],
  ["/v1/wallet/mandates/emergency-exit", "mandate_emergency_exit"],
]));

export class CanonicalWalletGatewayNodeHost {
  #admission;
  #allowLegacyStateMigration;
  #build;
  #bodyTimeoutMs;
  #emitEvent;
  #kernel;
  #metrics;
  #registry;
  #remoteDeployed;
  #registrySha256;
  #enabledProductClientIds;
  #statePath;
  #now;

  constructor(registry, options, deployment = { remoteDeployed: false }) {
    const runtime = hostOptions(options);
    const deploymentState = deploymentConfig(deployment);
    this.#statePath = statePath(runtime.statePath);
    this.#bodyTimeoutMs = runtime.bodyTimeoutMs;
    this.#admission = runtime.admission;
    this.#allowLegacyStateMigration = runtime.allowLegacyStateMigration;
    this.#now = runtime.now;
    this.#emitEvent = runtime.emitEvent;
    this.#remoteDeployed = deploymentState.remoteDeployed;
    this.#build = deploymentState.build;
    this.#metrics = {
      durationMsTotal: 0,
      errorsByCode: new Map(),
      eventsDroppedTotal: 0,
      inFlight: 0,
      requestsTotal: 0,
      responsesByRouteStatus: new Map(),
    };
    const reviewedRegistry = parseCentralRegistryDocument(registry);
    this.#registry = reviewedRegistry;
    this.#registrySha256 = createHash("sha256").update(canonicalJSON(reviewedRegistry)).digest("hex");
    this.#enabledProductClientIds = Object.freeze(reviewedRegistry.products.filter((product) => product.enabled).map((product) => product.productClientId).sort());
    const stored = loadState(this.#statePath);
    if (stored?.needsRewrite && !this.#allowLegacyStateMigration) {
      throw new WalletAuthError("LEGACY_STATE_MIGRATION_REQUIRED", "Canonical Gateway legacy state requires explicit one-time migration authorization");
    }
    this.#kernel = new CanonicalWalletGatewayHttpKernel(reviewedRegistry, stored?.snapshot);
    if (stored && stored.stateDigest !== gatewayStateDigest(this.#kernel.snapshot())) {
      throw new WalletAuthError("STATE_TAMPERED", "Canonical Gateway persisted state digest is invalid");
    }
    if (stored && stored.registrySha256 !== null && stored.registrySha256 !== this.#registrySha256) {
      throw new WalletAuthError("REGISTRY_STATE_MISMATCH", "Canonical Gateway persisted state belongs to a different registry");
    }
    if (!stored || stored.needsRewrite) this.#persist();
  }

  handler() {
    return async (request, response) => {
      const requestId = randomUUID();
      const traceId = randomUUID();
      const route = observableRoute(request.url);
      const startedAt = Date.now();
      this.#metrics.requestsTotal += 1;
      this.#metrics.inFlight += 1;
      let errorCode = null;
      let errorId = null;
      let status = 500;
      let admissionTicket = null;
      let releaseStateLock = null;
      const releaseHeldStateLock = () => {
        if (!releaseStateLock) return;
        const release = releaseStateLock;
        releaseStateLock = null;
        release();
      };
      try {
        admissionTicket = this.#admission?.enter(forwardedClient(request)) ?? null;
        if (admissionTicket && !admissionTicket.ok) {
          status = admissionTicket.status;
          errorCode = admissionTicket.code;
          errorId = randomUUID();
          response.writeHead(status, observabilityHeaders({ ...JSON_HEADERS, "retry-after": "60" }, requestId, traceId, errorId));
          response.end(canonicalJSON({
            error: { code: errorCode, message: "Wallet Gateway admission policy rejected the request" },
            errorId,
            ok: false,
            requestId,
            schemaVersion: CANONICAL_GATEWAY_HTTP_SCHEMA_VERSION,
            stateDigest: gatewayStateDigest(this.#kernel.snapshot()),
            traceId,
          }));
          return;
        }
        const administrative = this.#administrativeResponse(request);
        if (administrative) {
          status = administrative.status;
          response.writeHead(status, observabilityHeaders(administrative.headers, requestId, traceId, null));
          response.end(administrative.body);
          return;
        }
        const body = await boundedBody(request, this.#bodyTimeoutMs);
        const proof = decodeGatewayProofHeader(request.headers[CANONICAL_GATEWAY_PROOF_HEADER]);
        releaseStateLock = await acquireStateLock(this.#statePath);
        this.#reload();
        const before = this.#kernel.snapshot();
        const result = this.#kernel.dispatch({
          method: request.method,
          path: request.url,
          contentType: request.headers["content-type"] ?? "",
          body,
          proof,
          origin: request.headers.origin,
        }, this.#now());
        if (result.mutated) {
          try {
            this.#persist();
          } catch (caught) {
            if (caught?.code !== "STATE_COMMIT_UNCERTAIN") this.#kernel = new CanonicalWalletGatewayHttpKernel(this.#registry, before);
            throw caught;
          }
        }
        releaseHeldStateLock();
        status = result.status;
        errorCode = status >= 400 ? responseErrorCode(result.body) : null;
        errorId = errorCode ? randomUUID() : null;
        response.writeHead(status, observabilityHeaders(result.headers, requestId, traceId, errorId));
        response.end(result.body);
      } catch (caught) {
        let failure = caught;
        try { releaseHeldStateLock(); }
        catch (lockFailure) { failure = lockFailure; }
        const error = hostError(failure);
        status = error.status;
        errorCode = error.code;
        errorId = randomUUID();
        response.writeHead(status, observabilityHeaders(JSON_HEADERS, requestId, traceId, errorId));
        response.end(canonicalJSON({
          error: { code: error.code, message: error.message },
          errorId,
          ok: false,
          requestId,
          schemaVersion: CANONICAL_GATEWAY_HTTP_SCHEMA_VERSION,
          stateDigest: gatewayStateDigest(this.#kernel.snapshot()),
          traceId,
        }));
      } finally {
        releaseHeldStateLock();
        if (admissionTicket?.ok) admissionTicket.release();
        this.#metrics.inFlight -= 1;
        const durationMs = Math.max(0, Date.now() - startedAt);
        this.#metrics.durationMsTotal += durationMs;
        increment(this.#metrics.responsesByRouteStatus, `${route}\u0000${status}`);
        if (errorCode) increment(this.#metrics.errorsByCode, errorCode);
        this.#emit({
          at: new Date().toISOString(),
          durationMs,
          errorCode,
          errorId,
          method: observableMethod(request.method),
          ok: status < 400,
          release: this.#build.release,
          remoteDeployed: this.#remoteDeployed,
          requestId,
          route,
          schemaVersion: CANONICAL_GATEWAY_OBSERVABILITY_SCHEMA_VERSION,
          service: "ynx-wallet-gatewayd",
          sourceCommit: this.#build.sourceCommit,
          stateDigest: gatewayStateDigest(this.#kernel.snapshot()),
          status,
          traceId,
        });
      }
    };
  }

  snapshot() {
    return this.#kernel.snapshot();
  }

  #administrativeResponse(request) {
    if (request.method !== "GET" || request.headers[CANONICAL_GATEWAY_PROOF_HEADER] !== undefined) return null;
    const stateDigest = gatewayStateDigest(this.#kernel.snapshot());
    if (request.url === "/health") {
      return jsonResponse({
        ok: true,
        remoteDeployed: this.#remoteDeployed,
        service: "ynx-wallet-gatewayd",
        stateDigest,
        truthfulStatus: this.#remoteDeployed ? "remote-canonical-wallet-gateway" : "canonical-wallet-gateway-local-runtime",
      });
    }
    if (request.url === "/ready") {
      return jsonResponse({
        ok: true,
        publicDeploymentReady: this.#remoteDeployed,
        remoteDeployed: this.#remoteDeployed,
        runtimeReady: true,
        service: "ynx-wallet-gatewayd",
        stateDigest,
      });
    }
    if (request.url === "/version") {
      return jsonResponse({
        build: this.#build,
        enabledProductClientIds: this.#enabledProductClientIds,
        gatewayHttpSchemaVersion: CANONICAL_GATEWAY_HTTP_SCHEMA_VERSION,
        nodeStateSchemaVersion: CANONICAL_GATEWAY_NODE_STATE_SCHEMA_VERSION,
        observabilitySchemaVersion: CANONICAL_GATEWAY_OBSERVABILITY_SCHEMA_VERSION,
        ok: true,
        registrySha256: this.#registrySha256,
        remoteDeployed: this.#remoteDeployed,
        service: "ynx-wallet-gatewayd",
      });
    }
    if (request.url === "/metrics") {
      return Object.freeze({
        body: this.#renderMetrics(),
        headers: Object.freeze({
          "cache-control": "no-store",
          "content-type": "text/plain; version=0.0.4; charset=utf-8",
        }),
        status: 200,
      });
    }
    return null;
  }

  #emit(event) {
    try {
      this.#emitEvent(Object.freeze(event));
    } catch {
      this.#metrics.eventsDroppedTotal += 1;
    }
  }

  #renderMetrics() {
    const buildCommit = this.#build.sourceCommit ?? "unbound";
    const lines = [
      "# HELP ynx_wallet_gateway_requests_total Total HTTP requests accepted by the process.",
      "# TYPE ynx_wallet_gateway_requests_total counter",
      `ynx_wallet_gateway_requests_total ${this.#metrics.requestsTotal}`,
      "# HELP ynx_wallet_gateway_in_flight Current in-flight HTTP requests.",
      "# TYPE ynx_wallet_gateway_in_flight gauge",
      `ynx_wallet_gateway_in_flight ${this.#metrics.inFlight}`,
      "# HELP ynx_wallet_gateway_request_duration_ms_sum Cumulative process-local request duration in milliseconds.",
      "# TYPE ynx_wallet_gateway_request_duration_ms_sum counter",
      `ynx_wallet_gateway_request_duration_ms_sum ${this.#metrics.durationMsTotal}`,
      "# HELP ynx_wallet_gateway_events_dropped_total Structured events dropped because the configured sink failed.",
      "# TYPE ynx_wallet_gateway_events_dropped_total counter",
      `ynx_wallet_gateway_events_dropped_total ${this.#metrics.eventsDroppedTotal}`,
      "# HELP ynx_wallet_gateway_remote_deployed Whether this process is explicitly classified as remotely deployed.",
      "# TYPE ynx_wallet_gateway_remote_deployed gauge",
      `ynx_wallet_gateway_remote_deployed ${this.#remoteDeployed ? 1 : 0}`,
      "# HELP ynx_wallet_gateway_build_info Exact release identity supplied by the operator, or unbound for local runtime.",
      "# TYPE ynx_wallet_gateway_build_info gauge",
      `ynx_wallet_gateway_build_info{release="${prometheusLabel(this.#build.release)}",source_commit="${prometheusLabel(buildCommit)}"} 1`,
      "# HELP ynx_wallet_gateway_responses_total HTTP responses by bounded route and status.",
      "# TYPE ynx_wallet_gateway_responses_total counter",
    ];
    for (const [key, count] of [...this.#metrics.responsesByRouteStatus.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const [responseRoute, responseStatus] = key.split("\u0000");
      lines.push(`ynx_wallet_gateway_responses_total{route="${responseRoute}",status="${responseStatus}"} ${count}`);
    }
    lines.push(
      "# HELP ynx_wallet_gateway_errors_total Rejected or failed requests by bounded public error code.",
      "# TYPE ynx_wallet_gateway_errors_total counter",
    );
    for (const [code, count] of [...this.#metrics.errorsByCode.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(`ynx_wallet_gateway_errors_total{code="${prometheusLabel(code)}"} ${count}`);
    }
    return `${lines.join("\n")}\n`;
  }

  #persist() {
    const snapshot = this.#kernel.snapshot();
    const envelope = {
      registrySha256: this.#registrySha256,
      schemaVersion: CANONICAL_GATEWAY_NODE_STATE_SCHEMA_VERSION,
      stateDigest: gatewayStateDigest(snapshot),
      snapshot,
    };
    const directory = dirname(this.#statePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if ((statSync(directory).mode & 0o077) !== 0) throw new WalletAuthError("STATE_PERMISSIONS", "Canonical Gateway state directory must use mode 0700");
    const temporary = `${this.#statePath}.${process.pid}.tmp`;
    let directoryDescriptor;
    let renamed = false;
    let temporaryDescriptor;
    try {
      temporaryDescriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      writeFileSync(temporaryDescriptor, canonicalJSON(envelope), "utf8");
      fsyncSync(temporaryDescriptor);
      closeSync(temporaryDescriptor);
      temporaryDescriptor = undefined;
      directoryDescriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      renameSync(temporary, this.#statePath);
      renamed = true;
      try { fsyncSync(directoryDescriptor); }
      catch { throw new WalletAuthError("STATE_COMMIT_UNCERTAIN", "Canonical Gateway state rename completed but directory durability is uncertain"); }
    } finally {
      if (temporaryDescriptor !== undefined) closeSync(temporaryDescriptor);
      if (directoryDescriptor !== undefined) closeSync(directoryDescriptor);
      if (!renamed) try { unlinkSync(temporary); } catch { /* temporary path may be absent or a fault fixture */ }
    }
  }

  #reload() {
    const stored = loadState(this.#statePath);
    if (!stored) throw new WalletAuthError("STATE_UNAVAILABLE", "Canonical Gateway persisted state is unavailable");
    if (stored.needsRewrite && !this.#allowLegacyStateMigration) {
      throw new WalletAuthError("LEGACY_STATE_MIGRATION_REQUIRED", "Canonical Gateway legacy state requires explicit one-time migration authorization");
    }
    const refreshed = new CanonicalWalletGatewayHttpKernel(this.#registry, stored.snapshot);
    if (stored.stateDigest !== gatewayStateDigest(refreshed.snapshot())) {
      throw new WalletAuthError("STATE_TAMPERED", "Canonical Gateway persisted state digest is invalid");
    }
    if (stored.registrySha256 !== null && stored.registrySha256 !== this.#registrySha256) {
      throw new WalletAuthError("REGISTRY_STATE_MISMATCH", "Canonical Gateway persisted state belongs to a different registry");
    }
    this.#kernel = refreshed;
  }
}

function hostOptions(value) {
  if (!isPlainObject(value)) exactFields(value, ["now", "statePath"], "Canonical Gateway Node host options");
  const required = ["now", "statePath"];
  const allowed = new Set([...required, "admission", "allowLegacyStateMigration", "bodyTimeoutMs", "emitEvent"]);
  if (required.some(field => !Object.hasOwn(value, field)) || Object.keys(value).some(field => !allowed.has(field))) {
    throw new WalletAuthError("UNKNOWN_OR_MISSING_FIELD", "Canonical Gateway Node host options fields do not match the protocol schema");
  }
  const admission = value.admission ?? null;
  const emitEvent = value.emitEvent ?? (() => {});
  const allowLegacyStateMigration = value.allowLegacyStateMigration ?? false;
  const bodyTimeoutMs = value.bodyTimeoutMs ?? 15_000;
  if (admission !== null && !(admission instanceof GatewayAdmissionController)) throw new WalletAuthError("INVALID_ADMISSION", "Canonical Gateway admission controller is invalid");
  if (typeof allowLegacyStateMigration !== "boolean") throw new WalletAuthError("INVALID_MIGRATION_POLICY", "Canonical Gateway legacy state migration policy is invalid");
  if (!Number.isSafeInteger(bodyTimeoutMs) || bodyTimeoutMs < 10 || bodyTimeoutMs > 120_000) throw new WalletAuthError("INVALID_BODY_TIMEOUT", "Canonical Gateway request body timeout is outside policy");
  if (typeof emitEvent !== "function") throw new WalletAuthError("INVALID_EVENT_SINK", "Canonical Gateway event sink is invalid");
  if (typeof value.now !== "function") throw new WalletAuthError("INVALID_CLOCK", "Canonical Gateway Node host clock is invalid");
  return Object.freeze({ admission, allowLegacyStateMigration, bodyTimeoutMs, emitEvent, now: value.now, statePath: value.statePath });
}

function deploymentConfig(value) {
  let build = null;
  try {
    exactFields(value, ["remoteDeployed"], "Canonical Gateway Node host deployment");
  } catch {
    exactFields(value, ["build", "remoteDeployed"], "Canonical Gateway Node host deployment");
    build = buildIdentity(value.build);
  }
  if (typeof value.remoteDeployed !== "boolean") throw new WalletAuthError("INVALID_DEPLOYMENT_STATUS", "Canonical Gateway deployment status is invalid");
  if (value.remoteDeployed && build === null) throw new WalletAuthError("INVALID_BUILD_IDENTITY", "Remote Canonical Gateway requires exact build identity");
  return Object.freeze({
    build: build ?? Object.freeze({ buildTime: null, release: "local-unbound", sourceCommit: null }),
    remoteDeployed: value.remoteDeployed,
  });
}

function buildIdentity(value) {
  exactFields(value, ["buildTime", "release", "sourceCommit"], "Canonical Gateway build identity");
  if (typeof value.sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(value.sourceCommit)) {
    throw new WalletAuthError("INVALID_BUILD_IDENTITY", "Canonical Gateway source commit must be a full lowercase Git SHA");
  }
  if (typeof value.release !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.release)) {
    throw new WalletAuthError("INVALID_BUILD_IDENTITY", "Canonical Gateway release identifier is invalid");
  }
  const parsed = Date.parse(value.buildTime);
  if (typeof value.buildTime !== "string" || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value.buildTime) {
    throw new WalletAuthError("INVALID_BUILD_IDENTITY", "Canonical Gateway build time must be canonical ISO-8601 UTC");
  }
  return Object.freeze({ buildTime: value.buildTime, release: value.release, sourceCommit: value.sourceCommit });
}

function jsonResponse(payload) {
  return Object.freeze({ body: canonicalJSON(payload), headers: JSON_HEADERS, status: 200 });
}

function observabilityHeaders(base, requestId, traceId, errorId) {
  return Object.freeze({
    ...base,
    ...(errorId ? { "x-error-id": errorId } : {}),
    "x-request-id": requestId,
    "x-trace-id": traceId,
  });
}

function observableRoute(value) {
  return typeof value === "string" ? OBSERVABLE_ROUTES.get(value) ?? "unknown" : "unknown";
}

function observableMethod(value) {
  return value === "GET" || value === "POST" ? value : "OTHER";
}

function responseErrorCode(body) {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.error?.code === "string" && /^[A-Z0-9_]{1,80}$/.test(parsed.error.code) ? parsed.error.code : "HTTP_ERROR";
  } catch {
    return "HTTP_ERROR";
  }
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function prometheusLabel(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

export function encodeGatewayProofHeader(proof) {
  const encoded = Buffer.from(canonicalJSON(proof), "utf8").toString("base64url");
  if (Buffer.byteLength(encoded, "ascii") > MAX_PROOF_HEADER_BYTES) throw new WalletAuthError("INVALID_PROOF_HEADER", "Product Session proof header exceeds policy");
  return encoded;
}

export function decodeGatewayProofHeader(value) {
  if (value === undefined) return null;
  if (Array.isArray(value) || typeof value !== "string" || value.length < 2 || value.length > MAX_PROOF_HEADER_BYTES || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new WalletAuthError("INVALID_PROOF_HEADER", "Product Session proof header is invalid");
  }
  let decoded;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw new Error("noncanonical");
    decoded = bytes.toString("utf8");
  } catch {
    throw new WalletAuthError("INVALID_PROOF_HEADER", "Product Session proof header is invalid");
  }
  let proof;
  try { proof = JSON.parse(decoded); } catch { throw new WalletAuthError("INVALID_PROOF_HEADER", "Product Session proof header is not JSON"); }
  if (canonicalJSON(proof) !== decoded) throw new WalletAuthError("INVALID_PROOF_HEADER", "Product Session proof header must contain canonical JSON");
  return proof;
}

function loadState(path) {
  let raw;
  let descriptor;
  try {
    const directory = dirname(path);
    let directoryInfo;
    try { directoryInfo = lstatSync(directory); } catch (caught) {
      if (caught?.code === "ENOENT") return null;
      throw caught;
    }
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (directoryInfo.mode & 0o077) !== 0) {
      throw new WalletAuthError("STATE_PERMISSIONS", "Canonical Gateway state directory must use mode 0700 and be a private non-symlink directory");
    }
    try { descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (caught) {
      if (caught?.code === "ENOENT") return null;
      throw new WalletAuthError("STATE_UNAVAILABLE", "Canonical Gateway persisted state is unavailable");
    }
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0 || info.size < 2 || info.size > MAX_STATE_BYTES) {
      throw new WalletAuthError("STATE_PERMISSIONS", "Canonical Gateway state must be a private single-link regular file within the size policy");
    }
    raw = readFileSync(descriptor, "utf8");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  let value;
  try { value = JSON.parse(raw); } catch { throw new WalletAuthError("STATE_TAMPERED", "Canonical Gateway persisted state is invalid JSON"); }
  if (canonicalJSON(value) !== raw) throw new WalletAuthError("STATE_TAMPERED", "Canonical Gateway persisted state must use canonical JSON");
  let needsRewrite = value?.schemaVersion === 1;
  if (needsRewrite) {
    try { exactFields(value, LEGACY_STATE_FIELDS, "Canonical Gateway legacy persisted state"); }
    catch (legacyError) {
      try { exactFields(value, [...LEGACY_STATE_FIELDS, "updatedAt"], "Canonical Gateway timestamped legacy persisted state"); }
      catch { throw legacyError; }
    }
  } else {
    exactFields(value, STATE_FIELDS, "Canonical Gateway persisted state");
  }
  if (Object.hasOwn(value, "updatedAt")) {
    const updatedAt = Date.parse(value.updatedAt);
    if (typeof value.updatedAt !== "string" || !Number.isFinite(updatedAt) || new Date(updatedAt).toISOString() !== value.updatedAt) {
      throw new WalletAuthError("STATE_TAMPERED", "Canonical Gateway legacy persisted state timestamp is invalid");
    }
  }
  if ((value.schemaVersion !== 1 && value.schemaVersion !== CANONICAL_GATEWAY_NODE_STATE_SCHEMA_VERSION) || !/^[0-9a-f]{64}$/.test(value.stateDigest) || (value.schemaVersion === CANONICAL_GATEWAY_NODE_STATE_SCHEMA_VERSION && !/^[0-9a-f]{64}$/.test(value.registrySha256))) {
    throw new WalletAuthError("STATE_TAMPERED", "Canonical Gateway persisted state envelope is invalid");
  }
  return { schemaVersion: value.schemaVersion, registrySha256: value.registrySha256 ?? null, stateDigest: value.stateDigest, snapshot: value.snapshot, needsRewrite };
}

async function acquireStateLock(path) {
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + STATE_LOCK_WAIT_MS;
  for (;;) {
    const owner = Object.freeze({
      acquiredAt: new Date().toISOString(),
      pid: process.pid,
      schemaVersion: STATE_LOCK_SCHEMA_VERSION,
      token: randomUUID(),
    });
    const temporary = `${lockPath}.${owner.token}.tmp`;
    try {
      writeStateLockOwner(temporary, owner);
      linkSync(temporary, lockPath);
      unlinkSync(temporary);
      return () => releaseStateLock(lockPath, owner);
    } catch (caught) {
      try { unlinkSync(temporary); } catch { /* temporary lock owner may be absent */ }
      if (!caught || caught.code !== "EEXIST") throw caught;
      if (Date.now() >= deadline) {
        throw new WalletAuthError("STATE_LOCKED", "Canonical Gateway persisted state is locked");
      }
      await new Promise(resolve => setTimeout(resolve, STATE_LOCK_RETRY_MS));
    }
  }
}

export function inspectGatewayStateLock(value) {
  const stateFile = statePath(value);
  const lockPath = `${stateFile}.lock`;
  const lock = readStateLock(lockPath, true);
  if (lock === null) return Object.freeze({ locked: false });
  return Object.freeze({
    acquiredAt: lock.owner.acquiredAt,
    locked: true,
    ownerAlive: processAlive(lock.owner.pid),
    ownerPid: lock.owner.pid,
    schemaVersion: lock.owner.schemaVersion,
  });
}

export function recoverGatewayStateLock(registryInput, options) {
  exactFields(options, ["minimumAgeMs", "now", "statePath"], "Canonical Gateway state lock recovery options");
  if (!Number.isSafeInteger(options.minimumAgeMs) || options.minimumAgeMs < 0) throw new WalletAuthError("INVALID_LOCK_RECOVERY_POLICY", "Canonical Gateway minimum stale-lock age is invalid");
  if (typeof options.now !== "function") throw new WalletAuthError("INVALID_CLOCK", "Canonical Gateway state lock recovery clock is invalid");
  const now = options.now();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new WalletAuthError("INVALID_CLOCK", "Canonical Gateway state lock recovery clock is invalid");
  const stateFile = statePath(options.statePath);
  const lockPath = `${stateFile}.lock`;
  const initial = readStateLock(lockPath, false);
  if (initial === null) throw new WalletAuthError("STATE_LOCK_ABSENT", "Canonical Gateway state lock is absent");
  assertRecoverableStateLock(initial.owner, now, options.minimumAgeMs);

  const registry = parseCentralRegistryDocument(registryInput);
  const registrySha256 = createHash("sha256").update(canonicalJSON(registry)).digest("hex");
  const stored = loadState(stateFile);
  if (!stored || stored.needsRewrite) throw new WalletAuthError("STATE_TAMPERED", "Canonical Gateway current state is unavailable or legacy during lock recovery");
  const kernel = new CanonicalWalletGatewayHttpKernel(registry, stored.snapshot);
  if (stored.stateDigest !== gatewayStateDigest(kernel.snapshot())) throw new WalletAuthError("STATE_TAMPERED", "Canonical Gateway current state digest is invalid during lock recovery");
  if (stored.registrySha256 !== registrySha256) throw new WalletAuthError("REGISTRY_STATE_MISMATCH", "Canonical Gateway current state belongs to a different registry during lock recovery");

  const recoveryPath = `${lockPath}.recovery`;
  const recovery = Object.freeze({ acquiredAt: now.toISOString(), pid: process.pid, schemaVersion: STATE_LOCK_SCHEMA_VERSION, token: randomUUID() });
  try {
    writeStateLockOwner(recoveryPath, recovery);
  } catch (caught) {
    if (caught?.code === "EEXIST") throw new WalletAuthError("STATE_LOCK_RECOVERY_BUSY", "Canonical Gateway state lock recovery is already in progress");
    throw caught;
  }
  let discardedTemporaryState = false;
  try {
    const current = readStateLock(lockPath, false);
    if (current === null || canonicalJSON(current.owner) !== canonicalJSON(initial.owner)) throw new WalletAuthError("STATE_LOCK_CHANGED", "Canonical Gateway state lock changed during recovery");
    assertRecoverableStateLock(current.owner, now, options.minimumAgeMs);
    const temporaryStatePath = `${stateFile}.${current.owner.pid}.tmp`;
    discardedTemporaryState = validateDeadOwnerTemporaryState(temporaryStatePath);
    if (discardedTemporaryState) unlinkSync(temporaryStatePath);
    if (current.temporaryPath !== null) unlinkSync(current.temporaryPath);
    unlinkSync(lockPath);
    fsyncStateDirectory(dirname(stateFile));
  } finally {
    try { unlinkSync(recoveryPath); } catch { /* recovery guard may be absent */ }
  }
  return Object.freeze({
    discardedTemporaryState,
    lockAcquiredAt: initial.owner.acquiredAt,
    lockOwnerPid: initial.owner.pid,
    recovered: true,
    registrySha256,
    stateDigest: stored.stateDigest,
  });
}

function writeStateLockOwner(path, owner) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(descriptor, canonicalJSON(owner), "utf8");
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readStateLock(path, absentAllowed) {
  let descriptor;
  try {
    try { descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (caught) {
      if (caught?.code === "ENOENT" && absentAllowed) return null;
      if (caught?.code === "ENOENT") return null;
      throw new WalletAuthError("STATE_LOCK_TAMPERED", "Canonical Gateway state lock is unavailable or unsafe");
    }
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.nlink < 1 || info.nlink > 2 || (info.mode & 0o077) !== 0 || info.size < 2 || info.size > MAX_STATE_LOCK_BYTES) {
      throw new WalletAuthError("STATE_LOCK_TAMPERED", "Canonical Gateway state lock must be a private one-link owner record");
    }
    const raw = readFileSync(descriptor, "utf8");
    let owner;
    try { owner = JSON.parse(raw); } catch { throw new WalletAuthError("STATE_LOCK_TAMPERED", "Canonical Gateway state lock owner record is invalid JSON"); }
    if (canonicalJSON(owner) !== raw) throw new WalletAuthError("STATE_LOCK_TAMPERED", "Canonical Gateway state lock owner record must use canonical JSON");
    try { exactFields(owner, STATE_LOCK_FIELDS, "Canonical Gateway state lock owner"); }
    catch { throw new WalletAuthError("STATE_LOCK_TAMPERED", "Canonical Gateway state lock owner record has unknown or missing fields"); }
    const acquiredAt = Date.parse(owner.acquiredAt);
    if (owner.schemaVersion !== STATE_LOCK_SCHEMA_VERSION || !Number.isSafeInteger(owner.pid) || owner.pid < 1 || typeof owner.token !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(owner.token) || typeof owner.acquiredAt !== "string" || !Number.isFinite(acquiredAt) || new Date(acquiredAt).toISOString() !== owner.acquiredAt) {
      throw new WalletAuthError("STATE_LOCK_TAMPERED", "Canonical Gateway state lock owner record is invalid");
    }
    let temporaryPath = null;
    if (info.nlink === 2) {
      temporaryPath = `${path}.${owner.token}.tmp`;
      let temporaryInfo;
      try { temporaryInfo = lstatSync(temporaryPath); } catch { throw new WalletAuthError("STATE_LOCK_TAMPERED", "Canonical Gateway state lock has an unexplained hard link"); }
      if (!temporaryInfo.isFile() || temporaryInfo.isSymbolicLink() || temporaryInfo.dev !== info.dev || temporaryInfo.ino !== info.ino) throw new WalletAuthError("STATE_LOCK_TAMPERED", "Canonical Gateway state lock hard link does not match its owner token");
    }
    return Object.freeze({ owner: Object.freeze(owner), temporaryPath });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function releaseStateLock(path, owner) {
  const current = readStateLock(path, false);
  if (current === null || current.owner.pid !== owner.pid || current.owner.token !== owner.token) throw new WalletAuthError("STATE_LOCK_LOST", "Canonical Gateway state lock ownership was lost");
  unlinkSync(path);
}

function assertRecoverableStateLock(owner, now, minimumAgeMs) {
  if (processAlive(owner.pid)) throw new WalletAuthError("STATE_LOCK_ACTIVE", "Canonical Gateway state lock owner is still alive");
  const ageMs = now.getTime() - Date.parse(owner.acquiredAt);
  if (ageMs < minimumAgeMs) throw new WalletAuthError("STATE_LOCK_TOO_FRESH", "Canonical Gateway state lock has not reached the recovery age floor");
}

function validateDeadOwnerTemporaryState(path) {
  let info;
  try { info = lstatSync(path); }
  catch (caught) {
    if (caught?.code === "ENOENT") return false;
    throw new WalletAuthError("STATE_LOCK_TAMPERED", "Canonical Gateway temporary state is unavailable during lock recovery");
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o077) !== 0 || info.size > MAX_STATE_BYTES) {
    throw new WalletAuthError("STATE_LOCK_TAMPERED", "Canonical Gateway temporary state is unsafe during lock recovery");
  }
  return true;
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (caught) {
    if (caught?.code === "ESRCH") return false;
    if (caught?.code === "EPERM") return true;
    throw caught;
  }
}

function fsyncStateDirectory(directory) {
  let descriptor;
  try {
    descriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

async function boundedBody(request, timeoutMs) {
  const chunks = [];
  let size = 0;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    request.destroy(new WalletAuthError("REQUEST_BODY_TIMEOUT", "Canonical Wallet Gateway request body timed out"));
  }, timeoutMs);
  timeout.unref?.();
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 1_048_576) throw new WalletAuthError("INVALID_BODY", "Canonical Wallet Gateway body exceeds 1048576 bytes");
      chunks.push(chunk);
    }
  } catch (caught) {
    if (timedOut) throw new WalletAuthError("REQUEST_BODY_TIMEOUT", "Canonical Wallet Gateway request body timed out");
    if (request.aborted || caught?.code === "ECONNRESET") throw new WalletAuthError("REQUEST_ABORTED", "Canonical Wallet Gateway request was aborted");
    throw caught;
  } finally {
    clearTimeout(timeout);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function statePath(value) {
  if (typeof value !== "string" || !isAbsolute(value) || value === "/") throw new WalletAuthError("INVALID_STATE_PATH", "Canonical Gateway state path must be an absolute file path");
  return value;
}

function hostError(caught) {
  if (caught instanceof WalletAuthError) {
    const stateUnavailable = caught.code === "LEGACY_STATE_MIGRATION_REQUIRED" || caught.code === "REGISTRY_STATE_MISMATCH" || caught.code.startsWith("STATE_");
    const status = caught.code === "INVALID_BODY" ? 413 : caught.code === "REQUEST_BODY_TIMEOUT" ? 408 : stateUnavailable ? 503 : 400;
    return { status, code: caught.code, message: caught.message };
  }
  return { status: 500, code: "INTERNAL", message: "Canonical Wallet Gateway host failed closed" };
}
