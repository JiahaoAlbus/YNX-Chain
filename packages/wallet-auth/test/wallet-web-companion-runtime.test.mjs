import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  createProductSessionReturnURL,
  encodeProductSessionWalletURL,
  parseProductSessionWalletURL,
  parseProductSessionApproval,
  ProductSessionGatewayFetchAdapter,
  ProductSessionGatewayHttpHandler,
  productPlatformBinding,
  RecoverableProductSessionClient,
  signProductSessionApproval,
  PRODUCT_SESSION_CLIENT_STATE,
  PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2,
  WalletAuthError,
} from "../src/index.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-08-15T09:00:00.000Z");
const deviceSecret = Buffer.alloc(32, 23);
const device = {
  id: "wallet-web-companion-device-001",
  key: Buffer.from(p256.getPublicKey(deviceSecret, true)).toString("base64url"),
  secret: deviceSecret.toString("base64url"),
  scopes: ["account:read", "wallet:session:request"],
  purpose: "Review a short-lived Product Session for the official YNX Wallet Web companion.",
};
const token = (label) => createHash("sha256").update(label).digest("base64url");
const storage = () => { const values = new Map(); return { securityLevel: "os-protected", async get(key) { return values.get(key) ?? null; }, async set(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); }, values }; };

function runtime(options = {}) {
  const clock = options.clock ?? (() => NOW);
  let challengeIndex = 0;
  const handler = new ProductSessionGatewayHttpHandler(registry, () => token(`web-companion-gateway-${challengeIndex++}`), options.snapshot);
  const requests = [];
  const fetch = async (url, init) => {
    const parsed = new URL(url); requests.push({ path: parsed.pathname, body: init.body, headers: { ...init.headers } });
    if (options.networkUnavailable?.(parsed.pathname)) throw new TypeError("offline");
    await options.beforeRequest?.(parsed.pathname);
    const response = handler.handle({
      requestId: init.headers["x-request-id"], method: init.method, path: parsed.pathname,
      contentType: init.headers["content-type"], body: init.body,
      proofHeader: init.headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2] ?? null, networkAvailable: true,
    }, clock());
    return new Response(response.body, { status: response.status, headers: response.headers });
  };
  const gateway = new ProductSessionGatewayFetchAdapter({ endpoint: "https://rest.ynxweb4.com", fetch, walletInstalled: async () => true, schemeRegistered: async () => true, timeoutMs: 5_000 });
  let tokenIndex = 0;
  const protectedStorage = options.storage ?? storage();
  const client = new RecoverableProductSessionClient({ registry, productId: "wallet-web-companion", platform: "web", storage: protectedStorage, gateway, device, tokenFactory: () => token(`web-companion-client-${tokenIndex++}`), clock });
  return { handler, requests, client, storage: protectedStorage };
}

test("Web companion runtime binding is Web-only and matches the frozen Central identity and callback", () => {
  const binding = productPlatformBinding(registry, "wallet-web-companion", "web");
  assert.equal(binding.clientId, "ynx-wallet-web-companion-v1");
  assert.equal(binding.applicationId, "web.ynx.wallet.companion");
  assert.equal(binding.origin, "https://www.ynxweb4.com");
  assert.equal(binding.callback, "https://www.ynxweb4.com/dapp/wallet/wallet-auth/callback");
  assert.deepEqual(binding.scopes, ["account:read", "chain:network:add", "chain:network:switch", "wallet:session:request"]);
  assert.throws(() => productPlatformBinding(registry, "wallet-web-companion", "android"), code("INVALID_PLATFORM"));
});

test("Web companion approval completes challenge, Product Session and introspection through the real HTTP handler", async () => {
  const setup = runtime();
  const connecting = await setup.client.begin({ walletInstalled: true, schemeRegistered: true });
  assert.deepEqual(parseProductSessionWalletURL(registry, encodeProductSessionWalletURL(registry, connecting.request, NOW), NOW), connecting.request);
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret: "1".padStart(64, "0"), scopes: connecting.request.scopes, expiresAt: "2026-08-15T09:03:00.000Z" }, NOW);
  const returned = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  const connected = await setup.client.handleReturn(returned);
  assert.equal(connected.status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal(connected.session.clientId, "ynx-wallet-web-companion-v1");
  assert.deepEqual(setup.requests.map((item) => item.path), ["/v2/product-sessions/challenge", "/v2/product-sessions/complete", "/v2/product-sessions/introspect"]);
  assert.equal(setup.handler.snapshot().authority.sessions.length, 1);
});

test("concurrent identical Web companion callbacks linearize to one Product Session lifecycle", async () => {
  const setup = runtime();
  const connecting = await setup.client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret: "1".padStart(64, "0"), scopes: connecting.request.scopes, expiresAt: "2026-08-15T09:03:00.000Z" }, NOW);
  const returned = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  const [first, second] = await Promise.all([setup.client.handleReturn(returned), setup.client.handleReturn(returned)]);
  assert.equal(first.status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.deepEqual(second, first);
  assert.deepEqual(setup.requests.map((item) => item.path), ["/v2/product-sessions/challenge", "/v2/product-sessions/complete", "/v2/product-sessions/introspect"]);
  assert.equal(setup.handler.snapshot().authority.sessions.length, 1);
});

test("a different concurrent Web companion callback fails closed without joining the valid approval", async () => {
  const setup = runtime();
  const connecting = await setup.client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret: "1".padStart(64, "0"), scopes: connecting.request.scopes, expiresAt: "2026-08-15T09:03:00.000Z" }, NOW);
  const returned = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  const valid = setup.client.handleReturn(returned);
  await assert.rejects(setup.client.handleReturn(returned.replace("/wallet-auth/callback", "/wallet-auth/attacker")), code("CONCURRENT_CALLBACK"));
  assert.equal((await valid).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.deepEqual(setup.requests.map((item) => item.path), ["/v2/product-sessions/challenge", "/v2/product-sessions/complete", "/v2/product-sessions/introspect"]);
});

test("disconnect racing an approved callback revokes the issued Product Session without resurrection", async () => {
  let releaseChallenge;
  const challengeBlocked = new Promise((resolve) => { releaseChallenge = resolve; });
  let challengeStarted;
  const challengeSeen = new Promise((resolve) => { challengeStarted = resolve; });
  const setup = runtime({ beforeRequest: async (path) => {
    if (path === "/v2/product-sessions/challenge") { challengeStarted(); await challengeBlocked; }
  } });
  const connecting = await setup.client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret: "1".padStart(64, "0"), scopes: connecting.request.scopes, expiresAt: "2026-08-15T09:03:00.000Z" }, NOW);
  const returned = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  const completion = setup.client.handleReturn(returned);
  await challengeSeen;
  const disconnect = setup.client.disconnect();
  releaseChallenge();
  assert.equal((await completion).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal((await disconnect).status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.equal(setup.client.current.status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.deepEqual(setup.requests.map((item) => item.path), ["/v2/product-sessions/challenge", "/v2/product-sessions/complete", "/v2/product-sessions/introspect", "/v2/product-sessions/revoke"]);
  assert.equal(setup.handler.snapshot().authority.sessions.length, 1);
  assert.equal(setup.handler.snapshot().authority.revokedSessions.length, 1);
  assert.equal(await setup.storage.get(setup.client.storageKey), null);
});

test("Web companion rejection creates no challenge, session or Gateway mutation", async () => {
  const setup = runtime();
  const connecting = await setup.client.begin({ walletInstalled: true, schemeRegistered: true });
  const returned = createProductSessionReturnURL(registry, connecting.request, { result: "rejected", reason: "user_rejected" }, NOW);
  assert.equal((await setup.client.handleReturn(returned)).status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.deepEqual(setup.requests, []);
  assert.equal(setup.handler.snapshot().authority.sessions.length, 0);
  assert.equal(setup.handler.snapshot().audit.length, 0);
});

test("Web companion disconnect revokes the authoritative Product Session before clearing protected state", async () => {
  const setup = runtime();
  const connecting = await setup.client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret: "1".padStart(64, "0"), scopes: connecting.request.scopes, expiresAt: "2026-08-15T09:03:00.000Z" }, NOW);
  const connected = await setup.client.handleReturn(createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW));
  assert.equal((await setup.client.disconnect()).status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.deepEqual(setup.requests.map((item) => item.path), ["/v2/product-sessions/challenge", "/v2/product-sessions/complete", "/v2/product-sessions/introspect", "/v2/product-sessions/revoke"]);
  assert.deepEqual(setup.handler.snapshot().authority.revokedSessions, [connected.session.sessionBinding]);
  const beforeReplay = setup.handler.snapshot();
  const revoke = setup.requests.at(-1);
  const replay = setup.handler.handle({ requestId: revoke.headers["x-request-id"], method: "POST", path: revoke.path, contentType: "application/json", body: revoke.body, proofHeader: revoke.headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2], networkAvailable: true }, NOW);
  assert.equal(replay.status, 409);
  assert.equal(JSON.parse(replay.body).error.code, "REPLAY");
  assert.deepEqual(setup.handler.snapshot().authority, beforeReplay.authority);
  assert.deepEqual(setup.handler.snapshot().consumedProofs, beforeReplay.consumedProofs);
});

test("concurrent Web companion disconnects linearize to one authoritative revoke", async () => {
  const setup = runtime();
  const connecting = await setup.client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret: "1".padStart(64, "0"), scopes: connecting.request.scopes, expiresAt: "2026-08-15T09:03:00.000Z" }, NOW);
  const connected = await setup.client.handleReturn(createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW));
  const [first, second] = await Promise.all([setup.client.disconnect(), setup.client.disconnect()]);
  assert.equal(first.status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.deepEqual(second, first);
  assert.equal(setup.requests.filter((item) => item.path === "/v2/product-sessions/revoke").length, 1);
  assert.deepEqual(setup.handler.snapshot().authority.revokedSessions, [connected.session.sessionBinding]);
  assert.equal(await setup.storage.get(setup.client.storageKey), null);
});

test("Web companion session restores across Gateway restart and expiry removes authority locally without a network call", async () => {
  const first = runtime();
  const connecting = await first.client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret: "1".padStart(64, "0"), scopes: connecting.request.scopes, expiresAt: "2026-08-15T09:03:00.000Z" }, NOW);
  assert.equal((await first.client.handleReturn(createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW))).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  const restarted = runtime({ snapshot: first.handler.snapshot(), storage: first.storage });
  assert.equal((await restarted.client.restore(true)).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.deepEqual(restarted.requests.map((item) => item.path), ["/v2/product-sessions/introspect"]);
  const expired = runtime({ snapshot: restarted.handler.snapshot(), storage: restarted.storage, clock: () => new Date("2026-08-15T09:04:00.000Z") });
  const result = await expired.client.restore(true);
  assert.equal(result.status, PRODUCT_SESSION_CLIENT_STATE.CONNECTING);
  assert.equal(result.automatic, true);
  assert.equal("session" in result, false);
  assert.deepEqual(expired.requests, []);
});

test("disconnect racing restart introspection cannot resurrect or auto-reconnect a Product Session", async () => {
  const first = runtime();
  const connecting = await first.client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret: "1".padStart(64, "0"), scopes: connecting.request.scopes, expiresAt: "2026-08-15T09:03:00.000Z" }, NOW);
  await first.client.handleReturn(createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW));
  let releaseIntrospection;
  const introspectionBlocked = new Promise((resolve) => { releaseIntrospection = resolve; });
  let introspectionStarted;
  const introspectionSeen = new Promise((resolve) => { introspectionStarted = resolve; });
  const restarted = runtime({ snapshot: first.handler.snapshot(), storage: first.storage, beforeRequest: async (path) => {
    if (path === "/v2/product-sessions/introspect") { introspectionStarted(); await introspectionBlocked; }
  } });
  const restoring = restarted.client.restore(true);
  await introspectionSeen;
  const disconnect = restarted.client.disconnect();
  releaseIntrospection();
  await restoring;
  assert.equal((await disconnect).status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.equal(restarted.client.current.status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.deepEqual(restarted.requests.map((item) => item.path), ["/v2/product-sessions/introspect", "/v2/product-sessions/revoke"]);
  assert.equal(restarted.handler.snapshot().authority.revokedSessions.length, 1);
  assert.equal(await restarted.storage.get(restarted.client.storageKey), null);
});

test("Web companion revoke outage retains protected state until Retry re-introspects and revokes", async () => {
  let offline = false;
  const setup = runtime({ networkUnavailable: () => offline });
  const connecting = await setup.client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret: "1".padStart(64, "0"), scopes: connecting.request.scopes, expiresAt: "2026-08-15T09:03:00.000Z" }, NOW);
  await setup.client.handleReturn(createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW));
  offline = true;
  assert.equal((await setup.client.disconnect()).status, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
  assert.notEqual(await setup.storage.get(setup.client.storageKey), null);
  assert.deepEqual(setup.handler.snapshot().authority.revokedSessions, []);
  offline = false;
  assert.equal((await setup.client.retry({ walletInstalled: true, schemeRegistered: true })).status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
  assert.equal((await setup.client.disconnect()).status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.equal(await setup.storage.get(setup.client.storageKey), null);
  assert.equal(setup.handler.snapshot().authority.revokedSessions.length, 1);
});

test("disconnect revokes a protected session issued before an introspection outage instead of orphaning authority", async () => {
  let introspectionOffline = true;
  const setup = runtime({ networkUnavailable: (path) => introspectionOffline && path === "/v2/product-sessions/introspect" });
  const connecting = await setup.client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret: "1".padStart(64, "0"), scopes: connecting.request.scopes, expiresAt: "2026-08-15T09:03:00.000Z" }, NOW);
  const returned = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  assert.equal((await setup.client.handleReturn(returned)).status, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
  assert.equal(setup.handler.snapshot().authority.sessions.length, 1);
  assert.notEqual(await setup.storage.get(setup.client.storageKey), null);
  introspectionOffline = false;
  assert.equal((await setup.client.disconnect()).status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  assert.equal(setup.handler.snapshot().authority.revokedSessions.length, 1);
  assert.deepEqual(setup.requests.map((item) => item.path), ["/v2/product-sessions/challenge", "/v2/product-sessions/complete", "/v2/product-sessions/introspect", "/v2/product-sessions/revoke"]);
  assert.equal(await setup.storage.get(setup.client.storageKey), null);
});

test("Web companion callback, product, device and scope substitutions fail before session mutation", async () => {
  const setup = runtime();
  const connecting = await setup.client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(registry, connecting.request, { accountSecret: "1".padStart(64, "0"), scopes: connecting.request.scopes, expiresAt: "2026-08-15T09:03:00.000Z" }, NOW);
  const valid = createProductSessionReturnURL(registry, connecting.request, { result: "approved", approval }, NOW);
  assert.equal((await setup.client.handleReturn(valid.replace("/wallet-auth/callback", "/wallet-auth/attacker"))).status, PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED);
  assert.deepEqual(setup.requests, []);
  for (const changed of [
    { clientId: "ynx-exchange-v1" },
    { deviceKey: Buffer.from(p256.getPublicKey(Buffer.alloc(32, 24), true)).toString("base64url") },
    { scopes: ["account:read", "exchange:trade"] },
  ]) assert.throws(() => parseProductSessionApproval(registry, { ...connecting.request, ...changed }, approval, NOW), WalletAuthError);
  assert.equal(setup.handler.snapshot().authority.sessions.length, 0);
  assert.equal(setup.handler.snapshot().audit.length, 0);
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
