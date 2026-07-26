import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CentralWalletSessionStore, createGatewayChallenge, migrateCentralRegistryEntry,
  parseAuthorizationRequest, signAuthorization, signGatewayChallenge, WalletAuthError,
} from "../src/index.js";
import { ACCOUNT_SECRET, NOW, PRODUCT_DEVICE_KEY, PRODUCT_DEVICE_SECRET, request } from "./fixtures.mjs";

const vector = JSON.parse(readFileSync(new URL("../testdata/central-lifecycle-v1.json", import.meta.url), "utf8"));

const registryEntry = migrateCentralRegistryEntry({
  schemaVersion: 1, productClientId: "ynx-social-v1", requestingProduct: "social",
  bundleId: "com.ynx.social", callback: "ynx-social://com.ynx.social",
  scopes: ["account:read", "profile:link"], maxScopes: 2,
});

function completionInput() {
  const authorizationRequest = parseAuthorizationRequest(request(), {
    now: NOW,
    registry: { "ynx-social-v1": { requestingProduct: "social", bundleId: "com.ynx.social", callbacks: registryEntry.callbacks, scopes: registryEntry.scopes, maxScopes: 2 } },
  });
  const walletApproval = signAuthorization(authorizationRequest, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(walletApproval, { challenge: "gateway_challenge_abcdefghijklmnop", expiresAt: "2026-07-15T12:03:00.000Z" }, NOW);
  return { registryEntry, authorizationRequest, walletApproval, gatewayCompletion: signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET) };
}

function context(overrides = {}) {
  return { productClientId: "ynx-social-v1", bundleId: "com.ynx.social", productDeviceKey: PRODUCT_DEVICE_KEY, requiredScopes: ["account:read"], ...overrides };
}

test("completion consumes nonce, request and challenge atomically and survives restart", () => {
  const store = new CentralWalletSessionStore();
  const input = completionInput();
  const session = store.complete(input, NOW);
  assert.equal(session.requestDigest, vector.expected.requestDigest);
  assert.equal(session.account, vector.expected.account);
  assert.equal(session.sessionBinding, vector.expected.sessionBinding);
  assert.equal(session.approvalDigest, vector.expected.approvalDigest);
  assert.equal(session.deviceBinding, vector.expected.deviceBinding);
  assert.equal(store.snapshot().audit[0].hash, vector.expected.firstAuditHash);
  assert.equal(store.introspect(session.sessionBinding, context(), NOW).active, true);
  assert.throws(() => store.complete(input, NOW), code("REPLAY"));
  const restarted = new CentralWalletSessionStore(store.snapshot());
  assert.equal(restarted.introspect(session.sessionBinding, context(), NOW).session.account, session.account);
  assert.throws(() => new CentralWalletSessionStore({ ...store.snapshot(), consumedNonces: [] }), code("INVALID_STORE"));
});

test("introspection rejects cross-App, device and scope substitution", () => {
  const store = new CentralWalletSessionStore();
  const session = store.complete(completionInput(), NOW);
  assert.throws(() => store.introspect(session.sessionBinding, context({ productClientId: "ynx-pay-v1" }), NOW), code("CROSS_APP_REUSE"));
  assert.throws(() => store.introspect(session.sessionBinding, context({ bundleId: "com.ynxweb4.pay" }), NOW), code("CROSS_APP_REUSE"));
  assert.throws(() => store.introspect(session.sessionBinding, context({ productDeviceKey: "A".repeat(44) }), NOW), code("CROSS_APP_REUSE"));
  assert.throws(() => store.introspect(session.sessionBinding, context({ requiredScopes: ["admin:all"] }), NOW), code("SCOPE_NOT_ALLOWED"));
});

test("session, approval, device and all-device account revocation fail closed", () => {
  for (const revoke of [
    (store, session) => store.revokeSession(session.sessionBinding, NOW),
    (store, session) => store.revokeApproval(session.approvalDigest, NOW),
    (store, session) => store.revokeDevice(session.deviceBinding, NOW),
    (store, session) => store.logoutAllDevices(session.account, NOW),
  ]) {
    const store = new CentralWalletSessionStore();
    const session = store.complete(completionInput(), NOW);
    revoke(store, session);
    assert.throws(() => store.introspect(session.sessionBinding, context(), NOW), code("REVOKED"));
    assert.equal(store.snapshot().audit.length, 2);
  }
});

test("session inventory groups apps, approvals and devices without hiding revocation reasons", () => {
  const store = new CentralWalletSessionStore();
  const session = store.complete(completionInput(), NOW);
  const active = store.inventory(session.account, NOW);
  assert.equal(active.schemaVersion, 1);
  assert.equal(active.account, session.account);
  assert.equal(active.connectedApps.length, 1);
  assert.equal(active.connectedApps[0].productClientId, session.productClientId);
  assert.equal(active.connectedApps[0].active, true);
  assert.deepEqual(active.connectedApps[0].sessionBindings, [session.sessionBinding]);
  assert.deepEqual(active.approvals[0].activeSessionBindings, [session.sessionBinding]);
  assert.equal(active.approvals[0].revoked, false);
  assert.equal(active.devices[0].revoked, false);
  assert.equal(active.sessions[0].active, true);
  assert.deepEqual(active.sessions[0].inactiveReasons, []);
  assert.equal(Object.isFrozen(active), true);
  assert.equal(Object.isFrozen(active.sessions), true);
  assert.equal(Object.isFrozen(active.sessions[0].inactiveReasons), true);

  store.revokeApproval(session.approvalDigest, NOW);
  store.revokeDevice(session.deviceBinding, NOW);
  const inactive = new CentralWalletSessionStore(store.snapshot()).inventory(session.account, NOW);
  assert.equal(inactive.connectedApps[0].active, false);
  assert.equal(inactive.approvals[0].revoked, true);
  assert.equal(inactive.devices[0].revoked, true);
  assert.equal(inactive.sessions[0].active, false);
  assert.deepEqual(inactive.sessions[0].inactiveReasons, ["approval-revoked", "device-revoked"]);
  assert.deepEqual(new CentralWalletSessionStore().inventory(session.account, NOW).sessions, []);
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
