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
  const challenge = createGatewayChallenge(walletApproval, { challenge: "gateway_challenge_abcdefghijklmnop", expiresAt: "2026-07-15T12:03:00.000Z" }, NOW);
  return { authorizationRequest, walletApproval, gatewayCompletion: signGatewayChallenge(challenge, PRODUCT_DEVICE_SECRET) };
}

function proof(session, path, body, nonce = "http_kernel_proof_abcdefghijklmnop") {
  return createProductSessionProof(session, {
    method: "POST",
    path,
    bodyDigest: httpBodyDigest(body),
    nonce,
    issuedAt: NOW.toISOString(),
    expiresAt: "2026-07-15T12:00:30.000Z",
  }, PRODUCT_DEVICE_SECRET);
}

function requestInput(path, body, productProof = null, overrides = {}) {
  return { method: "POST", path, contentType: "application/json", body, proof: productProof, ...overrides };
}

function decoded(response) { return JSON.parse(response.body); }

test("HTTP Kernel completes, persists and restarts a canonical Product Session", () => {
  const registry = approvedRegistry();
  const kernel = new CanonicalWalletGatewayHttpKernel(registry);
  const body = canonicalJSON(completion());
  const response = kernel.dispatch(requestInput("/v1/wallet/sessions/complete", body), NOW);
  const payload = decoded(response);
  assert.equal(response.status, 200);
  assert.equal(response.mutated, true);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(payload.ok, true);
  assert.equal(payload.result.productClientId, "ynx-social-v1");
  assert.equal(payload.stateDigest, gatewayStateDigest(kernel.snapshot()));
  assert.equal(kernel.snapshot().sessionStore.sessions.length, 1);

  const restarted = new CanonicalWalletGatewayHttpKernel(registry, kernel.snapshot());
  assert.equal(gatewayStateDigest(restarted.snapshot()), payload.stateDigest);
});

test("proof header binds the exact canonical business body and replay is atomic", () => {
  const kernel = new CanonicalWalletGatewayHttpKernel(approvedRegistry());
  kernel.dispatch(requestInput("/v1/wallet/sessions/complete", canonicalJSON(completion())), NOW);
  const session = kernel.snapshot().sessionStore.sessions[0];
  const path = "/v1/wallet/sessions/introspect";
  const body = canonicalJSON({ requiredScopes: ["account:read"] });
  const signed = proof(session, path, body);
  const accepted = kernel.dispatch(requestInput(path, body, signed), NOW);
  assert.equal(accepted.status, 200);
  assert.equal(decoded(accepted).result.active, true);
  const afterAccepted = gatewayStateDigest(kernel.snapshot());

  const replayed = kernel.dispatch(requestInput(path, body, signed), NOW);
  assert.equal(replayed.status, 409);
  assert.equal(replayed.mutated, false);
  assert.equal(decoded(replayed).error.code, "REPLAY");
  assert.equal(decoded(replayed).stateDigest, afterAccepted);
  assert.equal(gatewayStateDigest(kernel.snapshot()), afterAccepted);

  const alteredBody = canonicalJSON({ requiredScopes: [] });
  const altered = kernel.dispatch(requestInput(path, alteredBody, proof(session, path, body, "http_kernel_altered_abcdefghijkl")), NOW);
  assert.equal(altered.status, 403);
  assert.equal(decoded(altered).error.code, "HTTP_BINDING_MISMATCH");
  assert.equal(gatewayStateDigest(kernel.snapshot()), afterAccepted);
});

test("HTTP Kernel freezes the approved registry against caller mutation and rollback substitution", () => {
  const registry = approvedRegistry();
  const kernel = new CanonicalWalletGatewayHttpKernel(registry);
  const social = registry.products.find(product => product.productId === "social");
  social.reviewState = "rejected";
  social.enabled = false;
  const invalid = kernel.dispatch(requestInput("/v1/wallet/not-registered", "{}"), NOW);
  assert.equal(invalid.status, 404);
  const response = kernel.dispatch(requestInput("/v1/wallet/sessions/complete", canonicalJSON(completion())), NOW);
  assert.equal(response.status, 200);
  assert.equal(decoded(response).result.productClientId, "ynx-social-v1");
});

test("HTTP shape, media type, path, proof placement and canonical JSON fail closed", () => {
  const kernel = new CanonicalWalletGatewayHttpKernel(approvedRegistry());
  const initial = gatewayStateDigest(kernel.snapshot());
  const cases = [
    [requestInput("/v1/wallet/sessions/complete", canonicalJSON(completion()), {}, {}), 400, "UNEXPECTED_PROOF_HEADER"],
    [requestInput("/v1/wallet/sessions/introspect", "{}"), 400, "PROOF_REQUIRED"],
    [requestInput("/v1/wallet/sessions/complete", ` ${canonicalJSON(completion())}`), 400, "NON_CANONICAL_JSON"],
    [requestInput("/v1/wallet/sessions/complete", "{\"a\":1,\"a\":1}"), 400, "NON_CANONICAL_JSON"],
    [requestInput("/v1/wallet/sessions/complete", canonicalJSON(completion()), null, { method: "GET" }), 405, "METHOD_NOT_ALLOWED"],
    [requestInput("/v1/wallet/sessions/complete", canonicalJSON(completion()), null, { contentType: "application/json; charset=utf-8" }), 415, "UNSUPPORTED_MEDIA_TYPE"],
    [requestInput("/v1/wallet/sessions/complete?x=1", canonicalJSON(completion())), 400, "INVALID_PATH"],
    [requestInput("/v1/wallet/not-registered", "{}"), 404, "ROUTE_NOT_FOUND"],
    [{ ...requestInput("/v1/wallet/sessions/complete", canonicalJSON(completion())), extra: true }, 400, "UNKNOWN_OR_MISSING_FIELD"],
  ];
  for (const [input, status, code] of cases) {
    const response = kernel.dispatch(input, NOW);
    assert.equal(response.status, status);
    assert.equal(response.mutated, false);
    assert.equal(decoded(response).error.code, code);
    assert.equal(gatewayStateDigest(kernel.snapshot()), initial);
  }
});

test("HTTP Kernel enforces bounded canonical bodies and never exposes internal exception text", () => {
  const kernel = new CanonicalWalletGatewayHttpKernel(approvedRegistry());
  const oversized = `{"value":"${"a".repeat(1_048_576)}"}`;
  const response = kernel.dispatch(requestInput("/v1/wallet/sessions/complete", oversized), NOW);
  assert.equal(response.status, 400);
  assert.equal(decoded(response).error.code, "INVALID_BODY");
  assert.equal(response.body.includes("stack"), false);
  assert.equal(response.body.includes("/Users/"), false);
});
