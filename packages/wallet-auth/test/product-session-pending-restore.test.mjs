import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalJSON, WalletAuthError } from "../src/canonical.js";
import { RecoverableProductSessionClient } from "../src/product-session-recovery.js";
import { createProductSessionReturnURL, parseProductSessionWalletURL } from "../src/product-session-router.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-09-12T00:00:00.000Z");
const LATER = new Date(NOW.getTime() + 15_000);
const options = { timeout: 3000 };
const token = label => createHash("sha256").update(label).digest("base64url");
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

// Only a synthetic protected Map and the public P-256 generator point are used.
// No key, signing, actual storage protection, Wallet launch, or network is used.
function harness() {
  const calls = [], values = new Map(), hooks = {};
  let counter = 0, time = NOW;
  const storage = {
    securityLevel: "os-protected",
    async get(key) { calls.push(["get", key]); return hooks.get ? hooks.get(key, () => values.get(key) ?? null) : values.get(key) ?? null; },
    async set(key, value) { calls.push(["set", key, value]); if (hooks.set) return hooks.set(key, value, () => values.set(key, value)); values.set(key, value); },
    async remove(key) { calls.push(["remove", key]); values.delete(key); },
  };
  const unexpected = name => async () => { calls.push([name]); assert.fail(`Pending recovery must not call ${name}`); };
  const gateway = {
    currentTime: async () => { calls.push(["authority-time"]); return time; },
    walletInstalled: async () => { calls.push(["wallet-probe"]); return true; },
    schemeRegistered: async () => { calls.push(["scheme-probe"]); return true; },
    challenge: unexpected("challenge"), complete: unexpected("complete"), introspect: unexpected("introspect"), revoke: unexpected("revoke"),
    openWallet: unexpected("open-wallet"), openURL: unexpected("open-url"),
  };
  const device = {
    id: "pending-restore-device", key: Buffer.from("036b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296", "hex").toString("base64url"),
    sign: unexpected("device-sign"), scopes: ["account:read", "profile:link"], purpose: "Restore the same pending Social Wallet request.",
  };
  const makeClient = (deviceOverrides = {}) => new RecoverableProductSessionClient({
    registry, productId: "social", platform: "android", storage, gateway, device: { ...device, ...deviceOverrides },
    tokenFactory: () => { calls.push(["token"]); return token(`pending-restore-${counter++}`); },
    clock: () => { calls.push(["local-time"]); return new Date("2040-01-01T00:00:00.000Z"); },
  });
  const client = makeClient();
  return { client, makeClient, storage, values, calls, hooks, gateway, device, pendingKey: `${client.storageKey}:pending`, setTime: value => { time = value; } };
}
async function seed() {
  const setup = harness(), original = await setup.client.beginExplicit();
  const raw = setup.values.get(setup.pendingKey);
  assert.equal(raw, canonicalJSON(original.request));
  setup.setTime(LATER); setup.calls.length = 0;
  return { ...setup, original, raw };
}
function assertNoMutationOrAuthority(setup) {
  assert.equal(setup.calls.some(([name]) => ["set", "remove", "local-time", "wallet-probe", "scheme-probe", "open-wallet", "open-url", "device-sign", "challenge", "complete", "introspect", "revoke"].includes(name)), false, JSON.stringify(setup.calls));
}
function assertNoRequest(result) {
  assert.equal(Object.hasOwn(result, "request"), false); assert.equal(Object.hasOwn(result, "route"), false); assert.equal(Object.hasOwn(result, "session"), false);
}
function assertRestored(setup, result) {
  assert.equal(result.status, "connecting");
  assert.equal(result.automatic, false); assert.equal(result.installation, "unverified");
  assert.equal(result.route.status, "ready"); assert.equal(result.route.automatic, false); assert.equal(result.route.installation, "unverified");
  assert.deepEqual(result.request, setup.original.request);
  assert.deepEqual(parseProductSessionWalletURL(registry, result.route.url, LATER), setup.original.request);
  assert.equal(setup.values.get(setup.pendingKey), setup.raw);
  assert.equal(Object.hasOwn(result, "session"), false);
}

test("cold restore keeps exact explicit pending bytes, nonce, state and expiry without creating another attempt", options, async () => {
  const setup = await seed(), cold = setup.makeClient();
  const restored = await cold.restore(true);
  assert.equal(setup.values.get(setup.pendingKey), setup.raw, "Cold restore must preserve the original canonical request bytes");
  assertRestored(setup, restored);
  assertNoMutationOrAuthority(setup);
  assert.equal(setup.calls.filter(([name]) => name === "authority-time").length, 1);
  assert.equal(setup.calls.filter(([name]) => name === "token").length, 1, "Only the authority-time request ID may be allocated; no new nonce/state");
});

test("repeated restore reuses pending approval without silently renewing its lifetime", options, async () => {
  const setup = await seed(), cold = setup.makeClient();
  assertRestored(setup, await cold.restore(true));
  setup.setTime(new Date(NOW.getTime() + 60_000));
  assertRestored(setup, await cold.restore(true));
  assertNoMutationOrAuthority(setup);
});

test("valid legacy JSON key order is preserved byte for byte without canonical rewriting", options, async () => {
  const setup = await seed();
  setup.raw = JSON.stringify(Object.fromEntries(Object.entries(setup.original.request).reverse()), null, 2);
  assert.notEqual(setup.raw, canonicalJSON(setup.original.request));
  setup.values.set(setup.pendingKey, setup.raw);
  assertRestored(setup, await setup.makeClient().restore(true));
  assertNoMutationOrAuthority(setup);
});

test("offline cold restore retains pending bytes without calling any clock", options, async () => {
  const setup = await seed(), result = await setup.makeClient().restore(false);
  assert.equal(result.status, "network-unavailable"); assertNoRequest(result);
  assert.equal(setup.values.get(setup.pendingKey), setup.raw);
  assertNoMutationOrAuthority(setup);
  assert.equal(setup.calls.some(([name]) => name === "authority-time"), false);
});

for (const [label, clock] of [
  ["missing", undefined],
  ["typed unavailable", async () => { throw new WalletAuthError("CLOCK_UNAVAILABLE", "fixture clock unavailable"); }],
  ["adapter exception", async () => { throw new Error("offline clock adapter"); }],
  ["invalid Date", async () => new Date(NaN)],
  ["string date", async () => LATER.toISOString()],
]) test(`${label} authority time cannot renew or expose pending approval`, options, async () => {
  const setup = await seed();
  if (clock) setup.gateway.currentTime = clock; else delete setup.gateway.currentTime;
  const result = await setup.makeClient().restore(true);
  assert.equal(result.status, "network-unavailable"); assertNoRequest(result);
  assert.equal(setup.values.get(setup.pendingKey), setup.raw);
  assertNoMutationOrAuthority(setup);
});

for (const [label, time] of [
  ["expiry equality", new Date(NOW.getTime() + 300_000)],
  ["past expiry", new Date(NOW.getTime() + 301_000)],
  ["issuedAt beyond the existing 30-second clock-skew allowance", new Date(NOW.getTime() - 30_001)],
]) test(`${label} needs explicit retry and retains the original pending request`, options, async () => {
  const setup = await seed(); setup.setTime(time);
  const result = await setup.makeClient().restore(true);
  assert.equal(result.status, "retry-required"); assertNoRequest(result);
  assert.equal(setup.values.get(setup.pendingKey), setup.raw);
  assertNoMutationOrAuthority(setup);
});

for (const [label, rewrite] of [
  ["invalid JSON", () => "not-json"],
  ["unknown field", request => canonicalJSON({ ...request, approval: true })],
  ["callback substitution", request => canonicalJSON({ ...request, callback: "ynx-social://other.example" })],
  ["origin substitution", request => canonicalJSON({ ...request, origin: "https://attacker.example" })],
  ["missing state", request => { const { state, ...rest } = request; return canonicalJSON(rest); }],
]) test(`${label} cannot replace pending storage with a new automatic request`, options, async () => {
  const setup = await seed(), corrupted = rewrite(setup.original.request);
  setup.values.set(setup.pendingKey, corrupted);
  const result = await setup.makeClient().restore(true);
  assert.equal(result.status, "retry-required"); assertNoRequest(result);
  assert.equal(setup.values.get(setup.pendingKey), corrupted);
  assertNoMutationOrAuthority(setup);
});

for (const [label, overrides] of [
  ["device id", { id: "different-installation" }],
  ["device public key", { key: Buffer.from("026b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296", "hex").toString("base64url") }],
  ["configured scopes", { scopes: ["account:read"] }],
]) test(`pending ${label} mismatch requires retry without deleting its bytes`, options, async () => {
  const setup = await seed(), result = await setup.makeClient(overrides).restore(true);
  assert.equal(result.status, "retry-required"); assertNoRequest(result);
  assert.equal(setup.values.get(setup.pendingKey), setup.raw);
  assertNoMutationOrAuthority(setup);
});

function gateRestore(setup, stage) {
  const entered = deferred(), release = deferred();
  if (stage === "clock") {
    let first = true;
    setup.gateway.currentTime = async () => {
      setup.calls.push(["authority-time"]);
      if (first) { first = false; entered.resolve(); return release.promise; }
      return LATER;
    };
  } else {
    let reads = 0;
    setup.hooks.get = async (key, read) => {
      if (key === setup.pendingKey && ++reads === (stage === "initial read" ? 1 : 2)) {
        const snapshot = read(); entered.resolve(); await release.promise; return snapshot;
      }
      return read();
    };
  }
  return { entered, release };
}

for (const stage of ["initial read", "clock", "final read"]) test(`Guest cancels restore waiting on ${stage} without reviving a route`, options, async t => {
  const setup = await seed(), cold = setup.makeClient(), gate = gateRestore(setup, stage);
  t.after(() => gate.release.resolve(LATER));
  const restoring = cold.restore(true); await gate.entered.promise;
  const guest = cold.enterGuest(); assert.equal(guest.status, "guest");
  gate.release.resolve(LATER);
  assert.equal(await restoring, cold.current); assert.equal(cold.current.status, "guest"); assertNoRequest(cold.current);
  assert.equal(setup.values.get(setup.pendingKey), setup.raw);
  assertNoMutationOrAuthority(setup);
});

for (const stage of ["initial read", "clock", "final read"]) test(`a new explicit attempt wins over restore waiting on ${stage}`, options, async t => {
  const setup = await seed(), cold = setup.makeClient(), gate = gateRestore(setup, stage);
  t.after(() => gate.release.resolve(LATER));
  const restoring = cold.restore(true); await gate.entered.promise;
  const newer = await cold.beginExplicit(), newerRaw = setup.values.get(setup.pendingKey);
  assert.equal(newer.status, "connecting"); assert.equal(newer.automatic, false);
  assert.notEqual(newer.request.nonce, setup.original.request.nonce); assert.notEqual(newer.request.state, setup.original.request.state);
  assert.equal(newerRaw, canonicalJSON(newer.request));
  gate.release.resolve(LATER);
  assert.equal(await restoring, cold.current); assert.deepEqual(cold.current.request, newer.request);
  assert.equal(setup.values.get(setup.pendingKey), newerRaw);
  assert.equal(setup.calls.some(([name]) => ["wallet-probe", "scheme-probe", "device-sign", "open-url", "open-wallet"].includes(name)), false);
});

test("pending bytes changed while authority time is awaited cannot publish the old route", options, async t => {
  const setup = await seed(), cold = setup.makeClient(), gate = gateRestore(setup, "clock");
  t.after(() => gate.release.resolve(LATER));
  const restoring = cold.restore(true); await gate.entered.promise;
  const replacement = canonicalJSON({ ...setup.original.request, state: token("different-persisted-state") });
  setup.values.set(setup.pendingKey, replacement); gate.release.resolve(LATER);
  const result = await restoring;
  assert.equal(result.status, "retry-required"); assertNoRequest(result);
  assert.equal(setup.values.get(setup.pendingKey), replacement);
  assertNoMutationOrAuthority(setup);
});

for (const recover of [false, true]) test(`network loss${recover ? " and recovery" : ""} during authority time cannot publish a stale pending route`, options, async t => {
  const setup = await seed(), cold = setup.makeClient(), gate = gateRestore(setup, "clock");
  t.after(() => gate.release.resolve(LATER));
  const restoring = cold.restore(true); await gate.entered.promise;
  cold.setNetworkAvailable(false); if (recover) cold.setNetworkAvailable(true);
  gate.release.resolve(LATER); const result = await restoring;
  assert.equal(result.status, recover ? "retry-required" : "network-unavailable"); assertNoRequest(result);
  assert.equal(setup.values.get(setup.pendingKey), setup.raw);
  assertNoMutationOrAuthority(setup);
});

test("restore waits for an already started explicit pending write ACK instead of treating storage as empty", options, async t => {
  const setup = harness(), entered = deferred(), release = deferred(); let blocked = false;
  t.after(() => release.resolve());
  setup.hooks.set = async (key, value, commit) => {
    if (key === setup.pendingKey && !blocked) { blocked = true; entered.resolve(value); await release.promise; }
    commit();
  };
  const beginning = setup.client.beginExplicit(), raw = await entered.promise;
  let settled = false;
  const restoring = setup.client.restore(true).then(value => { settled = true; return value; });
  await turn(); assert.equal(settled, false);
  assert.equal(setup.calls.filter(([name]) => name === "token").length, 3, "The original clock request ID plus original nonce/state only");
  assert.equal(setup.calls.some(([name]) => ["wallet-probe", "scheme-probe"].includes(name)), false);
  release.resolve(); const prepared = await beginning, restored = await restoring;
  assert.equal(restored.status, "connecting"); assert.equal(restored.automatic, false);
  assert.deepEqual(restored.request, prepared.request); assert.equal(setup.values.get(setup.pendingKey), raw);
  assert.equal(setup.calls.filter(([name, key]) => name === "set" && key === setup.pendingKey).length, 1);
});

test("a genuinely empty installation retains the existing first detected automatic attempt", options, async () => {
  const setup = harness(), result = await setup.client.restore(true);
  assert.equal(result.status, "connecting"); assert.equal(result.automatic, true);
  assert.equal(setup.calls.filter(([name]) => name === "wallet-probe").length, 1);
  assert.equal(setup.calls.filter(([name]) => name === "scheme-probe").length, 1);
  assert.equal(setup.values.get(setup.pendingKey), canonicalJSON(result.request));
  assert.equal(setup.calls.some(([name]) => ["device-sign", "challenge", "complete", "open-url", "open-wallet"].includes(name)), false);
});

test("the original pending request rejection callback still completes after cold restore", options, async () => {
  const setup = await seed(), cold = setup.makeClient();
  const callback = createProductSessionReturnURL(registry, setup.original.request, { result: "rejected", reason: "user_rejected" }, LATER);
  assertRestored(setup, await cold.restore(true));
  assertNoMutationOrAuthority(setup);
  setup.calls.length = 0;
  const result = await cold.handleReturn(callback);
  assert.equal(result.status, "disconnected"); assertNoRequest(result);
  assert.equal(setup.values.has(setup.pendingKey), false);
  assert.equal(setup.calls.some(([name, key]) => name === "remove" && key === setup.pendingKey), true);
  assert.equal(setup.calls.some(([name]) => ["wallet-probe", "scheme-probe", "device-sign", "challenge", "complete", "introspect", "revoke", "open-url", "open-wallet"].includes(name)), false);
});
