import { canonicalJSON, exactFields, WalletAuthError } from "./canonical.js";
import { productPlatformBinding } from "./product-session-registry.js";
import { parseProductSession } from "./product-session-v2.js";
import { decodeProductSessionGatewayProofHeaderV2, ProductSessionGatewayFetchAdapter } from "./product-session-gateway-client.js";
import { httpBodyDigest } from "./session-proof.js";

const INTROSPECT = "/v2/product-sessions/introspect";
const TUPLE = ["productId", "clientId", "applicationId", "bundleId", "packageId", "origin", "callback"];
const SENDER = ["sessionBinding", "account", "deviceId", "deviceKey"];

/** Server-side live consumer of the existing protocol. Configure a fixed
 * registry identity and HTTPS authority in trusted server code. Route scopes
 * must come from the server router, never a request body or claimed role.
 * The proof authorizes introspection of a session, not the business HTTP body.
 * Object ownership, business policy and separate action approval remain required.
 */
export class ProductSessionServerAuthorizer {
  #binding; #gateway; #clock;
  constructor(config) {
    exactFields(config, ["registry", "productId", "platform", "endpoint", "fetch", "timeoutMs", ...(Object.hasOwn(config, "clock") ? ["clock"] : [])], "Server Product Session configuration");
    this.#binding = productPlatformBinding(config.registry, config.productId, config.platform);
    this.#clock = config.clock ?? (() => new Date());
    if (typeof this.#clock !== "function") fail("INVALID_SERVER_POLICY", "Server time source is invalid");
    this.#gateway = new ProductSessionGatewayFetchAdapter({ endpoint: config.endpoint, fetch: config.fetch, timeoutMs: config.timeoutMs, walletInstalled: () => false, schemeRegistered: () => false });
  }

  /** No caching or automatic retries. A lost response requires a fresh client
   * proof, because the original may already have been consumed by the authority.
   * `origin` may be null for native requests or a read-only web GET, since
   * browsers can omit Origin on same-origin GET. The signed proof remains
   * mandatory; Origin/Fetch-Metadata are never credentials. Web mutation
   * methods still require the registered Origin. GET routes must be read-only.
   * Caller must reject duplicate proof/Origin headers before creating this input.
   */
  async authorize(input) {
    exactFields(input, ["proofHeader", "origin", "method", "path", "requiredScopes"], "Server Product Session request");
    if (input.origin !== this.#binding.origin && !(input.origin === null && (this.#binding.platform !== "web" || input.method === "GET"))) fail("ORIGIN_MISMATCH", "Request origin does not match the configured product");
    if (typeof input.method !== "string" || !/^(GET|POST|PUT|PATCH|DELETE)$/.test(input.method) || typeof input.path !== "string" || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@\/-]{1,255}$/.test(input.path) || input.path.includes("//")) fail("INVALID_ROUTE_POLICY", "Server route metadata is invalid");
    const requiredScopes = scopes(input.requiredScopes, this.#binding.scopes);
    const proof = decodeProductSessionGatewayProofHeaderV2(input.proofHeader);
    if (TUPLE.some(key => proof[key] !== this.#binding[key])) fail("CROSS_PRODUCT_SESSION", "Proof does not match the fixed server product identity");
    const body = canonicalJSON({ requiredScopes });
    if (proof.method !== "POST" || proof.path !== INTROSPECT || proof.bodyDigest !== httpBodyDigest(body)) fail("HTTP_BINDING_MISMATCH", "Proof must bind the exact route-required introspection scopes");
    const before = instant(this.#clock());
    active(proof, before);
    // The incoming proof cannot select a URL, a backend identity or an upstream
    // request ID. This request sends no incoming cookies or bearer credentials.
    const requestId = randomRequestId();
    const result = await this.#gateway.introspect({ requestId, sessionBinding: proof.sessionBinding, requiredScopes, proof });
    exactFields(result, ["active", "session"], "Live Product Session result");
    if (result.active !== true) fail("SESSION_INACTIVE", "The authority did not confirm an active session");
    const session = parseProductSession(result.session);
    if (session.chainId !== this.#binding.chainId || session.platform !== this.#binding.platform || TUPLE.some(key => session[key] !== this.#binding[key]) || SENDER.some(key => session[key] !== proof[key])) fail("SESSION_BINDING_MISMATCH", "Authority response changed the requested product or sender");
    const after = instant(this.#clock());
    if (after < before) fail("CLOCK_UNAVAILABLE", "Server clock moved backwards during authorization");
    active(proof, after); active(session, after);
    if (proof.issuedAt < session.issuedAt || proof.expiresAt > session.expiresAt) fail("SESSION_EXPIRED", "Proof does not fit within the live session lifetime");
    if (session.scopes.some(scope => !this.#binding.scopes.includes(scope)) || requiredScopes.some(scope => !session.scopes.includes(scope))) fail("SCOPE_WIDENING", "The live session does not grant the required scopes");
    return session;
  }
}

function scopes(value, allowed) {
  if (!Array.isArray(value)) fail("INVALID_ROUTE_POLICY", "Route scopes must be an array");
  const snapshot = [...value];
  if (!snapshot.length || snapshot.length > 32 || snapshot.some(scope => typeof scope !== "string" || !allowed.includes(scope)) || new Set(snapshot).size !== snapshot.length || snapshot.some((scope, index) => index > 0 && snapshot[index - 1] >= scope)) fail("INVALID_ROUTE_POLICY", "Route scopes must be a nonempty canonical subset of the configured product");
  return Object.freeze(snapshot);
}
function active(value, now) { if (Date.parse(value.issuedAt) > now || Date.parse(value.expiresAt) <= now) fail("SESSION_EXPIRED", "Session proof is not currently valid"); }
function instant(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("CLOCK_UNAVAILABLE", "Valid server time is required"); return value.getTime(); }
function randomRequestId() {
  if (typeof globalThis.crypto?.getRandomValues !== "function") fail("RANDOM_UNAVAILABLE", "Server cryptographic random source is unavailable");
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(18));
  return "req_product_" + [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function fail(code, message) { throw new WalletAuthError(code, message); }
