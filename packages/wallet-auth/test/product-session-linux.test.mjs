import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  createProductSessionRequest, createProductSessionReturnURL, encodeProductSessionWalletURL,
  parseProductSessionApproval, parseProductSessionRequest, parseProductSessionReturnURL,
  parseProductSessionWalletURL, productPlatformBinding, ProductSessionAuthority,
  signProductSessionApproval, signProductSessionChallenge, WalletAuthError,
} from "../src/index.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-09-06T01:00:00.000Z");
// Public deterministic test fixtures, never used with an installed wallet or network.
const accountSecret = "1".padStart(64, "0");
const deviceSecret = Buffer.alloc(32, 0x42);
const deviceKey = Buffer.from(p256.getPublicKey(deviceSecret, true)).toString("base64url");
const token = value => createHash("sha256").update(value).digest("base64url");
const code = expected => error => error instanceof WalletAuthError && error.code === expected;

function fixture(productId = "social") {
  const product = registry.products.find(item => item.productId === productId);
  const request = createProductSessionRequest(registry, {
    productId, platform: "linux", deviceId: "linux-device-test", deviceKey,
    scopes: product.scopes, purpose: "Sign in to this Linux app.",
    nonce: token(`linux-nonce:${productId}`), state: token(`linux-state:${productId}`),
  }, NOW);
  const approval = signProductSessionApproval(registry, request, {
    accountSecret, scopes: request.scopes, expiresAt: request.expiresAt,
  }, NOW);
  return { request, approval };
}

function introspection(session, overrides = {}) {
  return {
    chainId: session.chainId, productId: session.productId, clientId: session.clientId,
    platform: session.platform, applicationId: session.applicationId,
    bundleId: session.bundleId, packageId: session.packageId, origin: session.origin,
    callback: session.callback, account: session.account, deviceId: session.deviceId,
    deviceKey: session.deviceKey, requiredScopes: session.scopes, ...overrides,
  };
}

function issue(authority, input) {
  return authority.issueChallenge({ ...input, challenge: token("linux-challenge") }, NOW);
}

test("every registered Linux product retains its native package, origin and exact return callback", () => {
  for (const product of registry.products) {
    const binding = productPlatformBinding(registry, product.productId, "linux");
    assert.equal(binding.applicationId, product.applicationId);
    assert.equal(binding.packageId, product.applicationId);
    assert.equal(binding.bundleId, null);
    assert.equal(binding.origin, `app://linux/${product.applicationId}`);
    assert.equal(binding.callback, product.nativeCallback);
    const { request, approval } = fixture(product.productId);
    const walletURL = encodeProductSessionWalletURL(registry, request, NOW);
    assert.deepEqual(parseProductSessionWalletURL(registry, walletURL, NOW), request);
    const approvedURL = createProductSessionReturnURL(registry, request, { result: "approved", approval }, NOW);
    const returned = parseProductSessionReturnURL(registry, request, approvedURL, NOW);
    assert.equal(returned.status, "ready");
    assert.deepEqual(returned.approval, approval);
    const rejectedURL = createProductSessionReturnURL(registry, request, { result: "rejected", reason: "user_rejected" }, NOW);
    assert.equal(parseProductSessionReturnURL(registry, request, rejectedURL, NOW).status, "user-rejected");
  }
});

test("Linux challenge issuance, completion and introspection preserve binding across both restart boundaries", () => {
  const input = fixture();
  let authority = new ProductSessionAuthority(registry);
  const challenge = issue(authority, input);
  assert.equal(challenge.platform, "linux");
  assert.equal(challenge.packageId, input.request.applicationId);
  const completion = signProductSessionChallenge(challenge, deviceSecret.toString("base64url"));
  authority = new ProductSessionAuthority(registry, JSON.parse(JSON.stringify(authority.snapshot())));
  const session = authority.complete({ ...input, completion }, NOW);
  assert.equal(session.platform, "linux");
  assert.equal(session.packageId, input.request.applicationId);
  assert.equal(session.origin, input.request.origin);
  assert.equal(session.callback, input.request.callback);
  authority = new ProductSessionAuthority(registry, JSON.parse(JSON.stringify(authority.snapshot())));
  assert.equal(authority.introspect(session.sessionBinding, introspection(session), NOW).active, true);
  assert.throws(() => authority.complete({ ...input, completion }, NOW), code("CHALLENGE_NOT_ISSUED"));
  authority.revokeSession(session.sessionBinding);
  const revoked = new ProductSessionAuthority(registry, authority.snapshot());
  assert.throws(() => revoked.introspect(session.sessionBinding, introspection(session), NOW), code("SESSION_REVOKED"));
});

test("Linux request and approval reject package, bundle, origin and callback substitution", () => {
  const { request, approval } = fixture();
  for (const override of [
    { packageId: null }, { packageId: "com.attacker.app" },
    { bundleId: request.applicationId },
    { applicationId: "com.attacker.app", packageId: "com.attacker.app" },
    { origin: `app://windows/${request.applicationId}` },
    { origin: "app://linux/com.attacker.app" },
    { callback: "ynxpay://wallet-auth/callback" },
  ]) {
    assert.throws(() => parseProductSessionRequest(registry, { ...request, ...override }, NOW), code("SESSION_BINDING_MISMATCH"));
    assert.throws(() => parseProductSessionApproval(registry, request, { ...approval, ...override }, NOW), code("SESSION_BINDING_MISMATCH"));
  }
  for (const origin of [`app://linux/${request.applicationId}/`, `app://linux/${request.applicationId}?account=other`]) {
    assert.throws(() => parseProductSessionRequest(registry, { ...request, origin }, NOW), code("INVALID_ORIGIN"));
  }
});

test("Linux completion and restarted introspection reject substituted native identities", () => {
  const input = fixture();
  const authority = new ProductSessionAuthority(registry);
  const challenge = issue(authority, input);
  const completion = signProductSessionChallenge(challenge, deviceSecret.toString("base64url"));
  for (const override of [
    { packageId: null }, { packageId: "com.attacker.app" },
    { origin: `app://windows/${input.request.applicationId}` },
    { origin: "app://linux/com.attacker.app" },
  ]) {
    assert.throws(() => authority.complete({ ...input, completion: { ...completion, challenge: { ...challenge, ...override } } }, NOW), code("SESSION_BINDING_MISMATCH"));
  }
  const session = authority.complete({ ...input, completion }, NOW);
  const restored = new ProductSessionAuthority(registry, authority.snapshot());
  for (const override of [
    { platform: "windows" }, { packageId: null }, { packageId: "com.attacker.app" },
    { bundleId: session.applicationId }, { origin: `app://windows/${session.applicationId}` },
    { origin: "app://linux/com.attacker.app" },
  ]) {
    assert.throws(() => restored.introspect(session.sessionBinding, introspection(session, override), NOW), code("CROSS_PRODUCT_SESSION"));
  }
  assert.throws(() => restored.introspect(session.sessionBinding, introspection(session), new Date(session.expiresAt)), code("SESSION_EXPIRED"));
});
