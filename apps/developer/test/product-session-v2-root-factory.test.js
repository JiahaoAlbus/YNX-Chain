import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createProductWalletConnection, PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN } from "../vendor/wallet-auth-c5/src/product-wallet-connection.js";
import { canonicalJSON } from "../vendor/wallet-auth-c5/src/canonical.js";
import { PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION } from "../vendor/wallet-auth-c5/src/product-session-gateway.js";
import vm from "node:vm";
import { createRequire } from "node:module";

const registry = JSON.parse(await readFile(new URL("../vendor/wallet-auth-c5/product-session-registry.json", import.meta.url), "utf8"));

// TEST_ONLY Native capability and SDK fixtures exercise the actual Developer
// wrapper's ownership; they grant no real device or protected service authority.
async function nativeRuntimeFixture(sdk) {
  const calls = [], timers = [];
  const device = { id: "TEST_ONLY", key: "TEST_ONLY_DEVICE", sign: async () => "TEST_ONLY", scopes: ["account:read", "developer:deploy"], purpose: "source fixture" };
  const bridge = { beginConnection: async () => { calls.push("consent"); return device; }, endConnection: async () => calls.push("end"), walletAvailability: async () => ({ walletInstalled: true, schemeRegistered: true }), protectedStorage: { get: async () => null, set: async () => {}, remove: async () => {} }, openAuthorization: async () => calls.push("open") };
  const ts = createRequire(import.meta.url)("../services/language-service/node_modules/typescript/lib/typescript.js");
  const code = ts.transpileModule(await readFile(new URL("../frontend/src/wallet/product-session-v2.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}, modules = {
    "./transport": { canonicalJSON, developerWalletV2Bridge: () => bridge, developerWalletV2Device: async () => { calls.push("device"); return device; } },
    "../../../vendor/wallet-auth-c5/src/product-wallet-connection.js": { PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN, createProductWalletConnection: config => { assert.equal(config.productId, "developer"); assert.equal(config.platform, "macos"); for (const key of ["endpoint", "origin", "callback", "clock", "transport", "session"]) assert.equal(Object.hasOwn(config, key), false); calls.push("factory"); return sdk; } },
    "../../../vendor/wallet-auth-c5/src/product-session-router.js": { walletConnectionChoices: () => [] },
    "../../../vendor/wallet-auth-c5/src/product-session-recovery.js": { PRODUCT_SESSION_CLIENT_STATE: {} },
    "../../../vendor/wallet-auth-c5/product-session-registry.json": registry,
  };
  vm.runInNewContext(code, { exports, require: id => { assert.ok(modules[id], id); return modules[id]; }, window: {}, Promise, Error, Symbol, setTimeout: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; }, clearTimeout() {} });
  return { exports, calls, timers, bridge };
}

test("Developer Native inspection never provisions a device or requests consent", async () => {
  const f = await nativeRuntimeFixture({}); await f.exports.inspectDeveloperWalletV2Runtime(); assert.deepEqual(f.calls, []);
});

test("Developer Native return owns completion while the older opener is pending", async () => {
  let openReply, returnReply; const urls = [];
  const sdk = { beginYNX: () => new Promise(resolve => openReply = resolve), handleReturn: url => { urls.push(url); return new Promise(resolve => returnReply = resolve); }, setNetworkAvailable() {} };
  const f = await nativeRuntimeFixture(sdk), runtime = await f.exports.beginDeveloperWalletV2Connection();
  const begin = runtime.connection.beginYNX(); const returning = runtime.connection.handleReturn("ynxdeveloper://wallet-auth/callback?TEST_ONLY");
  await assert.rejects(runtime.connection.handleReturn("duplicate"), /pending Developer Wallet operation/);
  openReply({ status: "session-state" }); await begin; assert.equal(f.calls.filter(x => x === "end").length, 0);
  returnReply({ status: "session-state", sessionState: { status: "connected" } }); await returning; await runtime.finished;
  assert.deepEqual(urls, ["ynxdeveloper://wallet-auth/callback?TEST_ONLY"]); assert.equal(f.calls.filter(x => x === "end").length, 1);
});

test("an older opener failure preserves the pending Native return and its original error", async () => {
  let rejectOpen, returnReply;
  const sdk = { beginYNX: () => new Promise((_, reject) => rejectOpen = reject), handleReturn: () => new Promise(resolve => returnReply = resolve), setNetworkAvailable() {} };
  const f = await nativeRuntimeFixture(sdk), runtime = await f.exports.beginDeveloperWalletV2Connection();
  const opening = runtime.connection.beginYNX(), returning = runtime.connection.handleReturn("TEST_ONLY_RETURN"), error = Error("original opener error");
  const observed = assert.rejects(opening, actual => actual === error); rejectOpen(error); await observed; assert.equal(f.calls.filter(x => x === "end").length, 0);
  returnReply({ status: "session-state" }); await returning; assert.equal(f.calls.filter(x => x === "end").length, 1);
});

test("Developer Native expiration fences a late opener and permits explicit retry", async () => {
  let reply; const network = [];
  const sdk = { beginYNX: () => new Promise(resolve => reply = resolve), setNetworkAvailable: value => network.push(value) };
  const f = await nativeRuntimeFixture(sdk), runtime = await f.exports.beginDeveloperWalletV2Connection(); const pending = runtime.connection.beginYNX();
  assert.equal(f.timers[0].ms, 300_000); f.timers[0].fn(); await runtime.finished; assert.deepEqual(network, [false]);
  reply({ status: "wallet-opened" }); await pending; await assert.rejects(runtime.connection.beginYNX(), /Explicit native/);
  const retry = await f.exports.beginDeveloperWalletV2Connection(); assert.equal(f.calls.filter(x => x === "consent").length, 2); await retry.endNativeOperation();
});

test("accepted Wallet v2 root factory fails closed for an absent Wallet and preserves explicit Guest limits", async () => {
  const stored = new Map();
  const connection = createProductWalletConnection({
    registry,
    productId: "developer",
    platform: "macos",
    walletInstalled: async () => false,
    schemeRegistered: async () => false,
    gatewayTimeoutMs: 10_000,
    storage: { securityLevel: "os-protected", get: async (key) => stored.get(key) ?? null, set: async (key, value) => void stored.set(key, value), remove: async (key) => void stored.delete(key) },
    device: { id: "developer-test-device", key: "A".repeat(44), scopes: ["account:read", "developer:deploy"], purpose: "root factory test", sign: async () => "MEQCIA" },
    scope: globalThis,
    discoveryWaitMs: 0,
    openWallet: async () => ({ opened: false, code: "WALLET_NOT_INSTALLED" }),
    openTimeoutMs: 10_000,
  });
  const options = await connection.options();
  assert.equal(PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN, "https://wallet-auth.ynxweb4.com");
  assert.equal(options.availability.ynxWalletInstalled, false);
  assert.ok(options.choices.some((choice) => choice.id === "download-ynx-wallet" && choice.action === "download" && choice.authoritative === true));
  const guest = connection.enterGuest();
  assert.equal(guest.sessionState.status, "guest");
  assert.deepEqual(guest.sessionState.limitations, ["not-signed-in", "no-wallet-balance", "no-transactions", "no-chain-authority"]);
});

test("accepted Wallet v2 root factory opens only a populated canonical authorization request", async () => {
  // TEST_ONLY authority-time response: no live gateway, approved identity,
  // private producer or actual Wallet is provided by this source fixture.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN + "/v2/product-sessions/time");
    assert.equal(init.method, "GET");
    const requestId = init.headers["x-request-id"];
    return new Response(canonicalJSON({ schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION, ok: true, requestId, result: { serverTime: "2026-10-14T08:00:00.000Z" } }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": requestId } });
  };
  try {
  const stored = new Map();
  const deviceKey = "A2sX0fLhLEJH-Lzm5WOkQPJ3A32BLeszoPShOUXYmMKW";
  let opened;
  const connection = createProductWalletConnection({
    registry,
    productId: "developer",
    platform: "macos",
    walletInstalled: async () => true,
    schemeRegistered: async () => true,
    gatewayTimeoutMs: 10_000,
    storage: { securityLevel: "os-protected", get: async (key) => stored.get(key) ?? null, set: async (key, value) => void stored.set(key, value), remove: async (key) => void stored.delete(key) },
    device: { id: "developer-test-device", key: deviceKey, scopes: ["account:read", "developer:deploy"], purpose: "root factory canonical request test", sign: async () => "MEQCIA" },
    scope: globalThis,
    discoveryWaitMs: 0,
    openWallet: async (input) => { opened = input; return { opened: true }; },
    openTimeoutMs: 10_000,
  });
  const state = await connection.beginYNX();
  assert.equal(state.status, "wallet-opened");
  assert.match(opened.url, /^ynxwallet:\/\/authorize\?request=[A-Za-z0-9_-]{80,8192}$/);
  const encoded = new URL(opened.url).searchParams.get("request");
  const request = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  assert.equal(request.version, "2");
  assert.equal(request.chainId, "ynx_6423-1");
  assert.equal(request.productId, "developer");
  assert.equal(request.clientId, "ynx-developer-v1");
  assert.equal(request.platform, "macos");
  assert.equal(request.callback, "ynxdeveloper://wallet-auth/callback");
  assert.equal(request.deviceKey, deviceKey);
  assert.match(request.nonce, /^[A-Za-z0-9_-]{32,64}$/);
  assert.match(request.state, /^[A-Za-z0-9_-]{32,64}$/);
  assert.deepEqual(request.scopes, ["account:read", "developer:deploy"]);
  assert.ok(Date.parse(request.expiresAt) > Date.parse(request.issuedAt));
  } finally { globalThis.fetch = originalFetch; }
});
