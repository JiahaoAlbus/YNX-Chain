#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { p256 } from "@noble/curves/nist.js";
import { canonicalJSON } from "../src/canonical.js";
import { encodeProductSessionGatewayProofHeaderV2 } from "../src/product-session-gateway-client.js";
import { createProductSessionProofV2, productSessionProofV2SignBytes } from "../src/product-session-proof-v2.js";
import { createProductSessionRequest, signProductSessionApproval, signProductSessionChallenge } from "../src/product-session-v2.js";
import { httpBodyDigest } from "../src/session-proof.js";

const registry = JSON.parse(readFileSync(fileURLToPath(new URL("../product-session-registry.json", import.meta.url)), "utf8"));

export async function verifyProductSessionV2PublicNegativeMatrix(options = {}) {
  const endpoint = origin(options.endpoint ?? process.env.YNX_PRODUCT_SESSION_V2_NEGATIVE_URL ?? "https://rest.ynxweb4.com", options.allowLoopback ?? process.env.YNX_PRODUCT_SESSION_V2_ALLOW_LOOPBACK === "1");
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const timeoutMs = integer(options.timeoutMs ?? process.env.YNX_PRODUCT_SESSION_V2_NEGATIVE_TIMEOUT_MS ?? 20_000, 1_000, 60_000, "timeout");
  const expiryWaitMs = integer(options.expiryWaitMs ?? 4_000, 1_000, 30_000, "expiry wait");
  if (typeof fetchImplementation !== "function" || typeof sleep !== "function") fail("INVALID_CONFIGURATION", "Public negative matrix dependencies are unavailable");
  const run = randomBytes(12).toString("base64url");
  const primary = await issue(endpoint, run, "primary", "finance", "web", randomBytes(32), new Date(Date.now() + 180_000), fetchImplementation, timeoutMs);
  const cases = [];
  for (const attack of [
    { name: "wrong-product", mutate: (proof) => ({ ...proof, productId: "social" }), code: "CROSS_PRODUCT_SESSION" },
    { name: "wrong-device", mutate: (proof) => ({ ...proof, deviceId: `${proof.deviceId}-substituted` }), code: "CROSS_PRODUCT_SESSION" },
    { name: "wrong-bundle", mutate: (proof) => ({ ...proof, applicationId: "com.attacker.product", bundleId: "com.attacker.product" }), code: "CROSS_PRODUCT_SESSION" },
  ]) {
    const body = { requiredScopes: ["finance.pay.read"] };
    const proof = mutatedProof(primary.session, "/v2/product-sessions/introspect", body, primary.secretText, attack.mutate);
    cases.push(await expectRejected(endpoint, `/v2/product-sessions/introspect`, id(attack.name, run), body, proof, 403, attack.code, fetchImplementation, timeoutMs, attack.name));
  }
  const widenedBody = { requiredScopes: ["admin:all"] };
  cases.push(await expectRejected(endpoint, "/v2/product-sessions/introspect", id("wrong-scope", run), widenedBody, proof(primary.session, "/v2/product-sessions/introspect", widenedBody, primary.secretText), 403, "SCOPE_WIDENING", fetchImplementation, timeoutMs, "wrong-scope"));
  await expectAccepted(endpoint, "/v2/product-sessions/revoke", id("primary-cleanup", run), {}, proof(primary.session, "/v2/product-sessions/revoke", {}, primary.secretText), fetchImplementation, timeoutMs);

  const sharedSecret = randomBytes(32);
  const deviceA = await issue(endpoint, run, "device-a", "finance", "web", sharedSecret, new Date(Date.now() + 180_000), fetchImplementation, timeoutMs, "shared-public-device");
  const deviceB = await issue(endpoint, run, "device-b", "finance", "web", sharedSecret, new Date(Date.now() + 180_000), fetchImplementation, timeoutMs, "shared-public-device");
  await expectAccepted(endpoint, "/v2/product-sessions/devices/revoke", id("device-revoke", run), {}, proof(deviceA.session, "/v2/product-sessions/devices/revoke", {}, deviceA.secretText), fetchImplementation, timeoutMs);
  cases.push(await expectRejected(endpoint, "/v2/product-sessions/introspect", id("device-revoked-sibling", run), { requiredScopes: [] }, proof(deviceB.session, "/v2/product-sessions/introspect", { requiredScopes: [] }, deviceB.secretText), 403, "SESSION_REVOKED", fetchImplementation, timeoutMs, "devices-revoke"));

  const expiry = await issue(endpoint, run, "expiry", "finance", "web", randomBytes(32), new Date(Date.now() + expiryWaitMs), fetchImplementation, timeoutMs);
  const expiryBody = { requiredScopes: [] };
  const expiryProof = proof(expiry.session, "/v2/product-sessions/introspect", expiryBody, expiry.secretText, new Date());
  await sleep(Math.max(0, Date.parse(expiry.session.expiresAt) - Date.now() + 25));
  cases.push(await expectRejected(endpoint, "/v2/product-sessions/introspect", id("expired", run), expiryBody, expiryProof, 403, "SESSION_EXPIRED", fetchImplementation, timeoutMs, "expiry"));

  return Object.freeze({
    endpoint: endpoint.origin,
    cases: Object.freeze(cases),
    deviceRevokeCascaded: true,
    installedWalletApprovalVerified: false,
    ok: true,
    productRuntimeMigrated: false,
    schemaVersion: 1,
  });
}

async function issue(endpoint, run, label, productId, platform, secret, expiresAt, fetchImplementation, timeoutMs, deviceId = `public-negative-${label}-${run}`) {
  const secretText = secret.toString("base64url");
  const registration = registry.products.find((item) => item.productId === productId);
  const request = createProductSessionRequest(registry, { deviceId, deviceKey: Buffer.from(p256.getPublicKey(secret, true)).toString("base64url"), nonce: token(`${run}:${label}:nonce`), platform, productId, purpose: `Verify ${label} fail-closed Product Session behavior.`, scopes: registration.scopes.slice(0, 2), state: token(`${run}:${label}:state`) }, new Date());
  const approval = signProductSessionApproval(registry, request, { accountSecret: "1".padStart(64, "0"), expiresAt: expiresAt.toISOString(), scopes: request.scopes }, new Date());
  const challengeBody = { approval, request };
  const challenge = (await expectAccepted(endpoint, "/v2/product-sessions/challenge", id(`${label}-challenge`, run), challengeBody, null, fetchImplementation, timeoutMs)).result;
  const completionBody = { approval, completion: signProductSessionChallenge(challenge, secretText), request };
  const session = (await expectAccepted(endpoint, "/v2/product-sessions/complete", id(`${label}-complete`, run), completionBody, null, fetchImplementation, timeoutMs)).result;
  return { secretText, session };
}

function proof(session, path, body, secretText, at = new Date()) {
  return encodeProductSessionGatewayProofHeaderV2(createProductSessionProofV2(session, proofInput(path, body, at, session.expiresAt), secretText));
}

function mutatedProof(session, path, body, secretText, mutate) {
  const { signature: _signature, ...normal } = createProductSessionProofV2(session, proofInput(path, body, new Date(), session.expiresAt), secretText);
  const unsigned = mutate(normal);
  const signature = Buffer.from(p256.sign(Buffer.from(productSessionProofV2SignBytes(unsigned)), Buffer.from(secretText, "base64url"), { format: "der" })).toString("base64url");
  return encodeProductSessionGatewayProofHeaderV2({ ...unsigned, signature });
}

function proofInput(path, body, at, sessionExpiresAt) {
  const issuedAt = new Date(Math.max(at.getTime(), Date.now()));
  const expiresAt = new Date(Math.min(issuedAt.getTime() + 30_000, Date.parse(sessionExpiresAt)));
  return { bodyDigest: httpBodyDigest(canonicalJSON(body)), expiresAt: expiresAt.toISOString(), issuedAt: issuedAt.toISOString(), method: "POST", nonce: randomBytes(32).toString("base64url"), path };
}

async function expectAccepted(endpoint, path, requestId, body, proofHeader, fetchImplementation, timeoutMs) {
  const response = await call(endpoint, path, requestId, body, proofHeader, fetchImplementation, timeoutMs);
  if (response.status !== 200 || response.payload?.ok !== true) fail("PUBLIC_MATRIX_ASSERTION_FAILED", `${path} did not succeed`);
  return response.payload;
}

async function expectRejected(endpoint, path, requestId, body, proofHeader, status, code, fetchImplementation, timeoutMs, name) {
  const response = await call(endpoint, path, requestId, body, proofHeader, fetchImplementation, timeoutMs);
  if (response.status !== status || response.payload?.ok !== false || response.payload?.error?.code !== code) fail("PUBLIC_MATRIX_ASSERTION_FAILED", `${name} returned ${response.status}/${response.payload?.error?.code ?? "no-code"}`);
  return Object.freeze({ code, name, requestId, status });
}

async function call(endpoint, path, requestId, body, proofHeader, fetchImplementation, timeoutMs) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { "content-type": "application/json", "x-request-id": requestId }; if (proofHeader) headers["x-ynx-product-session-proof-v2"] = proofHeader;
    const response = await fetchImplementation(new URL(path, endpoint), { body: canonicalJSON(body), headers, method: "POST", redirect: "error", signal: controller.signal });
    const text = await response.text(); let payload; try { payload = JSON.parse(text); } catch { fail("INVALID_PUBLIC_RESPONSE", "Public negative matrix response is not JSON"); }
    if (canonicalJSON(payload) !== text || payload.requestId !== requestId || payload.schemaVersion !== 2 || response.headers.get("cache-control")?.split(",").map((item) => item.trim()).includes("no-store") !== true) fail("INVALID_PUBLIC_RESPONSE", "Public negative matrix response is not canonical and request-bound");
    return { payload, status: response.status };
  } finally { clearTimeout(timer); }
}

function id(label, run) { return `req_psv2_neg_${label.replaceAll("-", "_")}_${run}`; }
function token(value) { return createHash("sha256").update(value).digest("base64url"); }
function integer(value, minimum, maximum, label) { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail("INVALID_CONFIGURATION", `${label} is outside policy`); return parsed; }
function origin(value, allowLoopback) { let parsed; try { parsed = new URL(value); } catch { fail("INVALID_ENDPOINT", "Public negative matrix endpoint is invalid"); } const loopback = allowLoopback && parsed.protocol === "http:" && ["127.0.0.1", "::1", "localhost"].includes(parsed.hostname); if ((parsed.protocol !== "https:" && !loopback) || parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) fail("INVALID_ENDPOINT", "Public negative matrix requires canonical HTTPS or explicit loopback"); return parsed; }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  if (process.env.YNX_PRODUCT_SESSION_V2_PUBLIC_NEGATIVE !== "1") { process.stderr.write("Set YNX_PRODUCT_SESSION_V2_PUBLIC_NEGATIVE=1 to run the public negative matrix.\n"); process.exitCode = 2; }
  else verifyProductSessionV2PublicNegativeMatrix().then((result) => process.stdout.write(`${canonicalJSON({ ok: true, result })}\n`), (error) => { process.stderr.write(`${canonicalJSON({ error: { code: error?.code ?? "PUBLIC_MATRIX_FAILED", message: error?.message ?? "Public negative matrix failed" }, ok: false })}\n`); process.exitCode = 1; });
}
