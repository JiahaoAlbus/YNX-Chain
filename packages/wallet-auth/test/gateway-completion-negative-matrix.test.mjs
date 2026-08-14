import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  canonicalJSON,
  CanonicalWalletGatewayHttpKernel,
  createGatewayChallenge,
  gatewayStateDigest,
  parseAuthorizationRequest,
  signAuthorization,
  signGatewayChallenge,
} from "../src/index.js";
import { ACCOUNT_SECRET, NOW, PRODUCT_DEVICE_SECRET, REGISTRY, request } from "./fixtures.mjs";

const vector = JSON.parse(readFileSync(new URL("../testdata/gateway-completion-negative-matrix-v1.json", import.meta.url), "utf8"));

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
  const challenge = createGatewayChallenge(walletApproval, { challenge: "gateway_matrix_challenge_abcdefgh", expiresAt: "2026-07-15T12:03:00.000Z" }, NOW);
  return { authorizationRequest, walletApproval, gatewayCompletion: signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET) };
}
function dispatch(kernel, value) {
  return kernel.dispatch({ method: "POST", path: vector.route, contentType: "application/json", body: canonicalJSON(value), proof: null }, NOW);
}
function decoded(response) { return JSON.parse(response.body); }
function mutate(value, item) {
  const output = structuredClone(value);
  const keys = item.target.split(".");
  let target = output;
  for (const key of keys.slice(0, -1)) target = target[key];
  const field = keys.at(-1);
  if (item.mutation === "replace") target[field] = item.value;
  else if (item.mutation === "flip-last-byte") {
    if (field === "walletSignature") target[field] = `${target[field].slice(0, -2)}${target[field].endsWith("00") ? "01" : "00"}`;
    else {
      const bytes = Buffer.from(target[field], "base64url");
      bytes[bytes.length - 1] ^= 1;
      target[field] = bytes.toString("base64url");
    }
  } else throw new Error(`unsupported matrix mutation ${item.mutation}`);
  return output;
}

test("published completion negative matrix is exact, unique and bounded", () => {
  assert.equal(vector.schemaVersion, 1);
  assert.equal(vector.domain, "YNX_GATEWAY_COMPLETION_NEGATIVE_MATRIX_V1");
  assert.equal(vector.cases.length, 15);
  assert.equal(new Set(vector.cases.map(item => item.id)).size, 15);
  assert.deepEqual(vector.invariants, { mutated: false, stateDigestUnchanged: true, sessionsCreated: 0, authorizationNoncesConsumed: 0, productProofsConsumed: 0 });
});

test("fourteen completion substitutions fail closed through the real HTTP Kernel without state mutation", () => {
  for (const item of vector.cases.filter(value => value.mutation !== "replay-after-success")) {
    const kernel = new CanonicalWalletGatewayHttpKernel(approvedRegistry());
    const before = kernel.snapshot();
    const response = dispatch(kernel, mutate(completion(), item));
    const payload = decoded(response);
    assert.equal(response.status, item.status, item.id);
    assert.equal(response.mutated, false, item.id);
    assert.equal(payload.error.code, item.code, item.id);
    assert.equal(payload.stateDigest, gatewayStateDigest(before), item.id);
    assert.deepEqual(kernel.snapshot(), before, item.id);
    assert.equal(kernel.snapshot().sessionStore.sessions.length, 0, item.id);
    assert.equal(kernel.snapshot().sessionStore.consumedNonces.length, 0, item.id);
    assert.equal(kernel.snapshot().consumedProductProofs.length, 0, item.id);
  }
});

test("exact completion replay is rejected without any additional mutation", () => {
  const item = vector.cases.find(value => value.mutation === "replay-after-success");
  const kernel = new CanonicalWalletGatewayHttpKernel(approvedRegistry());
  const value = completion();
  const accepted = dispatch(kernel, value);
  assert.equal(accepted.status, 200);
  const afterAccepted = structuredClone(kernel.snapshot());
  const afterDigest = gatewayStateDigest(afterAccepted);
  const replay = dispatch(kernel, value);
  assert.equal(replay.status, item.status);
  assert.equal(replay.mutated, false);
  assert.equal(decoded(replay).error.code, item.code);
  assert.equal(decoded(replay).stateDigest, afterDigest);
  assert.deepEqual(kernel.snapshot(), afterAccepted);
  assert.equal(kernel.snapshot().sessionStore.sessions.length, 1);
  assert.equal(kernel.snapshot().sessionStore.consumedNonces.length, 1);
});
