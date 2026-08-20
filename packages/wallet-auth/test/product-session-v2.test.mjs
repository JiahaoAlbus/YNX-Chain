import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  createProductSessionChallenge, createProductSessionRequest, deviceBinding, parseProductSessionRequest, ProductSessionAuthority,
  signProductSessionApproval, signProductSessionChallenge, WalletAuthError, walletIdentity,
} from "../src/index.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-08-14T01:00:00.000Z");
const PRODUCTS = registry.products.map((item) => item.productId);
const PLATFORMS = ["web", "macos", "windows", "android", "ios"];

function token(label) { return createHash("sha256").update(label).digest("base64url"); }
function deviceSecret(index) { const value = Buffer.alloc(32); value.writeUInt32BE(index + 1, 28); return value; }
function completion(index, productId = PRODUCTS[index % PRODUCTS.length], platform = null, accountSecret = `${(index % 2) + 1}`.padStart(64, "0"), registryInput = registry) {
  const product = registryInput.products.find((item) => item.productId === productId);
  const candidatePlatform = platform ?? PLATFORMS[index % PLATFORMS.length];
  const activePlatforms = (product.platforms ?? PLATFORMS).filter((candidate) => !product.retiredClients?.some((retired) => retired.platform === candidate));
  const selectedPlatform = activePlatforms.includes(candidatePlatform) ? candidatePlatform : activePlatforms[0];
  const secret = deviceSecret(index);
  const request = createProductSessionRequest(registryInput, {
    productId, platform: selectedPlatform, deviceId: `device-${String(index).padStart(6, "0")}`,
    deviceKey: Buffer.from(p256.getPublicKey(secret, true)).toString("base64url"), scopes: product.scopes,
    purpose: `Authorize ${product.displayName} on this exact device.`, nonce: token(`nonce:${index}`), state: token(`state:${index}`),
  }, NOW);
  const approval = signProductSessionApproval(registryInput, request, { accountSecret, scopes: request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const challenge = createProductSessionChallenge(registryInput, request, approval, { challenge: token(`challenge:${index}`) }, NOW);
  return { request, approval, challenge, completion: signProductSessionChallenge(challenge, secret.toString("base64url")) };
}

function issued(authority, input) {
  authority.issueChallenge({ request: input.request, approval: input.approval, challenge: input.challenge.challenge }, NOW);
  return { request: input.request, approval: input.approval, completion: input.completion };
}

function context(session, overrides = {}) { return { chainId: session.chainId, productId: session.productId, clientId: session.clientId, platform: session.platform, applicationId: session.applicationId, bundleId: session.bundleId, packageId: session.packageId, origin: session.origin, callback: session.callback, account: session.account, deviceId: session.deviceId, deviceKey: session.deviceKey, requiredScopes: session.scopes, ...overrides }; }

test("120 concurrent Product Session completions preserve nonce uniqueness and tenant/account isolation", async () => {
  const authority = new ProductSessionAuthority(registry);
  const inputs = Array.from({ length: 120 }, (_, index) => completion(index));
  const sessions = await Promise.all(inputs.map(async (input) => authority.complete(issued(authority, input), NOW)));
  assert.equal(sessions.length, 120);
  assert.equal(new Set(sessions.map((item) => item.sessionBinding)).size, 120);
  assert.equal(new Set(sessions.map((item) => item.nonce)).size, 120);
  assert.equal(new Set(sessions.map((item) => item.state)).size, 120);
  assert.equal(new Set(sessions.map((item) => `${item.productId}:${item.clientId}:${item.applicationId}:${item.origin}:${item.callback}`)).size >= 12, true);
  for (const session of sessions) {
    assert.equal(authority.introspect(session.sessionBinding, context(session), NOW).active, true);
    assert.equal(session.deviceBinding, deviceBinding(session, session.account));
    const other = sessions.find((item) => item.productId !== session.productId && item.account !== session.account) ?? sessions.find((item) => item.productId !== session.productId);
    assert.throws(() => authority.introspect(session.sessionBinding, context(session, { productId: other.productId, clientId: other.clientId, account: other.account }), NOW), code("CROSS_PRODUCT_SESSION"));
  }
  const restored = new ProductSessionAuthority(registry, authority.snapshot());
  assert.equal(restored.introspect(sessions[0].sessionBinding, context(sessions[0]), NOW).active, true);
  assert.throws(() => restored.complete({ request: inputs[0].request, approval: inputs[0].approval, completion: inputs[0].completion }, NOW), code("CHALLENGE_NOT_ISSUED"));
});

test("race: one issued challenge can complete exactly once", async () => {
  const authority = new ProductSessionAuthority(registry); const input = completion(400);
  authority.issueChallenge({ request: input.request, approval: input.approval, challenge: input.challenge.challenge }, NOW);
  const attempts = await Promise.allSettled(Array.from({ length: 100 }, async () => authority.complete({ request: input.request, approval: input.approval, completion: input.completion }, NOW)));
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((item) => item.status === "rejected" && item.reason instanceof WalletAuthError).length, 99);
});

test("origin, callback, bundle/package, application, device, account and scope substitution all fail closed", () => {
  const authority = new ProductSessionAuthority(registry);
  const input = completion(500, "social", "android");
  assert.equal(input.request.bundleId, null);
  assert.equal(input.request.packageId, "com.ynx.social");
  assert.throws(() => parseProductSessionRequest(registry, { ...input.request, packageId: "com.attacker.product" }, NOW), code("SESSION_BINDING_MISMATCH"));
  assert.throws(() => parseProductSessionRequest(registry, { ...input.request, bundleId: "com.ynx.social" }, NOW), code("SESSION_BINDING_MISMATCH"));
  const session = authority.complete(issued(authority, input), NOW);
  for (const override of [
    { origin: "app://android/com.attacker.product" }, { callback: "ynxpay://wallet-auth/callback" },
    { applicationId: "com.attacker.product", packageId: "com.attacker.product" }, { packageId: "com.attacker.product" }, { deviceId: "device-attacker" },
    { deviceKey: Buffer.from(p256.getPublicKey(deviceSecret(999), true)).toString("base64url") },
    { account: walletIdentity("2".padStart(64, "0")).account }, { requiredScopes: ["admin:all"] },
  ]) assert.throws(() => authority.introspect(session.sessionBinding, context(session, override), NOW), (error) => error instanceof WalletAuthError && ["CROSS_PRODUCT_SESSION", "SCOPE_WIDENING"].includes(error.code));
});

test("expiry, session revoke, device revoke and account revoke survive restart", () => {
  let index = 1000;
  for (const revoke of [
    (authority, session) => authority.revokeSession(session.sessionBinding),
    (authority, session) => authority.revokeDevice(session.deviceBinding),
    (authority, session) => authority.revokeAccount(session.account, NOW),
  ]) {
    const authority = new ProductSessionAuthority(registry); const session = authority.complete(issued(authority, completion(index++)), NOW); revoke(authority, session);
    const restarted = new ProductSessionAuthority(registry, authority.snapshot());
    assert.throws(() => restarted.introspect(session.sessionBinding, context(session), NOW), code("SESSION_REVOKED"));
  }
  const authority = new ProductSessionAuthority(registry); const session = authority.complete(issued(authority, completion(9999)), NOW);
  assert.throws(() => authority.introspect(session.sessionBinding, context(session), new Date("2026-08-14T01:06:00.000Z")), code("SESSION_EXPIRED"));
});

test("registry retirement revokes existing Shop Android authority and cancels pending approval", () => {
  const priorRegistry = structuredClone(registry);
  priorRegistry.products.find((item) => item.productId === "shop").retiredClients = [];
  const prior = new ProductSessionAuthority(priorRegistry);
  const completed = completion(12000, "shop", "android", "1".padStart(64, "0"), priorRegistry);
  const session = prior.complete(issued(prior, completed), NOW);
  const pending = completion(12001, "shop", "android", "1".padStart(64, "0"), priorRegistry);
  prior.issueChallenge({ request: pending.request, approval: pending.approval, challenge: pending.challenge.challenge }, NOW);
  const retired = new ProductSessionAuthority(registry, prior.snapshot());
  const snapshot = retired.snapshot();
  assert.equal(snapshot.revokedSessions.includes(session.sessionBinding), true);
  assert.equal(snapshot.revokedDevices.includes(session.deviceBinding), true);
  assert.equal(snapshot.issuedChallenges.some((item) => item.challenge === pending.challenge.challenge), false);
  assert.throws(() => retired.introspect(session.sessionBinding, context(session), NOW), code("SESSION_REVOKED"));
  assert.throws(() => retired.complete({ request: pending.request, approval: pending.approval, completion: pending.completion }, NOW), code("CLIENT_RETIRED"));
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
