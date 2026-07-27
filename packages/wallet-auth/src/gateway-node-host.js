import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { CanonicalWalletGatewayHttpKernel, gatewayStateDigest } from "./gateway-http.js";

export const CANONICAL_GATEWAY_PROOF_HEADER = "x-ynx-product-session-proof";
export const CANONICAL_GATEWAY_NODE_STATE_SCHEMA_VERSION = 1;
const STATE_FIELDS = ["schemaVersion", "stateDigest", "snapshot"];
const MAX_PROOF_HEADER_BYTES = 16_384;

export class CanonicalWalletGatewayNodeHost {
  #kernel;
  #remoteDeployed;
  #statePath;
  #now;

  constructor(registry, options, deployment = { remoteDeployed: false }) {
    exactFields(options, ["now", "statePath"], "Canonical Gateway Node host options");
    exactFields(deployment, ["remoteDeployed"], "Canonical Gateway Node host deployment");
    this.#statePath = statePath(options.statePath);
    if (typeof options.now !== "function") throw new WalletAuthError("INVALID_CLOCK", "Canonical Gateway Node host clock is invalid");
    this.#now = options.now;
    this.#remoteDeployed = deployment.remoteDeployed;
    if (typeof this.#remoteDeployed !== "boolean") throw new WalletAuthError("INVALID_DEPLOYMENT_STATUS", "Canonical Gateway deployment status is invalid");
    const stored = loadState(this.#statePath);
    this.#kernel = new CanonicalWalletGatewayHttpKernel(registry, stored?.snapshot);
    if (stored && stored.stateDigest !== gatewayStateDigest(this.#kernel.snapshot())) {
      throw new WalletAuthError("STATE_TAMPERED", "Canonical Gateway persisted state digest is invalid");
    }
    if (!stored) this.#persist();
  }

  handler() {
    return async (request, response) => {
      try {
        if (request.method === "GET" && request.url === "/health" && request.headers[CANONICAL_GATEWAY_PROOF_HEADER] === undefined) {
          response.writeHead(200, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(canonicalJSON({
            ok: true,
            remoteDeployed: this.#remoteDeployed,
            service: "ynx-wallet-gatewayd",
            stateDigest: gatewayStateDigest(this.#kernel.snapshot()),
            truthfulStatus: this.#remoteDeployed ? "remote-canonical-wallet-gateway" : "canonical-wallet-gateway-local-runtime",
          }));
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
        response.writeHead(result.status, result.headers);
        response.end(result.body);
      } catch (caught) {
        const error = hostError(caught);
        response.writeHead(error.status, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(canonicalJSON({
          error: { code: error.code, message: error.message },
          ok: false,
          schemaVersion: 1,
          stateDigest: gatewayStateDigest(this.#kernel.snapshot()),
        }));
      }
    };
  }

  snapshot() {
    return this.#kernel.snapshot();
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
  exactFields(value, STATE_FIELDS, "Canonical Gateway persisted state");
  if (value.schemaVersion !== CANONICAL_GATEWAY_NODE_STATE_SCHEMA_VERSION || !/^[0-9a-f]{64}$/.test(value.stateDigest)) {
    throw new WalletAuthError("STATE_TAMPERED", "Canonical Gateway persisted state envelope is invalid");
  }
  return value;
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
