import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { productSessionGatewayAuthority } from "../src/product-session-gateway-client.js";
import {
  canonicalJSON, createBrowserProductSessionClient, createProductSessionReturnURL,
  ProductSessionGatewayFetchAdapter, ProductSessionGatewayHttpHandler,
  RecoverableProductSessionClient, signProductSessionApproval, WalletAuthError,
  createProductSessionRequest, signProductSessionChallengeWith,
} from "../src/index.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-09-06T12:00:00.000Z");
const scopes = ["creator:account", "creator:publish", "creator:revenue"];
const token = label => createHash("sha256").update(label).digest("base64url");

function setup({ localOffsetMs = 0, indexedDB = fakeIndexedDB(), endpoint = "https://wallet-auth.ynxweb4.com" } = {}) {
  const exports = [], generated = [], seen = [];
  const crypto = { getRandomValues: values => webcrypto.getRandomValues(values), subtle: new Proxy(webcrypto.subtle, { get(target, key) {
    if (key === "exportKey") return (format, value) => { exports.push({ format, type: value.type }); assert.equal(value.type, "public", "adapter must never attempt to export a private key"); return target.exportKey(format, value); };
    if (key === "generateKey") return async (...args) => { const pair = await target.generateKey(...args); generated.push(pair); return pair; };
    return typeof target[key] === "function" ? target[key].bind(target) : target[key];
  } }) };
  const environment = { crypto, indexedDB, isSecureContext: true, location: { origin: "https://creator.ynxweb4.com" } };
  let sequence = 0;
  const authority = { now: NOW, unavailable: false, malformed: false };
  const handler = new ProductSessionGatewayHttpHandler(registry, () => token(`browser-challenge-${sequence++}`));
  const gateway = new ProductSessionGatewayFetchAdapter({ endpoint, walletInstalled: async () => true, schemeRegistered: async () => true, timeoutMs: 1000,
    async fetch(url, input) {
      seen.push({ url, headers: input.headers, body: input.body });
      if (new URL(url).pathname === "/v2/product-sessions/time") {
        if (authority.unavailable) throw new TypeError("time service unavailable");
        assert.equal(input.method, "GET"); assert.equal(input.body, undefined);
        return new Response(canonicalJSON({ ok: true, requestId: input.headers["x-request-id"], result: { serverTime: authority.malformed ? "invalid" : authority.now.toISOString() }, schemaVersion: 2 }), { headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": input.headers["x-request-id"] } });
      }
      const result = handler.handle({ requestId: input.headers["x-request-id"], method: input.method, path: new URL(url).pathname, contentType: input.headers["content-type"], body: input.body, proofHeader: input.headers["x-ynx-product-session-proof-v2"] ?? null, networkAvailable: true }, authority.now);
      return new Response(result.body, { status: result.status, headers: result.headers });
    },
  });
  const config = { registry, productId: "creator-studio", scopes, purpose: "Sign in to Creator Studio.", gateway, environment, clock: () => new Date(NOW.getTime() + localOffsetMs) };
  return { config, environment, indexedDB, handler, gateway, generated, exports, seen, authority };
}
async function connect(adapter, config) {
  const pending = await adapter.client.begin({ walletInstalled: true, schemeRegistered: true });
  const approval = signProductSessionApproval(config.registry, pending.request, { accountSecret: "1".padStart(64, "0"), scopes: pending.request.scopes, expiresAt: pending.request.expiresAt }, NOW);
  const callback = createProductSessionReturnURL(config.registry, pending.request, { result: "approved", approval }, NOW);
  return adapter.client.handleReturn(callback);
}

test("real WebCrypto signs callback, API proofs, restart restoration and revoke without exporting a private key", async () => {
  const s = setup(), first = await createBrowserProductSessionClient(s.config);
  assert.deepEqual(first.capabilities, { securityLevel: "webcrypto-nonextractable", privateKeyExtractable: false, persistedCryptoKey: true, osProtected: false, hardwareBacked: false, origin: s.environment.location.origin, productId: "creator-studio", scopes });
  assert.equal(first.storage.securityLevel, "webcrypto-nonextractable");
  assert.equal("secret" in first.device, false);
  const persisted = [...s.indexedDB.records("devices").values()][0];
  assert.notEqual(persisted.privateKey, s.generated[0].privateKey); // Structured clone, not a shared in-memory key handle.
  assert.equal(persisted.privateKey.extractable, false);
  await assert.rejects(webcrypto.subtle.exportKey("jwk", persisted.privateKey), error =>
    error instanceof DOMException && ["InvalidAccessError", "InvalidAccessException"].includes(error.name));
  await assert.rejects(first.createIntrospectionProof(["creator:publish"]), { code: "SESSION_INACTIVE" });
  assert.equal((await connect(first, s.config)).status, "connected");
  const api = await first.createIntrospectionProof(["creator:publish"]);
  assert.equal(api.body, '{"requiredScopes":["creator:publish"]}');
  assert.equal((await s.gateway.introspect({ requestId: api.requestId, sessionBinding: api.proof.sessionBinding, requiredScopes: ["creator:publish"], proof: api.proof })).active, true);
  await assert.rejects(s.gateway.introspect({ requestId: `req_replay_${token("replay")}`, sessionBinding: api.proof.sessionBinding, requiredScopes: ["creator:publish"], proof: api.proof }), { code: "REPLAY" });
  await assert.rejects(first.createIntrospectionProof(["video:playback"]), { code: "SCOPE_WIDENING" });
  first.close();
  const restarted = await createBrowserProductSessionClient(s.config);
  assert.equal(restarted.device.id, first.device.id); assert.equal(restarted.device.key, first.device.key);
  assert.equal(s.generated.length, 1);
  assert.equal((await restarted.client.restore()).status, "connected");
  assert.equal((await restarted.client.disconnect()).status, "disconnected");
  assert.equal(s.handler.snapshot().authority.revokedSessions.length, 1);
  assert.equal(await restarted.storage.get(restarted.client.storageKey), null);
  assert.equal(s.exports.every(entry => entry.format === "raw" && entry.type === "public"), true);
  for (const entry of s.seen) assert.equal(/privateKey|deviceSecret|"secret"|"jwk"/.test(JSON.stringify(entry)), false);
  restarted.close();
});

for (const localOffsetMs of [-600_000, 400, 600_000]) test(`authority time survives ${localOffsetMs} ms local skew for login, API, refresh and revoke`, async () => {
  const s = setup({ localOffsetMs }), browser = await createBrowserProductSessionClient(s.config);
  assert.equal((await connect(browser, s.config)).status, "connected");
  const proof = await browser.createIntrospectionProof(["creator:account"]);
  assert.equal(proof.proof.issuedAt, NOW.toISOString());
  assert.equal(Date.parse(proof.proof.expiresAt) - Date.parse(proof.proof.issuedAt), 30_000);
  assert.equal((await s.gateway.introspect({ requestId: proof.requestId, sessionBinding: proof.proof.sessionBinding, requiredScopes: ["creator:account"], proof: proof.proof })).active, true);
  browser.close();
  const restarted = await createBrowserProductSessionClient(s.config);
  assert.equal((await restarted.client.restore()).status, "connected");
  assert.equal((await restarted.client.disconnect()).status, "disconnected");
  assert.equal(s.handler.snapshot().authority.revokedSessions.length, 1);
  restarted.close();
});

test("time outages preserve the session for Retry and never permit local-clock API proofs or pretend revocation", async () => {
  const s = setup({ localOffsetMs: 600_000 }), first = await createBrowserProductSessionClient(s.config);
  assert.equal((await connect(first, s.config)).status, "connected");
  const stored = await first.storage.get(first.client.storageKey);
  s.authority.unavailable = true;
  await assert.rejects(first.createIntrospectionProof(["creator:account"]), { code: "NETWORK_UNAVAILABLE" });
  assert.equal((await first.client.disconnect()).status, "network-unavailable");
  assert.equal(await first.storage.get(first.client.storageKey), stored);
  assert.equal(s.handler.snapshot().authority.revokedSessions.length, 0);
  first.close();
  const restarted = await createBrowserProductSessionClient(s.config);
  assert.equal((await restarted.client.restore()).status, "retry-required");
  assert.equal(await restarted.storage.get(restarted.client.storageKey), stored);
  s.authority.unavailable = false;
  const result = await restarted.client.retry({ walletInstalled: true, schemeRegistered: true });
  assert.equal(result.status, "disconnected"); assert.equal(result.revocationConfirmed, true);
  restarted.close();
});

test("unverified authority time retains stored state for repair and cannot fall back to the device clock", async () => {
  const s = setup(), browser = await createBrowserProductSessionClient(s.config);
  assert.equal((await connect(browser, s.config)).status, "connected");
  const stored = await browser.storage.get(browser.client.storageKey);
  s.authority.malformed = true;
  await assert.rejects(browser.createIntrospectionProof(["creator:account"]), { code: "CLOCK_UNAVAILABLE" });
  assert.equal((await browser.client.restore()).status, "network-unavailable");
  assert.equal(await browser.storage.get(browser.client.storageKey), stored);
  browser.close();
});

test("a clock lookup racing sign-out cannot release an API proof", async () => {
  const s = setup(), browser = await createBrowserProductSessionClient(s.config);
  assert.equal((await connect(browser, s.config)).status, "connected");
  const originalTime = s.gateway.currentTime.bind(s.gateway);
  let releaseTime, enteredTime;
  const entered = new Promise(resolve => { enteredTime = resolve; });
  s.gateway.currentTime = async () => { enteredTime(); return new Promise(resolve => { releaseTime = resolve; }); };
  const pending = browser.createIntrospectionProof(["creator:account"]);
  await entered;
  s.gateway.currentTime = originalTime;
  assert.equal((await browser.client.disconnect()).status, "disconnected");
  releaseTime(NOW);
  await assert.rejects(pending, { code: "SESSION_INACTIVE" });
  browser.close();
});

test("sign-out awaiting authority time immediately blocks both pending and new API proofs", async () => {
  const s = setup(), browser = await createBrowserProductSessionClient(s.config);
  assert.equal((await connect(browser, s.config)).status, "connected");
  const connected = browser.client.current;
  let releaseApiTime, releaseLogoutTime, enteredApiTime, enteredLogoutTime, timeCalls = 0;
  const apiEntered = new Promise(resolve => { enteredApiTime = resolve; });
  const logoutEntered = new Promise(resolve => { enteredLogoutTime = resolve; });
  s.gateway.currentTime = async () => {
    timeCalls++;
    if (timeCalls === 1) { enteredApiTime(); return new Promise(resolve => { releaseApiTime = resolve; }); }
    if (timeCalls === 2) { enteredLogoutTime(); return new Promise(resolve => { releaseLogoutTime = resolve; }); }
    throw new Error("A new API proof must not request authority time during sign-out");
  };
  const pending = browser.createIntrospectionProof(["creator:account"]);
  await apiEntered;
  const logout = browser.client.disconnect();
  try {
    const revoking = browser.client.current;
    assert.notEqual(revoking, connected);
    assert.equal(revoking, browser.client.current, "the pending public state remains stable");
    assert.equal(revoking.session, undefined);
    await logoutEntered;
    await assert.rejects(browser.createIntrospectionProof(["creator:account"]), { code: "SESSION_INACTIVE" });
    releaseApiTime(NOW);
    await assert.rejects(pending, { code: "SESSION_INACTIVE" });
    assert.equal(timeCalls, 2);
    assert.equal(s.handler.snapshot().authority.revokedSessions.length, 0, "revocation is still awaiting authority time");
    assert.equal(browser.client.current, revoking);
    releaseLogoutTime(NOW);
    assert.equal((await logout).status, "disconnected");
    assert.equal(s.handler.snapshot().authority.revokedSessions.length, 1);
    assert.equal(await browser.storage.get(browser.client.storageKey), null);
  } finally {
    releaseApiTime?.(NOW); releaseLogoutTime?.(NOW);
    await Promise.allSettled([pending, logout]);
    browser.close();
  }
});

test("restore completing during sign-out returns the pending public state instead of a late session", async () => {
  const s = setup(), browser = await createBrowserProductSessionClient(s.config);
  assert.equal((await connect(browser, s.config)).status, "connected");
  let releaseRestoreTime, releaseLogoutTime, enteredRestoreTime, enteredLogoutTime, timeCalls = 0;
  const restoreEntered = new Promise(resolve => { enteredRestoreTime = resolve; });
  const logoutEntered = new Promise(resolve => { enteredLogoutTime = resolve; });
  s.gateway.currentTime = async () => {
    timeCalls++;
    if (timeCalls === 1) { enteredRestoreTime(); return new Promise(resolve => { releaseRestoreTime = resolve; }); }
    if (timeCalls === 2) { enteredLogoutTime(); return new Promise(resolve => { releaseLogoutTime = resolve; }); }
    throw new Error("Unexpected authority time request");
  };
  const restoring = browser.client.restore();
  await restoreEntered;
  const logout = browser.client.disconnect();
  try {
    const revoking = browser.client.current;
    releaseRestoreTime(NOW);
    const restored = await restoring;
    await logoutEntered;
    assert.equal(restored, revoking);
    assert.notEqual(restored.status, "connected");
    assert.equal(restored.session, undefined);
    assert.equal(browser.client.current, revoking);
    assert.equal(s.handler.snapshot().authority.revokedSessions.length, 0);
    releaseLogoutTime(NOW);
    assert.equal((await logout).status, "disconnected");
    assert.equal(s.handler.snapshot().authority.revokedSessions.length, 1);
    assert.equal(await browser.storage.get(browser.client.storageKey), null);
  } finally {
    releaseRestoreTime?.(NOW); releaseLogoutTime?.(NOW);
    await Promise.allSettled([restoring, logout]);
    browser.close();
  }
});

test("authority time bounds near-expiry proofs and rejects expired sessions even with a slow local clock", async () => {
  const s = setup({ localOffsetMs: -600_000 }), browser = await createBrowserProductSessionClient(s.config);
  assert.equal((await connect(browser, s.config)).status, "connected");
  const expiresAt = browser.client.current.session.expiresAt;
  s.authority.now = new Date(Date.parse(expiresAt) - 10);
  const nearExpiry = await browser.createIntrospectionProof(["creator:account"]);
  assert.equal(nearExpiry.proof.expiresAt, expiresAt);
  s.authority.now = new Date(expiresAt);
  await assert.rejects(browser.createIntrospectionProof(["creator:account"]), { code: "SESSION_EXPIRED" });
  const expired = await browser.client.disconnect();
  assert.equal(expired.status, "expired"); assert.equal(expired.revocationConfirmed, false);
  assert.equal(s.handler.snapshot().authority.revokedSessions.length, 0); // Already expired at Auth; no fabricated revoke.
  browser.close();
});

test("product, exact scopes and origin select separate keys and cannot read each other's state", async () => {
  const s = setup(), full = await createBrowserProductSessionClient(s.config);
  const limited = await createBrowserProductSessionClient({ ...s.config, scopes: ["creator:account"] });
  assert.notEqual(full.device.key, limited.device.key);
  assert.notEqual(full.device.id, limited.device.id);
  assert.equal((await connect(full, s.config)).status, "connected");
  assert.equal(await limited.storage.get(limited.client.storageKey), null);
  await assert.rejects(limited.storage.set(limited.client.storageKey, JSON.stringify(full.client.current.session)), { code: "DEVICE_CHANGED" });
  const video = await createBrowserProductSessionClient({ ...s.config, productId: "video", scopes: ["video:account"], environment: { ...s.environment, location: { origin: "https://video.ynxweb4.com" } } });
  assert.notEqual(video.device.key, full.device.key);
  await assert.rejects(video.storage.get(full.client.storageKey), { code: "CROSS_PRODUCT_SESSION" });
  const count = s.indexedDB.records("devices").size;
  await assert.rejects(createBrowserProductSessionClient({ ...s.config, environment: { ...s.environment, location: { origin: "https://web4.ynxweb4.com" } } }), { code: "ORIGIN_NOT_ALLOWED" });
  await assert.rejects(createBrowserProductSessionClient({ ...s.config, environment: { ...s.environment, isSecureContext: false } }), { code: "ORIGIN_NOT_ALLOWED" });
  assert.equal(s.indexedDB.records("devices").size, count);
  full.close(); limited.close(); video.close();
});

test("concurrent tabs reuse the committed key instead of overwriting each other's device", async () => {
  const s = setup();
  const [first, second] = await Promise.all([createBrowserProductSessionClient(s.config), createBrowserProductSessionClient(s.config)]);
  assert.equal(first.device.id, second.device.id); assert.equal(first.device.key, second.device.key);
  assert.equal(s.indexedDB.records("devices").size, 1);
  assert.equal((await connect(first, s.config)).status, "connected");
  assert.equal((await second.client.restore()).status, "connected");
  first.close(); second.close();
});

test("missing, extractable, wrong public or mismatched private key fails closed without replacement", async () => {
  for (const mutation of ["missing", "extractable", "public", "private", "binding"]) {
    const s = setup(), adapter = await createBrowserProductSessionClient(s.config);
    await connect(adapter, s.config); adapter.close();
    const records = s.indexedDB.records("devices"), [namespace, record] = [...records][0];
    const replacement = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, mutation === "extractable", ["sign", "verify"]);
    if (mutation === "missing") records.delete(namespace);
    else if (mutation === "public") record.publicKey = replacement.publicKey;
    else if (mutation === "binding") record.namespace = "another-product";
    else record.privateKey = replacement.privateKey;
    await assert.rejects(createBrowserProductSessionClient(s.config), error => ["DEVICE_CHANGED", "INSECURE_STORAGE"].includes(error.code), mutation);
    assert.equal(s.generated.length, 1, "must not replace a damaged identity automatically");
    assert.equal(s.handler.snapshot().authority.sessions.length, 1);
  }
});

test("device deletion during an open session prevents later proof generation", async () => {
  const s = setup(), adapter = await createBrowserProductSessionClient(s.config);
  await connect(adapter, s.config);
  s.indexedDB.records("devices").clear();
  await assert.rejects(adapter.createIntrospectionProof(["creator:publish"]), { code: "DEVICE_CHANGED" });
  assert.equal(s.handler.snapshot().consumedProofs.length, 1); // Only the initial login introspection.
  adapter.close();
});

test("browser storage assurance is accepted only with a Web signer and never with an exported secret", async () => {
  const s = setup(), adapter = await createBrowserProductSessionClient(s.config);
  const common = { registry, productId: "creator-studio", storage: adapter.storage, gateway: s.gateway, device: adapter.device, tokenFactory: () => token("policy"), clock: () => NOW };
  for (const platform of ["android", "ios", "linux", "macos", "windows"]) assert.throws(() => new RecoverableProductSessionClient({ ...common, platform }), { code: "INSECURE_STORAGE" });
  assert.throws(() => new RecoverableProductSessionClient({ ...common, platform: "web", device: { ...adapter.device, secret: token("not-a-key") } }), { code: "INSECURE_STORAGE" });
  const { sign: _sign, ...device } = adapter.device;
  assert.throws(() => new RecoverableProductSessionClient({ ...common, platform: "web", device }), { code: "INSECURE_STORAGE" });
  adapter.close();
});

test("IndexedDB failure has no in-memory or plaintext fallback", async () => {
  const s = setup();
  await assert.rejects(createBrowserProductSessionClient({ ...s.config, environment: { ...s.environment, indexedDB: { open() { throw new Error("denied"); } } } }), { code: "INSECURE_STORAGE" });
  s.indexedDB.failWrites = true;
  await assert.rejects(createBrowserProductSessionClient(s.config), { code: "INSECURE_STORAGE" });
  assert.equal(s.indexedDB.records("devices").size, 0);
  assert.equal(s.indexedDB.records("state").size, 0);
});

test("pending sign-out survives reload, blocks login and proofs, and requires explicit authority Retry", async () => {
  const s = setup(), first = await createBrowserProductSessionClient(s.config);
  await connect(first, s.config);
  const target = first.client.current.session, key = `${first.client.storageKey}:revoke`;
  s.authority.unavailable = true;
  const pendingLogout = await first.client.disconnect();
  assert.equal(pendingLogout.status, "network-unavailable"); assert.deepEqual(pendingLogout.actions, ["retry"]);
  assert.equal(pendingLogout.revocationPending, true);
  const intent = await first.storage.get(key);
  assert.deepEqual(JSON.parse(intent).session, target);
  first.close();
  const restarted = await createBrowserProductSessionClient(s.config), requestCount = s.seen.length;
  assert.equal((await restarted.client.restore()).revocationPending, true);
  assert.equal((await restarted.client.begin({ walletInstalled: true, schemeRegistered: true })).revocationPending, true);
  assert.equal((await restarted.client.handleReturn("https://creator.ynxweb4.com/?irrelevant=callback")).revocationPending, true);
  await assert.rejects(restarted.createIntrospectionProof(["creator:account"]), { code: "SESSION_INACTIVE" });
  assert.equal(s.seen.length, requestCount, "restore and begin never auto-contact Auth for a saved logout");
  assert.equal(await restarted.storage.get(key), intent);
  s.authority.now = new Date(target.expiresAt);
  assert.equal((await restarted.client.retry({ walletInstalled: true, schemeRegistered: true })).status, "network-unavailable");
  assert.equal(await restarted.storage.get(key), intent, "offline clock cannot resolve target expiry");
  s.authority.unavailable = false;
  const expired = await restarted.client.retry({ walletInstalled: true, schemeRegistered: true });
  assert.equal(expired.status, "expired"); assert.equal(expired.revocationConfirmed, false);
  assert.equal(expired.sessionBinding, target.sessionBinding);
  assert.equal(await restarted.storage.get(key), null);
  assert.equal(await restarted.storage.get(restarted.client.storageKey), null);
  assert.equal(s.handler.snapshot().authority.revokedSessions.length, 0);
  restarted.close();
});

test("failed intent persistence blocks revocation I/O and business proofs until the same target is saved", async () => {
  const s = setup(), browser = await createBrowserProductSessionClient(s.config);
  await connect(browser, s.config);
  const target = browser.client.current.session, requestCount = s.seen.length;
  s.indexedDB.failWrites = true;
  assert.equal((await browser.client.disconnect()).revocationPending, true);
  assert.equal(s.seen.length, requestCount, "no clock or revoke call before durable intent");
  await assert.rejects(browser.createIntrospectionProof(["creator:account"]), { code: "SESSION_INACTIVE" });
  assert.equal((await browser.client.begin({ walletInstalled: true, schemeRegistered: true })).revocationPending, true);
  assert.equal(s.seen.length, requestCount);
  s.indexedDB.failWrites = false;
  const result = await browser.client.retry({ walletInstalled: true, schemeRegistered: true });
  assert.equal(result.status, "disconnected"); assert.equal(result.revocationConfirmed, true);
  assert.equal(result.sessionBinding, target.sessionBinding);
  assert.deepEqual(s.handler.snapshot().authority.revokedSessions, [target.sessionBinding]);
  browser.close();
});

test("a browser clock cannot resolve pending logout expiry without authenticated authority time", async () => {
  const s = setup({ localOffsetMs: 600_000 }), browser = await createBrowserProductSessionClient(s.config);
  await connect(browser, s.config);
  const target = browser.client.current.session;
  s.gateway.currentTime = undefined;
  const result = await browser.client.disconnect();
  assert.equal(result.status, "retry-required"); assert.notEqual(result.revocationConfirmed, true);
  assert.deepEqual(JSON.parse(await browser.storage.get(`${browser.client.storageKey}:revoke`)).session, target);
  assert.deepEqual(JSON.parse(await browser.storage.get(browser.client.storageKey)), target);
  assert.equal(s.handler.snapshot().authority.revokedSessions.length, 0);
  browser.close();
});

test("lost revoke receipt retains exact target through reload and fresh Retry confirms its revocation", async () => {
  const s = setup(), first = await createBrowserProductSessionClient(s.config);
  await connect(first, s.config);
  const target = first.client.current.session, original = s.gateway.revoke.bind(s.gateway);
  s.gateway.revoke = async input => { await original(input); throw new WalletAuthError("NETWORK_UNAVAILABLE", "receipt lost after revoke commit"); };
  assert.equal((await first.client.disconnect()).status, "network-unavailable");
  const intent = await first.storage.get(`${first.client.storageKey}:revoke`);
  assert.deepEqual(s.handler.snapshot().authority.revokedSessions, [target.sessionBinding]);
  first.close(); s.gateway.revoke = original;
  const restarted = await createBrowserProductSessionClient(s.config), before = s.seen.length;
  assert.equal((await restarted.client.restore()).revocationPending, true);
  assert.equal(s.seen.length, before);
  assert.equal(await restarted.storage.get(`${restarted.client.storageKey}:revoke`), intent);
  const result = await restarted.client.retry({ walletInstalled: true, schemeRegistered: true });
  assert.equal(result.status, "disconnected"); assert.equal(result.revocationConfirmed, true);
  assert.equal(result.sessionBinding, target.sessionBinding);
  const revokes = s.seen.filter(item => new URL(item.url).pathname.endsWith("/revoke"));
  assert.equal(revokes.length, 2);
  assert.notEqual(revokes[0].headers["x-ynx-product-session-proof-v2"], revokes[1].headers["x-ynx-product-session-proof-v2"]);
  assert.equal(await restarted.storage.get(`${restarted.client.storageKey}:revoke`), null);
  restarted.close();
});

test("wrong revocation receipt and another tab cannot bypass the persisted sign-out target", async () => {
  const s = setup(), first = await createBrowserProductSessionClient(s.config);
  await connect(first, s.config);
  const second = await createBrowserProductSessionClient(s.config); await second.client.restore();
  const target = first.client.current.session, original = s.gateway.revoke.bind(s.gateway);
  s.gateway.revoke = async () => ({ revoked: "0".repeat(64) });
  assert.equal((await first.client.disconnect()).status, "retry-required");
  const intent = await first.storage.get(`${first.client.storageKey}:revoke`);
  assert.deepEqual(JSON.parse(intent).session, target);
  assert.equal(second.client.current.status, "connected", "the other tab still has an old in-memory view");
  await assert.rejects(second.createIntrospectionProof(["creator:account"]), { code: "SESSION_INACTIVE" });
  assert.equal(s.handler.snapshot().authority.revokedSessions.length, 0);
  s.gateway.revoke = original;
  assert.equal((await first.client.retry({ walletInstalled: true, schemeRegistered: true })).revocationConfirmed, true);
  await assert.rejects(second.createIntrospectionProof(["creator:account"]), { code: "SESSION_INACTIVE" });
  first.close(); second.close();
});

test("a late exact-target logout receipt never deletes a newer stored session", async () => {
  const s = setup(), browser = await createBrowserProductSessionClient(s.config); await connect(browser, s.config);
  const target = browser.client.current.session;
  const request = createProductSessionRequest(registry, { productId: "creator-studio", platform: "web", deviceId: browser.device.id, deviceKey: browser.device.key, scopes, purpose: "Independent newer-account fixture.", nonce: token("newer-account-nonce"), state: token("newer-account-state") }, NOW);
  const approval = signProductSessionApproval(registry, request, { accountSecret: "2".padStart(64, "0"), scopes, expiresAt: request.expiresAt }, NOW);
  const challenge = await s.gateway.challenge({ requestId: "req_newer_fixture_challenge", request, approval });
  const completion = await signProductSessionChallengeWith(challenge, browser.device.sign);
  const newer = await s.gateway.complete({ requestId: "req_newer_fixture_complete", request, approval, completion });
  const original = s.gateway.revoke.bind(s.gateway);
  let entered, release; const started = new Promise(resolve => { entered = resolve; }), blocked = new Promise(resolve => { release = resolve; });
  s.gateway.revoke = async input => { const result = await original(input); entered(); await blocked; return result; };
  const logout = browser.client.disconnect(); await started;
  // Simulate a pre-upgrade tab that writes B while A's response is in flight.
  const storedState = [...s.indexedDB.records("state").values()][0];
  storedState.values[browser.client.storageKey] = JSON.stringify(newer);
  release(); const result = await logout;
  assert.equal(result.sessionBinding, target.sessionBinding); assert.equal(result.revocationConfirmed, true);
  assert.deepEqual(JSON.parse(await browser.storage.get(browser.client.storageKey)), newer);
  assert.equal(s.handler.snapshot().authority.revokedSessions.includes(newer.sessionBinding), false);
  browser.close();
});

for (const delay of [59_999, 60_000, 61_000]) test(`real WebCrypto reload retries the exact lost completion body after ${delay} ms`, async () => {
  const s = setup(), first = await createBrowserProductSessionClient(s.config), original = s.gateway.complete.bind(s.gateway);
  let lose = true;
  s.gateway.complete = async input => { const result = await original(input); if (lose) { lose = false; throw new WalletAuthError("NETWORK_UNAVAILABLE", "completion response lost"); } return result; };
  assert.equal((await connect(first, s.config)).status, "network-unavailable");
  const stored = await first.storage.get(`${first.client.storageKey}:completion`);
  assert.ok(stored); const originalSignature = JSON.parse(stored).completion.deviceSignature;
  first.close(); s.authority.now = new Date(NOW.getTime() + delay);
  const restarted = await createBrowserProductSessionClient(s.config);
  assert.equal((await restarted.client.retry({ walletInstalled: true, schemeRegistered: true })).status, "connected");
  const completions = s.seen.filter(item => new URL(item.url).pathname.endsWith("/complete"));
  assert.equal(completions.length, 2); assert.equal(completions[0].body, completions[1].body);
  assert.equal(JSON.parse(completions[1].body).completion.deviceSignature, originalSignature);
  assert.equal(s.seen.filter(item => new URL(item.url).pathname.endsWith("/challenge")).length, 1);
  assert.equal(s.handler.snapshot().authority.sessions.length, 1);
  restarted.close();
});

for (const failure of ["uncompleted", "revoked", "session-expired"]) test(`protected completion Retry rejects ${failure} without a new challenge or signature`, async () => {
  const s = setup(), first = await createBrowserProductSessionClient(s.config), original = s.gateway.complete.bind(s.gateway);
  let lose = true;
  s.gateway.complete = async input => {
    if (lose && failure === "uncompleted") { lose = false; throw new WalletAuthError("NETWORK_UNAVAILABLE", "request never reached Auth"); }
    const result = await original(input);
    if (lose) { lose = false; throw new WalletAuthError("NETWORK_UNAVAILABLE", "completion response lost"); }
    return result;
  };
  assert.equal((await connect(first, s.config)).status, "network-unavailable");
  const record = JSON.parse(await first.storage.get(`${first.client.storageKey}:completion`));
  if (failure === "revoked") {
    const active = await createBrowserProductSessionClient(s.config); await active.client.restore();
    assert.equal((await active.client.disconnect()).status, "disconnected"); active.close();
    // Restore only the lost-response retry envelope to test server rejection.
    await first.storage.set(`${first.client.storageKey}:pending`, JSON.stringify(record.request));
    await first.storage.set(`${first.client.storageKey}:return`, createProductSessionReturnURL(registry, record.request, { result: "approved", approval: record.approval }, NOW));
    await first.storage.set(`${first.client.storageKey}:completion`, canonicalJSON(record));
  }
  first.close();
  s.authority.now = failure === "session-expired" ? new Date(record.completion.challenge.sessionExpiresAt) : new Date(NOW.getTime() + 61_000);
  const restarted = await createBrowserProductSessionClient(s.config);
  const result = await restarted.client.retry({ walletInstalled: true, schemeRegistered: true });
  assert.equal(result.status, "retry-required"); assert.equal(result.session, undefined);
  assert.equal(s.seen.filter(item => new URL(item.url).pathname.endsWith("/challenge")).length, 1);
  assert.equal(s.handler.snapshot().authority.sessions.length, failure === "uncompleted" ? 0 : 1);
  restarted.close();
});

test("logout after a lost first completion fixes the actual target and revokes after reload without replaying complete", async () => {
  const s = setup(), first = await createBrowserProductSessionClient(s.config), original = s.gateway.complete.bind(s.gateway);
  s.gateway.complete = async input => { await original(input); throw new WalletAuthError("NETWORK_UNAVAILABLE", "first completion receipt lost"); };
  assert.equal((await connect(first, s.config)).status, "network-unavailable");
  assert.equal(await first.storage.get(first.client.storageKey), null);
  const actual = s.handler.snapshot().authority.sessions[0];
  s.authority.unavailable = true;
  assert.equal((await first.client.disconnect()).status, "network-unavailable");
  const intent = await first.storage.get(`${first.client.storageKey}:revoke`);
  assert.deepEqual(JSON.parse(intent).session, actual, "derived target must equal every field of the actual authority result");
  first.close(); const restarted = await createBrowserProductSessionClient(s.config);
  assert.equal((await restarted.client.restore()).revocationPending, true);
  s.authority.unavailable = false;
  const result = await restarted.client.retryDetected();
  assert.equal(result.status, "disconnected"); assert.equal(result.revocationConfirmed, true);
  assert.equal(result.sessionBinding, actual.sessionBinding);
  assert.deepEqual(s.handler.snapshot().authority.revokedSessions, [actual.sessionBinding]);
  assert.equal(s.seen.filter(item => new URL(item.url).pathname.endsWith("/complete")).length, 1);
  assert.equal(s.seen.filter(item => new URL(item.url).pathname.endsWith("/challenge")).length, 1);
  assert.equal(restarted.client.current.session, undefined);
  restarted.close();
});

test("uncommitted completion logout stays unconfirmed on 404 and ends only at verified target expiry", async () => {
  const s = setup(), first = await createBrowserProductSessionClient(s.config);
  s.gateway.complete = async () => { throw new WalletAuthError("NETWORK_UNAVAILABLE", "completion never reached Auth"); };
  assert.equal((await connect(first, s.config)).status, "network-unavailable");
  const result = await first.client.disconnect();
  assert.equal(result.status, "retry-required"); assert.notEqual(result.revocationConfirmed, true);
  const intent = await first.storage.get(`${first.client.storageKey}:revoke`), target = JSON.parse(intent).session;
  assert.ok(target.sessionBinding); assert.equal(s.handler.snapshot().authority.sessions.length, 0);
  first.close(); const restarted = await createBrowserProductSessionClient(s.config);
  assert.equal((await restarted.client.restore()).revocationPending, true);
  s.authority.now = new Date(NOW.getTime() + 61_000);
  assert.equal((await restarted.client.retryDetected()).status, "retry-required");
  assert.equal(await restarted.storage.get(`${restarted.client.storageKey}:revoke`), intent);
  s.authority.now = new Date(target.expiresAt);
  const expired = await restarted.client.retryDetected();
  assert.equal(expired.status, "expired"); assert.equal(expired.revocationConfirmed, false);
  assert.equal(expired.sessionBinding, target.sessionBinding);
  assert.equal(await restarted.storage.get(`${restarted.client.storageKey}:revoke`), null);
  assert.equal(s.handler.snapshot().authority.sessions.length, 0);
  assert.equal(s.handler.snapshot().authority.revokedSessions.length, 0);
  assert.equal(s.seen.filter(item => new URL(item.url).pathname.endsWith("/complete")).length, 0);
  restarted.close();
});


// Endpoint labels below identify independent synthetic authorities; fetch is an
// injected local handler and never performs any network I/O.
test("switching Gateway authority never sends an old session proof to the new endpoint or deletes old state", async () => {
  const a = setup({ endpoint: "https://legacy-auth.example" });
  const first = await createBrowserProductSessionClient(a.config);
  assert.equal((await connect(first, a.config)).status, "connected");
  const previous = structuredClone([...a.indexedDB.records("state")]);
  first.close();
  const b = setup({ indexedDB: a.indexedDB, endpoint: "https://replacement-auth.example" });
  const next = await createBrowserProductSessionClient(b.config);
  try {
    await next.client.restore();
    assert.equal(b.seen.filter(item => new URL(item.url).pathname !== "/v2/product-sessions/time").length, 0, "old proof/completion/revoke must never be sent to the new authority");
    assert.notEqual(next.device.id, first.device.id);
    assert.equal(await next.storage.get(next.client.storageKey), null);
    for (const [key, value] of previous) assert.deepEqual(a.indexedDB.records("state").get(key), value);
  } finally { next.close(); }
  const original = await createBrowserProductSessionClient(a.config);
  try { assert.equal(original.device.id, first.device.id); assert.equal((await original.client.restore()).status, "connected"); }
  finally { original.close(); }
});

test("pending request and durable sign-out remain isolated under their exact authority", async () => {
  const a = setup({ endpoint: "https://legacy-auth.example" });
  const first = await createBrowserProductSessionClient(a.config);
  const prepared = await first.client.beginExplicit();
  const pending = await first.storage.get(first.client.storageKey + ":pending");
  const b = setup({ indexedDB: a.indexedDB, endpoint: "https://replacement-auth.example" });
  const next = await createBrowserProductSessionClient(b.config);
  try {
    assert.equal(await next.storage.get(next.client.storageKey + ":pending"), null);
    assert.notEqual(next.device.id, first.device.id);
    const other = await next.client.beginExplicit();
    assert.notEqual(other.request.nonce, prepared.request.nonce);
    assert.equal(await first.storage.get(first.client.storageKey + ":pending"), pending);
    assert.equal((await connect(first, a.config)).status, "connected");
    a.authority.unavailable = true;
    assert.equal((await first.client.disconnect()).status, "network-unavailable");
    const oldIntent = await first.storage.get(first.client.storageKey + ":revoke");
    assert.ok(oldIntent);
    assert.equal(await next.storage.get(next.client.storageKey + ":revoke"), null);
    await next.client.disconnect();
    assert.equal(await first.storage.get(first.client.storageKey + ":revoke"), oldIntent);
    assert.equal(b.seen.some(item => new URL(item.url).pathname.endsWith("/revoke")), false);
  } finally { first.close(); next.close(); }
});

test("unbound legacy device and all old records stay untouched and require a new approval", async () => {
  const s = setup({ endpoint: "https://legacy-auth.example" });
  const first = await createBrowserProductSessionClient(s.config);
  assert.equal((await connect(first, s.config)).status, "connected");
  await first.client.beginExplicit();
  await first.storage.set(first.client.storageKey + ":return", "legacy-callback-preserved");
  first.close();
  const [boundNamespace, boundDevice] = [...s.indexedDB.records("devices")][0];
  const oldBinding = JSON.parse(boundNamespace); delete oldBinding.authority;
  const legacyNamespace = canonicalJSON(oldBinding);
  const legacyDevice = { ...boundDevice, version: 1, namespace: legacyNamespace }; delete legacyDevice.authority;
  const legacyState = { ...s.indexedDB.records("state").get(boundNamespace), version: 1 }; delete legacyState.authority;
  s.indexedDB.records("devices").delete(boundNamespace); s.indexedDB.records("state").delete(boundNamespace);
  s.indexedDB.records("devices").set(legacyNamespace, legacyDevice); s.indexedDB.records("state").set(legacyNamespace, legacyState);
  const previousState = structuredClone(legacyState), generatedBefore = s.generated.length;
  const readsBefore = s.indexedDB.reads.length, seenBefore = s.seen.length;
  const next = await createBrowserProductSessionClient(s.config);
  try {
    assert.notEqual(next.device.id, legacyDevice.deviceId);
    assert.equal(s.generated.length, generatedBefore + 1);
    assert.equal(await next.storage.get(next.client.storageKey), null);
    assert.equal(await next.storage.get(next.client.storageKey + ":pending"), null);
    await next.client.restore();
    assert.equal(s.seen.slice(seenBefore).some(item => new URL(item.url).pathname !== "/v2/product-sessions/time"), false);
    assert.equal(s.indexedDB.reads.slice(readsBefore).some(item => item.key === legacyNamespace), false, "old unbound records are never read or assigned a guessed authority");
    assert.deepEqual(s.indexedDB.records("state").get(legacyNamespace), previousState);
    const kept = s.indexedDB.records("devices").get(legacyNamespace);
    assert.equal(kept.deviceId, legacyDevice.deviceId); assert.equal(kept.deviceKey, legacyDevice.deviceKey); assert.equal(kept.privateKey.extractable, false);
    const bytes = new Uint8Array([1, 2, 3]), signature = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kept.privateKey, bytes);
    assert.equal(await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, kept.publicKey, signature, bytes), true, "legacy key remains usable; no deletion or migration occurred");
  } finally { next.close(); }
});

test("authority metadata comes from the real constructor, not a property, prototype copy, duck type or Proxy", async () => {
  const s = setup({ endpoint: "https://legacy-auth.example" });
  assert.equal(productSessionGatewayAuthority(s.gateway), "https://legacy-auth.example");
  s.gateway.authority = "https://replacement-auth.example";
  assert.equal(productSessionGatewayAuthority(s.gateway), "https://legacy-auth.example");
  for (const candidate of [Object.create(ProductSessionGatewayFetchAdapter.prototype), new Proxy(s.gateway, {}), { authority: "https://legacy-auth.example", currentTime: s.gateway.currentTime.bind(s.gateway) }]) {
    assert.throws(() => productSessionGatewayAuthority(candidate), { code: "INVALID_GATEWAY" });
    await assert.rejects(createBrowserProductSessionClient({ ...s.config, gateway: candidate }), { code: "INVALID_GATEWAY" });
  }
  assert.equal(s.indexedDB.records("devices").size, 0); assert.equal(s.generated.length, 0); assert.equal(s.seen.length, 0);
  for (const endpoint of ["https://legacy-auth.example/ide6441", "https://legacy-auth.example/", "https://legacy-auth.example:443", "https://legacy-auth.example?authority=b", "https://LEGACY-auth.example"]) {
    assert.throws(() => new ProductSessionGatewayFetchAdapter({ endpoint, fetch: async () => assert.fail("not dispatched"), walletInstalled: async () => true, schemeRegistered: async () => true, timeoutMs: 1000 }), { code: "INVALID_GATEWAY" });
  }
});

for (const storeName of ["devices", "state"]) test(`changed ${storeName} authority fails closed in the same namespace without replacement`, async () => {
  const s = setup(), first = await createBrowserProductSessionClient(s.config);
  const [namespace, record] = [...s.indexedDB.records(storeName)][0];
  assert.equal(record.version, 2); assert.equal(record.authority, "https://wallet-auth.ynxweb4.com");
  record.authority = "https://foreign-auth.example";
  const before = structuredClone(record);
  await assert.rejects(first.storage.get(first.client.storageKey), { code: "DEVICE_CHANGED" });
  first.close();
  await assert.rejects(createBrowserProductSessionClient(s.config), { code: "DEVICE_CHANGED" });
  assert.deepEqual(s.indexedDB.records(storeName).get(namespace), before);
  assert.equal(s.generated.length, 1); assert.equal(s.seen.length, 0);
});

// A narrow IndexedDB transaction fake: request callbacks, structured-cloned values,
// serialized transactions and atomic commit/abort. Cryptography above is real WebCrypto.
function fakeIndexedDB() {
  const databases = new Map();
  const api = { failWrites: false, reads: [], records(name) { return databases.values().next().value?.stores.get(name) ?? new Map(); }, open(name) {
    const request = {};
    setImmediate(() => {
      let database = databases.get(name), created = false;
      if (!database) { database = { stores: new Map(), queue: [], running: false }; databases.set(name, database); created = true; }
      let closed = false;
      request.result = {
        objectStoreNames: { contains: name => database.stores.has(name) },
        createObjectStore(name) { database.stores.set(name, new Map()); },
        close() { closed = true; },
        transaction(names, mode) {
          if (closed) throw new Error("closed database");
          const requests = []; let ended = false, stores;
          const transaction = {
            objectStore(name) {
              if (!names.includes(name)) throw new Error("missing store");
              const enqueue = (operation, key, value) => {
                const req = {};
                requests.push(() => {
                  try {
                    const values = stores.get(name);
                    if (operation === "get") { api.reads.push({ store: name, key }); req.result = structuredClone(values.get(key)); }
                    else {
                      if (mode !== "readwrite" || api.failWrites) throw new Error("write rejected");
                      if (operation === "add" && values.has(key)) throw new Error("duplicate key");
                      values.set(key, structuredClone(value)); req.result = key;
                    }
                    req.onsuccess?.();
                  } catch (error) { req.error = error; req.onerror?.(); transaction.abort(); }
                });
                return req;
              };
              return { get: key => enqueue("get", key), put: (value, key) => enqueue("put", key, value), add: (value, key) => enqueue("add", key, value) };
            },
            abort() { if (ended) return; ended = true; setImmediate(() => { transaction.onabort?.(); finish(); }); },
          };
          function finish() { database.running = false; database.queue.shift(); pump(); }
          function step() {
            if (ended) return;
            if (requests.length) { requests.shift()(); if (!ended) setImmediate(step); return; }
            if (mode === "readwrite") for (const [name, values] of stores) database.stores.set(name, values);
            ended = true; transaction.oncomplete?.(); finish();
          }
          function start() { stores = new Map(names.map(name => [name, structuredClone(database.stores.get(name))])); setImmediate(step); }
          function pump() { if (!database.running && database.queue.length) { database.running = true; database.queue[0](); } }
          database.queue.push(start); setImmediate(pump);
          return transaction;
        },
      };
      if (created) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  } };
  return api;
}
