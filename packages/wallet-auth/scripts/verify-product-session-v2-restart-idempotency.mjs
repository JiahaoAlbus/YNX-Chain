#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { p256 } from "@noble/curves/nist.js";
import { canonicalJSON } from "../src/canonical.js";
import { encodeProductSessionGatewayProofHeaderV2 } from "../src/product-session-gateway-client.js";
import { createProductSessionProofV2 } from "../src/product-session-proof-v2.js";
import { createProductSessionRequest, signProductSessionApproval, signProductSessionChallenge } from "../src/product-session-v2.js";
import { httpBodyDigest } from "../src/session-proof.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));

export async function prepareRestartIdempotency(options) {
  const endpoint = endpointValue(options.endpoint, options.allowLoopback);
  const run = randomBytes(12).toString("base64url"), secret = randomBytes(32), secretText = secret.toString("base64url"), now = new Date();
  const request = createProductSessionRequest(registry, { deviceId: `restart-idempotency-${run}`, deviceKey: Buffer.from(p256.getPublicKey(secret, true)).toString("base64url"), nonce: token(`${run}:nonce`), platform: "web", productId: "finance", purpose: "Verify exact completion response recovery across a controlled Gateway restart.", scopes: ["finance.pay.read"], state: token(`${run}:state`) }, now);
  const approval = signProductSessionApproval(registry, request, { accountSecret: "1".padStart(64, "0"), expiresAt: new Date(now.getTime() + 240_000).toISOString(), scopes: request.scopes }, now);
  const challenge = await accepted(endpoint, "/v2/product-sessions/challenge", `req_psv2_restart_challenge_${run}`, { approval, request }, null, options.fetchImplementation);
  const completionBody = { approval, completion: signProductSessionChallenge(challenge.result, secretText), request };
  const completionRequestId = `req_psv2_restart_complete_${run}`;
  const completion = await call(endpoint, "/v2/product-sessions/complete", completionRequestId, completionBody, null, options.fetchImplementation);
  expect(completion, 200, null, "completion prepare");
  writeRecord(options.recordPath, { completionBody, completionRequestId, completionResponseBody: completion.text, endpoint: endpoint.origin, secretText, session: completion.payload.result });
  return Object.freeze({ completionRequestId, completionResponseBytes: Buffer.byteLength(completion.text), completionResponseSha256: sha256(completion.text), recordContainsSecret: true, recordMode: "0600", sessionBindingSha256: sha256(completion.payload.result.sessionBinding) });
}

export async function verifyRestartIdempotency(options) {
  const record = readRecord(options.recordPath), endpoint = endpointValue(options.endpoint ?? record.endpoint, options.allowLoopback);
  const retry = await call(endpoint, "/v2/product-sessions/complete", record.completionRequestId, record.completionBody, null, options.fetchImplementation);
  expect(retry, 200, null, "completion retry");
  if (retry.text !== record.completionResponseBody) fail("IDEMPOTENCY_FAILED", "Completion response changed across restart");
  const body = {}, revokeRequestId = `req_psv2_restart_cleanup_${randomBytes(9).toString("base64url")}`;
  const revoked = await call(endpoint, "/v2/product-sessions/revoke", revokeRequestId, body, senderProof(record, "/v2/product-sessions/revoke", body), options.fetchImplementation);
  expect(revoked, 200, null, "cleanup revoke");
  const introspectionBody = { requiredScopes: [] }, postRevokeRequestId = `req_psv2_restart_postrevoke_${randomBytes(9).toString("base64url")}`;
  const postRevoke = await call(endpoint, "/v2/product-sessions/introspect", postRevokeRequestId, introspectionBody, senderProof(record, "/v2/product-sessions/introspect", introspectionBody), options.fetchImplementation);
  expect(postRevoke, 403, "SESSION_REVOKED", "post-revoke introspection");
  unlinkSync(options.recordPath);
  return Object.freeze({ cleanupRevoked: true, completionRequestId: record.completionRequestId, completionResponseByteIdentical: true, completionResponseBytes: Buffer.byteLength(retry.text), completionResponseSha256: sha256(retry.text), postRevokeCode: "SESSION_REVOKED", postRevokeRequestId, recordRemoved: true, revokeRequestId });
}

function senderProof(record, path, body) { const at = new Date(Math.max(Date.now(), Date.parse(record.session.issuedAt))); const value = createProductSessionProofV2(record.session, { bodyDigest: httpBodyDigest(canonicalJSON(body)), expiresAt: new Date(Math.min(at.getTime() + 30_000, Date.parse(record.session.expiresAt))).toISOString(), issuedAt: at.toISOString(), method: "POST", nonce: randomBytes(32).toString("base64url"), path }, record.secretText); return encodeProductSessionGatewayProofHeaderV2(value); }

async function accepted(endpoint, path, requestId, body, proof, fetchImplementation) { const response = await call(endpoint, path, requestId, body, proof, fetchImplementation); expect(response, 200, null, path); return response.payload; }
async function call(endpoint, path, requestId, body, proof, fetchImplementation = globalThis.fetch) { const headers = { "content-type": "application/json", "x-request-id": requestId }; if (proof) headers["x-ynx-product-session-proof-v2"] = proof; const response = await fetchImplementation(new URL(path, endpoint), { body: canonicalJSON(body), headers, method: "POST" }); const text = await response.text(); let payload; try { payload = JSON.parse(text); } catch { fail("INVALID_RESPONSE", "Restart verifier response is not JSON"); } if (canonicalJSON(payload) !== text || payload.requestId !== requestId || payload.schemaVersion !== 2) fail("INVALID_RESPONSE", "Restart verifier response is not canonical and request-bound"); return { payload, status: response.status, text }; }
function expect(response, status, code, label) { if (response.status !== status || (code === null ? response.payload?.ok !== true : response.payload?.error?.code !== code)) fail("RESTART_ASSERTION_FAILED", `${label} returned an unexpected response`); }
function writeRecord(path, value) { safePath(path); const descriptor = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); try { writeFileSync(descriptor, `${canonicalJSON(value)}\n`, "utf8"); } finally { closeSync(descriptor); } }
function readRecord(path) { safePath(path); const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { const stat = fstatSync(descriptor); if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid() || stat.size < 2 || stat.size > 262_144) fail("UNSAFE_RECORD", "Restart verifier record metadata is unsafe"); const text = readFileSync(descriptor, "utf8"); const value = JSON.parse(text); if (`${canonicalJSON(value)}\n` !== text) fail("UNSAFE_RECORD", "Restart verifier record is noncanonical"); return value; } finally { closeSync(descriptor); } }
function safePath(path) { if (typeof path !== "string" || !isAbsolute(path) || !path.startsWith("/private/tmp/") || path.length > 512) fail("UNSAFE_RECORD", "Restart verifier record must use a bounded /private/tmp path"); }
function endpointValue(value, allowLoopback) { let parsed; try { parsed = new URL(value); } catch { fail("INVALID_ENDPOINT", "Restart verifier endpoint is invalid"); } const loopback = allowLoopback && parsed.protocol === "http:" && ["127.0.0.1", "::1", "localhost"].includes(parsed.hostname); if ((parsed.protocol !== "https:" && !loopback) || parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) fail("INVALID_ENDPOINT", "Restart verifier requires canonical HTTPS or explicit loopback"); return parsed; }
function token(value) { return createHash("sha256").update(value).digest("base64url"); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
