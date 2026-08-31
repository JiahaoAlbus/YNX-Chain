import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  canonicalJSON, createProductSessionProofV2, createProductSessionRequest,
  encodeProductSessionGatewayProofHeaderV2, httpBodyDigest, ProductSessionGatewayHttpHandler,
  PRODUCT_SESSION_GATEWAY_HTTP_MAX_BODY_BYTES, PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2,
  signProductSessionApproval, signProductSessionChallenge,
} from "../src/index.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-08-14T01:00:00.000Z");
const secret = Buffer.alloc(32, 19), secretText = secret.toString("base64url");
const deviceKey = Buffer.from(p256.getPublicKey(secret, true)).toString("base64url");
const token = (label) => createHash("sha256").update(label).digest("base64url");
let challengeIndex = 0;
const handler = (snapshot) => new ProductSessionGatewayHttpHandler(registry, () => token(`http-handler-${challengeIndex++}`), snapshot);
const request = () => createProductSessionRequest(registry, { productId: "finance", platform: "web", deviceId: "http-handler-device-001", deviceKey, scopes: ["finance.pay.read", "finance.portfolio.read"], purpose: "Connect the exact Finance Web origin over the v2 HTTP boundary.", nonce: token("http-handler-nonce"), state: token("http-handler-state") }, NOW);
const call = (target, requestId, path, body, proofHeader = null, networkAvailable = true) => target.handle({ requestId, method: "POST", path, contentType: "application/json", body: canonicalJSON(body), proofHeader, networkAvailable }, NOW);

test("HTTP handler completes, introspects and restarts the exact Product Session v2 envelope", () => {
  const target = handler(), pending = request();
  const approval = signProductSessionApproval(registry, pending, { accountSecret: "1".padStart(64, "0"), scopes: pending.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const challengeResponse = call(target, "req_http_challenge_0001", "/v2/product-sessions/challenge", { request: pending, approval });
  assert.equal(challengeResponse.status, 200);
  const challenge = JSON.parse(challengeResponse.body).result;
  const completion = signProductSessionChallenge(challenge, secretText);
  const completeResponse = call(target, "req_http_complete_00001", "/v2/product-sessions/complete", { request: pending, approval, completion });
  const session = JSON.parse(completeResponse.body).result;
  const body = { requiredScopes: ["finance.pay.read"] };
  const proof = createProductSessionProofV2(session, { method: "POST", path: "/v2/product-sessions/introspect", bodyDigest: httpBodyDigest(canonicalJSON(body)), nonce: token("http-proof-1"), issuedAt: NOW.toISOString(), expiresAt: "2026-08-14T01:00:30.000Z" }, secretText);
  assert.equal(call(target, "req_http_introspect_001", "/v2/product-sessions/introspect", body, encodeProductSessionGatewayProofHeaderV2(proof)).status, 200);
  const restarted = handler(target.snapshot());
  const proofAfterRestart = createProductSessionProofV2(session, { method: "POST", path: "/v2/product-sessions/introspect", bodyDigest: httpBodyDigest(canonicalJSON(body)), nonce: token("http-proof-2"), issuedAt: NOW.toISOString(), expiresAt: "2026-08-14T01:00:30.000Z" }, secretText);
  assert.equal(call(restarted, "req_http_restart_000001", "/v2/product-sessions/introspect", body, encodeProductSessionGatewayProofHeaderV2(proofAfterRestart)).status, 200);
  assert.equal(restarted.snapshot().authority.sessions[0].sessionBinding, session.sessionBinding);
});

test("HTTP handler rejects media type, noncanonical/oversized bodies, malformed proof and offline state", () => {
  const target = handler();
  const media = target.handle({ requestId: "req_http_media_type_001", method: "POST", path: "/v2/product-sessions/challenge", contentType: "text/plain", body: "{}", proofHeader: null, networkAvailable: true }, NOW);
  assert.equal(media.status, 415); assert.equal(JSON.parse(media.body).error.code, "UNSUPPORTED_MEDIA_TYPE");
  const noncanonical = target.handle({ requestId: "req_http_body_shape_001", method: "POST", path: "/v2/product-sessions/challenge", contentType: "application/json", body: "{} ", proofHeader: null, networkAvailable: true }, NOW);
  assert.equal(noncanonical.status, 400); assert.equal(JSON.parse(noncanonical.body).error.code, "NON_CANONICAL_BODY");
  const oversized = target.handle({ requestId: "req_http_body_large_001", method: "POST", path: "/v2/product-sessions/challenge", contentType: "application/json", body: "x".repeat(PRODUCT_SESSION_GATEWAY_HTTP_MAX_BODY_BYTES + 1), proofHeader: null, networkAvailable: true }, NOW);
  assert.equal(oversized.status, 413); assert.equal(JSON.parse(oversized.body).error.code, "BODY_TOO_LARGE");
  const malformedProof = target.handle({ requestId: "req_http_proof_bad_0001", method: "POST", path: "/v2/product-sessions/introspect", contentType: "application/json", body: canonicalJSON({ requiredScopes: [] }), proofHeader: "not+base64", networkAvailable: true }, NOW);
  assert.equal(malformedProof.status, 400); assert.equal(JSON.parse(malformedProof.body).error.code, "INVALID_PROOF_HEADER");
  const offline = target.handle({ requestId: "req_http_offline_000001", method: "POST", path: "/v2/product-sessions/challenge", contentType: "application/json", body: "{}", proofHeader: null, networkAvailable: false }, NOW);
  assert.equal(offline.status, 503); assert.equal(JSON.parse(offline.body).error.code, "NETWORK_UNAVAILABLE");
  const invalidId = target.handle({ requestId: "bad", method: "POST", path: "/v2/product-sessions/challenge", contentType: "application/json", body: "{}", proofHeader: null, networkAvailable: true }, NOW);
  assert.equal(invalidId.headers["x-request-id"], "req_invalid_request_000");
});

test("HTTP handler is mountable on a real loopback server without changing protocol bytes", async () => {
  const target = handler();
  const server = createServer(async (incoming, outgoing) => {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
    const result = target.handle({ requestId: incoming.headers["x-request-id"], method: incoming.method, path: new URL(incoming.url, "http://127.0.0.1").pathname, contentType: incoming.headers["content-type"], body: Buffer.concat(chunks).toString("utf8"), proofHeader: incoming.headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2] ?? null, networkAvailable: true }, NOW);
    outgoing.writeHead(result.status, result.headers); outgoing.end(result.body);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const address = server.address(); const pending = request();
    const approval = signProductSessionApproval(registry, pending, { accountSecret: "1".padStart(64, "0"), scopes: pending.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
    const body = canonicalJSON({ request: pending, approval });
    const response = await fetch(`http://127.0.0.1:${address.port}/v2/product-sessions/challenge`, { method: "POST", headers: { "content-type": "application/json", "x-request-id": "req_http_loopback_00001" }, body });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(canonicalJSON(await response.json()), (await call(target, "req_http_loopback_00001", "/v2/product-sessions/challenge", { request: pending, approval })).body);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
