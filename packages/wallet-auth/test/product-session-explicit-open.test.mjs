import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalJSON, WalletAuthError } from "../src/canonical.js";
import { RecoverableProductSessionClient } from "../src/product-session-recovery.js";
import { parseProductSessionWalletURL, prepareWalletAttempt } from "../src/product-session-router.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-09-12T00:00:00.000Z");
const LOCAL_WRONG_TIME = new Date("2040-01-01T00:00:00.000Z");
const options = { timeout: 3000 };
const token = label => createHash("sha256").update(label).digest("base64url");
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

// Synthetic protected-storage adapter and public P-256 generator point only.
// No signing, OS storage, app launch, network, Gateway service or Wallet is used.
function harness() {
  const calls = [], values = new Map(), hooks = {};
  let index = 0;
  const storage = {
    securityLevel: "os-protected", values,
    async get(key) { calls.push(["get", key]); return hooks.get ? hooks.get(key, () => values.get(key) ?? null) : values.get(key) ?? null; },
    async set(key, value) { calls.push(["set", key, value]); if (hooks.set) return hooks.set(key, value, () => values.set(key, value)); values.set(key, value); },
    async remove(key) { calls.push(["remove", key]); if (hooks.remove) return hooks.remove(key, () => values.delete(key)); values.delete(key); },
  };
  const unexpected = name => async () => { calls.push([name]); assert.fail(`Explicit preparation must not call ${name}`); };
  const gateway = {
    currentTime: async () => { calls.push(["authority-time"]); return NOW; },
    walletInstalled: unexpected("wallet-probe"), schemeRegistered: unexpected("scheme-probe"),
    challenge: unexpected("challenge"), complete: unexpected("complete"), introspect: unexpected("introspect"), revoke: unexpected("revoke"),
    openWallet: unexpected("open-wallet"), openURL: unexpected("open-url"),
  };
  const client = new RecoverableProductSessionClient({
    registry, productId: "social", platform: "android", storage, gateway,
    device: { id: "explicit-fixture-device", key: Buffer.from("036b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296", "hex").toString("base64url"), sign: unexpected("device-sign"), scopes: ["account:read", "profile:link"], purpose: "Explicitly prepare Social Wallet approval." },
    tokenFactory: () => token(`explicit-${index++}`),
    clock: () => { calls.push(["local-time"]); return LOCAL_WRONG_TIME; },
  });
  return { client, storage, gateway, calls, hooks, pendingKey: `${client.storageKey}:pending` };
}
function assertNotReady(value) {
  assert.notEqual(value.status, "connecting");
  assert.notEqual(value.status, "connected");
  assert.equal(Object.hasOwn(value, "route"), false);
  assert.equal(Object.hasOwn(value, "request"), false);
}
function assertPrepared(setup, result) {
  assert.equal(result.status, "connecting");
  assert.equal(result.automatic, false);
  assert.equal(result.installation, "unverified");
  assert.equal(result.route.status, "ready");
  assert.equal(result.route.installation, "unverified");
  assert.equal(result.route.automatic, false);
  assert.deepEqual(parseProductSessionWalletURL(registry, result.route.url, NOW), result.request);
  assert.equal(setup.storage.values.get(setup.pendingKey), canonicalJSON(result.request));
  assert.equal(Object.hasOwn(result, "session"), false);
  assert.equal(result.request.issuedAt, NOW.toISOString());
}
function gateClock(setup) {
  const entered = deferred(), release = deferred();
  setup.gateway.currentTime = async () => { entered.resolve(); return release.promise; };
  return { entered, release };
}
function gateFirstPendingWrite(setup) {
  const entered = deferred(), release = deferred(); let first = true;
  setup.hooks.set = async (key, value, commit) => {
    if (key === setup.pendingKey && first) { first = false; entered.resolve(value); await release.promise; }
    commit();
  };
  return { entered, release };
}

test("explicit begin prepares an unverified URL without probes, opening or signing and uses authority time", options, async () => {
  const setup = harness();
  const result = await setup.client.beginExplicit();
  assertPrepared(setup, result);
  assert.equal(setup.calls.filter(([name]) => name === "authority-time").length, 1);
  assert.equal(setup.calls.some(([name]) => ["local-time", "wallet-probe", "scheme-probe", "open-wallet", "open-url", "device-sign", "challenge", "complete"].includes(name)), false);
  const timeIndex = setup.calls.findIndex(([name]) => name === "authority-time");
  const writeIndex = setup.calls.findIndex(([name, key]) => name === "set" && key === setup.pendingKey);
  assert.ok(timeIndex >= 0 && writeIndex > timeIndex);
  assert.ok(setup.calls.slice(writeIndex + 1).some(([name, key]) => name === "get" && key === setup.pendingKey));
  const route = prepareWalletAttempt(registry, result.request, NOW);
  assert.equal(route.installation, "unverified"); assert.equal(route.automatic, false); assert.equal(route.status, "ready");
  assert.deepEqual(parseProductSessionWalletURL(registry, route.url, NOW), result.request);
});

for (const [label, clock] of [
  ["missing", undefined],
  ["typed failure", async () => { throw new WalletAuthError("CLOCK_UNAVAILABLE", "fixture unavailable"); }],
  ["adapter exception", async () => { throw new Error("offline adapter"); }],
  ["invalid Date", async () => new Date(NaN)],
  ["string result", async () => NOW.toISOString()],
]) test(`${label} authority clock never falls back to local time or prepares a route`, options, async () => {
  const setup = harness();
  if (clock) setup.gateway.currentTime = clock; else delete setup.gateway.currentTime;
  const result = await setup.client.beginExplicit();
  assert.equal(result.status, "network-unavailable"); assertNotReady(result);
  assert.equal(setup.calls.some(([name]) => name === "local-time"), false);
  assert.equal(setup.calls.some(([name, key]) => name === "set" && key === setup.pendingKey), false);
});

test("authority clock must finish before any pending request is persisted", options, async t => {
  const setup = harness(), gate = gateClock(setup); t.after(() => gate.release.resolve(NOW));
  const beginning = setup.client.beginExplicit(); await gate.entered.promise;
  assertNotReady(setup.client.current);
  assert.equal(setup.storage.values.has(setup.pendingKey), false);
  assert.equal(setup.calls.some(([name, key]) => name === "set" && key === setup.pendingKey), false);
  gate.release.resolve(NOW); assertPrepared(setup, await beginning);
});

test("pending exact readback must finish before connecting is published", options, async t => {
  const setup = harness(), entered = deferred(), release = deferred(); t.after(() => release.resolve());
  setup.hooks.get = async (key, read) => {
    if (key === setup.pendingKey && setup.storage.values.has(key)) { entered.resolve(); await release.promise; }
    return read();
  };
  const beginning = setup.client.beginExplicit(); await entered.promise;
  assertNotReady(setup.client.current);
  assert.equal(typeof setup.storage.values.get(setup.pendingKey), "string");
  release.resolve(); assertPrepared(setup, await beginning);
});

test("silent storage drop and semantically equivalent but noncanonical readback fail closed", options, async () => {
  for (const rewrite of [() => null, raw => JSON.stringify(JSON.parse(raw)), raw => `${raw}\n`]) {
    const setup = harness();
    setup.hooks.set = async (key, value, commit) => {
      if (key !== setup.pendingKey) return commit();
      // Reversing keys makes the second case definitely differ from canonicalJSON.
      const next = rewrite(value);
      if (next !== null) setup.storage.values.set(key, next === JSON.stringify(JSON.parse(value)) ? JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(value)).reverse())) : next);
    };
    await assert.rejects(setup.client.beginExplicit(), { code: "INSECURE_STORAGE" });
    assertNotReady(setup.client.current);
  }
});

for (const stage of ["clock", "write"]) for (const recover of [false, true]) test(`network changes during ${stage}${recover ? " and returns" : ""} cannot publish a stale route`, options, async t => {
  const setup = harness(), gate = stage === "clock" ? gateClock(setup) : gateFirstPendingWrite(setup);
  t.after(() => gate.release.resolve(NOW));
  const beginning = setup.client.beginExplicit(); await gate.entered.promise;
  setup.client.setNetworkAvailable(false);
  if (recover) setup.client.setNetworkAvailable(true);
  gate.release.resolve(NOW);
  const result = await beginning;
  assert.equal(result.status, recover ? "retry-required" : "network-unavailable");
  assertNotReady(result); assertNotReady(setup.client.current);
});

for (const staleFails of [false, true]) test(`new explicit B wins while A has a slow clock, even when A later ${staleFails ? "fails" : "succeeds"}`, options, async t => {
  const setup = harness(), entered = deferred(), release = deferred(); let clockCalls = 0;
  t.after(() => release.resolve(NOW));
  setup.gateway.currentTime = async () => { if (++clockCalls === 1) { entered.resolve(); return release.promise; } return NOW; };
  const a = setup.client.beginExplicit(); await entered.promise;
  const b = await setup.client.beginExplicit(); assertPrepared(setup, b);
  const bBytes = setup.storage.values.get(setup.pendingKey);
  if (staleFails) release.reject(new WalletAuthError("CLOCK_UNAVAILABLE", "stale A failed")); else release.resolve(NOW);
  assert.deepEqual(await a, b);
  assert.deepEqual(setup.client.current, b);
  assert.equal(setup.storage.values.get(setup.pendingKey), bBytes);
});

test("B waits for A's late pending write ACK and keeps B's bytes after A settles", options, async t => {
  const setup = harness(), gate = gateFirstPendingWrite(setup); t.after(() => gate.release.resolve());
  const a = setup.client.beginExplicit(), aBytes = await gate.entered.promise;
  let bSettled = false;
  const b = setup.client.beginExplicit().then(value => { bSettled = true; return value; });
  await turn();
  assert.equal(bSettled, false, "B cannot expose its request before A's writer settles");
  assert.equal(setup.calls.filter(([name, key]) => name === "set" && key === setup.pendingKey).length, 1);
  gate.release.resolve();
  const [, result] = await Promise.all([a, b]); assertPrepared(setup, result);
  assert.notEqual(canonicalJSON(result.request), aBytes);
  assert.deepEqual(setup.client.current, result);
  assert.equal(setup.storage.values.get(setup.pendingKey), canonicalJSON(result.request));
});

for (const stage of ["clock", "write"]) test(`Guest cancels an explicit begin waiting on ${stage} without late revival`, options, async t => {
  const setup = harness(), gate = stage === "clock" ? gateClock(setup) : gateFirstPendingWrite(setup);
  t.after(() => gate.release.resolve(NOW));
  const beginning = setup.client.beginExplicit(); await gate.entered.promise;
  const guest = setup.client.enterGuest(); assert.equal(guest.status, "guest");
  gate.release.resolve(NOW);
  assert.equal((await beginning).status, "guest");
  assert.equal(setup.client.current.status, "guest"); assertNotReady(setup.client.current);
});

for (const stage of ["clock", "write"]) test(`Disconnect cancels an explicit begin waiting on ${stage} and clears any late pending bytes`, options, async t => {
  const setup = harness(), gate = stage === "clock" ? gateClock(setup) : gateFirstPendingWrite(setup);
  t.after(() => gate.release.resolve(NOW));
  const beginning = setup.client.beginExplicit(); await gate.entered.promise;
  const disconnecting = setup.client.disconnect(); await turn(); assertNotReady(setup.client.current);
  gate.release.resolve(NOW);
  await Promise.all([beginning, disconnecting]);
  assert.equal(setup.client.current.status, "disconnected"); assertNotReady(setup.client.current);
  assert.equal(setup.storage.values.get(setup.pendingKey) ?? null, null);
  assert.equal(setup.calls.some(([name]) => name === "revoke"), false, "No session was ever created to revoke");
});

test("a late detected probe cannot overwrite a newer explicit request or pending bytes", options, async t => {
  const setup = harness(), entered = deferred(), release = deferred(); t.after(() => release.resolve(false));
  setup.gateway.walletInstalled = async () => { entered.resolve(); return release.promise; };
  setup.gateway.schemeRegistered = async () => false;
  const detected = setup.client.beginDetected(); await entered.promise;
  const explicit = await setup.client.beginExplicit(); assertPrepared(setup, explicit);
  const bytes = setup.storage.values.get(setup.pendingKey);
  release.resolve(false); assert.deepEqual(await detected, explicit);
  assert.deepEqual(setup.client.current, explicit);
  assert.equal(setup.storage.values.get(setup.pendingKey), bytes);
});

test("detected false probes still show guidance while later restore preserves the original pending request", options, async () => {
  const setup = harness(); let probes = 0;
  setup.gateway.walletInstalled = async () => { probes++; return false; };
  setup.gateway.schemeRegistered = async () => false;
  const detected = await setup.client.beginDetected();
  assert.equal(detected.status, "retry-required"); assert.equal(detected.route.status, "wallet-not-installed");
  assert.equal(detected.automatic, false); assert.ok(detected.actions.includes("download"));
  const count = probes, raw = setup.storage.values.get(setup.pendingKey);
  const restored = await setup.client.restore(true);
  assert.equal(restored.status, "connecting"); assert.equal(restored.route.status, "ready"); assert.equal(restored.automatic, false);
  assert.equal(restored.installation, "unverified"); assert.equal(probes, count);
  assert.equal(setup.storage.values.get(setup.pendingKey), raw);
  const again = await setup.client.restore(true);
  assert.deepEqual(again, restored); assert.equal(probes, count);
});
