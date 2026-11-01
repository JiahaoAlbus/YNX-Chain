import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCentralWalletSessionActive, centralDeviceBinding, createGatewayChallenge, migrateCentralRegistryEntry,
  parseCentralRegistryEntry, parseCentralWalletSession, parseAuthorizationRequest, signAuthorization, signGatewayChallenge,
  verifyCentralWalletSession, walletIdentity, WalletAuthError,
} from "../src/index.js";
import { ACCOUNT_SECRET, NOW, PRODUCT_DEVICE_SECRET, request } from "./fixtures.mjs";

const REGISTRY_V1 = Object.freeze({
  schemaVersion: 1,
  productClientId: "ynx-social-v1",
  requestingProduct: "social",
  bundleId: "com.ynx.social",
  callback: "ynx-social://com.ynx.social",
  scopes: Object.freeze(["account:read", "profile:link"]),
  maxScopes: 2,
});

test("central registry v1 migrates deterministically to an origin-empty retired schema v3", () => {
  const migrated = migrateCentralRegistryEntry(REGISTRY_V1);
  assert.deepEqual(migrated, {
    schemaVersion: 3,
    productClientId: "ynx-social-v1",
    requestingProduct: "social",
    bundleId: "com.ynx.social",
    callbacks: ["ynx-social://com.ynx.social"],
    scopes: ["account:read", "profile:link"],
    maxScopes: 2,
    productDeviceAlgorithms: ["p256-sha256"],
    origins: [],
  });
  assert.deepEqual(migrateCentralRegistryEntry(migrated), migrated);
});

function originBoundRegistry() { return { ...migrateCentralRegistryEntry(REGISTRY_V1), origins: ["https://social.ynxweb4.com"] }; }

test("central verifier validates origin-bound registry, Wallet approval, and device proof in one fail-closed call", () => {
  const registryEntry = originBoundRegistry();
  const parsed = parseAuthorizationRequest(request(), { now: NOW, registry: { "ynx-social-v1": { requestingProduct: "social", bundleId: "com.ynx.social", origins: registryEntry.origins, callbacks: registryEntry.callbacks, scopes: registryEntry.scopes, maxScopes: 2 } } });
  const approval = signAuthorization(parsed, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(approval, { challenge: "gateway_challenge_abcdefghijklmnop", expiresAt: "2026-07-15T12:03:00.000Z" }, NOW);
  const gatewayCompletion = signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET);
  const session = verifyCentralWalletSession({ registryEntry, authorizationRequest: parsed, walletApproval: approval, gatewayCompletion }, NOW);
  assert.equal(session.verifierVersion, "wallet-auth-v2");
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
  assert.throws(() => migrateCentralRegistryEntry({ ...REGISTRY_V1, callback: "ynx-social://com.ynx.social", extra: true }), code("UNKNOWN_OR_MISSING_FIELD"));
  assert.throws(() => parseCentralRegistryEntry({ ...migrateCentralRegistryEntry(REGISTRY_V1), productDeviceAlgorithms: ["ed25519"] }), code("INVALID_REGISTRY"));
  assert.throws(() => parseCentralRegistryEntry({ ...migrateCentralRegistryEntry(REGISTRY_V1), callbacks: ["ynx-social://com.ynx.social?state=mutable"] }), code("INVALID_REGISTRY"));
  const registryEntry = originBoundRegistry();
  const parsed = parseAuthorizationRequest(request(), { now: NOW, registry: { "ynx-social-v1": { requestingProduct: "social", bundleId: "com.ynx.social", origins: registryEntry.origins, callbacks: registryEntry.callbacks, scopes: registryEntry.scopes, maxScopes: 2 } } });
  const approval = signAuthorization(parsed, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(approval, { challenge: "gateway_challenge_abcdefghijklmnop", expiresAt: "2026-07-15T12:03:00.000Z" }, NOW);
  const gatewayCompletion = signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET);
  assert.throws(() => verifyCentralWalletSession({ registryEntry, authorizationRequest: parsed, walletApproval: { ...approval, purpose: "substituted" }, gatewayCompletion }, NOW), WalletAuthError);
  assert.throws(() => verifyCentralWalletSession({ registryEntry, authorizationRequest: parsed, walletApproval: approval, gatewayCompletion, extra: true }, NOW), code("UNKNOWN_OR_MISSING_FIELD"));
});

test("origin-empty registry migrations and persisted v1 sessions load but retire fail closed", () => {
  const migrated = migrateCentralRegistryEntry(REGISTRY_V1);
  assert.throws(() => parseAuthorizationRequest(request(), { now: NOW, registry: { "ynx-social-v1": { requestingProduct: "social", bundleId: "com.ynx.social", origins: migrated.origins, callbacks: migrated.callbacks, scopes: migrated.scopes, maxScopes: 2 } } }), code("ORIGIN_NOT_ALLOWED"));
  const identity = walletIdentity(ACCOUNT_SECRET);
  const legacy = {
    verifierVersion: "wallet-auth-v1",
    sessionBinding: "11".repeat(32),
    chainId: "ynx_6423-1",
    requestingProduct: "social",
    productClientId: "ynx-social-v1",
    bundleId: "com.ynx.social",
    callback: "ynx-social://com.ynx.social",
    productDeviceAlgorithm: "p256-sha256",
    productDeviceKey: request().productDeviceKey,
    deviceBinding: null,
    account: identity.account,
    accountPublicKey: identity.accountPublicKey,
    scopes: ["account:read", "profile:link"],
    nonce: "legacy_session_nonce_abcdefghijkl",
    purpose: "Recover and retire a pre-origin Product Session.",
    requestDigest: "22".repeat(32),
    approvalDigest: "33".repeat(32),
    issuedAt: "2026-07-15T11:59:00.000Z",
    expiresAt: "2026-07-15T12:04:00.000Z",
  };
  legacy.deviceBinding = centralDeviceBinding(legacy, legacy.account);
  assert.deepEqual(parseCentralWalletSession(legacy), legacy);
  const active = { revokedSessionBindings: [], revokedApprovalDigests: [], revokedDeviceBindings: [], accountLogoutRecords: [] };
  assert.throws(() => assertCentralWalletSessionActive(legacy, active, NOW), code("SESSION_RETIRED"));
  assert.throws(() => parseCentralWalletSession({ ...legacy, accountPublicKey: undefined }), code("INVALID_REGISTRY"));
  assert.throws(() => parseCentralWalletSession({ ...legacy, accountPublicKey: `02${"00".repeat(32)}` }), code("INVALID_SESSION"));
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
