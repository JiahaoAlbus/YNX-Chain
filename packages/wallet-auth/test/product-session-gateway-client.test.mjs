import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  canonicalJSON, createProductSessionReturnURL,
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

test("fetch adapter recovers lost completion response idempotently without exposing the device secret", async () => {
  let challengeIndex = 0; let loseCompletionResponse = true;
  const handler = new ProductSessionGatewayHttpHandler(registry, () => token(`fetch-gateway-${challengeIndex++}`));
  const captured = [];
  const fakeFetch = async (url, init) => {
    const parsed = new URL(url); const headers = init.headers;
    if (parsed.pathname === "/v2/product-sessions/time") return new Response(canonicalJSON({ ok: true, requestId: headers["x-request-id"], result: { serverTime: NOW.toISOString() }, schemaVersion: 2 }), { headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": headers["x-request-id"] } });
    const body = JSON.parse(init.body);
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
  assert.equal(handler.snapshot().audit.filter((item) => item.outcome === "idempotent").length, 1);
  const completions = captured.filter((item) => new URL(item.url).pathname.endsWith("/complete"));
  assert.equal(completions.length, 2); assert.deepEqual(completions[1], completions[0]);
  assert.equal(JSON.stringify(captured).includes(device.secret), false);
  assert.equal(captured.every((item) => item.headers["content-type"] === "application/json" && item.headers["x-request-id"].startsWith("req_ps_")), true);

  const restarted = new RecoverableProductSessionClient({ registry, productId: "dex", platform: "web", storage: protectedStorage, gateway: adapter, device, tokenFactory: () => token(`fetch-restart-${tokenIndex++}`), clock: () => NOW });
  assert.equal((await restarted.restore(true)).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
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
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }

test("authority time and POST call injected browser fetch without a foreign receiver", async () => {
  const calls = [];
  // Native Window.fetch rejects an arbitrary receiver before network I/O.
  // Node's fetch and arrow-function fixtures do not enforce that browser rule.
  async function browserFetch(url, init) {
    assert.equal(this, undefined, "Gateway must not become the native fetch receiver");
    calls.push({ url, init });
    const requestId = init.headers["x-request-id"];
    const result = init.method === "GET" ? { serverTime: NOW.toISOString() } : { fixture: "challenge-response" };
    return new Response(canonicalJSON({ ok: true, requestId, result, schemaVersion: 2 }), { headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": requestId } });
  }
  const adapter = new ProductSessionGatewayFetchAdapter({ endpoint: "https://gateway.test", fetch: browserFetch, walletInstalled: () => false, schemeRegistered: () => false, timeoutMs: 1000 });
  const requestId = `req_ps_t_${token("actual-browser-time-length")}`;
  assert.equal(requestId.length, 52);
  assert.deepEqual(await adapter.currentTime({ requestId }), NOW);
  assert.deepEqual(await adapter.challenge({ requestId: "req_browser_fetch_challenge_1", request: { fixture: "request" }, approval: { fixture: "approval" } }), { fixture: "challenge-response" });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.url), ["https://gateway.test/v2/product-sessions/time", "https://gateway.test/v2/product-sessions/challenge"]);
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[1].init.body, canonicalJSON({ request: { fixture: "request" }, approval: { fixture: "approval" } }));
  for (const { init } of calls) {
    assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit"); assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
  }
});

for (const [label, modify] of [
  ["missing time route", response => ({ ...response, status: 404 })],
  ["stale response request ID", response => ({ ...response, headers: { ...response.headers, "x-request-id": "req_time_from_another_request" } })],
  ["noncanonical time", response => ({ ...response, result: { serverTime: "Sun, 06 Sep 2026 06:23:20 GMT" } })],
  ["missing cache policy", response => ({ ...response, headers: { ...response.headers, "cache-control": "public,max-age=300" } })],
]) test(`authority time fails closed on ${label}`, async () => {
  const requestId = "req_authority_time_response_0001";
  const adapter = new ProductSessionGatewayFetchAdapter({ endpoint: "https://gateway.test", walletInstalled: () => false, schemeRegistered: () => false, timeoutMs: 1000,
    fetch: async () => {
      const value = modify({ status: 200, result: { serverTime: NOW.toISOString() }, headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": requestId } });
      return new Response(canonicalJSON({ ok: true, requestId, result: value.result, schemaVersion: 2 }), { status: value.status, headers: value.headers });
    },
  });
  await assert.rejects(adapter.currentTime({ requestId }), code("CLOCK_UNAVAILABLE"));
});

test("authority time timeout covers a stalled body after response headers", async () => {
  const requestId = "req_authority_time_stalled_body_1";
  const adapter = new ProductSessionGatewayFetchAdapter({ endpoint: "https://gateway.test", walletInstalled: () => false, schemeRegistered: () => false, timeoutMs: 1000,
    fetch: async (_url, init) => ({ status: 200, headers: new Headers({ "content-type": "application/json", "cache-control": "no-store", "x-request-id": requestId }),
      text: () => new Promise((_resolve, reject) => { init.signal.addEventListener("abort", () => reject(new Error("body timed out")), { once: true }); }),
    }),
  });
  await assert.rejects(adapter.currentTime({ requestId }), code("NETWORK_UNAVAILABLE"));
});
