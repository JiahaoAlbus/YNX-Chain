import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  canonicalJSON,
  CanonicalWalletGatewayHttpKernel,
  createGatewayChallenge,
  createProductSessionProof,
  gatewayStateDigest,
  httpBodyDigest,
  parseAuthorizationRequest,
  signAuthorization,
  signGatewayChallenge,
} from "../src/index.js";
import { ACCOUNT_SECRET, NOW, PRODUCT_DEVICE_SECRET, REGISTRY, request } from "./fixtures.mjs";

const vector = JSON.parse(readFileSync(new URL("../testdata/product-session-http-negative-matrix-v1.json", import.meta.url), "utf8"));

function approvedRegistry() {
  const value = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));
  const social = value.products.find(product => product.productId === "social");
  social.reviewState = "approved";
  social.enabled = true;
  return value;
}

function completion() {
  const authorizationRequest = parseAuthorizationRequest(request(), { now: NOW, registry: REGISTRY });
  const walletApproval = signAuthorization(authorizationRequest, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(walletApproval, { challenge: "http_negative_matrix_challenge_abcd", expiresAt: "2026-07-15T12:03:00.000Z" }, NOW);
  return { authorizationRequest, walletApproval, gatewayCompletion: signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET) };
}

function setup() {
  const kernel = new CanonicalWalletGatewayHttpKernel(approvedRegistry());
  const response = kernel.dispatch(httpInput("/v1/wallet/sessions/complete", canonicalJSON(completion()), null), NOW);
  assert.equal(response.status, 200);
  return { kernel, session: kernel.snapshot().sessionStore.sessions[0] };
}

function httpInput(path, body, proof, overrides = {}) {
  return { method: "POST", path, contentType: "application/json", body, proof, ...overrides };
}

function productProof(session, path, body, nonce, overrides = {}) {
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

function prepared(item, session) {
  const operation = vector.operations[item.operation];
  let bodyValue = structuredClone(operation.body);
  if (item.mutation === "request-body") bodyValue = structuredClone(item.value);
  const body = canonicalJSON(bodyValue);
  const nonce = `matrix_${vector.cases.indexOf(item).toString().padStart(2, "0")}_abcdefghijklmnopqrstuv`;
  const proofOverrides = {};
  if (item.mutation === "proof-path") proofOverrides.path = item.value;
  if (item.mutation === "proof-body") proofOverrides.bodyDigest = httpBodyDigest(canonicalJSON(item.value));
  if (item.mutation === "proof-time") {
    proofOverrides.issuedAt = item.issuedAt;
    proofOverrides.expiresAt = item.expiresAt;
  }
  let proof = productProof(session, operation.route, body, nonce, proofOverrides);
  if (item.mutation === "proof-device") proof = { ...proof, productDeviceKey: item.value };
  const overrides = item.mutation === "request-method" ? { method: item.value } : {};
  const at = item.mutation === "dispatch-time" ? new Date(item.value) : NOW;
  return { at, input: httpInput(operation.route, body, proof, overrides) };
}

test("published Product Session HTTP negative matrix is exact, unique and covers both operations", () => {
  assert.equal(vector.schemaVersion, 1);
  assert.equal(vector.domain, "YNX_PRODUCT_SESSION_HTTP_NEGATIVE_MATRIX_V1");
  assert.equal(vector.cases.length, 16);
  assert.equal(new Set(vector.cases.map(item => item.id)).size, 16);
  assert.deepEqual(new Set(vector.cases.map(item => item.operation)), new Set(["introspect", "revoke"]));
  for (const coverage of vector.requiredCoverage) assert.ok(vector.cases.some(item => item.coverage === coverage), coverage);
  assert.deepEqual(vector.invariants, { mutated: false, stateDigestUnchanged: true, sessionsChanged: 0, revocationsChanged: 0, productProofsConsumed: 0 });
});

test("introspection and revoke failures preserve the exact pre-request Gateway state", () => {
  for (const item of vector.cases.filter(value => value.mutation !== "replay-after-success")) {
    const { kernel, session } = setup();
    const before = structuredClone(kernel.snapshot());
    const { input, at } = prepared(item, session);
    const response = kernel.dispatch(input, at);
    const payload = decoded(response);
    assert.equal(response.status, item.status, item.id);
    assert.equal(response.mutated, false, item.id);
    assert.equal(payload.error.code, item.code, item.id);
    assert.equal(payload.stateDigest, gatewayStateDigest(before), item.id);
    assert.deepEqual(kernel.snapshot(), before, item.id);
    assert.equal(kernel.snapshot().sessionStore.sessions.length, before.sessionStore.sessions.length, item.id);
    assert.equal(kernel.snapshot().sessionStore.revokedSessionBindings.length, before.sessionStore.revokedSessionBindings.length, item.id);
    assert.equal(kernel.snapshot().consumedProductProofs.length, before.consumedProductProofs.length, item.id);
  }
});

test("exact introspection and revoke proof replay causes zero additional mutation", () => {
  for (const item of vector.cases.filter(value => value.mutation === "replay-after-success")) {
    const { kernel, session } = setup();
    const { input, at } = prepared(item, session);
    const accepted = kernel.dispatch(input, at);
    assert.equal(accepted.status, 200, item.id);
    const afterAccepted = structuredClone(kernel.snapshot());
    const replay = kernel.dispatch(input, at);
    assert.equal(replay.status, item.status, item.id);
    assert.equal(replay.mutated, false, item.id);
    assert.equal(decoded(replay).error.code, item.code, item.id);
    assert.equal(decoded(replay).stateDigest, gatewayStateDigest(afterAccepted), item.id);
    assert.deepEqual(kernel.snapshot(), afterAccepted, item.id);
  }
});
