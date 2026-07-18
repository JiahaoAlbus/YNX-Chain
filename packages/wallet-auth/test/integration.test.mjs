import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCentralWalletSessionActive, createGatewayChallenge, migrateCentralRegistryEntry,
  parseCentralRegistryEntry, parseAuthorizationRequest, signAuthorization, signGatewayChallenge,
  verifyCentralWalletSession, WalletAuthError,
} from "../src/index.js";
import { ACCOUNT_SECRET, NOW, PRODUCT_DEVICE_SECRET, request } from "./fixtures.mjs";

const REGISTRY_V1 = Object.freeze({
  schemaVersion: 1,
  productClientId: "ynx-social-v1",
  requestingProduct: "social",
  bundleId: "com.ynxweb4.social",
  callback: "ynxsocial://wallet-auth/callback",
  scopes: Object.freeze(["account:read", "profile:link"]),
  maxScopes: 2,
});

test("central registry v1 migrates deterministically to exact P-256 schema v2", () => {
  const migrated = migrateCentralRegistryEntry(REGISTRY_V1);
  assert.deepEqual(migrated, {
    schemaVersion: 2,
    productClientId: "ynx-social-v1",
    requestingProduct: "social",
    bundleId: "com.ynxweb4.social",
    callbacks: ["ynxsocial://wallet-auth/callback"],
    scopes: ["account:read", "profile:link"],
    maxScopes: 2,
    productDeviceAlgorithms: ["p256-sha256"],
  });
  assert.deepEqual(migrateCentralRegistryEntry(migrated), migrated);
});

test("central verifier validates registry, Wallet approval, and device proof in one fail-closed call", () => {
  const registryEntry = migrateCentralRegistryEntry(REGISTRY_V1);
  const parsed = parseAuthorizationRequest(request(), { now: NOW, registry: { "ynx-social-v1": { requestingProduct: "social", bundleId: "com.ynxweb4.social", callbacks: registryEntry.callbacks, scopes: registryEntry.scopes, maxScopes: 2 } } });
  const approval = signAuthorization(parsed, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(approval, { challenge: "gateway_challenge_abcdefghijklmnop", expiresAt: "2026-07-15T12:03:00.000Z" }, NOW);
  const gatewayCompletion = signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET);
  const session = verifyCentralWalletSession({ registryEntry, authorizationRequest: parsed, walletApproval: approval, gatewayCompletion }, NOW);
  assert.equal(session.verifierVersion, "wallet-auth-v1");
  const active = { revokedSessionBindings: [], revokedApprovalDigests: [], revokedDeviceBindings: [], accountLogoutRecords: [] };
  assert.deepEqual(assertCentralWalletSessionActive(session, active, NOW), session);
  assert.throws(() => assertCentralWalletSessionActive(session, { ...active, revokedSessionBindings: [session.sessionBinding] }, NOW), code("REVOKED"));
  assert.throws(() => assertCentralWalletSessionActive(session, { ...active, revokedApprovalDigests: [session.approvalDigest] }, NOW), code("REVOKED"));
  assert.throws(() => assertCentralWalletSessionActive(session, { ...active, revokedDeviceBindings: [session.deviceBinding] }, NOW), code("REVOKED"));
  assert.throws(() => assertCentralWalletSessionActive(session, { ...active, accountLogoutRecords: [{ account: session.account, before: session.issuedAt }] }, NOW), code("REVOKED"));
  assert.throws(() => assertCentralWalletSessionActive(session, active, new Date("2026-07-15T12:03:00.000Z")), code("EXPIRED"));
  assert.throws(() => assertCentralWalletSessionActive({ ...session, account: "ynx1tampered" }, active, NOW), code("INVALID_REGISTRY"));
  assert.throws(() => assertCentralWalletSessionActive({ ...session, unknown: true }, active, NOW), code("UNKNOWN_OR_MISSING_FIELD"));
});

test("central integration rejects registry migration tamper and approval substitution", () => {
  assert.throws(() => migrateCentralRegistryEntry({ ...REGISTRY_V1, callback: "ynxsocial://wallet-auth/callback", extra: true }), code("UNKNOWN_OR_MISSING_FIELD"));
  assert.throws(() => parseCentralRegistryEntry({ ...migrateCentralRegistryEntry(REGISTRY_V1), productDeviceAlgorithms: ["ed25519"] }), code("INVALID_REGISTRY"));
  assert.throws(() => parseCentralRegistryEntry({ ...migrateCentralRegistryEntry(REGISTRY_V1), callbacks: ["ynxsocial://wallet-auth/callback?state=mutable"] }), code("INVALID_REGISTRY"));
  const registryEntry = migrateCentralRegistryEntry(REGISTRY_V1);
  const parsed = parseAuthorizationRequest(request(), { now: NOW, registry: { "ynx-social-v1": { requestingProduct: "social", bundleId: "com.ynxweb4.social", callbacks: registryEntry.callbacks, scopes: registryEntry.scopes, maxScopes: 2 } } });
  const approval = signAuthorization(parsed, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(approval, { challenge: "gateway_challenge_abcdefghijklmnop", expiresAt: "2026-07-15T12:03:00.000Z" }, NOW);
  const gatewayCompletion = signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET);
  assert.throws(() => verifyCentralWalletSession({ registryEntry, authorizationRequest: parsed, walletApproval: { ...approval, purpose: "substituted" }, gatewayCompletion }, NOW), WalletAuthError);
  assert.throws(() => verifyCentralWalletSession({ registryEntry, authorizationRequest: parsed, walletApproval: approval, gatewayCompletion, extra: true }, NOW), code("UNKNOWN_OR_MISSING_FIELD"));
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
