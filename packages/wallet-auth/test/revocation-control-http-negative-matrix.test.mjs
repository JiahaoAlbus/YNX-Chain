import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  canonicalJSON,
  CanonicalWalletGatewayHttpKernel,
  centralProtocolEntry,
  createGatewayChallenge,
  createProductSessionProof,
  gatewayStateDigest,
  httpBodyDigest,
  parseAuthorizationRequest,
  signAuthorization,
  signGatewayChallenge,
} from "../src/index.js";
import { ACCOUNT_SECRET, NOW, PRODUCT_DEVICE_SECRET, request } from "./fixtures.mjs";

const vector = JSON.parse(readFileSync(new URL("../testdata/revocation-control-http-negative-matrix-v1.json", import.meta.url), "utf8"));

function approvedRegistry(...productIds) {
  const ids = productIds.length === 0 ? ["social"] : productIds;
  const value = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));
  for (const productId of ids) {
    const registration = value.products.find(product => product.productId === productId);
    assert.ok(registration, `missing ${productId} registration`);
    registration.reviewState = "approved";
    registration.enabled = true;
  }
  return value;
}

function completionFor(registry, productId, nonce, challengeValue) {
  const registration = registry.products.find(product => product.productId === productId);
  const authorizationRequest = parseAuthorizationRequest(request({
    nonce,
    requestingProduct: registration.requestingProduct,
    productClientId: registration.productClientId,
    bundleId: registration.bundleId,
    callback: registration.callbacks[0],
    scopes: [...registration.scopes],
    purpose: productId === "wallet"
      ? "Manage canonical Wallet sessions, device revocation and account logout controls."
      : "Use this product session only within the exact registered authorization boundary.",
  }), { now: NOW, registry: { [registration.productClientId]: centralProtocolEntry(registration) } });
  const walletApproval = signAuthorization(authorizationRequest, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(walletApproval, { challenge: challengeValue, expiresAt: "2026-07-15T12:03:00.000Z" }, NOW);
  return { authorizationRequest, walletApproval, gatewayCompletion: signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET) };
}

function httpInput(path, body, proof, overrides = {}) {
  return { method: "POST", path, contentType: "application/json", body, proof, ...overrides };
}

function proof(session, path, body, nonce, overrides = {}) {
  return createProductSessionProof(session, {
    method: "POST",
    path,
    bodyDigest: httpBodyDigest(body),
    nonce,
    issuedAt: NOW.toISOString(),
    expiresAt: "2026-07-15T12:00:30.000Z",
    ...overrides,
  }, PRODUCT_DEVICE_SECRET);
}

function decoded(response) { return JSON.parse(response.body); }

function setup(item) {
  const operation = vector.operations[item.operation];
  const socialControl = item.mutation === "social-with-wallet-scope";
  const socialNoScope = item.mutation === "social-without-wallet-scope";
  const productId = socialControl || socialNoScope ? "social" : operation.actor;
  const registry = approvedRegistry(productId);
  if (socialControl) {
    const social = registry.products.find(product => product.productId === "social");
    social.scopes = ["wallet:sessions"];
    social.maxScopes = 1;
  }
  const kernel = new CanonicalWalletGatewayHttpKernel(registry);
  const completion = completionFor(
    registry,
    productId,
    `matrix_completion_${vector.cases.indexOf(item).toString().padStart(2, "0")}_abcdefghijkl`,
    `matrix_challenge_${vector.cases.indexOf(item).toString().padStart(2, "0")}_abcdefghijkl`,
  );
  const completed = kernel.dispatch(httpInput("/v1/wallet/sessions/complete", canonicalJSON(completion), null), NOW);
  assert.equal(completed.status, 200, item.id);
  return { kernel, session: kernel.snapshot().sessionStore.sessions[0] };
}

function prepared(item, session, suffix = "a") {
  const operation = vector.operations[item.operation];
  let bodyValue = structuredClone(operation.body);
  if (item.mutation === "request-body") bodyValue = structuredClone(item.value);
  const body = canonicalJSON(bodyValue);
  const index = vector.cases.indexOf(item).toString().padStart(2, "0");
  const proofOverrides = {};
  if (item.mutation === "proof-path") proofOverrides.path = item.value;
  if (item.mutation === "proof-time") {
    proofOverrides.issuedAt = item.issuedAt;
    proofOverrides.expiresAt = item.expiresAt;
  }
  let signed = proof(session, operation.route, body, `control_${index}_${suffix}_abcdefghijklmnopqrst`, proofOverrides);
  if (item.mutation === "proof-device") signed = { ...signed, productDeviceKey: item.value };
  const overrides = item.mutation === "request-method" ? { method: item.value } : {};
  const at = item.mutation === "dispatch-time" ? new Date(item.value) : NOW;
  return { at, input: httpInput(operation.route, body, signed, overrides) };
}

test("published revocation-control HTTP matrix is exact, unique and bounded", () => {
  assert.equal(vector.schemaVersion, 1);
  assert.equal(vector.domain, "YNX_REVOCATION_CONTROL_HTTP_NEGATIVE_MATRIX_V1");
  assert.equal(vector.cases.length, 26);
  assert.equal(new Set(vector.cases.map(item => item.id)).size, 26);
  assert.deepEqual(new Set(vector.cases.map(item => item.operation)), new Set(["approvalRevoke", "deviceRevoke", "allDeviceLogout"]));
  for (const coverage of vector.requiredCoverage) assert.ok(vector.cases.some(item => item.coverage === coverage), coverage);
  assert.deepEqual(vector.invariants, { mutated: false, stateDigestUnchanged: true, revocationsChanged: 0, logoutRecordsChanged: 0, auditEventsChanged: 0, productProofsConsumed: 0 });
});

test("revocation and logout authorization failures preserve exact Gateway state", () => {
  const postSuccess = new Set(["replay-after-success", "fresh-proof-after-success"]);
  for (const item of vector.cases.filter(value => !postSuccess.has(value.mutation))) {
    const { kernel, session } = setup(item);
    const before = structuredClone(kernel.snapshot());
    let preparedRequest;
    assert.doesNotThrow(() => { preparedRequest = prepared(item, session); }, item.id);
    const { input, at } = preparedRequest;
    const response = kernel.dispatch(input, at);
    const payload = decoded(response);
    assert.equal(response.status, item.status, item.id);
    assert.equal(response.mutated, false, item.id);
    assert.equal(payload.error.code, item.code, item.id);
    assert.equal(payload.stateDigest, gatewayStateDigest(before), item.id);
    assert.deepEqual(kernel.snapshot(), before, item.id);
  }
});

test("successful revoke controls reject replay and repeat without additional mutation", () => {
  for (const item of vector.cases.filter(value => ["replay-after-success", "fresh-proof-after-success"].includes(value.mutation))) {
    const { kernel, session } = setup(item);
    const first = prepared(item, session, "first");
    const accepted = kernel.dispatch(first.input, first.at);
    assert.equal(accepted.status, 200, item.id);
    const afterAccepted = structuredClone(kernel.snapshot());
    const repeated = item.mutation === "replay-after-success" ? first : prepared(item, session, "fresh");
    const response = kernel.dispatch(repeated.input, repeated.at);
    assert.equal(response.status, item.status, item.id);
    assert.equal(response.mutated, false, item.id);
    assert.equal(decoded(response).error.code, item.code, item.id);
    assert.equal(decoded(response).stateDigest, gatewayStateDigest(afterAccepted), item.id);
    assert.deepEqual(kernel.snapshot(), afterAccepted, item.id);
  }
});
