import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  canonicalJSON, createProductSessionProofV2, createProductSessionRequest, httpBodyDigest,
  parseProductSessionGatewaySnapshot, ProductSessionGatewayKernel, signProductSessionApproval, signProductSessionChallenge,
} from "../src/index.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-08-14T01:00:00.000Z");
const secret = Buffer.alloc(32, 11), secretText = secret.toString("base64url");
const deviceKey = Buffer.from(p256.getPublicKey(secret, true)).toString("base64url");
const token = (label) => createHash("sha256").update(label).digest("base64url");
let challengeIndex = 0;

function kernel(snapshot) { return new ProductSessionGatewayKernel(registry, () => token(`gateway-${challengeIndex++}`), snapshot); }
function request() { return createProductSessionRequest(registry, { productId: "dex", platform: "web", deviceId: "gateway-device-001", deviceKey, scopes: ["dex:account", "dex:orders", "dex:trade"], purpose: "Connect the exact DEX Web origin and device.", nonce: token("gateway-nonce"), state: token("gateway-state") }, NOW); }
function dispatch(gateway, requestId, path, body, proof = null, networkAvailable = true) { return gateway.dispatch({ requestId, method: "POST", path, body, proof, networkAvailable }, NOW); }

test("App Gateway issues the challenge, completes the session and consumes sender-constrained introspection proofs", () => {
  const gateway = kernel(), pending = request();
  const approval = signProductSessionApproval(registry, pending, { accountSecret: "1".padStart(64, "0"), scopes: pending.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const issued = JSON.parse(dispatch(gateway, "req_gateway_challenge_001", "/v2/product-sessions/challenge", { request: pending, approval }).body).result;
  const completion = signProductSessionChallenge(issued, secretText);
  const completed = dispatch(gateway, "req_gateway_complete_001", "/v2/product-sessions/complete", { request: pending, approval, completion });
  assert.equal(completed.status, 200);
  const session = JSON.parse(completed.body).result;
  const body = { requiredScopes: ["dex:account"] };
  const proof = createProductSessionProofV2(session, { method: "POST", path: "/v2/product-sessions/introspect", bodyDigest: httpBodyDigest(canonicalJSON(body)), nonce: token("proof-nonce"), issuedAt: NOW.toISOString(), expiresAt: "2026-08-14T01:00:30.000Z" }, secretText);
  assert.equal(dispatch(gateway, "req_gateway_introspect_01", "/v2/product-sessions/introspect", body, proof).status, 200);
  assert.equal(dispatch(gateway, "req_gateway_introspect_02", "/v2/product-sessions/introspect", body, proof).status, 409);
  const restarted = kernel(gateway.snapshot());
  assert.equal(restarted.snapshot().authority.sessions[0].sessionBinding, session.sessionBinding);
  assert.equal(restarted.snapshot().consumedProofs.length, 1);
  assert.deepEqual(restarted.snapshot().audit.map((item) => item.requestId), ["req_gateway_challenge_001", "req_gateway_complete_001", "req_gateway_introspect_01", "req_gateway_introspect_02"]);
});

test("App Gateway fails closed on unissued challenges, network loss and request binding substitution", () => {
  const gateway = kernel(), pending = request();
  const approval = signProductSessionApproval(registry, pending, { accountSecret: "1".padStart(64, "0"), scopes: pending.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const other = kernel();
  const issued = JSON.parse(dispatch(other, "req_other_challenge_001", "/v2/product-sessions/challenge", { request: pending, approval }).body).result;
  assert.equal(dispatch(gateway, "req_gateway_unissued_001", "/v2/product-sessions/complete", { request: pending, approval, completion: signProductSessionChallenge(issued, secretText) }).status, 400);
  const offline = dispatch(gateway, "req_gateway_offline_001", "/v2/product-sessions/challenge", { request: pending, approval }, null, false);
  assert.equal(offline.status, 503); assert.equal(JSON.parse(offline.body).error.code, "NETWORK_UNAVAILABLE");
  assert.equal(dispatch(gateway, "req_gateway_unknown_001", "/v2/product-sessions/not-registered", {}, null).status, 404);
});

test("App Gateway rejects malformed audit timestamps without leaking parser exceptions", () => {
  const snapshot = kernel().snapshot();
  const malformed = {
    ...snapshot,
    audit: [{ sequence: 1, requestId: "req_gateway_audit_001", path: "/invalid", outcome: "rejected", code: "INVALID_TIME", subject: "none", at: "not-a-date" }],
  };
  assert.throws(() => parseProductSessionGatewaySnapshot(malformed), (error) => error?.code === "INVALID_GATEWAY_STORE");
});

test("App Gateway sanitizes malformed request paths before persisting its restartable audit", () => {
  const gateway = kernel();
  const rejected = gateway.dispatch({ requestId: "req_gateway_bad_path_01", method: "POST", path: "/bad?callback=javascript:alert", body: {}, proof: null, networkAvailable: true }, NOW);
  assert.equal(rejected.status, 400);
  assert.equal(gateway.snapshot().audit[0].path, "/invalid");
  assert.doesNotThrow(() => kernel(gateway.snapshot()));
});

test("App Gateway preserves a restartable 20,000-event bounded audit after rollover", () => {
  const snapshot = kernel().snapshot();
  const audit = Array.from({ length: 20_000 }, (_, index) => Object.freeze({ sequence: index + 1, requestId: "req_gateway_audit_001", path: "/invalid", outcome: "rejected", code: "NETWORK_UNAVAILABLE", subject: "none", at: NOW.toISOString() }));
  const gateway = kernel({ ...snapshot, audit });
  dispatch(gateway, "req_gateway_rollover_01", "/v2/product-sessions/challenge", {}, null, false);
  const rolled = gateway.snapshot();
  assert.equal(rolled.audit.length, 20_000);
  assert.equal(rolled.audit[0].sequence, 1);
  assert.equal(rolled.audit.at(-1).sequence, 20_000);
  assert.equal(rolled.audit.at(-1).requestId, "req_gateway_rollover_01");
  assert.doesNotThrow(() => kernel(rolled));
});
