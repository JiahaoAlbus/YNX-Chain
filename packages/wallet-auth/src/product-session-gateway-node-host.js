import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync, closeSync, constants, fchmodSync, fsyncSync, fstatSync, lstatSync,
  mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2 } from "./product-session-gateway-client.js";
import { ProductSessionGatewayHttpHandler } from "./product-session-gateway-http.js";
import { PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION } from "./product-session-gateway.js";
import { parseProductSessionRegistry } from "./product-session-registry.js";

export const PRODUCT_SESSION_GATEWAY_NODE_STATE_SCHEMA_VERSION = 1;
const STATE_FIELDS = ["schemaVersion", "snapshotDigest", "snapshot"];
const ROUTES = new Set([
  "/v2/product-sessions/challenge",
  "/v2/product-sessions/complete",
  "/v2/product-sessions/introspect",
  "/v2/product-sessions/revoke",
  "/v2/product-sessions/devices/revoke",
]);
const CORS_ALLOWED_HEADERS = "content-type, x-request-id, x-ynx-product-session-proof-v2";
const MAX_STATE_BYTES = 32 * 1024 * 1024;

export class ProductSessionGatewayNodeHost {
  #handler; #now; #origins; #registry; #stateIdentity; #statePath; #tokens;

  constructor(registryInput, options) {
    exactFields(options, ["now", "statePath", "tokenFactory"], "Product Session Gateway Node host options");
    if (typeof options.now !== "function" || typeof options.tokenFactory !== "function") fail("INVALID_HOST", "Product Session Gateway Node host dependencies are invalid");
    if (typeof options.statePath !== "string" || !isAbsolute(options.statePath) || options.statePath === "/") fail("INVALID_STATE_PATH", "Product Session Gateway state path must be an absolute file path");
    this.#registry = parseProductSessionRegistry(registryInput);
    this.#origins = new Set(this.#registry.products.map((product) => product.webOrigin));
    this.#now = options.now; this.#tokens = options.tokenFactory; this.#statePath = options.statePath;
    const stored = loadState(this.#statePath);
    this.#handler = new ProductSessionGatewayHttpHandler(this.#registry, this.#tokens, stored?.snapshot);
    if (stored === null) this.#persist(this.#handler.snapshot());
    else this.#stateIdentity = stored.identity;
  }

  handler() {
    return async (request, response) => {
      const requestId = validRequestId(request.headers["x-request-id"]) ? request.headers["x-request-id"] : "req_invalid_request_000";
      let corsHeaders = {};
      try {
        this.#assertStateIdentity();
        corsHeaders = this.#corsHeaders(request.headers.origin);
        if (request.method === "OPTIONS") {
          this.#preflight(request, corsHeaders);
          response.writeHead(204, { ...corsHeaders, "access-control-allow-headers": CORS_ALLOWED_HEADERS, "access-control-allow-methods": "POST", "access-control-max-age": "300", "cache-control": "no-store" });
          response.end(); return;
        }
        const route = pathname(request.url);
        if (!ROUTES.has(route)) fail("ROUTE_NOT_FOUND", "Product Session Gateway route is not registered");
        if (request.method !== "POST") fail("METHOD_NOT_ALLOWED", "Product Session Gateway accepts POST only");
        const body = await boundedBody(request);
        this.#assertStateIdentity();
        const candidate = new ProductSessionGatewayHttpHandler(this.#registry, this.#tokens, this.#handler.snapshot());
        const result = candidate.handle({ requestId, method: request.method, path: route, contentType: singleHeader(request.headers["content-type"]), body, proofHeader: nullableHeader(request.headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2]), networkAvailable: true }, this.#now());
        const before = snapshotDigest(this.#handler.snapshot()), after = snapshotDigest(candidate.snapshot());
        if (after !== before) this.#persist(candidate.snapshot());
        this.#handler = candidate;
        response.writeHead(result.status, { ...result.headers, ...corsHeaders }); response.end(result.body);
      } catch (caught) {
        const error = hostError(caught);
        response.writeHead(error.status, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-request-id": requestId, ...corsHeaders });
        response.end(canonicalJSON({ error: { code: error.code, message: error.message }, ok: false, requestId, schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION }));
      }
    };
  }

  snapshot() { return this.#handler.snapshot(); }

  #corsHeaders(value) {
    if (value === undefined) return {};
    const origin = canonicalOrigin(value);
    if (!this.#origins.has(origin)) fail("ORIGIN_NOT_ALLOWED", "Product Session Gateway origin is not registered");
    return { "access-control-allow-origin": origin, "access-control-expose-headers": "x-request-id", vary: "origin" };
  }

  #preflight(request, corsHeaders) {
    if (Object.keys(corsHeaders).length === 0) fail("ORIGIN_NOT_ALLOWED", "Product Session Gateway preflight requires a registered origin");
    if (!ROUTES.has(pathname(request.url))) fail("ROUTE_NOT_FOUND", "Product Session Gateway route is not registered");
    if (request.headers["access-control-request-method"] !== "POST") fail("METHOD_NOT_ALLOWED", "Product Session Gateway preflight requires POST");
    const supplied = singleHeader(request.headers["access-control-request-headers"]);
    const headers = supplied.split(",").map((item) => item.trim().toLowerCase());
    const allowed = new Set(CORS_ALLOWED_HEADERS.split(", "));
    if (headers.length === 0 || new Set(headers).size !== headers.length || headers.some((item) => !allowed.has(item))) fail("INVALID_CORS_REQUEST", "Product Session Gateway requested headers are not allowed");
  }

  #assertStateIdentity() {
    const loaded = loadState(this.#statePath), identity = loaded?.identity;
    if (!identity || !this.#stateIdentity || identity.dev !== this.#stateIdentity.dev || identity.ino !== this.#stateIdentity.ino || identity.size !== this.#stateIdentity.size || identity.digest !== this.#stateIdentity.digest) fail("STATE_TAMPERED", "Product Session Gateway state identity changed outside the process");
  }

  #persist(snapshot) {
    if (this.#stateIdentity) this.#assertStateIdentity();
    const envelope = { schemaVersion: PRODUCT_SESSION_GATEWAY_NODE_STATE_SCHEMA_VERSION, snapshotDigest: snapshotDigest(snapshot), snapshot };
    const encoded = canonicalJSON(envelope);
    if (Buffer.byteLength(encoded) > MAX_STATE_BYTES) fail("STATE_CAPACITY", "Product Session Gateway state exceeds policy");
    const directory = dirname(this.#statePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const directoryStat = lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || (directoryStat.mode & 0o077) !== 0 || !ownedByProcess(directoryStat)) fail("STATE_PERMISSIONS", "Product Session Gateway state directory must be an owner-bound real mode-0700 directory");
    const temporary = `${this.#statePath}.${process.pid}.${randomUUID()}.tmp`;
    let descriptor, renamed = false;
    try {
      descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow(), 0o600);
      writeFileSync(descriptor, encoded, { encoding: "utf8" }); fchmodSync(descriptor, 0o600); fsyncSync(descriptor);
      const stat = fstatSync(descriptor); if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || !ownedByProcess(stat)) fail("STATE_PERMISSIONS", "Product Session Gateway temporary state is unsafe");
      closeSync(descriptor); descriptor = undefined;
      renameSync(temporary, this.#statePath); renamed = true; chmodSync(this.#statePath, 0o600);
      const directoryDescriptor = openSync(directory, constants.O_RDONLY); try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
      const loaded = loadState(this.#statePath);
      if (!loaded || loaded.snapshotDigest !== envelope.snapshotDigest) fail("STATE_TAMPERED", "Product Session Gateway persisted state did not read back exactly");
      this.#stateIdentity = loaded.identity;
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (!renamed) { try { unlinkSync(temporary); } catch (caught) { if (caught?.code !== "ENOENT") throw caught; } }
      throw error;
    }
  }
}

function loadState(path) {
  let descriptor;
  try { descriptor = openSync(path, constants.O_RDONLY | noFollow()); }
  catch (caught) { if (caught?.code === "ENOENT") return null; if (caught?.code === "ELOOP") fail("STATE_PERMISSIONS", "Product Session Gateway state must not be a symbolic link"); throw caught; }
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.size > MAX_STATE_BYTES || !ownedByProcess(stat)) fail("STATE_PERMISSIONS", "Product Session Gateway state must be one owner-bound mode-0600 regular file");
    const raw = readFileSync(descriptor, "utf8"); let envelope;
    try { envelope = JSON.parse(raw); } catch { fail("STATE_TAMPERED", "Product Session Gateway state is invalid JSON"); }
    exactFields(envelope, STATE_FIELDS, "Product Session Gateway persisted state");
    if (envelope.schemaVersion !== PRODUCT_SESSION_GATEWAY_NODE_STATE_SCHEMA_VERSION || !/^[0-9a-f]{64}$/.test(envelope.snapshotDigest) || snapshotDigest(envelope.snapshot) !== envelope.snapshotDigest || canonicalJSON(envelope) !== raw) fail("STATE_TAMPERED", "Product Session Gateway state envelope is invalid");
    return { ...envelope, identity: { dev: stat.dev, ino: stat.ino, size: stat.size, digest: envelope.snapshotDigest } };
  } finally { closeSync(descriptor); }
}

function snapshotDigest(value) { return createHash("sha256").update(canonicalJSON(value)).digest("hex"); }
function pathname(value) { try { const parsed = new URL(value, "http://127.0.0.1"); if (parsed.search || parsed.hash) fail("INVALID_PATH", "Product Session Gateway URL must not contain query or fragment"); return parsed.pathname; } catch (caught) { if (caught instanceof WalletAuthError) throw caught; fail("INVALID_PATH", "Product Session Gateway URL is invalid"); } }
function canonicalOrigin(value) { if (Array.isArray(value) || typeof value !== "string" || value.length > 255 || value.trim() !== value) fail("ORIGIN_NOT_ALLOWED", "Product Session Gateway origin is not registered"); let parsed; try { parsed = new URL(value); } catch { fail("ORIGIN_NOT_ALLOWED", "Product Session Gateway origin is not registered"); } if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.origin !== value) fail("ORIGIN_NOT_ALLOWED", "Product Session Gateway origin is not registered"); return parsed.origin; }
function validRequestId(value) { return typeof value === "string" && /^req_[A-Za-z0-9_-]{12,80}$/.test(value); }
function singleHeader(value) { return typeof value === "string" ? value : ""; }
function nullableHeader(value) { return value === undefined ? null : Array.isArray(value) ? "" : value; }
function noFollow() { return constants.O_NOFOLLOW ?? 0; }
function ownedByProcess(stat) { return typeof process.getuid !== "function" || stat.uid === process.getuid(); }
async function boundedBody(request) { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 1_048_576) fail("BODY_TOO_LARGE", "Product Session Gateway body exceeds policy"); chunks.push(chunk); } return Buffer.concat(chunks).toString("utf8"); }
function hostError(error) { if (!(error instanceof WalletAuthError)) return { status: 500, code: "INTERNAL", message: "Product Session Gateway host failed closed" }; const status = error.code === "ORIGIN_NOT_ALLOWED" ? 403 : error.code === "ROUTE_NOT_FOUND" ? 404 : error.code === "METHOD_NOT_ALLOWED" ? 405 : error.code === "BODY_TOO_LARGE" ? 413 : error.code.startsWith("STATE_") ? 500 : 400; return { status, code: error.code, message: error.message }; }
function fail(code, message) { throw new WalletAuthError(code, message); }
