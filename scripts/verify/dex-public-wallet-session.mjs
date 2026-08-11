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

const baseURL = (process.env.YNX_DEX_PUBLIC_BASE_URL || "https://dex.ynxweb4.com").replace(/\/$/, "");
const registry = JSON.parse(readFileSync(new URL("../../packages/wallet-auth/central-registry.json", import.meta.url), "utf8"));
const registration = registry.products.find((product) => product.productId === "dex");
assert(registration?.enabled === true && registration.reviewState === "approved", "DEX is not enabled in the canonical registry");

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
  purpose: "Verify the public DEX Wallet session, private positions boundary, replay rejection and revocation without moving assets.",
  issuedAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + 3 * 60_000).toISOString(),
}, { now, registry: { [registration.productClientId]: centralProtocolEntry(registration) } });
const walletApproval = signAuthorization(authorizationRequest, { accountSecret: randomBytes(32).toString("hex"), issuedAt: now.toISOString() });
const challenge = createGatewayChallenge(walletApproval, { challenge: nonce(), expiresAt: new Date(now.getTime() + 30_000).toISOString() }, now);
const gatewayCompletion = signGatewayChallenge(challenge, device.productDeviceSecret);
const completion = await request("POST", "/wallet-gateway/v1/wallet/sessions/complete", canonicalJSON({ authorizationRequest, walletApproval, gatewayCompletion }));
assert(completion.status === 200 && completion.payload?.ok === true && completion.payload?.result, `public DEX Product Session completion failed (${completion.status})`);
const session = completion.payload.result;
assert(session.productClientId === "ynx-dex-web-v1" && session.bundleId === "com.ynxweb4.dex.web", "Gateway issued a cross-product DEX session");
assert(session.scopes.join("\n") === registration.scopes.join("\n"), "Gateway changed the reviewed DEX scopes");

const positionsBody = canonicalJSON({ requiredScopes: ["account:read", "dex:positions:read"] });
const positionsProof = proof(session, device.productDeviceSecret, "/v1/wallet/sessions/introspect", positionsBody);
const positions = await request("GET", "/v1/account/positions", undefined, positionsProof);
assert(positions.status === 200 && Array.isArray(positions.payload?.items) && positions.payload?.account === session.account, `DEX positions did not accept the public Product Session (${positions.status})`);
const replay = await request("GET", "/v1/account/positions", undefined, positionsProof);
assert(replay.status === 403, `consumed DEX Product Session proof replay was not rejected (${replay.status})`);

const revokeBody = "{}";
const revokeProof = proof(session, device.productDeviceSecret, "/v1/wallet/sessions/revoke", revokeBody);
const revoked = await request("POST", "/wallet-gateway/v1/wallet/sessions/revoke", revokeBody, revokeProof);
assert(revoked.status === 200 && revoked.payload?.ok === true, `DEX Product Session revoke failed (${revoked.status})`);
const afterRevokeProof = proof(session, device.productDeviceSecret, "/v1/wallet/sessions/introspect", positionsBody);
const afterRevoke = await request("GET", "/v1/account/positions", undefined, afterRevokeProof);
assert(afterRevoke.status === 403, `revoked DEX session remained active (${afterRevoke.status})`);

console.log(JSON.stringify({
  schemaVersion: 1,
  verification: "public-dex-wallet-session-lifecycle",
  baseURL,
  productClientId: session.productClientId,
  completionStatus: completion.status,
  positionsStatus: positions.status,
  positionCount: positions.payload.items.length,
  replayStatus: replay.status,
  revokeStatus: revoked.status,
  postRevokeStatus: afterRevoke.status,
  assetMoved: false,
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

async function request(method, route, body, proofHeader) {
  let response;
  let failure;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(baseURL + route, {
        method,
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
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

function nonce() { return randomBytes(24).toString("base64url"); }
function assert(condition, message) { if (!condition) throw new Error(message); }
