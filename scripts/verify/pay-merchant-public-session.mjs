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

const publicBaseURL = (process.env.YNX_PAY_PUBLIC_BASE_URL || "https://rest.ynxweb4.com").replace(/\/$/, "");
const operatorBaseURL = required("YNX_PAY_OPERATOR_BASE_URL").replace(/\/$/, "");
const bootstrapKey = required("YNX_PAY_PRODUCT_BOOTSTRAP_KEY");
const registry = JSON.parse(readFileSync(new URL("../../packages/wallet-auth/central-registry.json", import.meta.url), "utf8"));
const registration = registry.products.find((product) => product.productId === "merchant-console");
assert(registration?.enabled === true && registration.reviewState === "approved", "Merchant Console is not enabled in the canonical registry");

const now = new Date();
const device = createProductDeviceIdentity();
const authorizationRequest = parseAuthorizationRequest({
  version: "1", nonce: nonce(), chainId: "ynx_6423-1", requestingProduct: registration.requestingProduct,
  productClientId: registration.productClientId, bundleId: registration.bundleId, productDeviceAlgorithm: "p256-sha256",
  productDeviceKey: device.productDeviceKey, callback: registration.callbacks[0], scopes: [...registration.scopes],
  purpose: "Verify the public YNX Merchant Console session and bounded API routes.", issuedAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + 3 * 60_000).toISOString(),
}, { now, registry: { [registration.productClientId]: centralProtocolEntry(registration) } });
const walletApproval = signAuthorization(authorizationRequest, { accountSecret: randomBytes(32).toString("hex"), issuedAt: now.toISOString() });
const runID = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const onboard = await request(operatorBaseURL, "POST", "/v1/merchants/onboard", canonicalJSON({
  displayName: `YNX Public Merchant Verification ${runID}`,
  payoutAddress: walletApproval.account,
  ownerAccount: walletApproval.account,
  webhookUrl: "https://httpbingo.org/post",
  idempotencyKey: `merchant-public-${runID}`,
}), { "X-YNX-Bootstrap-Key": bootstrapKey });
assert(onboard.status === 201 && /^mrc_[0-9a-f]{20}$/.test(onboard.payload?.merchant?.id), "operator onboarding did not create a bounded Testnet merchant");
const merchantID = onboard.payload.merchant.id;

const challenge = createGatewayChallenge(walletApproval, { challenge: nonce(), expiresAt: new Date(now.getTime() + 30_000).toISOString() }, now);
const gatewayCompletion = signGatewayChallenge(challenge, device.productDeviceSecret);
const completion = await request(publicBaseURL, "POST", "/v1/wallet/sessions/complete", canonicalJSON({ authorizationRequest, walletApproval, gatewayCompletion }));
assert(completion.status === 200 && completion.payload?.ok === true && completion.payload?.result, "public Merchant Product Session completion failed");
const productSession = completion.payload.result;

const introspectionBody = canonicalJSON({ requiredScopes: ["merchant:session:create"] });
const issuedAt = new Date();
const productProof = encodeGatewayProofHeader(createProductSessionProof(productSession, {
  method: "POST", path: "/v1/wallet/sessions/introspect", bodyDigest: httpBodyDigest(introspectionBody), nonce: nonce(),
  issuedAt: issuedAt.toISOString(), expiresAt: new Date(Math.min(issuedAt.getTime() + 60_000, Date.parse(productSession.expiresAt))).toISOString(),
}, device.productDeviceSecret));
const exchange = await request(publicBaseURL, "POST", "/app/pay-merchant/v1/merchant/sessions", canonicalJSON({ merchantId: merchantID }), { "X-YNX-Product-Session-Proof": productProof });
assert(exchange.status === 201 && exchange.payload?.role === "owner" && exchange.payload?.merchant?.id === merchantID && /^mcs_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(exchange.payload?.token), `public Merchant session exchange failed (${exchange.status}: ${JSON.stringify(exchange.payload)})`);

const authorization = `Bearer ${exchange.payload.token}`;
const state = await request(publicBaseURL, "GET", "/app/pay-merchant/v1/merchant/state", undefined, { Authorization: authorization });
assert(state.status === 200 && state.payload?.merchants?.[merchantID]?.id === merchantID, "public Merchant state did not return the authenticated merchant");
const operatorEscape = await request(publicBaseURL, "POST", "/app/pay-merchant/v1/operator/merchant-data-holds", "{}", { Authorization: authorization });
assert(operatorEscape.status === 404, "operator route escaped the public Merchant allowlist");

console.log(JSON.stringify({
  schemaVersion: 1,
  verification: "public-pay-merchant-session",
  publicBaseURL,
  merchantID,
  account: walletApproval.account,
  completionStatus: completion.status,
  merchantSessionStatus: exchange.status,
  merchantRole: exchange.payload.role,
  merchantStateStatus: state.status,
  operatorEscapeStatus: operatorEscape.status,
  assetMoved: false,
  secretMaterialRecorded: false,
}, null, 2));

async function request(base, method, path, body, extraHeaders = {}) {
  let response;
  let failure;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(base + path, {
        method,
        headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }), ...extraHeaders },
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
function required(name) { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`${name} is required`); return value; }
function assert(condition, message) { if (!condition) throw new Error(message); }
