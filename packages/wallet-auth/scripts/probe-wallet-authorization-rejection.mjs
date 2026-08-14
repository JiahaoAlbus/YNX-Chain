#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  canonicalJSON,
  centralProtocolEntry,
  createAuthorizationRejection,
  parseAuthorizationRequest,
  parseCentralRegistryDocument,
  registryParserBinding,
} from "../src/index.js";

const baseUrl = process.env.YNX_WALLET_REJECTION_PROBE_URL;
const registryPath = process.env.YNX_WALLET_REJECTION_REGISTRY_PATH;
if (!baseUrl || !registryPath) fail("YNX_WALLET_REJECTION_PROBE_URL and YNX_WALLET_REJECTION_REGISTRY_PATH are required");
const origin = new URL(baseUrl);
if (origin.protocol !== "https:" && !(process.env.YNX_WALLET_REJECTION_ALLOW_LOOPBACK === "1" && origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname))) {
  fail("Wallet rejection probe requires HTTPS or explicitly allowed loopback HTTP");
}
origin.pathname = "/";
origin.search = "";
origin.hash = "";
const healthUrl = process.env.YNX_WALLET_REJECTION_HEALTH_URL ? new URL(process.env.YNX_WALLET_REJECTION_HEALTH_URL) : new URL("health", origin);
if (healthUrl.origin !== origin.origin) fail("Wallet rejection health endpoint must use the same origin");

const registry = parseCentralRegistryDocument(JSON.parse(readFileSync(registryPath, "utf8")));
const registration = registry.products.find((product) => product.enabled);
if (!registration) fail("Wallet rejection probe requires an approved enabled product");
const entry = centralProtocolEntry(registration);
const now = new Date();
const issuedAt = new Date(now.getTime() - 1_000);
const expiresAt = new Date(now.getTime() + 120_000);
const authorizationRequest = parseAuthorizationRequest({
  version: "1",
  nonce: randomBytes(24).toString("base64url"),
  chainId: registry.chainId,
  requestingProduct: entry.requestingProduct,
  productClientId: entry.productClientId,
  bundleId: entry.bundleId,
  productDeviceAlgorithm: "p256-sha256",
  productDeviceKey: "AzrThhqVYhOSUWu1k-8FWD7S5YZvXLYmCjAXI3_Ym5Cv",
  callback: entry.callbacks[0],
  scopes: entry.scopes.slice(0, Math.min(entry.maxScopes, 1)),
  purpose: "Verify that an explicit Wallet rejection grants no authority or Product Session.",
  issuedAt: issuedAt.toISOString(),
  expiresAt: expiresAt.toISOString(),
}, { now, registry: registryParserBinding(entry) });
const walletRejection = createAuthorizationRejection(authorizationRequest, {
  decisionCode: "USER_REJECTED",
  rejectedAt: now.toISOString(),
});
const before = await getJSON(healthUrl);
const response = await fetch(new URL("v1/wallet/authorizations/reject", origin), {
  method: "POST",
  headers: { accept: "application/json", "content-type": "application/json" },
  body: canonicalJSON({ authorizationRequest, walletRejection }),
  signal: AbortSignal.timeout(10_000),
});
const responseText = await response.text();
let payload;
try { payload = JSON.parse(responseText); } catch { fail("Wallet rejection response was not JSON"); }
const after = await getJSON(healthUrl);
const requestId = response.headers.get("x-request-id");
const traceId = response.headers.get("x-trace-id");
const errorId = response.headers.get("x-error-id");
if (response.status !== 403 || payload?.ok !== false || payload?.error?.code !== "AUTHORIZATION_REJECTED") fail("Wallet rejection route did not return canonical rejection");
if (!uuid(requestId) || !uuid(traceId) || !uuid(errorId)) fail("Wallet rejection response identifiers are missing or invalid");
if (response.headers.get("cache-control") !== "no-store") fail("Wallet rejection response is cacheable");
if (before.stateDigest !== after.stateDigest || payload.stateDigest !== before.stateDigest) fail("Wallet rejection mutated Gateway state");
process.stdout.write(`${JSON.stringify({
  ok: true,
  route: "/v1/wallet/authorizations/reject",
  status: response.status,
  code: payload.error.code,
  productClientId: entry.productClientId,
  authorityGranted: false,
  grantedScopes: [],
  stateDigestBefore: before.stateDigest,
  stateDigestAfter: after.stateDigest,
  responseStateDigest: payload.stateDigest,
  requestId,
  traceId,
  errorId,
}, null, 2)}\n`);

async function getJSON(url) {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) fail(`Wallet rejection probe dependency returned HTTP ${response.status}`);
  const value = await response.json();
  if (!value?.ok || typeof value.stateDigest !== "string") fail("Wallet rejection probe dependency response is invalid");
  return value;
}
function uuid(value) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
function fail(message) { throw new Error(message); }
