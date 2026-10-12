#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { p256 } from "@noble/curves/nist.js";
import { canonicalJSON } from "../src/canonical.js";
import { encodeProductSessionGatewayProofHeaderV2 } from "../src/product-session-gateway-client.js";
import { createProductSessionProofV2 } from "../src/product-session-proof-v2.js";
import { createProductSessionRequest, signProductSessionApproval, signProductSessionChallenge } from "../src/product-session-v2.js";
import { httpBodyDigest } from "../src/session-proof.js";

const registry = JSON.parse(readFileSync(fileURLToPath(new URL("../product-session-registry.json", import.meta.url)), "utf8"));

export async function verifyProductSessionV2Lifecycle(options = {}) {
  const endpoint = lifecycleEndpoint(options.endpoint ?? process.env.YNX_PRODUCT_SESSION_V2_LIFECYCLE_URL ?? "https://wallet-auth.ynxweb4.com", options.allowLoopback ?? process.env.YNX_PRODUCT_SESSION_V2_ALLOW_LOOPBACK === "1");
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const fixedNow = options.now === undefined ? null : validDate(options.now);
  const now = fixedNow ?? new Date();
  const timeoutMs = boundedInteger(options.timeoutMs ?? process.env.YNX_PRODUCT_SESSION_V2_LIFECYCLE_TIMEOUT_MS ?? 20_000, 1_000, 60_000, "lifecycle timeout");
  if (typeof fetchImplementation !== "function") fail("FETCH_UNAVAILABLE", "Product Session v2 lifecycle requires fetch");
  const run = randomBytes(12).toString("base64url");
  const secret = randomBytes(32);
  const secretText = secret.toString("base64url");
  const deviceKey = Buffer.from(p256.getPublicKey(secret, true)).toString("base64url");
  const pending = createProductSessionRequest(registry, {
    deviceId: `public-lifecycle-${run}`,
    deviceKey,
    nonce: digestToken(`nonce:${run}`),
    platform: "web",
    productId: "finance",
    purpose: "Verify the deployed Product Session v2 protocol lifecycle without asset authority.",
    scopes: ["finance.pay.read", "finance.portfolio.read"],
    state: digestToken(`state:${run}`),
  }, now);
  const approval = signProductSessionApproval(registry, pending, { accountSecret: "1".padStart(64, "0"), expiresAt: new Date(now.getTime() + 180_000).toISOString(), scopes: pending.scopes }, now);
  const ids = Object.freeze({
    challenge: requestId("challenge", run),
    complete: requestId("complete", run),
    introspect: requestId("introspect", run),
    replay: requestId("replay", run),
    revoke: requestId("revoke", run),
    postRevoke: requestId("postrevoke", run),
  });
  const challengeBody = { approval, request: pending };
  const challengeResponse = await call(endpoint, "/v2/product-sessions/challenge", ids.challenge, challengeBody, null, fetchImplementation, timeoutMs);
  expect(challengeResponse, 200, null, "challenge");
  const challengeRetry = await call(endpoint, "/v2/product-sessions/challenge", ids.challenge, challengeBody, null, fetchImplementation, timeoutMs);
  expect(challengeRetry, 200, null, "challenge response-loss retry");
  if (challengeRetry.body !== challengeResponse.body) fail("IDEMPOTENCY_FAILED", "Product Session challenge retry did not return the exact committed response");
  const challenge = challengeResponse.payload.result;
  const completion = signProductSessionChallenge(challenge, secretText);
  const completeBody = { approval, completion, request: pending };
  const completeResponse = await call(endpoint, "/v2/product-sessions/complete", ids.complete, completeBody, null, fetchImplementation, timeoutMs);
  expect(completeResponse, 200, null, "complete");
  const completeRetry = await call(endpoint, "/v2/product-sessions/complete", ids.complete, completeBody, null, fetchImplementation, timeoutMs);
  expect(completeRetry, 200, null, "complete response-loss retry");
  if (completeRetry.body !== completeResponse.body) fail("IDEMPOTENCY_FAILED", "Product Session completion retry did not return the exact committed response");
  const session = completeResponse.payload.result;
  const introspectionBody = { requiredScopes: ["finance.pay.read"] };
  const introspectionProof = proof(session, "/v2/product-sessions/introspect", introspectionBody, digestToken(`proof-introspect:${run}`), proofTime(session, fixedNow), secretText);
  const introspection = await call(endpoint, "/v2/product-sessions/introspect", ids.introspect, introspectionBody, introspectionProof, fetchImplementation, timeoutMs);
  expect(introspection, 200, null, "introspect");
  if (introspection.payload.result.session.sessionBinding !== session.sessionBinding) fail("SESSION_BINDING_MISMATCH", "Product Session introspection returned another Session");
  const replay = await call(endpoint, "/v2/product-sessions/introspect", ids.replay, introspectionBody, introspectionProof, fetchImplementation, timeoutMs);
  expect(replay, 409, "REPLAY", "proof replay");
  const revokeBody = {};
  const revokeProof = proof(session, "/v2/product-sessions/revoke", revokeBody, digestToken(`proof-revoke:${run}`), proofTime(session, fixedNow), secretText);
  const revoke = await call(endpoint, "/v2/product-sessions/revoke", ids.revoke, revokeBody, revokeProof, fetchImplementation, timeoutMs);
  expect(revoke, 200, null, "revoke");
  const postRevokeProof = proof(session, "/v2/product-sessions/introspect", introspectionBody, digestToken(`proof-post-revoke:${run}`), proofTime(session, fixedNow), secretText);
  const postRevoke = await call(endpoint, "/v2/product-sessions/introspect", ids.postRevoke, introspectionBody, postRevokeProof, fetchImplementation, timeoutMs);
  expect(postRevoke, 403, "SESSION_REVOKED", "post-revoke introspection");
  return Object.freeze({
    account: `${session.account.slice(0, 10)}…${session.account.slice(-6)}`,
    challengeIdempotent: true,
    completeIdempotent: true,
    endpoint: endpoint.origin,
    proofReplayRejected: true,
    requestIds: ids,
    revoked: true,
    schemaVersion: 2,
    sessionBindingSha256: createHash("sha256").update(session.sessionBinding).digest("hex"),
    stateCreatedAndRevoked: true,
    visibleWalletApproval: false,
  });
}

async function call(endpoint, path, requestIdValue, value, proofHeader, fetchImplementation, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { "content-type": "application/json", "x-request-id": requestIdValue };
    if (proofHeader !== null) headers["x-ynx-product-session-proof-v2"] = proofHeader;
    const response = await fetchImplementation(new URL(path, endpoint), { body: canonicalJSON(value), headers, method: "POST", redirect: "error", signal: controller.signal });
    const body = await boundedText(response, 1_048_576);
    let payload;
    try { payload = JSON.parse(body); } catch { fail("INVALID_RESPONSE_JSON", `Product Session ${path} response is not JSON`); }
    if (canonicalJSON(payload) !== body || response.headers.get("cache-control")?.toLowerCase().split(",").map((item) => item.trim()).includes("no-store") !== true || payload.requestId !== requestIdValue || payload.schemaVersion !== 2) fail("INVALID_RESPONSE_ENVELOPE", `Product Session ${path} response is not canonical schema v2`);
    return Object.freeze({ body, payload, status: response.status });
  } catch (error) {
    if (error?.name === "AbortError") fail("LIFECYCLE_TIMEOUT", `Product Session ${path} timed out`);
    throw error;
  } finally { clearTimeout(timer); }
}

async function boundedText(response, maximum) {
  if (!response?.body || typeof response.body.getReader !== "function") fail("INVALID_HTTP_RESPONSE", "Product Session lifecycle received an invalid HTTP response");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) { await reader.cancel(); fail("RESPONSE_TOO_LARGE", "Product Session lifecycle response exceeds policy"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(all);
}

function proof(session, path, body, nonce, at, secretText) { return encodeProductSessionGatewayProofHeaderV2(createProductSessionProofV2(session, { bodyDigest: httpBodyDigest(canonicalJSON(body)), expiresAt: new Date(at.getTime() + 30_000).toISOString(), issuedAt: at.toISOString(), method: "POST", nonce, path }, secretText)); }
function expect(response, status, code, label) { if (response.status !== status || (code !== null && response.payload?.error?.code !== code) || (code === null && response.payload?.ok !== true)) fail("LIFECYCLE_ASSERTION_FAILED", `Product Session ${label} returned an unexpected result`); }
function requestId(label, run) { return `req_psv2_${label}_${run}`; }
function digestToken(value) { return createHash("sha256").update(value).digest("base64url"); }
function boundedInteger(value, minimum, maximum, label) { const parsed = typeof value === "number" ? value : Number(value); if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail("INVALID_CONFIGURATION", `${label} is outside policy`); return parsed; }
function validDate(value) { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("INVALID_TIME", "Product Session lifecycle time is invalid"); return value; }
function proofTime(session, fixedNow) { if (fixedNow) return fixedNow; const issuedAt = Date.parse(session?.issuedAt); if (!Number.isFinite(issuedAt)) fail("INVALID_SESSION_TIME", "Product Session lifecycle received an invalid Session issue time"); return new Date(Math.max(Date.now(), issuedAt)); }
function lifecycleEndpoint(value, allowLoopback) { let parsed; try { parsed = new URL(value); } catch { fail("INVALID_ENDPOINT", "Product Session lifecycle endpoint is invalid"); } const loopback = allowLoopback && parsed.protocol === "http:" && ["127.0.0.1", "::1", "localhost"].includes(parsed.hostname); if ((parsed.protocol !== "https:" && !loopback) || parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) fail("INVALID_ENDPOINT", "Product Session lifecycle requires a canonical HTTPS origin or explicitly allowed loopback"); return parsed; }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  if (process.env.YNX_PRODUCT_SESSION_V2_LIFECYCLE !== "1") {
    process.stderr.write("Set YNX_PRODUCT_SESSION_V2_LIFECYCLE=1 to run the Product Session v2 lifecycle verifier.\n");
    process.exitCode = 2;
  } else {
    verifyProductSessionV2Lifecycle().then(
      (result) => process.stdout.write(`${canonicalJSON({ ok: true, result })}\n`),
      (error) => { process.stderr.write(`${canonicalJSON({ error: { code: typeof error?.code === "string" ? error.code : "LIFECYCLE_FAILED", message: typeof error?.message === "string" ? error.message : "Product Session v2 lifecycle failed" }, ok: false })}\n`); process.exitCode = 1; },
    );
  }
}
