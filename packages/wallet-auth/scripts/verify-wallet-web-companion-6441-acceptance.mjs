#!/usr/bin/env node
import { canonicalJSON } from "../src/canonical.js";
import { verifyProductSessionV2Lifecycle } from "./verify-product-session-v2-lifecycle.mjs";
import { verifyProductSessionV2PublicNegativeMatrix } from "./verify-product-session-v2-public-negative-matrix.mjs";

export const WALLET_WEB_COMPANION_ORIGIN = "https://www.ynxweb4.com";

export async function verifyWalletWebCompanionCorsBoundary(options = {}) {
  const endpoint = publicOrigin(options.endpoint ?? process.env.YNX_WALLET_WEB_COMPANION_6441_URL ?? "https://rest.ynxweb4.com");
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") fail("FETCH_UNAVAILABLE", "Web companion acceptance requires fetch");
  const path = "/v2/product-sessions/challenge";
  const approved = await preflight(fetchImplementation, endpoint, path, WALLET_WEB_COMPANION_ORIGIN, "POST");
  if (approved.status !== 204 || approved.body !== "") fail("APPROVED_ORIGIN_REJECTED", "Web companion Product Session preflight must return an empty HTTP 204");
  assertCors(approved.headers, WALLET_WEB_COMPANION_ORIGIN);
  const unapproved = await preflight(fetchImplementation, endpoint, path, "https://attacker.example", "POST");
  if (unapproved.status !== 403 || unapproved.headers.get("access-control-allow-origin") !== null) fail("UNAPPROVED_ORIGIN_ALLOWED", "Unapproved Origin must return HTTP 403 without CORS authority");
  const wrongMethod = await preflight(fetchImplementation, endpoint, path, WALLET_WEB_COMPANION_ORIGIN, "DELETE");
  if (![403, 405].includes(wrongMethod.status) || wrongMethod.headers.get("access-control-allow-origin") !== null) fail("WRONG_METHOD_ALLOWED", "DELETE preflight must fail closed without CORS authority");
  return Object.freeze({ approvedOrigin: WALLET_WEB_COMPANION_ORIGIN, approvedStatus: 204, endpoint: endpoint.origin, unapprovedStatus: 403, wrongMethodStatus: wrongMethod.status });
}

export async function verifyWalletWebCompanion6441Acceptance(options = {}) {
  const endpoint = publicOrigin(options.endpoint ?? process.env.YNX_WALLET_WEB_COMPANION_6441_URL ?? "https://rest.ynxweb4.com");
  const expectedSource = fullSha(options.expectedSource ?? process.env.YNX_WALLET_WEB_COMPANION_6441_SOURCE);
  const expectedRegistrySha256 = sha256(options.expectedRegistrySha256 ?? process.env.YNX_WALLET_WEB_COMPANION_6441_REGISTRY_SHA256, "registry SHA-256");
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const cors = await verifyWalletWebCompanionCorsBoundary({ endpoint: endpoint.origin, fetchImplementation });
  const versionResponse = await fetchImplementation(new URL("/version", endpoint), { method: "GET", redirect: "error" });
  const version = await canonicalPayload(versionResponse, 64_000, "version");
  if (versionResponse.status !== 200 || version?.build?.sourceCommit !== expectedSource || version?.registrySha256 !== expectedRegistrySha256 || version?.remoteDeployed !== true) fail("SOURCE_MISMATCH", "6441 /version is not bound to the expected deployed source and registry");
  const corsFetch = async (input, init = {}) => {
    const headers = new Headers(init.headers); headers.set("origin", WALLET_WEB_COMPANION_ORIGIN);
    const response = await fetchImplementation(input, { ...init, headers });
    assertCors(response.headers, WALLET_WEB_COMPANION_ORIGIN);
    return response;
  };
  const lifecycle = await verifyProductSessionV2Lifecycle({ endpoint: endpoint.origin, fetchImplementation: corsFetch });
  const negative = await verifyProductSessionV2PublicNegativeMatrix({ endpoint: endpoint.origin, fetchImplementation: corsFetch });
  return Object.freeze({ cors, endpoint: endpoint.origin, lifecycle, negative, registrySha256: expectedRegistrySha256, sourceCommit: expectedSource, visibleWalletApproval: false });
}

async function preflight(fetchImplementation, endpoint, path, origin, method) {
  const response = await fetchImplementation(new URL(path, endpoint), { headers: { "access-control-request-headers": "content-type,x-request-id,x-ynx-product-session-proof-v2", "access-control-request-method": method, origin }, method: "OPTIONS", redirect: "error" });
  return { body: await boundedText(response, 64_000), headers: response.headers, status: response.status };
}
function assertCors(headers, origin) {
  if (headers.get("access-control-allow-origin") !== origin || headers.get("access-control-allow-credentials") === "true") fail("INVALID_CORS", "CORS must echo only the exact approved Origin without wildcard credentials");
  const methods = tokens(headers.get("access-control-allow-methods")); const allowedHeaders = tokens(headers.get("access-control-allow-headers")); const vary = tokens(headers.get("vary"));
  if (!methods.includes("post") || !allowedHeaders.includes("content-type") || !allowedHeaders.includes("x-request-id") || !allowedHeaders.includes("x-ynx-product-session-proof-v2") || !vary.includes("origin")) fail("INVALID_CORS", "CORS method, headers or Vary policy is incomplete");
}
async function canonicalPayload(response, maximum, label) { const text = await boundedText(response, maximum); let payload; try { payload = JSON.parse(text); } catch { fail("INVALID_RESPONSE", `${label} response is not JSON`); } if (canonicalJSON(payload) !== text) fail("INVALID_RESPONSE", `${label} response is not canonical JSON`); return payload; }
async function boundedText(response, maximum) { const text = await response.text(); if (new TextEncoder().encode(text).length > maximum) fail("RESPONSE_TOO_LARGE", "Acceptance response exceeds policy"); return text; }
function tokens(value) { return typeof value === "string" ? value.toLowerCase().split(",").map((item) => item.trim()).filter(Boolean) : []; }
function publicOrigin(value) { let parsed; try { parsed = new URL(value); } catch { fail("INVALID_ENDPOINT", "6441 acceptance endpoint is invalid"); } if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) fail("INVALID_ENDPOINT", "6441 acceptance requires a canonical public HTTPS origin"); return parsed; }
function fullSha(value) { if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) fail("INVALID_SOURCE", "Expected 6441 source must be a full lowercase Git SHA"); return value; }
function sha256(value, label) { if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail("INVALID_CONFIGURATION", `${label} is invalid`); return value; }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  if (process.env.YNX_WALLET_WEB_COMPANION_6441_ACCEPTANCE !== "1") { process.stderr.write("Set YNX_WALLET_WEB_COMPANION_6441_ACCEPTANCE=1 to run the public acceptance verifier.\n"); process.exitCode = 2; }
  else verifyWalletWebCompanion6441Acceptance().then((result) => process.stdout.write(`${canonicalJSON({ ok: true, result })}\n`), (error) => { process.stderr.write(`${canonicalJSON({ error: { code: error?.code ?? "ACCEPTANCE_FAILED", message: error?.message ?? "6441 acceptance failed" }, ok: false })}\n`); process.exitCode = 1; });
}
