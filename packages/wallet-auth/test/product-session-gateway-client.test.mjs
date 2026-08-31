import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  createProductSessionReturnURL,
  canonicalJSON, ProductSessionGatewayFetchAdapter, ProductSessionGatewayHttpHandler, RecoverableProductSessionClient,
  signProductSessionApproval, PRODUCT_SESSION_CLIENT_STATE, PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2, WalletAuthError,
} from "../src/index.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-08-14T01:00:00.000Z");
const deviceSecret = Buffer.alloc(32, 17);
const device = {
  id: "fetch-adapter-device-001",
  key: Buffer.from(p256.getPublicKey(deviceSecret, true)).toString("base64url"),
  secret: deviceSecret.toString("base64url"),
  scopes: ["dex:account", "dex:orders", "dex:trade"],
  purpose: "Connect YNX DEX through the exact v2 Gateway transport.",
};
const token = (label) => createHash("sha256").update(label).digest("base64url");
const storage = () => { const values = new Map(); return { securityLevel: "os-protected", async get(key) { return values.get(key) ?? null; }, async set(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); }, values }; };

test("fetch adapter recovers lost completion response idempotently without exposing the device secret", async () => {
  let challengeIndex = 0; let loseCompletionResponse = true;
  const handler = new ProductSessionGatewayHttpHandler(registry, () => token(`fetch-gateway-${challengeIndex++}`));
  const captured = [];
  const fakeFetch = async (url, init) => {
    const parsed = new URL(url); const headers = init.headers; const body = JSON.parse(init.body);
    captured.push({ url, headers: { ...headers }, body });
    const response = handler.handle({ requestId: headers["x-request-id"], method: init.method, path: parsed.pathname, contentType: headers["content-type"], body: init.body, proofHeader: headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2] ?? null, networkAvailable: true }, NOW);
    if (parsed.pathname === "/v2/product-sessions/complete" && loseCompletionResponse) { loseCompletionResponse = false; throw new TypeError("response lost after commit"); }
    return new Response(response.body, { status: response.status, headers: response.headers });
  };
  const adapter = new ProductSessionGatewayFetchAdapter({ endpoint: "https://gateway.test", fetch: fakeFetch, walletInstalled: async () => true, schemeRegistered: async () => true, timeoutMs: 5_000 });
  const protectedStorage = storage(); let tokenIndex = 0;
  const client = new RecoverableProductSessionClient({ registry, productId: "dex", platform: "web", storage: protectedStorage, gateway: adapter, device, tokenFactory: () => token(`fetch-client-${tokenIndex++}`), clock: () => NOW });
  const connecting = await client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret: "1".padStart(64, "0"), scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const callback = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  assert.equal((await client.handleReturn(callback)).status, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
  const connected = await client.retry({ walletInstalled: true, schemeRegistered: true });
  assert.equal(connected.status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal(handler.snapshot().authority.sessions.length, 1);
  assert.equal(handler.snapshot().idempotency.length, 2);
  assert.ok(handler.snapshot().audit.filter((item) => item.outcome === "idempotent").length >= 2);
  assert.equal(JSON.stringify(captured).includes(device.secret), false);
  assert.equal(captured.every((item) => item.headers["content-type"] === "application/json" && item.headers["x-request-id"].startsWith("req_ps_")), true);

  const restarted = new RecoverableProductSessionClient({ registry, productId: "dex", platform: "web", storage: protectedStorage, gateway: adapter, device, tokenFactory: () => token(`fetch-restart-${tokenIndex++}`), clock: () => NOW });
  assert.equal((await restarted.restore(true)).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
});

test("legacy canonical Wallet route miss preserves an approved callback solely for Retry", async () => {
  const gateway = new ProductSessionGatewayFetchAdapter({
    endpoint: "https://gateway.test",
    fetch: async () => new Response(canonicalJSON({ error: { code: "ROUTE_NOT_FOUND", message: "Canonical Wallet Gateway route was not found" }, ok: false, schemaVersion: 1, stateDigest: "a".repeat(64) }), { status: 404, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-request-id": "173e4567-e89b-42d3-a456-426614174000" } }),
    walletInstalled: async () => true,
    schemeRegistered: async () => true,
    timeoutMs: 5_000,
  });
  const protectedStorage = storage();
  const client = new RecoverableProductSessionClient({ registry, productId: "dex", platform: "web", storage: protectedStorage, gateway, device, tokenFactory: () => token("legacy-route-miss-client"), clock: () => NOW });
  const connecting = await client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret: "2".padStart(64, "0"), scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const callback = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);

  const result = await client.handleReturn(callback);
  assert.equal(result.status, PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED);
  assert.deepEqual(result.actions, ["retry", "guest"]);
  assert.equal(result.message.includes("not mounted"), true);
  assert.equal([...protectedStorage.values.keys()].some((key) => key.endsWith(":pending")), true);
  assert.equal([...protectedStorage.values.values()].includes(callback), true);
  assert.equal([...protectedStorage.values.keys()].some((key) => !key.endsWith(":pending") && !key.endsWith(":return")), false);
});

test("fetch adapter rejects unsafe origins, malformed responses and network fallback", async () => {
  const capabilities = { walletInstalled: async () => false, schemeRegistered: async () => false, timeoutMs: 5_000 };
  assert.throws(() => new ProductSessionGatewayFetchAdapter({ endpoint: "http://gateway.test", fetch: async () => null, ...capabilities }), code("INVALID_GATEWAY"));
  const malformed = new ProductSessionGatewayFetchAdapter({ endpoint: "https://gateway.test", fetch: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_adapter_response_001" } }), ...capabilities });
  await assert.rejects(() => malformed.challenge({ requestId: "req_adapter_response_001", request: {}, approval: {} }), code("INVALID_GATEWAY_RESPONSE"));
  const unavailable = new ProductSessionGatewayFetchAdapter({ endpoint: "https://gateway.test", fetch: async () => { throw new TypeError("offline"); }, ...capabilities });
  await assert.rejects(() => unavailable.challenge({ requestId: "req_adapter_network_0001", request: {}, approval: {} }), code("NETWORK_UNAVAILABLE"));
  const interrupted = new ProductSessionGatewayFetchAdapter({ endpoint: "https://gateway.test", fetch: async () => ({ status: 200, headers: new Headers({ "content-type": "application/json", "cache-control": "no-store", "x-request-id": "req_adapter_stream_00001" }), async text() { throw new TypeError("stream reset"); } }), ...capabilities });
  await assert.rejects(() => interrupted.challenge({ requestId: "req_adapter_stream_00001", request: {}, approval: {} }), code("NETWORK_UNAVAILABLE"));
  const unmounted = new ProductSessionGatewayFetchAdapter({
    endpoint: "https://gateway.test",
    fetch: async () => new Response(canonicalJSON({ error: { code: "ROUTE_NOT_FOUND", message: "Product Session Gateway route is not registered" }, ok: false, requestId: "req_invalid_request_000", schemaVersion: 2 }), { status: 404, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-request-id": "req_invalid_request_000" } }),
    ...capabilities,
  });
  await assert.rejects(() => unmounted.challenge({ requestId: "req_adapter_route_00001", request: {}, approval: {} }), code("ROUTE_NOT_MOUNTED"));
  const legacyUnmounted = new ProductSessionGatewayFetchAdapter({
    endpoint: "https://gateway.test",
    fetch: async () => new Response(canonicalJSON({ error: { code: "ROUTE_NOT_FOUND", message: "Canonical Wallet Gateway route was not found" }, ok: false, schemaVersion: 1, stateDigest: "a".repeat(64) }), { status: 404, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-request-id": "173e4567-e89b-42d3-a456-426614174000" } }),
    ...capabilities,
  });
  await assert.rejects(() => legacyUnmounted.challenge({ requestId: "req_adapter_route_00001", request: {}, approval: {} }), code("ROUTE_NOT_MOUNTED"));
  const substitutedUnmounted = new ProductSessionGatewayFetchAdapter({
    endpoint: "https://gateway.test",
    fetch: async () => new Response(canonicalJSON({ error: { code: "ROUTE_NOT_FOUND", message: "Product Session Gateway route is not registered" }, ok: false, requestId: "req_invalid_request_000", schemaVersion: 2 }), { status: 404, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-request-id": "req_substituted_request_0" } }),
    ...capabilities,
  });
  await assert.rejects(() => substitutedUnmounted.challenge({ requestId: "req_adapter_route_00001", request: {}, approval: {} }), code("INVALID_GATEWAY_RESPONSE"));
  const malformedLegacyUnmounted = new ProductSessionGatewayFetchAdapter({
    endpoint: "https://gateway.test",
    fetch: async () => new Response(canonicalJSON({ error: { code: "ROUTE_NOT_FOUND", message: "Canonical Wallet Gateway route was not found" }, ok: false, schemaVersion: 1, stateDigest: "not-a-digest" }), { status: 404, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-request-id": "173e4567-e89b-42d3-a456-426614174000" } }),
    ...capabilities,
  });
  await assert.rejects(() => malformedLegacyUnmounted.challenge({ requestId: "req_adapter_route_00001", request: {}, approval: {} }), (error) => error instanceof WalletAuthError && error.code !== "ROUTE_NOT_MOUNTED");
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
