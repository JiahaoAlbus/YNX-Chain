#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  canonicalJSON,
  centralProtocolEntry,
  createGatewayChallenge,
  createProductDeviceIdentity,
  createProductSessionProof,
  httpBodyDigest,
  parseAuthorizationRequest,
  signAuthorization,
  signGatewayChallenge,
  summarizePublicGatewayIdentifierEvidence,
} from "../src/index.js";
import { encodeGatewayProofHeader } from "../src/gateway-node-host.js";

if (process.env.YNX_WALLET_GATEWAY_PUBLIC_PROBE !== "1") {
  throw new Error("YNX_WALLET_GATEWAY_PUBLIC_PROBE=1 is required because this probe creates and immediately revokes a public Testnet Product Session");
}
const baseURL = publicBaseURL(process.env.YNX_WALLET_GATEWAY_PUBLIC_URL);
const registry = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));
const registration = registry.products.find((product) => product.productId === "bridge-web");
assert(registration?.enabled === true && registration.reviewState === "approved", "Bridge Web is not approved and enabled in the canonical registry");

const startedAt = new Date();
const device = createProductDeviceIdentity();
const authorizationRequest = parseAuthorizationRequest({
  version: "1",
  nonce: nonce(),
  chainId: "ynx_6423-1",
  requestingProduct: registration.requestingProduct,
  productClientId: registration.productClientId,
  bundleId: registration.bundleId,
  productDeviceAlgorithm: "p256-sha256",
  productDeviceKey: device.productDeviceKey,
  callback: registration.callbacks[0],
  scopes: [...registration.scopes],
  purpose: "Verify and immediately revoke an isolated public Testnet Gateway Product Session without moving assets.",
  issuedAt: startedAt.toISOString(),
  expiresAt: new Date(startedAt.getTime() + 3 * 60_000).toISOString(),
}, { now: startedAt, registry: { [registration.productClientId]: centralProtocolEntry(registration) } });
const walletApproval = signAuthorization(authorizationRequest, { accountSecret: accountSecret(), issuedAt: startedAt.toISOString() });
const gatewayCompletion = signGatewayChallenge(createGatewayChallenge(walletApproval, {
  challenge: nonce(),
  expiresAt: new Date(startedAt.getTime() + 60_000).toISOString(),
}, startedAt), device.productDeviceSecret);

const completion = await request("/v1/wallet/sessions/complete", canonicalJSON({ authorizationRequest, walletApproval, gatewayCompletion }));
assert(completion.status === 200 && completion.payload?.ok === true && completion.payload?.result, "public Product Session completion failed");
const session = completion.payload.result;
assert(session.account === walletApproval.account, "Gateway substituted the Wallet account");
assert(session.productClientId === registration.productClientId && session.bundleId === registration.bundleId, "Gateway issued a cross-product session");
assert(session.productDeviceKey === device.productDeviceKey, "Gateway substituted the product device");
assert(session.scopes.join("\n") === registration.scopes.join("\n"), "Gateway widened or reordered the reviewed scopes");

const introspectionBody = canonicalJSON({ requiredScopes: [registration.scopes[0]] });
const introspectionProof = proof(session, device.productDeviceSecret, "/v1/wallet/sessions/introspect", introspectionBody);
const introspection = await request("/v1/wallet/sessions/introspect", introspectionBody, introspectionProof);
assert(introspection.status === 200 && introspection.payload?.result?.active === true, "public Product Session introspection was not active");
const replay = await request("/v1/wallet/sessions/introspect", introspectionBody, introspectionProof);
assert(replay.status === 409 && replay.payload?.error?.code === "REPLAY", "public Gateway did not reject the exact proof replay");

const revokeBody = "{}";
const revoke = await request("/v1/wallet/sessions/revoke", revokeBody, proof(session, device.productDeviceSecret, "/v1/wallet/sessions/revoke", revokeBody));
assert(revoke.status === 200 && revoke.payload?.ok === true, "public Product Session revoke failed");
const postRevoke = await request("/v1/wallet/sessions/introspect", introspectionBody, proof(session, device.productDeviceSecret, "/v1/wallet/sessions/introspect", introspectionBody));
assert(postRevoke.status === 403 && postRevoke.payload?.error?.code === "REVOKED", "revoked public Product Session remained active");
const identifierEvidence = summarizePublicGatewayIdentifierEvidence({
  completion: identifiers(completion),
  introspection: identifiers(introspection),
  replay: identifiers(replay),
  revocation: identifiers(revoke),
  postRevocation: identifiers(postRevoke),
});

console.log(JSON.stringify({
  schemaVersion: 1,
  verification: "wallet-auth-public-gateway-lifecycle",
  environment: "public-testnet",
  observedAt: new Date().toISOString(),
  baseURL,
  productClientId: session.productClientId,
  completionStatus: completion.status,
  introspectionStatus: introspection.status,
  activeBeforeRevoke: introspection.payload.result.active,
  replayStatus: replay.status,
  replayCode: replay.payload.error.code,
  revocationStatus: revoke.status,
  postRevocationStatus: postRevoke.status,
  postRevocationCode: postRevoke.payload.error.code,
  finalStateDigest: postRevoke.payload.stateDigest,
  identifierEvidence,
  cacheControlNoStore: [completion, introspection, replay, revoke, postRevoke].every((item) => item.cacheControl === "no-store"),
  assetMoved: false,
  userClaimed: false,
  secretMaterialRecorded: false,
}, null, 2));

function proof(sessionValue, secret, path, body) {
  const issuedAt = new Date();
  return encodeGatewayProofHeader(createProductSessionProof(sessionValue, {
    method: "POST",
    path,
    bodyDigest: httpBodyDigest(body),
    nonce: nonce(),
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(Math.min(issuedAt.getTime() + 30_000, Date.parse(sessionValue.expiresAt))).toISOString(),
  }, secret));
}

async function request(path, body, proofHeader) {
  let response;
  let failure;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      response = await fetch(baseURL + path, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(proofHeader ? { "x-ynx-product-session-proof": proofHeader } : {}),
        },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      break;
    } catch (error) {
      failure = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!response) throw failure;
  const text = await response.text();
  assert(Buffer.byteLength(text, "utf8") <= 1_048_576, "public Gateway response exceeded the local verification bound");
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error("public Gateway response was not JSON"); }
  return {
    cacheControl: response.headers.get("cache-control"),
    payload,
    requestId: response.headers.get("x-request-id"),
    traceId: response.headers.get("x-trace-id"),
    errorId: response.headers.get("x-error-id"),
    status: response.status,
  };
}

function publicBaseURL(value) {
  if (typeof value !== "string" || value.trim() !== value) throw new Error("YNX_WALLET_GATEWAY_PUBLIC_URL is required");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.hostname !== "rest.ynxweb4.com" || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error("YNX_WALLET_GATEWAY_PUBLIC_URL must be exactly https://rest.ynxweb4.com/");
  }
  return "https://rest.ynxweb4.com";
}

function accountSecret() { return randomBytes(32).toString("hex"); }
function nonce() { return randomBytes(24).toString("base64url"); }
function identifiers(value) { return { status: value.status, requestId: value.requestId, traceId: value.traceId, errorId: value.errorId }; }
function assert(condition, message) { if (!condition) throw new Error(message); }
