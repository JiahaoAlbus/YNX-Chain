import { createServer as createHTTPServer } from "node:http";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import {
  canonicalJSON,
  CanonicalWalletGatewayHttpKernel,
  gatewayStateDigest,
  parseCentralRegistryDocument,
} from "../../packages/wallet-auth/src/index.js";

const MAX_BODY_BYTES = 1_048_576;
const MAX_PROOF_HEADER_BYTES = 16_384;
const STATE_SCHEMA_VERSION = 1;
const ROUTES = new Set([
  "/v1/wallet/sessions/complete",
  "/v1/wallet/sessions/introspect",
  "/v1/wallet/sessions",
  "/v1/wallet/sessions/revoke",
  "/v1/wallet/approvals/revoke",
  "/v1/wallet/devices/revoke",
  "/v1/wallet/accounts/logout-all",
  "/v1/wallet/mandates/activate",
  "/v1/wallet/mandates/authorize-action",
  "/v1/wallet/mandates",
  "/v1/wallet/mandates/revoke",
  "/v1/wallet/mandates/kill",
  "/v1/wallet/mandates/emergency-exit",
]);
const PROOF_HEADER = "x-ynx-product-session-proof";
const PREFLIGHT_HEADERS = new Set(["content-type", PROOF_HEADER]);

export class WalletGatewayHost {
  #registry;
  #allowedOrigins;
  #kernel;
  #statePath;
  #persist;
  #queue = Promise.resolve();
  #startedAt;
  #build;
  #now;
  #metrics = {
    requests: 0,
    accepted: 0,
    rejected: 0,
    persistenceFailures: 0,
  };

  constructor({ registry, statePath, allowedOrigins = [], build = {}, persist = persistState, startedAt = new Date(), now = () => new Date() }) {
    if (!isAbsolute(statePath) || statePath === "/") {
      throw new Error("wallet Gateway state path must be an absolute file path");
    }
    this.#registry = parseCentralRegistryDocument(registry);
    this.#allowedOrigins = normalizeAllowedOrigins(allowedOrigins);
    this.#statePath = statePath;
    this.#persist = persist;
    this.#startedAt = validDate(startedAt);
    this.#now = now;
    this.#build = Object.freeze({
      commit: nonEmpty(build.commit, "unknown"),
      release: nonEmpty(build.release, "local"),
      buildTime: nonEmpty(build.buildTime, "unknown"),
    });
    const persisted = loadState(this.#statePath, this.#registry);
    this.#kernel = new CanonicalWalletGatewayHttpKernel(this.#registry, persisted?.snapshot);
    if (persisted && persisted.stateDigest !== gatewayStateDigest(this.#kernel.snapshot())) {
      throw new Error("wallet Gateway persisted state digest mismatch");
    }
    if (!persisted) {
      const snapshot = this.#kernel.snapshot();
      this.#persist(this.#statePath, {
        schemaVersion: STATE_SCHEMA_VERSION,
        stateDigest: gatewayStateDigest(snapshot),
        snapshot,
        updatedAt: validDate(this.#now()).toISOString(),
      });
    }
  }

  handler() {
    return (request, response) => {
      this.#queue = this.#queue
        .then(() => this.#handle(request, response))
        .catch(() => {
          if (!response.headersSent) {
            writeHostError(response, 500, "INTERNAL_FAILURE", "Wallet Gateway request failed");
          } else {
            response.destroy();
          }
        });
    };
  }

  snapshot() {
    return this.#kernel.snapshot();
  }

  async #handle(request, response) {
    const requestID = randomUUID();
    response.setHeader("X-Request-ID", requestID);
    const origins = request.headersDistinct?.origin ?? [];
    if (origins.length > 1) {
      return writeHostError(response, 403, "ORIGIN_NOT_ALLOWED", "Browser origin is not allowed");
    }
    const origin = origins[0]?.trim() ?? "";
    if (origin) {
      if (!this.#allowedOrigins.has(origin)) {
        return writeHostError(response, 403, "ORIGIN_NOT_ALLOWED", "Browser origin is not allowed");
      }
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      return this.#preflight(request, response, origin);
    }
    if (request.method === "GET" && request.url === "/health") {
      return this.#health(response);
    }
    if (request.method === "GET" && request.url === "/version") {
      return this.#version(response);
    }
    if (request.method === "GET" && request.url === "/metrics") {
      return this.#serveMetrics(response);
    }
    if (request.method !== "POST") {
      return writeHostError(response, 405, "METHOD_NOT_ALLOWED", "Canonical Wallet Gateway accepts POST only");
    }
    if (!ROUTES.has(request.url)) {
      return writeHostError(response, 404, "ROUTE_NOT_FOUND", "Canonical Wallet Gateway route was not found");
    }
    this.#metrics.requests++;
    const contentTypes = request.headersDistinct?.["content-type"] ?? [];
    if (contentTypes.length !== 1 || contentTypes[0] !== "application/json") {
      this.#metrics.rejected++;
      return writeHostError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "Canonical Wallet Gateway requires application/json");
    }
    let body;
    try {
      body = await readBoundedBody(request, MAX_BODY_BYTES);
    } catch {
      this.#metrics.rejected++;
      return writeHostError(response, 400, "INVALID_BODY", "Canonical Wallet Gateway body size is outside policy");
    }
    let proof = null;
    try {
      proof = parseProofHeader(request);
    } catch {
      this.#metrics.rejected++;
      return writeHostError(response, 400, "INVALID_PROOF_HEADER", "Product Session proof header is invalid");
    }
    const before = this.#kernel.snapshot();
    const result = this.#kernel.dispatch({
      method: request.method,
      path: request.url,
      contentType: contentTypes[0],
      body,
      proof,
    }, validDate(this.#now()));
    if (result.mutated) {
      const snapshot = this.#kernel.snapshot();
      const stateDigest = gatewayStateDigest(snapshot);
      try {
        this.#persist(this.#statePath, {
          schemaVersion: STATE_SCHEMA_VERSION,
          stateDigest,
          snapshot,
          updatedAt: validDate(this.#now()).toISOString(),
        });
      } catch {
        this.#kernel = new CanonicalWalletGatewayHttpKernel(this.#registry, before);
        this.#metrics.persistenceFailures++;
        this.#metrics.rejected++;
        return writeHostError(
          response,
          503,
          "PERSISTENCE_FAILURE",
          "Wallet Gateway state could not be committed",
          gatewayStateDigest(before),
        );
      }
    }
    if (result.status >= 200 && result.status < 300) {
      this.#metrics.accepted++;
    } else {
      this.#metrics.rejected++;
    }
    response.writeHead(result.status, {
      ...result.headers,
      "X-Request-ID": requestID,
    });
    response.end(result.body);
  }

  #preflight(request, response, origin) {
    if (!origin || !ROUTES.has(request.url)) {
      return writeHostError(response, 403, "PREFLIGHT_NOT_ALLOWED", "Browser preflight is not allowed");
    }
    if (request.headers["access-control-request-method"]?.trim().toUpperCase() !== "POST") {
      return writeHostError(response, 403, "PREFLIGHT_NOT_ALLOWED", "Browser preflight method is not allowed");
    }
    const requestedHeaders = (request.headers["access-control-request-headers"] ?? "")
      .split(",")
      .map(value => value.trim().toLowerCase())
      .filter(Boolean);
    if (requestedHeaders.length === 0 || requestedHeaders.some(header => !PREFLIGHT_HEADERS.has(header))) {
      return writeHostError(response, 403, "PREFLIGHT_NOT_ALLOWED", "Browser preflight headers are not allowed");
    }
    response.writeHead(204, {
      "Access-Control-Allow-Headers": "Content-Type, X-YNX-Product-Session-Proof",
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Max-Age": "600",
      "Cache-Control": "no-store",
      "X-Request-ID": response.getHeader("X-Request-ID"),
    });
    response.end();
  }

  #health(response) {
    const snapshot = this.#kernel.snapshot();
    writeJSON(response, 200, {
      ok: true,
      service: "ynx-wallet-gatewayd",
      schemaVersion: STATE_SCHEMA_VERSION,
      registryVersion: snapshot.registryVersion,
      adapterStateVersion: snapshot.schemaVersion,
      stateDigest: gatewayStateDigest(snapshot),
      persistence: "atomic-local-state",
      startedAt: this.#startedAt.toISOString(),
      build: this.#build,
      truthfulStatus: "canonical-wallet-auth-local-runtime",
    });
  }

  #version(response) {
    writeJSON(response, 200, {
      service: "ynx-wallet-gatewayd",
      gatewayHttpKernelVersion: 1,
      gatewayAdapterSnapshotVersion: 2,
      registryDocumentVersion: 2,
      startedAt: this.#startedAt.toISOString(),
      build: this.#build,
    });
  }

  #serveMetrics(response) {
    const snapshot = this.#kernel.snapshot();
    const labels = 'service="ynx-wallet-gatewayd"';
    response.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
    response.end(
      [
        "# TYPE ynx_wallet_gateway_requests_total counter",
        `ynx_wallet_gateway_requests_total{${labels}} ${this.#metrics.requests}`,
        "# TYPE ynx_wallet_gateway_accepted_total counter",
        `ynx_wallet_gateway_accepted_total{${labels}} ${this.#metrics.accepted}`,
        "# TYPE ynx_wallet_gateway_rejected_total counter",
        `ynx_wallet_gateway_rejected_total{${labels}} ${this.#metrics.rejected}`,
        "# TYPE ynx_wallet_gateway_persistence_failures_total counter",
        `ynx_wallet_gateway_persistence_failures_total{${labels}} ${this.#metrics.persistenceFailures}`,
        "# TYPE ynx_wallet_gateway_sessions gauge",
        `ynx_wallet_gateway_sessions{${labels}} ${snapshot.sessionStore.sessions.length}`,
        "",
      ].join("\n"),
    );
  }
}

export function createWalletGatewayServer(options) {
  const host = new WalletGatewayHost(options);
  return { host, server: createHTTPServer(host.handler()) };
}

export function loadRegistry(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function normalizeAllowedOrigins(origins) {
  if (!Array.isArray(origins) || new Set(origins).size !== origins.length) {
    throw new Error("wallet Gateway allowed origins must be a unique array");
  }
  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("wallet Gateway allowed origin is invalid");
    }
    if (parsed.protocol !== "https:" || parsed.origin !== origin || parsed.username || parsed.password) {
      throw new Error("wallet Gateway allowed origins must be exact HTTPS origins");
    }
  }
  return new Set(origins);
}

function loadState(path, registry) {
  if (!existsSync(path)) return null;
  const value = JSON.parse(readFileSync(path, "utf8"));
  const fields = value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort().join(",")
    : "";
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    fields !== "schemaVersion,snapshot,stateDigest,updatedAt" ||
    value.schemaVersion !== STATE_SCHEMA_VERSION ||
    typeof value.stateDigest !== "string" ||
    value.snapshot === null ||
    typeof value.snapshot !== "object" ||
    Number.isNaN(Date.parse(value.updatedAt))
  ) {
    throw new Error("wallet Gateway persisted state schema is invalid");
  }
  const kernel = new CanonicalWalletGatewayHttpKernel(registry, value.snapshot);
  if (gatewayStateDigest(kernel.snapshot()) !== value.stateDigest) {
    throw new Error("wallet Gateway persisted state digest mismatch");
  }
  return value;
}

function persistState(path, value) {
  const directory = dirname(path);
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fileDescriptor;
  try {
    fileDescriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(fileDescriptor, canonicalJSON(value), "utf8");
    fsyncSync(fileDescriptor);
    closeSync(fileDescriptor);
    fileDescriptor = undefined;
    renameSync(temporary, path);
    const directoryDescriptor = openSync(directory, "r");
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } finally {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function parseProofHeader(request) {
  const values = request.headersDistinct?.[PROOF_HEADER] ?? [];
  if (values.length === 0) return null;
  if (values.length !== 1 || Buffer.byteLength(values[0], "utf8") > MAX_PROOF_HEADER_BYTES) {
    throw new Error("invalid proof header");
  }
  const proof = JSON.parse(values[0]);
  if (proof === null || typeof proof !== "object" || Array.isArray(proof)) {
    throw new Error("invalid proof header");
  }
  return proof;
}

async function readBoundedBody(request, maximum) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximum) throw new Error("body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length).toString("utf8");
}

function writeHostError(response, status, code, message, stateDigest) {
  const payload = {
    error: { code, message },
    ok: false,
    schemaVersion: 1,
    ...(stateDigest ? { stateDigest } : {}),
  };
  writeJSON(response, status, payload);
}

function writeJSON(response, status, payload) {
  const body = canonicalJSON(payload);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(body);
}

function validDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("startedAt must be a valid date");
  return date;
}

function nonEmpty(value, fallback) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}
