#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { p256 } from "@noble/curves/nist.js";
import {
  canonicalJSON,
  centralProtocolEntry,
  createGatewayChallenge,
  createProductSessionProof,
  httpBodyDigest,
  parseAuthorizationRequest,
  signAuthorization,
  signGatewayChallenge,
} from "../src/index.js";
import { encodeGatewayProofHeader } from "../src/gateway-node-host.js";

const baseUrl = requiredUrl(process.env.YNX_WALLET_PROTOCOL_BASE_URL);
const phase = process.env.YNX_WALLET_PROTOCOL_PHASE ?? "full";
const statePath = process.env.YNX_WALLET_PROTOCOL_STATE_PATH;
const registryPath = process.env.YNX_WALLET_PROTOCOL_REGISTRY_PATH;
const expectedSource = process.env.YNX_WALLET_PROTOCOL_EXPECT_SOURCE;
const origin = "https://social.ynxweb4.com";
const accountSecret = `${"00".repeat(31)}01`;
const deviceSecretBytes = Buffer.alloc(32, 0x42);
const deviceSecret = deviceSecretBytes.toString("base64url");
const deviceKey = Buffer.from(p256.getPublicKey(deviceSecretBytes, true)).toString("base64url");

if (!registryPath) throw new Error("YNX_WALLET_PROTOCOL_REGISTRY_PATH is required");
if (!new Set(["create", "restart", "full"]).has(phase)) throw new Error("YNX_WALLET_PROTOCOL_PHASE must be create, restart, or full");
if ((phase === "create" || phase === "restart") && !statePath) throw new Error("YNX_WALLET_PROTOCOL_STATE_PATH is required for split-phase verification");

const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const registration = registry.products.find((product) => product.productId === "social");
assert.ok(registration, "Social registry entry is required");
assert.equal(registration.schemaVersion, 4);
assert.equal(registration.reviewState, "approved");
assert.equal(registration.enabled, true);
assert.deepEqual(registration.webOrigins, [origin]);
const registryMap = { [registration.productClientId]: centralProtocolEntry(registration) };

const evidence = {
  schemaVersion: 1,
  baseUrl: baseUrl.toString().replace(/\/$/, ""),
  phase,
  sourceCommit: null,
  checks: [],
};

const version = await jsonRequest("/version");
assert.equal(version.response.status, 200);
assert.equal(version.payload.ok, true);
if (expectedSource) assert.equal(version.payload.build?.sourceCommit, expectedSource);
evidence.sourceCommit = version.payload.build?.sourceCommit ?? null;
record("version", version);

if (phase === "create" || phase === "full") {
  const session = await createAndCheck();
  if (phase === "create") {
    writeFileSync(statePath, canonicalJSON({ schemaVersion: 1, session }), { mode: 0o600 });
  } else {
    await restartAndRevoke(session, false);
  }
}

if (phase === "restart") {
  const stored = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(stored.schemaVersion, 1);
  await restartAndRevoke(stored.session, true);
}

process.stdout.write(`${canonicalJSON(evidence)}\n`);

async function createAndCheck() {
  const healthBefore = await jsonRequest("/health");
  assert.equal(healthBefore.response.status, 200);
  record("health-before", healthBefore);

  const preflight = await rawRequest("/v1/wallet/sessions/complete", {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type, x-ynx-product-session-proof",
    },
  });
  assert.equal(preflight.response.status, 204);
  assert.equal(preflight.response.headers.get("access-control-allow-origin"), origin);
  assert.equal(preflight.response.headers.get("access-control-allow-credentials"), null);
  record("registered-origin-options", preflight);

  const attacker = await rawRequest("/v1/wallet/sessions/complete", {
    method: "OPTIONS",
    headers: {
      origin: "https://attacker.example",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  assert.equal(attacker.response.status, 403);
  assert.equal(attacker.response.headers.get("access-control-allow-origin"), null);
  assert.equal(attacker.payload.error.code, "ORIGIN_NOT_ALLOWED");
  record("unregistered-origin-options", attacker);

  const wrongHeader = await rawRequest("/v1/wallet/sessions/complete", {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization",
    },
  });
  assert.equal(wrongHeader.response.status, 400);
  assert.equal(wrongHeader.payload.error.code, "INVALID_CORS_REQUEST");
  record("wrong-cors-header", wrongHeader);

  const wrongMethod = await rawRequest("/v1/wallet/sessions/complete", { method: "GET", headers: { origin } });
  assert.equal(wrongMethod.response.status, 405);
  assert.equal(wrongMethod.payload.error.code, "METHOD_NOT_ALLOWED");
  record("wrong-method", wrongMethod);

  const wrongRoute = await rawRequest("/v1/wallet/not-registered", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(wrongRoute.response.status, 404);
  assert.equal(wrongRoute.payload.error.code, "ROUTE_NOT_FOUND");
  record("wrong-route", wrongRoute);

  const healthAfterNegatives = await jsonRequest("/health");
  assert.equal(healthAfterNegatives.payload.stateDigest, healthBefore.payload.stateDigest);
  record("negative-zero-mutation", healthAfterNegatives);

  const now = new Date();
  const request = parseAuthorizationRequest({
    version: "2",
    nonce: token(),
    chainId: registry.chainId,
    requestingProduct: registration.requestingProduct,
    productClientId: registration.productClientId,
    bundleId: registration.bundleId,
    productDeviceAlgorithm: "p256-sha256",
    productDeviceKey: deviceKey,
    origin,
    callback: registration.callbacks[0],
    scopes: [...registration.scopes],
    purpose: "Verify the public origin-bound Product Session runtime.",
    issuedAt: new Date(now.getTime() - 5_000).toISOString(),
    expiresAt: new Date(now.getTime() + 240_000).toISOString(),
  }, { now, registry: registryMap });
  const approval = signAuthorization(request, { accountSecret, issuedAt: now.toISOString() });
  const challenge = createGatewayChallenge(approval, {
    challenge: token(),
    expiresAt: new Date(now.getTime() + 180_000).toISOString(),
  }, now);
  const body = canonicalJSON({
    authorizationRequest: request,
    walletApproval: approval,
    gatewayCompletion: signGatewayChallenge(challenge, deviceSecret),
  });
  const completed = await rawRequest("/v1/wallet/sessions/complete", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body,
  });
  assert.equal(completed.response.status, 200, JSON.stringify(completed.payload));
  assert.equal(completed.response.headers.get("access-control-allow-origin"), origin);
  assert.equal(completed.payload.result.origin, origin);
  assert.equal(completed.payload.result.productClientId, registration.productClientId);
  record("complete", completed);

  const introspected = await authenticated("/v1/wallet/sessions/introspect", completed.payload.result, { requiredScopes: ["account:read"] });
  assert.equal(introspected.response.status, 200, JSON.stringify(introspected.payload));
  assert.equal(introspected.payload.result.session.sessionBinding, completed.payload.result.sessionBinding);
  record("introspect-before-restart", introspected);
  return completed.payload.result;
}

async function restartAndRevoke(session, restarted) {
  const introspected = await authenticated("/v1/wallet/sessions/introspect", session, { requiredScopes: ["account:read"] });
  assert.equal(introspected.response.status, 200, JSON.stringify(introspected.payload));
  record(restarted ? "introspect-after-restart" : "introspect-followup", introspected);

  const replayed = await rawRequest("/v1/wallet/sessions/introspect", introspected.request);
  assert.equal(replayed.response.status, 409);
  assert.equal(replayed.payload.error.code, "REPLAY");
  record("replay", replayed);

  const revoked = await authenticated("/v1/wallet/sessions/revoke", session, {});
  assert.equal(revoked.response.status, 200, JSON.stringify(revoked.payload));
  record("revoke", revoked);

  const rejected = await authenticated("/v1/wallet/sessions/introspect", session, { requiredScopes: ["account:read"] });
  assert.equal(rejected.response.status, 403);
  assert.equal(rejected.payload.error.code, "REVOKED");
  record("post-revoke", rejected);
}

async function authenticated(path, session, payload) {
  const body = canonicalJSON(payload);
  const now = new Date();
  const proof = createProductSessionProof(session, {
    method: "POST",
    path,
    bodyDigest: httpBodyDigest(body),
    nonce: token(),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
  }, deviceSecret);
  const request = {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "x-ynx-product-session-proof": encodeGatewayProofHeader(proof),
    },
    body,
  };
  return { ...await rawRequest(path, request), request };
}

async function jsonRequest(path) {
  return rawRequest(path, { method: "GET" });
}

async function rawRequest(path, options) {
  const response = await fetch(new URL(path, baseUrl), options);
  const text = await response.text();
  let payload = null;
  if (text) payload = JSON.parse(text);
  return { response, payload };
}

function record(name, item) {
  evidence.checks.push({
    name,
    status: item.response.status,
    errorCode: item.payload?.error?.code ?? null,
    requestId: item.response.headers.get("x-request-id"),
    traceId: item.response.headers.get("x-trace-id"),
    stateDigest: item.payload?.stateDigest ?? null,
  });
}

function requiredUrl(value) {
  if (!value) throw new Error("YNX_WALLET_PROTOCOL_BASE_URL is required");
  const url = new URL(value);
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("YNX_WALLET_PROTOCOL_BASE_URL is invalid");
  return url;
}

function token() {
  return randomBytes(24).toString("base64url");
}
