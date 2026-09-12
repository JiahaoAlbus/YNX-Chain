import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { WalletAuthError } from "../src/canonical.js";
import { migrateLegacyCallback, parseProductSessionRegistry, productPlatformBinding } from "../src/product-session-registry.js";
import { createProductSessionRequest, parseProductSessionRequest } from "../src/product-session-v2.js";

const registry = parseProductSessionRegistry(JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8")));
const NOW = new Date("2026-09-12T00:00:00.000Z");
// Public P-256 generator point; these registration tests do not sign approvals.
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
    scopes: ["files.read"], evmCompatible: false, sessionDurationSeconds: 300,
  },
  {
    productId: "docs", clientId: "ynx-docs-mobile-v1", displayName: "YNX Docs", applicationId: "com.ynxweb4.docs",
    webOrigin: "https://docs.ynxweb4.com", nativeCallback: "ynxdocs://wallet-auth/callback",
    legacyCallbacks: ["ynxdocs://wallet-auth/callback"], scopes: ["docs.read", "files.read"],
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
    ["cloud", ["ai.use", "audit.read", "data.delete", "files.write", "permissions.manage"], "https://web4.ynxweb4.com/cloud/auth/callback"],
    ["docs", ["ai.use", "audit.read", "docs.comment", "docs.edit", "files.write", "permissions.manage"], "https://docs.ynxweb4.com/docs/auth/callback"],
  ]) {
    const product = expectedProducts.find((entry) => entry.productId === productId);
    for (const scope of scopes) assert.throws(() => request(product, "web", [scope]), code("SCOPE_WIDENING"));
    const pending = request(product, "web");
    assert.throws(() => parseProductSessionRequest(registry, { ...pending, callback }, NOW), code("SESSION_BINDING_MISMATCH"));
  }
});
