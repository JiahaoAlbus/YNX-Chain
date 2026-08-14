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
  summarizePublicGatewayMultiUserEvidence,
  verifyCentralWalletSession,
} from "../src/index.js";
import { encodeGatewayProofHeader } from "../src/gateway-node-host.js";

if (process.env.YNX_WALLET_GATEWAY_PUBLIC_MULTI_USER_PROBE !== "1") {
  throw new Error("YNX_WALLET_GATEWAY_PUBLIC_MULTI_USER_PROBE=1 is required because this probe creates and revokes four public Testnet Product Sessions");
}
const baseURL = publicBaseURL(process.env.YNX_WALLET_GATEWAY_PUBLIC_URL);
const intendedUsers = 4;
const registry = JSON.parse(readFileSync(new URL("../central-registry.json", import.meta.url), "utf8"));
const registration = registry.products.find(product => product.productId === "bridge-web");
assert(registration?.enabled === true && registration.reviewState === "approved", "Bridge Web is not approved and enabled in the canonical registry");

const subjects = Array.from({ length: intendedUsers }, () => createSubject());
const failures = [];
let crossSessionRejected = false;
try {
  const completions = await Promise.all(subjects.map(async subject => {
    const started = performance.now();
    let response;
    try { response = await request("/v1/wallet/sessions/complete", canonicalJSON(subject.completion)); }
    catch { return failPhase("COMPLETION_TRANSPORT_FAILED"); }
    subject.completionResponse = response;
    subject.completionLatencyMs = performance.now() - started;
    if (response.status !== 200 || response.payload?.ok !== true || !response.payload?.result) return failPhase("COMPLETION_FAILED");
    subject.session = response.payload.result;
    if (subject.session.account !== subject.account || subject.session.productDeviceKey !== subject.device.productDeviceKey) return failPhase("COMPLETION_SUBSTITUTION");
    if (subject.session.productClientId !== registration.productClientId || subject.session.bundleId !== registration.bundleId) return failPhase("CROSS_APP_SESSION");
    if (subject.session.scopes.join("\n") !== registration.scopes.join("\n")) return failPhase("SCOPE_WIDENING");
    return true;
  }));
  assert(completions.every(Boolean), "not every public Product Session completed canonically");
  assert(new Set(subjects.map(subject => subject.session.account)).size === intendedUsers, "public Gateway did not preserve distinct Wallet accounts");
  assert(new Set(subjects.map(subject => subject.session.sessionBinding)).size === intendedUsers, "public Gateway did not preserve distinct session bindings");

  await Promise.all(subjects.map(async subject => {
    subject.introspectionBody = canonicalJSON({ requiredScopes: [registration.scopes[0]] });
    subject.introspectionProof = proof(subject, "/v1/wallet/sessions/introspect", subject.introspectionBody);
    try { subject.introspectionResponse = await request("/v1/wallet/sessions/introspect", subject.introspectionBody, subject.introspectionProof); }
    catch { return failPhase("INTROSPECTION_TRANSPORT_FAILED"); }
    if (subject.introspectionResponse.status !== 200 || subject.introspectionResponse.payload?.result?.active !== true) failPhase("INTROSPECTION_FAILED");
  }));
  assert(failures.length === 0, "not every public Product Session introspected active");

  const firstProof = subjects[0].introspectionProof.object;
  const crossProof = encodeGatewayProofHeader({ ...firstProof, sessionBinding: subjects[1].session.sessionBinding });
  const crossResponse = await request("/v1/wallet/sessions/introspect", subjects[0].introspectionBody, { header: crossProof });
  crossSessionRejected = crossResponse.status === 403 && crossResponse.payload?.error?.code === "SESSION_BINDING_MISMATCH";
  assert(crossSessionRejected, "public Gateway did not reject cross-session proof substitution");

  await Promise.all(subjects.map(async subject => {
    try { subject.replayResponse = await request("/v1/wallet/sessions/introspect", subject.introspectionBody, subject.introspectionProof); }
    catch { return failPhase("REPLAY_TRANSPORT_FAILED"); }
    if (subject.replayResponse.status !== 409 || subject.replayResponse.payload?.error?.code !== "REPLAY") failPhase("REPLAY_NOT_REJECTED");
  }));
  assert(failures.length === 0, "not every exact public proof replay was rejected");

  await Promise.all(subjects.map(async subject => {
    const body = "{}";
    try { subject.revocationResponse = await request("/v1/wallet/sessions/revoke", body, proof(subject, "/v1/wallet/sessions/revoke", body)); }
    catch { return failPhase("REVOCATION_TRANSPORT_FAILED"); }
    if (subject.revocationResponse.status === 200 && subject.revocationResponse.payload?.ok === true) subject.revoked = true;
    else failPhase("REVOCATION_FAILED");
  }));
  assert(failures.length === 0, "not every public Product Session was revoked");

  await Promise.all(subjects.map(async subject => {
    try { subject.postRevocationResponse = await request("/v1/wallet/sessions/introspect", subject.introspectionBody, proof(subject, "/v1/wallet/sessions/introspect", subject.introspectionBody)); }
    catch { return failPhase("POST_REVOKE_TRANSPORT_FAILED"); }
    if (subject.postRevocationResponse.status !== 403 || subject.postRevocationResponse.payload?.error?.code !== "REVOKED") failPhase("POST_REVOKE_NOT_REJECTED");
  }));
  assert(failures.length === 0, "not every revoked public Product Session failed closed");
} finally {
  await Promise.all(subjects.filter(subject => !subject.revoked).map(async subject => {
    try {
      const body = "{}";
      const response = await request("/v1/wallet/sessions/revoke", body, proof(subject, "/v1/wallet/sessions/revoke", body));
      subject.revoked = response.status === 200
        || (response.status === 409 && response.payload?.error?.code === "ALREADY_REVOKED")
        || (response.status === 404 && response.payload?.error?.code === "SESSION_NOT_FOUND");
      if (!subject.revoked) failPhase("CLEANUP_FAILED");
    } catch { failPhase("CLEANUP_FAILED"); }
  }));
}

const completed = count(subject => subject.completionResponse?.status === 200 && subject.session);
const distinctAccounts = new Set(subjects.filter(subject => subject.session).map(subject => subject.session.account)).size;
const introspectedActive = count(subject => subject.introspectionResponse?.status === 200 && subject.introspectionResponse.payload?.result?.active === true);
const replayRejected = count(subject => subject.replayResponse?.status === 409 && subject.replayResponse.payload?.error?.code === "REPLAY");
const revoked = count(subject => subject.revoked === true);
const postRevokeRejected = count(subject => subject.postRevocationResponse?.status === 403 && subject.postRevocationResponse.payload?.error?.code === "REVOKED");
const summary = summarizePublicGatewayMultiUserEvidence({
  environment: "public-testnet", intendedUsers, completed, distinctAccounts, introspectedActive, replayRejected,
  crossSessionRejected, revoked, postRevokeRejected, cleanupComplete: revoked === intendedUsers, failures: [...new Set(failures)].sort(),
});
assert(summary.boundedSamplePassed, "public Gateway multi-user bounded sample did not pass");
const identifierSummaries = subjects.map(subject => summarizePublicGatewayIdentifierEvidence({
  completion: identifiers(subject.completionResponse), introspection: identifiers(subject.introspectionResponse), replay: identifiers(subject.replayResponse),
  revocation: identifiers(subject.revocationResponse), postRevocation: identifiers(subject.postRevocationResponse),
}));
const latencies = subjects.map(subject => subject.completionLatencyMs).sort((left, right) => left - right);
console.log(JSON.stringify({
  schemaVersion: 1,
  verification: "wallet-auth-public-gateway-multi-user-bounded",
  observedAt: new Date().toISOString(),
  baseURL,
  productClientId: registration.productClientId,
  summary,
  completionLatencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), max: decimal(latencies.at(-1)) },
  identifierEvidence: {
    requestIdCompleteness: identifierSummaries.every(value => value.requestIdCompleteness),
    traceIdCompleteness: identifierSummaries.every(value => value.traceIdCompleteness),
    errorIdCompleteness: identifierSummaries.every(value => value.errorIdCompleteness),
    allRequiredIdentifiersComplete: identifierSummaries.every(value => value.allRequiredIdentifiersComplete),
    identifierValuesRecorded: false,
  },
  exclusions: ["production capacity", "external load-balancer capacity", "multi-region recovery", "existing users", "provider traffic", "asset movement"],
}, null, 2));

function createSubject() {
  const startedAt = new Date();
  const device = createProductDeviceIdentity();
  const authorizationRequest = parseAuthorizationRequest({
    version: "1", nonce: nonce(), chainId: "ynx_6423-1", requestingProduct: registration.requestingProduct,
    productClientId: registration.productClientId, bundleId: registration.bundleId, productDeviceAlgorithm: "p256-sha256",
    productDeviceKey: device.productDeviceKey, callback: registration.callbacks[0], scopes: [...registration.scopes],
    purpose: "Verify an isolated bounded-concurrency public Testnet Gateway Product Session and immediately revoke it.",
    issuedAt: startedAt.toISOString(), expiresAt: new Date(startedAt.getTime() + 3 * 60_000).toISOString(),
  }, { now: startedAt, registry: { [registration.productClientId]: centralProtocolEntry(registration) } });
  const walletApproval = signAuthorization(authorizationRequest, { accountSecret: randomBytes(32).toString("hex"), issuedAt: startedAt.toISOString() });
  const gatewayCompletion = signGatewayChallenge(createGatewayChallenge(walletApproval, { challenge: nonce(), expiresAt: new Date(startedAt.getTime() + 60_000).toISOString() }, startedAt), device.productDeviceSecret);
  const completion = { authorizationRequest, walletApproval, gatewayCompletion };
  const verifierInput = { registryEntry: centralProtocolEntry(registration), ...completion };
  return { account: walletApproval.account, completion, device, session: verifyCentralWalletSession(verifierInput, startedAt), revoked: false };
}

function proof(subject, path, body) {
  const issuedAt = new Date();
  const object = createProductSessionProof(subject.session, { method: "POST", path, bodyDigest: httpBodyDigest(body), nonce: nonce(), issuedAt: issuedAt.toISOString(), expiresAt: new Date(Math.min(issuedAt.getTime() + 30_000, Date.parse(subject.session.expiresAt))).toISOString() }, subject.device.productDeviceSecret);
  return { object, header: encodeGatewayProofHeader(object) };
}

async function request(path, body, proofValue) {
  const response = await fetch(baseURL + path, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", ...(proofValue ? { "x-ynx-product-session-proof": proofValue.header } : {}) }, body, signal: AbortSignal.timeout(60_000) });
  const text = await response.text();
  assert(Buffer.byteLength(text, "utf8") <= 1_048_576, "public Gateway response exceeded the verification bound");
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error("public Gateway response was not JSON"); }
  return { status: response.status, payload, requestId: response.headers.get("x-request-id"), traceId: response.headers.get("x-trace-id"), errorId: response.headers.get("x-error-id") };
}

function publicBaseURL(value) {
  if (typeof value !== "string" || value.trim() !== value) throw new Error("YNX_WALLET_GATEWAY_PUBLIC_URL is required");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.hostname !== "rest.ynxweb4.com" || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) throw new Error("YNX_WALLET_GATEWAY_PUBLIC_URL must be exactly https://rest.ynxweb4.com/");
  return "https://rest.ynxweb4.com";
}
function identifiers(value) { return { status: value.status, requestId: value.requestId, traceId: value.traceId, errorId: value.errorId }; }
function count(predicate) { return subjects.filter(predicate).length; }
function failPhase(code) { failures.push(code); return false; }
function nonce() { return randomBytes(24).toString("base64url"); }
function decimal(value) { return Number(value.toFixed(3)); }
function percentile(values, fraction) { return decimal(values[Math.ceil(values.length * fraction) - 1]); }
function assert(condition, message) { if (!condition) throw new Error(message); }
