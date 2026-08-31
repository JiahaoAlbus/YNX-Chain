import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { CANONICAL_GATEWAY_HTTP_SCHEMA_VERSION, CanonicalWalletGatewayHttpKernel, gatewayStateDigest } from "./gateway-http.js";

export const CANONICAL_GATEWAY_PROOF_HEADER = "x-ynx-product-session-proof";
export const CANONICAL_GATEWAY_NODE_STATE_SCHEMA_VERSION = 1;
export const CANONICAL_GATEWAY_OBSERVABILITY_SCHEMA_VERSION = 1;
const STATE_FIELDS = ["schemaVersion", "stateDigest", "snapshot"];
const MAX_PROOF_HEADER_BYTES = 16_384;
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
  #build;
  #emitEvent;
  #kernel;
  #metrics;
  #remoteDeployed;
  #statePath;
  #now;

  constructor(registry, options, deployment = { remoteDeployed: false }) {
    const runtime = hostOptions(options);
    const deploymentState = deploymentConfig(deployment);
    this.#statePath = statePath(runtime.statePath);
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
    const stored = loadState(this.#statePath);
    this.#kernel = new CanonicalWalletGatewayHttpKernel(registry, stored?.snapshot);
    if (stored && stored.stateDigest !== gatewayStateDigest(this.#kernel.snapshot())) {
      throw new WalletAuthError("STATE_TAMPERED", "Canonical Gateway persisted state digest is invalid");
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
      try {
        const administrative = this.#administrativeResponse(request);
        if (administrative) {
          status = administrative.status;
          response.writeHead(status, observabilityHeaders(administrative.headers, requestId, traceId, null));
          response.end(administrative.body);
          return;
        }
        const body = await boundedBody(request);
        const proof = decodeGatewayProofHeader(request.headers[CANONICAL_GATEWAY_PROOF_HEADER]);
        const result = this.#kernel.dispatch({
          method: request.method,
          path: request.url,
          contentType: request.headers["content-type"] ?? "",
          body,
          proof,
        }, this.#now());
        if (result.mutated) this.#persist();
        status = result.status;
        errorCode = status >= 400 ? responseErrorCode(result.body) : null;
        errorId = errorCode ? randomUUID() : null;
        response.writeHead(status, observabilityHeaders(result.headers, requestId, traceId, errorId));
        response.end(result.body);
      } catch (caught) {
        const error = hostError(caught);
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
        gatewayHttpSchemaVersion: CANONICAL_GATEWAY_HTTP_SCHEMA_VERSION,
        nodeStateSchemaVersion: CANONICAL_GATEWAY_NODE_STATE_SCHEMA_VERSION,
        observabilitySchemaVersion: CANONICAL_GATEWAY_OBSERVABILITY_SCHEMA_VERSION,
        ok: true,
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
      schemaVersion: CANONICAL_GATEWAY_NODE_STATE_SCHEMA_VERSION,
      stateDigest: gatewayStateDigest(snapshot),
      snapshot,
    };
    const directory = dirname(this.#statePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if ((statSync(directory).mode & 0o077) !== 0) throw new WalletAuthError("STATE_PERMISSIONS", "Canonical Gateway state directory must use mode 0700");
    const temporary = `${this.#statePath}.${process.pid}.tmp`;
    writeFileSync(temporary, canonicalJSON(envelope), { encoding: "utf8", mode: 0o600, flag: "w" });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.#statePath);
    chmodSync(this.#statePath, 0o600);
  }
}

function hostOptions(value) {
  let emitEvent = () => {};
  try {
    exactFields(value, ["now", "statePath"], "Canonical Gateway Node host options");
  } catch {
    exactFields(value, ["emitEvent", "now", "statePath"], "Canonical Gateway Node host options");
    if (typeof value.emitEvent !== "function") throw new WalletAuthError("INVALID_EVENT_SINK", "Canonical Gateway event sink is invalid");
    emitEvent = value.emitEvent;
  }
  if (typeof value.now !== "function") throw new WalletAuthError("INVALID_CLOCK", "Canonical Gateway Node host clock is invalid");
  return Object.freeze({ emitEvent, now: value.now, statePath: value.statePath });
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
  try { raw = readFileSync(path, "utf8"); } catch (caught) {
    if (caught && caught.code === "ENOENT") return null;
    throw caught;
  }
  if ((statSync(path).mode & 0o077) !== 0) throw new WalletAuthError("STATE_PERMISSIONS", "Canonical Gateway state must use mode 0600");
  let value;
  try { value = JSON.parse(raw); } catch { throw new WalletAuthError("STATE_TAMPERED", "Canonical Gateway persisted state is invalid JSON"); }
  let needsRewrite = false;
  try {
    exactFields(value, STATE_FIELDS, "Canonical Gateway persisted state");
  } catch (currentError) {
    try {
      exactFields(value, [...STATE_FIELDS, "updatedAt"], "Canonical Gateway legacy persisted state");
      needsRewrite = true;
    } catch {
      throw currentError;
    }
  }
  if (needsRewrite) {
    const updatedAt = Date.parse(value.updatedAt);
    if (typeof value.updatedAt !== "string" || !Number.isFinite(updatedAt) || new Date(updatedAt).toISOString() !== value.updatedAt) {
      throw new WalletAuthError("STATE_TAMPERED", "Canonical Gateway legacy persisted state timestamp is invalid");
    }
  }
  if (value.schemaVersion !== CANONICAL_GATEWAY_NODE_STATE_SCHEMA_VERSION || !/^[0-9a-f]{64}$/.test(value.stateDigest)) {
    throw new WalletAuthError("STATE_TAMPERED", "Canonical Gateway persisted state envelope is invalid");
  }
  return { schemaVersion: value.schemaVersion, stateDigest: value.stateDigest, snapshot: value.snapshot, needsRewrite };
}

async function boundedBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_048_576) throw new WalletAuthError("INVALID_BODY", "Canonical Wallet Gateway body exceeds 1048576 bytes");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function statePath(value) {
  if (typeof value !== "string" || !isAbsolute(value) || value === "/") throw new WalletAuthError("INVALID_STATE_PATH", "Canonical Gateway state path must be an absolute file path");
  return value;
}

function hostError(caught) {
  if (caught instanceof WalletAuthError) return { status: caught.code === "INVALID_BODY" ? 413 : 400, code: caught.code, message: caught.message };
  return { status: 500, code: "INTERNAL", message: "Canonical Wallet Gateway host failed closed" };
}
