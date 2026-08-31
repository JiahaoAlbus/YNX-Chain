import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  canonicalJSON,
  CanonicalWalletGatewayAdapter,
  CanonicalWalletGatewayHttpKernel,
  createAuthorizationRejection,
  gatewayStateDigest,
  parseAuthorizationRejection,
  parseAuthorizationRequest,
  verifyAuthorizationRejection,
  WalletAuthError,
} from "../src/index.js";
import { NOW, REGISTRY, request } from "./fixtures.mjs";

function approvedRegistry() {
  const value = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));
  const social = value.products.find(product => product.productId === "social");
  social.reviewState = "approved";
  social.enabled = true;
  return value;
}
function fixture() {
  const authorizationRequest = parseAuthorizationRequest(request(), { now: NOW, registry: REGISTRY });
  const walletRejection = createAuthorizationRejection(authorizationRequest, { decisionCode: "USER_REJECTED", rejectedAt: NOW.toISOString() });
  return { authorizationRequest, walletRejection };
}
function code(expected) { return error => error instanceof WalletAuthError && error.code === expected; }

test("canonical Wallet rejection binds the exact request and grants no authority", () => {
  const { authorizationRequest, walletRejection } = fixture();
  assert.deepEqual(parseAuthorizationRejection(canonicalJSON(walletRejection)), walletRejection);
  assert.deepEqual(verifyAuthorizationRejection(walletRejection, authorizationRequest, NOW), walletRejection);
  assert.equal(walletRejection.decision, "rejected");
  assert.equal(walletRejection.authorityGranted, false);
  assert.deepEqual(walletRejection.grantedScopes, []);
  assert.equal(Object.hasOwn(walletRejection, "account"), false);
  assert.equal(Object.hasOwn(walletRejection, "walletSignature"), false);
});

test("rejection tamper, authority injection, unknown fields and invalid time fail closed", () => {
  const { authorizationRequest, walletRejection } = fixture();
  for (const tampered of [
    { ...walletRejection, requestDigest: "0".repeat(64) },
    { ...walletRejection, nonce: "tampered_nonce_abcdefghijklmnopqr" },
    { ...walletRejection, productClientId: "ynx-pay-v1" },
    { ...walletRejection, callback: "ynx-pay://wallet-auth/callback" },
  ]) assert.throws(() => verifyAuthorizationRejection(tampered, authorizationRequest, NOW), code("AUTHORIZATION_REJECTION_MISMATCH"));
  assert.throws(() => parseAuthorizationRejection({ ...walletRejection, authorityGranted: true }), code("AUTHORITY_ON_REJECTION"));
  assert.throws(() => parseAuthorizationRejection({ ...walletRejection, grantedScopes: ["account:read"] }), code("AUTHORITY_ON_REJECTION"));
  assert.throws(() => parseAuthorizationRejection({ ...walletRejection, unknown: true }), code("UNKNOWN_OR_MISSING_FIELD"));
  assert.throws(() => createAuthorizationRejection(authorizationRequest, { decisionCode: "USER_REJECTED", rejectedAt: authorizationRequest.expiresAt }), code("INVALID_REJECTION_TIME"));
  assert.throws(() => createAuthorizationRejection(authorizationRequest, { decisionCode: "POLICY_DENIED", rejectedAt: NOW.toISOString() }), code("INVALID_REJECTION"));
});

test("Gateway returns stable rejection without creating or consuming session state", () => {
  const registry = approvedRegistry();
  const gateway = new CanonicalWalletGatewayAdapter(registry);
  const before = gateway.snapshot();
  assert.throws(() => gateway.rejectAuthorization(fixture(), NOW), code("AUTHORIZATION_REJECTED"));
  assert.deepEqual(gateway.snapshot(), before);
  assert.equal(gateway.snapshot().sessionStore.sessions.length, 0);
  assert.equal(gateway.snapshot().sessionStore.consumedNonces.length, 0);
  assert.equal(gateway.snapshot().consumedProductProofs.length, 0);
});

test("HTTP rejection route is request-atomic and rejects proof or request substitution", () => {
  const registry = approvedRegistry();
  const kernel = new CanonicalWalletGatewayHttpKernel(registry);
  const before = kernel.snapshot();
  const input = fixture();
  const body = canonicalJSON(input);
  const response = kernel.dispatch({ method: "POST", path: "/v1/wallet/authorizations/reject", contentType: "application/json", body, proof: null }, NOW);
  const payload = JSON.parse(response.body);
  assert.equal(response.status, 403);
  assert.equal(response.mutated, false);
  assert.equal(payload.error.code, "AUTHORIZATION_REJECTED");
  assert.equal(payload.stateDigest, gatewayStateDigest(before));
  assert.deepEqual(kernel.snapshot(), before);

  const proofInjected = kernel.dispatch({ method: "POST", path: "/v1/wallet/authorizations/reject", contentType: "application/json", body, proof: {} }, NOW);
  assert.equal(proofInjected.status, 400);
  assert.equal(JSON.parse(proofInjected.body).error.code, "UNEXPECTED_PROOF_HEADER");
  const substituted = { ...input, walletRejection: { ...input.walletRejection, requestDigest: "0".repeat(64) } };
  const mismatch = kernel.dispatch({ method: "POST", path: "/v1/wallet/authorizations/reject", contentType: "application/json", body: canonicalJSON(substituted), proof: null }, NOW);
  assert.equal(mismatch.status, 400);
  assert.equal(JSON.parse(mismatch.body).error.code, "AUTHORIZATION_REJECTION_MISMATCH");
  assert.deepEqual(kernel.snapshot(), before);
});

test("published canonical rejection and negative vector remain deterministic", () => {
  const vector = JSON.parse(readFileSync(new URL("../testdata/authorization-rejection-v1.json", import.meta.url), "utf8"));
  const generated = fixture();
  assert.deepEqual(generated.authorizationRequest, vector.authorizationRequest);
  assert.deepEqual(generated.walletRejection, vector.walletRejection);
  assert.equal(vector.expectedGateway.status, 403);
  assert.equal(vector.expectedGateway.code, "AUTHORIZATION_REJECTED");
  assert.equal(vector.expectedGateway.mutated, false);
  assert.equal(vector.negativeCases.length, 7);
  assert.deepEqual([...new Set(vector.negativeCases.map(item => item.code))].sort(), ["AUTHORITY_ON_REJECTION", "AUTHORIZATION_REJECTION_MISMATCH", "UNEXPECTED_PROOF_HEADER", "UNKNOWN_OR_MISSING_FIELD"]);
});
