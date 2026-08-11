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
} from "../../packages/wallet-auth/src/index.js";
import { encodeGatewayProofHeader } from "../../packages/wallet-auth/src/gateway-node-host.js";

const baseURL = (process.env.YNX_PAY_PUBLIC_BASE_URL || "https://rest.ynxweb4.com").replace(/\/$/, "");
const registry = JSON.parse(readFileSync(new URL("../../packages/wallet-auth/central-registry.json", import.meta.url), "utf8"));
const registration = registry.products.find((product) => product.productId === "pay");
assert(registration?.enabled === true && registration.reviewState === "approved", "Pay is not enabled in the canonical registry");

const now = new Date();
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
  purpose: "Verify the public YNX Pay Product Session boundary without transferring assets.",
  issuedAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + 3 * 60_000).toISOString(),
}, { now, registry: { [registration.productClientId]: centralProtocolEntry(registration) } });
const walletApproval = signAuthorization(authorizationRequest, { accountSecret: accountSecret(), issuedAt: now.toISOString() });
const challenge = createGatewayChallenge(walletApproval, {
  challenge: nonce(),
  expiresAt: new Date(now.getTime() + 30_000).toISOString(),
}, now);
const gatewayCompletion = signGatewayChallenge(challenge, device.productDeviceSecret);
const completion = await request("POST", "/v1/wallet/sessions/complete", canonicalJSON({ authorizationRequest, walletApproval, gatewayCompletion }));
assert(completion.status === 200 && completion.payload?.ok === true && completion.payload?.result, "public Pay Product Session completion failed");
const session = completion.payload.result;
assert(session.productClientId === "ynx-pay-v1" && session.bundleId === "com.ynxweb4.pay", "Gateway issued a cross-product session");
assert(session.scopes.join("\n") === registration.scopes.join("\n"), "Gateway changed the reviewed Pay scopes");

const refundBody = canonicalJSON({
  amount: 1,
  reason: "Public canonical Product Session routing verification",
  idempotencyKey: `public-session-${nonce()}`,
});
const refundPath = "/app/pay-product/v1/invoices/inv_aaaaaaaaaaaaaaaaaaaa/refund-requests";
const refundProof = proof(session, device.productDeviceSecret, "pay:case:create", "/v1/wallet/sessions/introspect", canonicalJSON({ requiredScopes: ["pay:case:create"] }));
const routed = await request("POST", refundPath, refundBody, refundProof);
assert(routed.status !== 401 && routed.status !== 403, `valid Pay Product Session did not cross the public App Gateway (${routed.status})`);
assert(routed.status >= 400 && routed.status < 500, "nonexistent proof invoice unexpectedly mutated Pay state");

const replay = await request("POST", refundPath, refundBody, refundProof);
assert(replay.status === 401, `consumed Product Session proof replay was not rejected (${replay.status})`);

const revokeBody = "{}";
const revokeProof = proof(session, device.productDeviceSecret, null, "/v1/wallet/sessions/revoke", revokeBody);
const revoked = await request("POST", "/v1/wallet/sessions/revoke", revokeBody, revokeProof);
assert(revoked.status === 200 && revoked.payload?.ok === true, "Pay Product Session revoke failed");

const introspectionBody = canonicalJSON({ requiredScopes: ["pay:case:create"] });
const afterRevokeProof = proof(session, device.productDeviceSecret, "pay:case:create", "/v1/wallet/sessions/introspect", introspectionBody);
const afterRevoke = await request("POST", "/v1/wallet/sessions/introspect", introspectionBody, afterRevokeProof);
assert(afterRevoke.status === 403 && afterRevoke.payload?.error?.code === "REVOKED", "revoked Pay session remained active");

console.log(JSON.stringify({
  schemaVersion: 1,
  verification: "public-pay-product-session-routing",
  baseURL,
  productClientId: session.productClientId,
  completionStatus: completion.status,
  routedMutationStatus: routed.status,
  routedMutationResult: routed.payload?.error || "bounded-product-rejection",
  replayStatus: replay.status,
  revokeStatus: revoked.status,
  postRevokeStatus: afterRevoke.status,
  postRevokeError: afterRevoke.payload.error.code,
  assetMoved: false,
  secretMaterialRecorded: false,
}, null, 2));

function proof(sessionValue, secret, scope, path, body) {
  const issuedAt = new Date();
  const input = {
    method: "POST",
    path,
    bodyDigest: httpBodyDigest(body),
    nonce: nonce(),
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(Math.min(issuedAt.getTime() + 30_000, Date.parse(sessionValue.expiresAt))).toISOString(),
  };
  if (scope && !sessionValue.scopes.includes(scope)) throw new Error(`session does not grant ${scope}`);
  return encodeGatewayProofHeader(createProductSessionProof(sessionValue, input, secret));
}

async function request(method, path, body, proofHeader) {
  let response;
  let failure;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(baseURL + path, {
        method,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(proofHeader ? { "x-ynx-product-session-proof": proofHeader } : {}),
        },
        body,
        signal: AbortSignal.timeout(65_000),
      });
      break;
    } catch (error) {
      failure = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  if (!response) throw failure;
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 200) }; }
  return { status: response.status, payload };
}

function accountSecret() {
  return randomBytes(32).toString("hex");
}

function nonce() { return randomBytes(24).toString("base64url"); }
function assert(condition, message) { if (!condition) throw new Error(message); }
