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
import { ACCOUNT_SECRET, NOW, PRODUCT_DEVICE_SECRET, REGISTRY, request } from "./fixtures.mjs";

function approvedRegistry(...productIds) {
  const ids = productIds.length === 0 ? ["social"] : productIds;
  const value = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));
  for (const product of value.products) { product.schemaVersion = 4; product.webOrigins = []; }
  for (const productId of ids) {
    const registration = value.products.find(product => product.productId === productId);
    assert.ok(registration, `missing ${productId} registration`);
    registration.reviewState = "approved";
    registration.enabled = true;
    registration.webOrigins = [productId === "social" ? "https://social.ynxweb4.com" : `https://${productId}.ynxweb4.com`];
  }
  return value;
}

function completion() {
  const authorizationRequest = parseAuthorizationRequest(request(), { now: NOW, registry: REGISTRY });
  return completionForRequest(authorizationRequest, "gateway_challenge_abcdefghijklmnop");
}

function walletCompletion(registry) {
  const registration = registry.products.find(product => product.productId === "wallet");
  const authorizationRequest = parseAuthorizationRequest(request({
    nonce: "wallet_nonce_abcdefghijklmnopqrstuvwxyz",
    requestingProduct: registration.requestingProduct,
    productClientId: registration.productClientId,
    bundleId: registration.bundleId,
    origin: registration.webOrigins[0],
    callback: registration.callbacks[0],
    scopes: [...registration.scopes],
    purpose: "Manage canonical Wallet sessions, device revocation and account logout controls.",
  }), { now: NOW, registry: { [registration.productClientId]: centralProtocolEntry(registration) } });
  return completionForRequest(authorizationRequest, "wallet_gateway_challenge_abcdefghijk");
}

function nonWalletControlCompletion(registry) {
  const registration = registry.products.find(product => product.productId === "social");
  registration.scopes = ["wallet:sessions"];
  registration.maxScopes = 1;
  const authorizationRequest = parseAuthorizationRequest(request({
    nonce: "impostor_wallet_scope_abcdefghijklmnop",
    requestingProduct: registration.requestingProduct,
    productClientId: registration.productClientId,
    bundleId: registration.bundleId,
    origin: registration.webOrigins[0],
    callback: registration.callbacks[0],
    scopes: ["wallet:sessions"],
    purpose: "Attempt Wallet control through a non-Wallet product identity.",
  }), { now: NOW, registry: { [registration.productClientId]: centralProtocolEntry(registration) } });
  return completionForRequest(authorizationRequest, "impostor_gateway_challenge_abcdefgh");
}

function completionForRequest(authorizationRequest, challengeValue) {
  const walletApproval = signAuthorization(authorizationRequest, { accountSecret: ACCOUNT_SECRET, issuedAt: NOW.toISOString() });
  const challenge = createGatewayChallenge(walletApproval, { challenge: challengeValue, expiresAt: "2026-07-15T12:03:00.000Z" }, NOW);
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
  return { method: "POST", path, contentType: "application/json", body, proof: productProof, origin: productProof?.origin ?? "https://social.ynxweb4.com", ...overrides };
}

function decoded(response) { return JSON.parse(response.body); }

test("HTTP Kernel completes, persists and restarts a canonical Product Session", () => {
  const registry = approvedRegistry();
  const kernel = new CanonicalWalletGatewayHttpKernel(registry);
  const body = canonicalJSON(completion());
  const wrongOrigin = kernel.dispatch(requestInput("/v1/wallet/sessions/complete", body, null, { origin: "https://attacker.ynx.invalid" }), NOW);
  assert.equal(wrongOrigin.status, 403);
  assert.equal(decoded(wrongOrigin).error.code, "ORIGIN_MISMATCH");
  assert.equal(wrongOrigin.mutated, false);
  assert.equal(kernel.snapshot().sessionStore.sessions.length, 0);
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

test("approval and device revocation are self-scoped, immediate and restart-safe", () => {
  for (const item of [
    { path: "/v1/wallet/approvals/revoke", field: "revokedApprovalDigests", subject: "approvalDigest", nonce: "http_approval_revoke_abcdefghijklmnop" },
    { path: "/v1/wallet/devices/revoke", field: "revokedDeviceBindings", subject: "deviceBinding", nonce: "http_device_revoke_abcdefghijklmnopqr" },
  ]) {
    const registry = approvedRegistry();
    const kernel = new CanonicalWalletGatewayHttpKernel(registry);
    kernel.dispatch(requestInput("/v1/wallet/sessions/complete", canonicalJSON(completion())), NOW);
    const session = kernel.snapshot().sessionStore.sessions[0];
    const body = canonicalJSON({});
    const response = kernel.dispatch(requestInput(item.path, body, proof(session, item.path, body, item.nonce)), NOW);
    assert.equal(response.status, 200);
    assert.equal(decoded(response).result, session[item.subject]);
    assert.deepEqual(kernel.snapshot().sessionStore[item.field], [session[item.subject]]);

    const restarted = new CanonicalWalletGatewayHttpKernel(registry, kernel.snapshot());
    const introspectPath = "/v1/wallet/sessions/introspect";
    const introspectBody = canonicalJSON({ requiredScopes: ["account:read"] });
    const rejected = restarted.dispatch(requestInput(introspectPath, introspectBody, proof(session, introspectPath, introspectBody, `${item.nonce}_post`)), NOW);
    assert.equal(rejected.status, 403);
    assert.equal(decoded(rejected).error.code, "REVOKED");
  }
});

test("Wallet-only session inventory returns connected Apps, approvals, devices and restart-safe status", () => {
  const registry = approvedRegistry("social", "wallet");
  const kernel = new CanonicalWalletGatewayHttpKernel(registry);
  assert.equal(kernel.dispatch(requestInput("/v1/wallet/sessions/complete", canonicalJSON(completion())), NOW).status, 200);
  const walletComplete = walletCompletion(registry);
  assert.equal(kernel.dispatch(requestInput("/v1/wallet/sessions/complete", canonicalJSON(walletComplete), null, { origin: walletComplete.authorizationRequest.origin }), NOW).status, 200);
  const sessions = kernel.snapshot().sessionStore.sessions;
  const social = sessions.find(session => session.productClientId === "ynx-social-v1");
  const wallet = sessions.find(session => session.productClientId === "ynx-wallet-v1");
  assert.ok(social);
  assert.ok(wallet);
  const path = "/v1/wallet/sessions";
  const body = canonicalJSON({});

  const beforeDenied = gatewayStateDigest(kernel.snapshot());
  const denied = kernel.dispatch(requestInput(path, body, proof(social, path, body, "http_inventory_social_denied_abcdefgh")), NOW);
  assert.equal(denied.status, 403);
  assert.equal(decoded(denied).error.code, "SCOPE_NOT_ALLOWED");
  assert.equal(gatewayStateDigest(kernel.snapshot()), beforeDenied);

  const inventoryProof = proof(wallet, path, body, "http_inventory_wallet_abcdefghijklmnop");
  const response = kernel.dispatch(requestInput(path, body, inventoryProof), NOW);
  assert.equal(response.status, 200);
  const inventory = decoded(response).result;
  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.account, wallet.account);
  assert.equal(inventory.connectedApps.length, 2);
  assert.equal(inventory.approvals.length, 2);
  assert.equal(inventory.devices.length, 2);
  assert.equal(inventory.sessions.length, 2);
  assert.equal(inventory.connectedApps.every(item => item.active), true);
  assert.equal(inventory.sessions.every(item => item.active), true);
  const replay = kernel.dispatch(requestInput(path, body, inventoryProof), NOW);
  assert.equal(replay.status, 409);
  assert.equal(decoded(replay).error.code, "REPLAY");

  const revokePath = "/v1/wallet/devices/revoke";
  const revoked = kernel.dispatch(requestInput(revokePath, body, proof(social, revokePath, body, "http_inventory_social_revoke_abcdefgh")), NOW);
  assert.equal(revoked.status, 200);
  const restarted = new CanonicalWalletGatewayHttpKernel(registry, kernel.snapshot());
  const after = restarted.dispatch(requestInput(path, body, proof(wallet, path, body, "http_inventory_wallet_restart_abcdefgh")), NOW);
  assert.equal(after.status, 200);
  const afterInventory = decoded(after).result;
  const socialSession = afterInventory.sessions.find(item => item.productClientId === "ynx-social-v1");
  const walletSession = afterInventory.sessions.find(item => item.productClientId === "ynx-wallet-v1");
  const socialDevice = afterInventory.devices.find(item => item.productClientId === "ynx-social-v1");
  assert.deepEqual(socialSession.inactiveReasons, ["device-revoked"]);
  assert.equal(socialSession.active, false);
  assert.equal(socialDevice.revoked, true);
  assert.equal(walletSession.active, true);
});

test("all-device logout requires a canonical Wallet Product Session and survives restart", () => {
  const registry = approvedRegistry("wallet");
  const kernel = new CanonicalWalletGatewayHttpKernel(registry);
  const walletComplete = walletCompletion(registry);
  const completed = kernel.dispatch(requestInput("/v1/wallet/sessions/complete", canonicalJSON(walletComplete), null, { origin: walletComplete.authorizationRequest.origin }), NOW);
  assert.equal(completed.status, 200);
  const session = kernel.snapshot().sessionStore.sessions[0];
  const path = "/v1/wallet/accounts/logout-all";
  const body = canonicalJSON({});
  const response = kernel.dispatch(requestInput(path, body, proof(session, path, body, "http_logout_all_abcdefghijklmnopqr")), NOW);
  assert.equal(response.status, 200);
  assert.equal(decoded(response).result.account, session.account);
  assert.equal(kernel.snapshot().sessionStore.accountLogoutRecords.length, 1);

  const restarted = new CanonicalWalletGatewayHttpKernel(registry, kernel.snapshot());
  const introspectPath = "/v1/wallet/sessions/introspect";
  const introspectBody = canonicalJSON({ requiredScopes: ["wallet:sessions"] });
  const rejected = restarted.dispatch(requestInput(introspectPath, introspectBody, proof(session, introspectPath, introspectBody, "http_logout_post_abcdefghijklmnopqr")), NOW);
  assert.equal(rejected.status, 403);
  assert.equal(decoded(rejected).error.code, "REVOKED");
});

test("non-Wallet Product Sessions cannot invoke all-device logout", () => {
  const kernel = new CanonicalWalletGatewayHttpKernel(approvedRegistry());
  kernel.dispatch(requestInput("/v1/wallet/sessions/complete", canonicalJSON(completion())), NOW);
  const session = kernel.snapshot().sessionStore.sessions[0];
  const path = "/v1/wallet/accounts/logout-all";
  const body = canonicalJSON({});
  const before = gatewayStateDigest(kernel.snapshot());
  const response = kernel.dispatch(requestInput(path, body, proof(session, path, body, "http_logout_denied_abcdefghijklmnop")), NOW);
  assert.equal(response.status, 403);
  assert.equal(decoded(response).error.code, "SCOPE_NOT_ALLOWED");
  assert.equal(gatewayStateDigest(kernel.snapshot()), before);
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
