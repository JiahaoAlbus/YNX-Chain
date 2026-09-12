import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalJSON, WalletAuthError } from "../src/canonical.js";
import { migrateLegacyCallback, parseProductSessionRegistry, productPlatformBinding } from "../src/product-session-registry.js";
import { createProductSessionRequest, parseProductSessionRequest, signProductSessionApproval, signProductSessionChallenge } from "../src/product-session-v2.js";
import { ProductSessionGatewayKernel } from "../src/product-session-gateway.js";
import { createProductSessionProofV2 } from "../src/product-session-proof-v2.js";
import { httpBodyDigest } from "../src/session-proof.js";

const registry = parseProductSessionRegistry(JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8")));
const NOW = new Date("2026-09-12T00:00:00.000Z");
// Public P-256 generator point used by the registration requests below.
const deviceKey = Buffer.from("036b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296", "hex").toString("base64url");
const platforms = ["android", "ios", "linux", "macos", "web", "windows"];
const expectedProducts = [
  {
    productId: "ai", clientId: "ynx-ai-v1", displayName: "YNX AI", applicationId: "com.ynxweb4.ai",
    webOrigin: "https://assistant.ynxweb4.com", nativeCallback: "ynxai://wallet-auth/callback",
    legacyCallbacks: ["ynxai://wallet-auth/callback"],
    scopes: ["ai:actions", "ai:attachments", "ai:conversations", "ai:data-control", "ai:generate", "ai:permissions"],
    evmCompatible: false, sessionDurationSeconds: 240,
  },
  {
    productId: "cloud", clientId: "ynx-cloud-web-v1", displayName: "YNX Cloud", applicationId: "com.ynxweb4.cloud",
    webOrigin: "https://web4.ynxweb4.com", platforms: ["web"], nativeCallback: null, legacyCallbacks: [],
    scopes: ["files.read", "files.write"], evmCompatible: false, sessionDurationSeconds: 300,
  },
  {
    productId: "docs", clientId: "ynx-docs-mobile-v1", displayName: "YNX Docs", applicationId: "com.ynxweb4.docs",
    webOrigin: "https://docs.ynxweb4.com", nativeCallback: "ynxdocs://wallet-auth/callback",
    legacyCallbacks: ["ynxdocs://wallet-auth/callback"], scopes: ["docs.read", "docs.write", "files.read", "files.write"],
    evmCompatible: false, sessionDurationSeconds: 300,
  },
];

function request(product, platform, scopes = product.scopes) {
  return createProductSessionRequest(registry, {
    productId: product.productId, platform, scopes, deviceId: "registry-fixture-device", deviceKey,
    purpose: `Connect ${product.displayName}.`, nonce: "ecosystem_nonce_abcdefghijklmnopqrstuvwxyz12",
    state: "ecosystem_state_abcdefghijklmnopqrstuvwxyz12",
  }, NOW);
}

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }

for (const product of expectedProducts) {
  test(`${product.displayName} uses its agreed identity, callback and least-privilege scope contract`, () => {
    assert.deepEqual(registry.products.find((entry) => entry.productId === product.productId), product);
    for (const platform of product.platforms ?? platforms) {
      const binding = productPlatformBinding(registry, product.productId, platform);
      const pending = request(product, platform);
      assert.equal(pending.clientId, product.clientId);
      assert.equal(pending.applicationId, platform === "web" ? `${product.applicationId}.web` : product.applicationId);
      assert.equal(pending.origin, platform === "web" ? product.webOrigin : `app://${platform}/${product.applicationId}`);
      assert.equal(pending.callback, platform === "web" ? `${product.webOrigin}/wallet-auth/callback` : product.nativeCallback);
      assert.equal(binding.sessionDurationSeconds, product.sessionDurationSeconds);
      assert.deepEqual(parseProductSessionRequest(registry, pending, NOW), pending);
    }
  });

  test(`${product.displayName} rejects substituted origins, callbacks and product or platform identities`, () => {
    for (const platform of product.platforms ?? platforms) {
      const pending = request(product, platform);
      for (const mutation of [
        { clientId: "ynx-card-v1" },
        { origin: platform === "web" ? "https://card.ynxweb4.com" : `app://${platform}/com.ynxweb4.card` },
        { callback: platform === "web" ? `${product.webOrigin}/legacy-auth/callback` : "ynxcard://wallet-auth/callback" },
        { applicationId: platform === "web" ? "com.ynxweb4.card.web" : "com.ynxweb4.card" },
      ]) assert.throws(() => parseProductSessionRequest(registry, { ...pending, ...mutation }, NOW), code("SESSION_BINDING_MISMATCH"));
      assert.throws(() => parseProductSessionRequest(registry, { ...pending, platform: platform === "web" ? "android" : "web" }, NOW), code(product.platforms ? "INVALID_PLATFORM" : "SESSION_BINDING_MISMATCH"));
    }
  });

  test(`${product.displayName} permits a requested subset but rejects unrelated, repeated or reordered scopes`, () => {
    assert.deepEqual(request(product, "web", [product.scopes[0]]).scopes, [product.scopes[0]]);
    const invalid = [["card:application:write"], [...product.scopes, product.scopes[0]]];
    if (product.scopes.length > 1) invalid.push([...product.scopes].reverse());
    for (const scopes of invalid) {
      assert.throws(() => request(product, "web", scopes), code("SCOPE_WIDENING"));
    }
  });

  test(`${product.displayName} only migrates its registered native callback`, () => {
    if (product.platforms) {
      for (const platform of platforms.filter((value) => value !== "web")) {
        assert.throws(() => request(product, platform), code("INVALID_PLATFORM"));
      }
      assert.throws(() => migrateLegacyCallback(registry, "ynxcloud://wallet-auth/callback", { productId: product.productId, platform: "web" }), code("UNKNOWN_LEGACY_SCHEME"));
      return;
    }
    assert.equal(migrateLegacyCallback(registry, product.nativeCallback, { productId: product.productId, platform: "android" }).migrated, false);
    assert.throws(() => migrateLegacyCallback(registry, new URL(product.nativeCallback).protocol.slice(0, -1), { productId: product.productId, platform: "android" }), code("UNKNOWN_LEGACY_SCHEME"));
    assert.throws(() => migrateLegacyCallback(registry, product.nativeCallback, { productId: "card", platform: "android" }), code("UNKNOWN_LEGACY_SCHEME"));
    assert.throws(() => migrateLegacyCallback(registry, product.nativeCallback, { productId: product.productId, platform: "web" }), code("CALLBACK_MISMATCH"));
  });
}

test("explicit Web-only registrations cannot acquire native bindings or ambiguous platform lists", () => {
  const cloud = expectedProducts.find((product) => product.productId === "cloud");
  const withCloud = (overrides) => ({ ...registry, products: registry.products.map((product) => product.productId === "cloud" ? { ...cloud, ...overrides } : product) });
  for (const mutation of [
    { platforms: [] }, { platforms: ["web", "web"] }, { platforms: ["android"] },
    { platforms: ["web", "android"] }, { platforms: "web" }, { platforms: null }, { platforms: undefined },
    { nativeCallback: "ynxcloud://wallet-auth/callback" }, { legacyCallbacks: ["ynxcloud"] },
    { nativeCallback: undefined }, { legacyCallbacks: null },
  ]) assert.throws(() => parseProductSessionRegistry(withCloud(mutation)), code("INVALID_ROUTER_REGISTRY"));
  const missingPlatforms = withCloud({});
  delete missingPlatforms.products.find((product) => product.productId === "cloud").platforms;
  assert.throws(() => parseProductSessionRegistry(missingPlatforms), code("INVALID_ROUTER_REGISTRY"));
  assert.ok(Object.isFrozen(registry.products.find((product) => product.productId === "cloud").platforms));
});

test("Cloud and Docs do not inherit broader legacy service permissions or the old callback paths", () => {
  for (const [productId, scopes, callback] of [
    ["cloud", ["ai.use", "audit.read", "data.delete", "files.delete", "files.share", "pay", "permissions.manage"], "https://web4.ynxweb4.com/cloud/auth/callback"],
    ["docs", ["ai.use", "audit.read", "docs.comment", "docs.delete", "docs.edit", "docs.share", "files.delete", "files.share", "pay", "permissions.manage"], "https://docs.ynxweb4.com/docs/auth/callback"],
  ]) {
    const product = expectedProducts.find((entry) => entry.productId === productId);
    for (const scope of scopes) assert.throws(() => request(product, "web", [scope]), code("SCOPE_WIDENING"));
    const pending = request(product, "web");
    assert.throws(() => parseProductSessionRequest(registry, { ...pending, callback }, NOW), code("SESSION_BINDING_MISMATCH"));
  }
});

// Fixed test keys and an in-memory Gateway only: no real account, service or
// product operation is used. This proves scope authority, not a product route's
// create/save policy; routes must still reject delete/share/payment operations.
for (const [productId, readScopes, writeScopes] of [
  ["cloud", ["files.read"], ["files.write"]],
  ["docs", ["docs.read", "files.read"], ["docs.write", "files.write"]],
]) test(`${productId} read grants cannot authorize writes and a fresh explicit approval is required`, () => {
  let counter = 0;
  const next = () => createHash("sha256").update(`scope-boundary-${productId}-${counter++}`).digest("base64url");
  const secret = "1".padStart(64, "0"), deviceSecret = Buffer.from(secret, "hex").toString("base64url");
  const gateway = new ProductSessionGatewayKernel(registry, next);
  const dispatch = (path, body, proof = null) => gateway.dispatch({ requestId: `req_scope_${next()}`, method: "POST", path, body, proof, networkAvailable: true }, NOW);
  const makeRequest = granted => createProductSessionRequest(registry, {
    productId, platform: "web", scopes: granted, deviceId: "registry-write-fixture", deviceKey,
    purpose: "Review and explicitly approve this exact scope fixture.", nonce: next(), state: next(),
  }, NOW);
  const approve = pending => signProductSessionApproval(registry, pending, { accountSecret: secret, scopes: pending.scopes, expiresAt: pending.expiresAt }, NOW);
  const complete = (pending, approval) => {
    const issued = dispatch("/v2/product-sessions/challenge", { request: pending, approval });
    assert.equal(issued.status, 200, issued.body);
    const completion = signProductSessionChallenge(JSON.parse(issued.body).result, deviceSecret);
    const response = dispatch("/v2/product-sessions/complete", { request: pending, approval, completion });
    assert.equal(response.status, 200, response.body); return JSON.parse(response.body).result;
  };
  const introspect = (session, requiredScopes) => {
    const body = { requiredScopes }, path = "/v2/product-sessions/introspect";
    const proof = createProductSessionProofV2(session, { method: "POST", path, bodyDigest: httpBodyDigest(canonicalJSON(body)), nonce: next(), issuedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 30_000).toISOString() }, deviceSecret);
    return dispatch(path, body, proof);
  };
  const initialRequest = makeRequest(readScopes), readApproval = approve(initialRequest);
  const initial = complete(initialRequest, readApproval);
  assert.deepEqual(initial.scopes, readScopes);
  assert.equal(introspect(initial, readScopes).status, 200);
  for (const scope of writeScopes) {
    const denied = introspect(initial, [scope]);
    assert.equal(denied.status, 403); assert.equal(JSON.parse(denied.body).error.code, "SCOPE_WIDENING");
  }
  const writeRequest = makeRequest([...readScopes, ...writeScopes].sort());
  assert.notEqual(writeRequest.nonce, initialRequest.nonce); assert.notEqual(writeRequest.state, initialRequest.state);
  const reused = dispatch("/v2/product-sessions/challenge", { request: writeRequest, approval: readApproval });
  assert.equal(reused.status, 400); assert.equal(JSON.parse(reused.body).error.code, "SESSION_BINDING_MISMATCH");
  const explicit = complete(writeRequest, approve(writeRequest));
  assert.notEqual(explicit.sessionBinding, initial.sessionBinding);
  assert.deepEqual(explicit.scopes, writeRequest.scopes);
  for (const scope of writeScopes) assert.equal(introspect(explicit, [scope]).status, 200);
  assert.deepEqual(gateway.snapshot().authority.sessions.find(session => session.sessionBinding === initial.sessionBinding).scopes, readScopes);
});
