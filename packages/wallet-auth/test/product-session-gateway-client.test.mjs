import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  createProductSessionReturnURL,
  ProductSessionGatewayFetchAdapter, ProductSessionGatewayHttpHandler, RecoverableProductSessionClient,
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

test("fetch adapter recovers lost completion response with one platform signature and byte-identical idempotent replay", async () => {
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
  const purposes = [];
  const secureDevice = { id: device.id, key: device.key, scopes: device.scopes, purpose: device.purpose, async sign(input) { purposes.push(input.purpose); return Buffer.from(p256.sign(Buffer.from(input.payload, "base64url"), deviceSecret, { format: "der" })).toString("base64url"); } };
  const protectedStorage = storage(); let tokenIndex = 0;
  const client = new RecoverableProductSessionClient({ registry, productId: "dex", platform: "web", storage: protectedStorage, gateway: adapter, device: secureDevice, tokenFactory: () => token(`fetch-client-${tokenIndex++}`), clock: () => NOW });
  const connecting = await client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret: "1".padStart(64, "0"), scopes: connecting.request.scopes, expiresAt: "2026-08-14T01:03:00.000Z" }, NOW);
  const callback = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  assert.equal((await client.handleReturn(callback)).status, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
  const connected = await client.retry({ walletInstalled: true, schemeRegistered: true });
  assert.equal(connected.status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal(handler.snapshot().authority.sessions.length, 1);
  assert.equal(handler.snapshot().idempotency.length, 2);
  assert.equal(handler.snapshot().audit.filter((item) => item.outcome === "idempotent").length, 1);
  assert.equal(captured.filter((item) => new URL(item.url).pathname === "/v2/product-sessions/challenge").length, 1);
  assert.equal(purposes.filter((purpose) => purpose === "challenge").length, 1);
  const completions = captured.filter((item) => new URL(item.url).pathname === "/v2/product-sessions/complete");
  assert.equal(completions.length, 2);
  assert.deepEqual(completions[1].body, completions[0].body);
  assert.equal(JSON.stringify(captured).includes(device.secret), false);
  assert.equal(captured.every((item) => item.headers["content-type"] === "application/json" && item.headers["x-request-id"].startsWith("req_ps_")), true);

  const restarted = new RecoverableProductSessionClient({ registry, productId: "dex", platform: "web", storage: protectedStorage, gateway: adapter, device: secureDevice, tokenFactory: () => token(`fetch-restart-${tokenIndex++}`), clock: () => NOW });
  assert.equal((await restarted.restore(true)).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
});

test("fetch adapter rejects unsafe origins, malformed responses and network fallback", async () => {
  const capabilities = { walletInstalled: async () => false, schemeRegistered: async () => false, timeoutMs: 5_000 };
  assert.throws(() => new ProductSessionGatewayFetchAdapter({ endpoint: "http://gateway.test", fetch: async () => null, ...capabilities }), code("INVALID_GATEWAY"));
  let rejectedRequestCount = 0;
  const localBoundary = new ProductSessionGatewayFetchAdapter({ endpoint: "https://gateway.test", fetch: async () => { rejectedRequestCount += 1; return null; }, ...capabilities });
  await assert.rejects(() => localBoundary.challenge({ requestId: "req_adapter_boundary_001", request: {}, approval: {} }), code("INVALID_SESSION_REQUEST"));
  await assert.rejects(() => localBoundary.challenge({ requestId: "req_adapter_boundary_002", request: { chainId: "ynx_9102-1" }, approval: { chainId: "ynx_9102-1" } }), code("WRONG_NETWORK"));
  await assert.rejects(() => localBoundary.complete({ requestId: "req_adapter_boundary_003", request: { chainId: "ynx_6423-1" }, approval: { chainId: "ynx_6423-1" }, completion: { challenge: { chainId: "ynx_9102-1" } } }), code("WRONG_NETWORK"));
  assert.equal(rejectedRequestCount, 0);
  const malformed = new ProductSessionGatewayFetchAdapter({ endpoint: "https://gateway.test", fetch: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_adapter_response_001" } }), ...capabilities });
  await assert.rejects(() => malformed.challenge({ requestId: "req_adapter_response_001", request: { chainId: "ynx_6423-1" }, approval: { chainId: "ynx_6423-1" } }), code("INVALID_GATEWAY_RESPONSE"));
  const unavailable = new ProductSessionGatewayFetchAdapter({ endpoint: "https://gateway.test", fetch: async () => { throw new TypeError("offline"); }, ...capabilities });
  await assert.rejects(() => unavailable.challenge({ requestId: "req_adapter_network_0001", request: { chainId: "ynx_6423-1" }, approval: { chainId: "ynx_6423-1" } }), code("NETWORK_UNAVAILABLE"));
  const interrupted = new ProductSessionGatewayFetchAdapter({ endpoint: "https://gateway.test", fetch: async () => ({ status: 200, headers: new Headers({ "content-type": "application/json", "cache-control": "no-store", "x-request-id": "req_adapter_stream_00001" }), async text() { throw new TypeError("stream reset"); } }), ...capabilities });
  await assert.rejects(() => interrupted.challenge({ requestId: "req_adapter_stream_00001", request: { chainId: "ynx_6423-1" }, approval: { chainId: "ynx_6423-1" } }), code("NETWORK_UNAVAILABLE"));
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
