import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { decodeProductSessionGatewayProofHeaderV2, PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2 } from "./product-session-gateway-client.js";
import { ProductSessionGatewayHttpHandler } from "./product-session-gateway-http.js";
import { parseProductSessionRegistry } from "./product-session-registry.js";
import { decodeWalletSessionControlProofHeader, WALLET_SESSION_CONTROL_INTENT_PATHS, WALLET_SESSION_CONTROL_PATHS, WALLET_SESSION_CONTROL_PROOF_HEADER } from "./wallet-session-control.js";
import { observeDurableProductSessionControlIntent, parseProductSessionControlIntent, productSessionControlClockFloor } from "./product-session-control-intent.js";
import { ProductSessionControlNodeStore } from "./product-session-control-node-store.js";

const TIME = "/v2/product-sessions/time", WALLET = "https://wallet.ynxweb4.com";
const OWNER_ROUTES = new Set([...WALLET_SESSION_CONTROL_PATHS, ...WALLET_SESSION_CONTROL_INTENT_PATHS]);
const ROUTES = new Set([TIME, ...OWNER_ROUTES, "/v2/product-sessions/challenge", "/v2/product-sessions/complete", "/v2/product-sessions/introspect", "/v2/product-sessions/revoke", "/v2/product-sessions/devices/revoke"]);

/** Explicit v3 host; it never initializes or migrates a serving state file. */
export class ProductSessionControlNodeHost {
  #registry; #origins; #store; #now; #tokens;
  constructor(registry, options) {
    exactFields(options, ["now", "statePath", "tokenFactory", ...(Object.hasOwn(options, "io") ? ["io"] : [])], "Product Session control Node host options");
    if (typeof options.now !== "function" || typeof options.tokenFactory !== "function") fail("INVALID_HOST", "Control host dependencies are invalid");
    this.#registry = parseProductSessionRegistry(registry);
    this.#origins = new Set(this.#registry.products.map(product => product.webOrigin));
    this.#now = options.now; this.#tokens = options.tokenFactory;
    this.#store = new ProductSessionControlNodeStore({ statePath: options.statePath, ...(options.io ? { io: options.io } : {}) });
  }
  snapshot() { return this.#store.snapshot(); }
  handler() {
    return async (request, response) => {
      const requestId = validRequestId(request.headers["x-request-id"]) ? request.headers["x-request-id"] : "req_invalid_request_000";
      let cors = {}, route = "";
      try {
        route = pathname(request.url); cors = this.#cors(request.headers.origin, route);
        this.#store.snapshot();
        if (!ROUTES.has(route)) fail("ROUTE_NOT_FOUND", "Product Session control route is not registered");
        if (request.method === "OPTIONS") {
          if (!Object.keys(cors).length) fail("ORIGIN_NOT_ALLOWED", "Preflight requires an allowed origin");
          const method = route === TIME ? "GET" : "POST";
          if (request.headers["access-control-request-method"] !== method) fail("METHOD_NOT_ALLOWED", "Preflight method does not match this route");
          const requested = single(request.headers["access-control-request-headers"]).split(",").map(value => value.trim().toLowerCase());
          const allowed = headersFor(route).split(", ");
          if (!requested.length || new Set(requested).size !== requested.length || requested.some(header => !allowed.includes(header))) fail("INVALID_CORS_REQUEST", "Preflight headers are not allowed");
          response.writeHead(204, { ...cors, "cache-control": "no-store", "access-control-allow-methods": method, "access-control-allow-headers": headersFor(route), "access-control-max-age": "300" }); response.end(); return;
        }
        if (route === TIME) {
          if (request.method !== "GET") fail("METHOD_NOT_ALLOWED", "Authority time accepts GET only");
          if (!validRequestId(request.headers["x-request-id"])) fail("INVALID_REQUEST_ID", "Authority time requires a valid request ID");
          const now = this.#instant();
          if (now.getTime() < productSessionControlClockFloor(this.#store.snapshot())) fail("CLOCK_UNAVAILABLE", "Authority time is behind the durable control history");
          send(response, 200, requestId, { ok: true, result: { serverTime: now.toISOString() } }, cors); return;
        }
        if (request.method !== "POST") fail("METHOD_NOT_ALLOWED", "Product Session control accepts POST only");
        const body = await boundedBody(request), proofHeader = nullable(request.headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2]), walletControlProofHeader = nullable(request.headers[WALLET_SESSION_CONTROL_PROOF_HEADER]);
        this.#originBinding(request.headers.origin, route, body, proofHeader);
        let decisionAt;
        const committed = this.#store.transact(snapshot => {
          decisionAt = this.#instant();
          const candidate = new ProductSessionGatewayHttpHandler(this.#registry, this.#tokens, snapshot);
          const value = candidate.handle({ requestId, method: request.method, path: route, contentType: single(request.headers["content-type"]), body, proofHeader, walletControlProofHeader, networkAvailable: true }, decisionAt);
          return { snapshot: candidate.snapshot(), value };
        });
        let value = committed.value;
        if (WALLET_SESSION_CONTROL_INTENT_PATHS.includes(route) && value.status === 200) {
          const payload = JSON.parse(value.body), prepared = payload.result;
          if (payload.ok !== true || prepared?.status !== "prepared" || prepared.revocationConfirmed !== false) fail("INVALID_CONTROL_RESULT", "Control kernel did not produce an unconfirmed preparation");
          const proof = decodeWalletSessionControlProofHeader(walletControlProofHeader);
          const intent = parseProductSessionControlIntent({ account: proof.account, operation: route.endsWith("/revoke-all") ? "account-logout" : "device-logout", body: JSON.parse(body) });
          const confirmed = observeDurableProductSessionControlIntent(committed.snapshot, intent, decisionAt);
          if (!confirmed.revocationConfirmed || canonicalJSON(confirmed.receipt) !== canonicalJSON(prepared.preparedReceipt)) fail("INVALID_CONTROL_RESULT", "Durable readback does not confirm the exact prepared intent");
          value = { ...value, body: canonicalJSON({ ...payload, result: confirmed }) };
        }
        response.writeHead(value.status, { ...value.headers, ...cors }); response.end(value.body);
      } catch (caught) {
        if (response.headersSent || response.destroyed) { response.destroy?.(); return; }
        const error = publicError(caught);
        const uncertain = WALLET_SESSION_CONTROL_INTENT_PATHS.includes(route) && error.code.startsWith("STATE_");
        send(response, error.status, requestId, { ok: false, error: { code: error.code, message: error.message }, ...(uncertain ? { status: "unknown", revocationConfirmed: false } : {}) }, cors);
      }
    };
  }
  #instant() { const now = this.#now(); if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("INVALID_TIME", "Authority time is unavailable"); return now; }
  #cors(value, route) {
    if (value === undefined) return {};
    if (typeof value !== "string") fail("ORIGIN_NOT_ALLOWED", "Origin is invalid");
    let parsed; try { parsed = new URL(value); } catch { fail("ORIGIN_NOT_ALLOWED", "Origin is invalid"); }
    if (parsed.protocol !== "https:" || parsed.origin !== value) fail("ORIGIN_NOT_ALLOWED", "Origin must be a canonical HTTPS origin");
    const allowed = OWNER_ROUTES.has(route) ? value === WALLET : this.#origins.has(value) || route === TIME && value === WALLET;
    if (!allowed) fail("ORIGIN_NOT_ALLOWED", "Origin is not allowed for this route");
    return { "access-control-allow-origin": value, "access-control-expose-headers": "x-request-id", vary: "origin" };
  }
  #originBinding(origin, route, body, proofHeader) {
    if (origin === undefined || OWNER_ROUTES.has(route)) return;
    let bound;
    if (["/v2/product-sessions/challenge", "/v2/product-sessions/complete"].includes(route)) {
      let parsed; try { parsed = JSON.parse(body); } catch { fail("INVALID_BODY", "Product Session body is invalid JSON"); }
      bound = parsed?.request?.origin;
    } else { if (proofHeader === null) return; bound = decodeProductSessionGatewayProofHeaderV2(proofHeader).origin; }
    if (bound !== origin) fail("ORIGIN_NOT_ALLOWED", "Browser origin differs from the exact Product Session binding");
  }
}
function headersFor(route) { return `content-type, x-request-id, ${OWNER_ROUTES.has(route) ? WALLET_SESSION_CONTROL_PROOF_HEADER : PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2}`; }
function send(response, status, requestId, payload, cors) { response.writeHead(status, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-request-id": requestId, ...cors }); response.end(canonicalJSON({ ...payload, requestId, schemaVersion: 2 })); }
function publicError(error) {
  if (!(error instanceof WalletAuthError)) return { status: 500, code: "INTERNAL", message: "Control host failed closed; no revocation confirmation is available" };
  const status = ["CLOCK_UNAVAILABLE", "STATE_DURABILITY_UNCERTAIN", "STATE_WRITE_FAILED", "STATE_READ_FAILED", "STATE_WRITER_BUSY"].includes(error.code) ? 503 : error.code === "ORIGIN_NOT_ALLOWED" ? 403 : error.code === "ROUTE_NOT_FOUND" ? 404 : error.code === "METHOD_NOT_ALLOWED" ? 405 : error.code === "BODY_TOO_LARGE" ? 413 : error.code.startsWith("STATE_") ? 500 : 400;
  return { status, code: error.code, message: error.message.slice(0, 300) };
}
function pathname(value) { let url; try { url = new URL(value, "http://127.0.0.1"); } catch { fail("INVALID_PATH", "Control URL is invalid"); } if (url.search || url.hash) fail("INVALID_PATH", "Control URL cannot have query or fragment"); return url.pathname; }
function validRequestId(value) { return typeof value === "string" && /^req_[A-Za-z0-9_-]{12,80}$/.test(value); }
function single(value) { return typeof value === "string" ? value : ""; }
function nullable(value) { return value === undefined ? null : single(value); }
async function boundedBody(request) { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 1_048_576) fail("BODY_TOO_LARGE", "Control body exceeds policy"); chunks.push(chunk); } return Buffer.concat(chunks).toString("utf8"); }
function fail(code, message) { throw new WalletAuthError(code, message); }
