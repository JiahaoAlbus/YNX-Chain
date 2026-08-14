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

const vector = JSON.parse(readFileSync(new URL("../testdata/session-inventory-http-privacy-matrix-v1.json", import.meta.url), "utf8"));
const SECOND_ACCOUNT_SECRET = `${"00".repeat(31)}02`;

function approvedRegistry(productId) {
  const value = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));
  const registration = value.products.find(product => product.productId === productId);
  assert.ok(registration, `missing ${productId} registration`);
  registration.reviewState = "approved";
  registration.enabled = true;
  return value;
}

function completionFor(registry, productId, accountSecret, nonce, challengeValue) {
  const registration = registry.products.find(product => product.productId === productId);
  const authorizationRequest = parseAuthorizationRequest(request({
    nonce,
    requestingProduct: registration.requestingProduct,
    productClientId: registration.productClientId,
    bundleId: registration.bundleId,
    callback: registration.callbacks[0],
    scopes: [...registration.scopes],
    purpose: productId === "wallet"
      ? "List only this Wallet account's canonical connected applications and sessions."
      : "Use this product session only within the exact registered authorization boundary.",
  }), { now: NOW, registry: { [registration.productClientId]: centralProtocolEntry(registration) } });
  const walletApproval = signAuthorization(authorizationRequest, { accountSecret, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(walletApproval, { challenge: challengeValue, expiresAt: "2026-07-15T12:03:00.000Z" }, NOW);
  return { authorizationRequest, walletApproval, gatewayCompletion: signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET) };
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

function setup(item) {
  const social = item.mutation === "social-without-wallet-scope" || item.mutation === "social-with-wallet-scope";
  const productId = social ? "social" : "wallet";
  const registry = approvedRegistry(productId);
  if (item.mutation === "social-with-wallet-scope") {
    const registration = registry.products.find(product => product.productId === "social");
    registration.scopes = ["wallet:sessions"];
    registration.maxScopes = 1;
  }
  const kernel = new CanonicalWalletGatewayHttpKernel(registry);
  const index = vector.cases.indexOf(item).toString().padStart(2, "0");
  const completion = completionFor(registry, productId, ACCOUNT_SECRET, `inventory_completion_${index}_abcdefghij`, `inventory_challenge_${index}_abcdefghij`);
  const response = kernel.dispatch(httpInput("/v1/wallet/sessions/complete", canonicalJSON(completion), null), NOW);
  assert.equal(response.status, 200, item.id);
  return { kernel, registry, session: kernel.snapshot().sessionStore.sessions[0] };
}

function prepared(item, session, suffix = "first") {
  let bodyValue = structuredClone(vector.body);
  if (item.mutation === "request-body") bodyValue = structuredClone(item.value);
  const body = canonicalJSON(bodyValue);
  const index = vector.cases.indexOf(item).toString().padStart(2, "0");
  const overrides = {};
  if (item.mutation === "proof-path") overrides.path = item.value;
  if (item.mutation === "proof-time") {
    overrides.issuedAt = item.issuedAt;
    overrides.expiresAt = item.expiresAt;
  }
  let signed = productProof(session, vector.route, body, `inventory_${index}_${suffix}_abcdefghijklmn`, overrides);
  if (item.mutation === "proof-device") signed = { ...signed, productDeviceKey: item.value };
  if (item.mutation === "missing-proof") signed = null;
  const requestOverrides = item.mutation === "request-method" ? { method: item.value } : {};
  const at = item.mutation === "dispatch-time" ? new Date(item.value) : NOW;
  return { at, input: httpInput(vector.route, body, signed, requestOverrides) };
}

test("published session inventory HTTP privacy matrix is exact and bounded", () => {
  assert.equal(vector.schemaVersion, 1);
  assert.equal(vector.domain, "YNX_SESSION_INVENTORY_HTTP_PRIVACY_MATRIX_V1");
  assert.equal(vector.cases.length, 12);
  assert.equal(new Set(vector.cases.map(item => item.id)).size, 12);
  assert.deepEqual(vector.requiredAuthority, { scope: "wallet:sessions", productClientId: "ynx-wallet-v1", bundleId: "com.ynxweb4.wallet" });
  assert.deepEqual(vector.failureInvariants, { mutated: false, stateDigestUnchanged: true, inventoryDisclosed: false, productProofsConsumed: 0 });
});

test("session inventory authorization failures disclose nothing and preserve exact state", () => {
  for (const item of vector.cases.filter(value => !["replay-after-success", "cross-account-isolation"].includes(value.mutation))) {
    const { kernel, session } = setup(item);
    const before = structuredClone(kernel.snapshot());
    const { input, at } = prepared(item, session);
    const response = kernel.dispatch(input, at);
    const payload = decoded(response);
    assert.equal(response.status, item.status, item.id);
    assert.equal(response.mutated, false, item.id);
    assert.equal(payload.error.code, item.code, item.id);
    assert.equal(Object.hasOwn(payload, "result"), false, item.id);
    assert.equal(payload.stateDigest, gatewayStateDigest(before), item.id);
    assert.deepEqual(kernel.snapshot(), before, item.id);
  }
});

test("session inventory replay is atomic and account results are isolated", () => {
  const replayItem = vector.cases.find(item => item.mutation === "replay-after-success");
  const { kernel, session } = setup(replayItem);
  const preparedRequest = prepared(replayItem, session);
  const accepted = kernel.dispatch(preparedRequest.input, preparedRequest.at);
  assert.equal(accepted.status, 200);
  const afterAccepted = structuredClone(kernel.snapshot());
  const replay = kernel.dispatch(preparedRequest.input, preparedRequest.at);
  assert.equal(replay.status, replayItem.status);
  assert.equal(decoded(replay).error.code, replayItem.code);
  assert.deepEqual(kernel.snapshot(), afterAccepted);

  const isolationItem = vector.cases.find(item => item.mutation === "cross-account-isolation");
  const registry = approvedRegistry("wallet");
  const isolatedKernel = new CanonicalWalletGatewayHttpKernel(registry);
  for (const [accountSecret, nonce, challenge] of [
    [ACCOUNT_SECRET, "inventory_account_one_abcdefghijkl", "inventory_account_one_challenge_abcd"],
    [SECOND_ACCOUNT_SECRET, "inventory_account_two_abcdefghijkl", "inventory_account_two_challenge_abcd"],
  ]) {
    const completion = completionFor(registry, "wallet", accountSecret, nonce, challenge);
    assert.equal(isolatedKernel.dispatch(httpInput("/v1/wallet/sessions/complete", canonicalJSON(completion), null), NOW).status, 200);
  }
  const sessions = isolatedKernel.snapshot().sessionStore.sessions;
  assert.equal(sessions.length, 2);
  assert.notEqual(sessions[0].account, sessions[1].account);
  for (const [index, accountSession] of sessions.entries()) {
    const body = canonicalJSON({});
    const signed = productProof(accountSession, vector.route, body, `inventory_isolation_${index}_abcdefghijkl`, {});
    const response = isolatedKernel.dispatch(httpInput(vector.route, body, signed), NOW);
    assert.equal(response.status, isolationItem.status);
    const inventory = decoded(response).result;
    assert.equal(inventory.account, accountSession.account);
    assert.equal(inventory.sessions.length, 1);
    assert.equal(inventory.sessions[0].account, undefined);
    assert.equal(inventory.sessions[0].sessionBinding, accountSession.sessionBinding);
    assert.equal(inventory.sessions.some(item => item.sessionBinding === sessions[1 - index].sessionBinding), false);
  }
});
