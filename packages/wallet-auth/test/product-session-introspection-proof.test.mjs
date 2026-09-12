import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import { canonicalJSON, WalletAuthError } from "../src/canonical.js";
import { RecoverableProductSessionClient } from "../src/product-session-recovery.js";
import { createProductSessionReturnURL } from "../src/product-session-router.js";
import { signProductSessionApproval } from "../src/product-session-v2.js";
import { ProductSessionGatewayFetchAdapter, decodeProductSessionGatewayProofHeaderV2 } from "../src/product-session-gateway-client.js";
import { ProductSessionGatewayHttpHandler } from "../src/product-session-gateway-http.js";
import { verifyProductSessionProofV2 } from "../src/product-session-proof-v2.js";
import { httpBodyDigest } from "../src/session-proof.js";
import { createRevocationIntent } from "../src/product-session-revocation-intent.js";
import { productPlatformBinding } from "../src/product-session-registry.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-09-12T00:00:00.000Z");
const scopes = ["account:read", "profile:link"];
const deviceSecret = Buffer.alloc(32, 9), accountSecret = "1".padStart(64, "0");
const options = { timeout: 3000 };
const token = label => createHash("sha256").update(label).digest("base64url");
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

// Real local protocol, signatures and Gateway parser with fixed test keys only.
// The protected Map and fetch are synthetic: no OS/device/public service is used.
function harness() {
  const values = new Map(), calls = [], hooks = {}, time = { now: NOW };
  let sequence = 0;
  const storage = {
    securityLevel: "os-protected",
    async get(key) { calls.push(["get", key]); return hooks.get ? hooks.get(key, () => values.get(key) ?? null) : values.get(key) ?? null; },
    async set(key, value) { calls.push(["set", key]); values.set(key, value); },
    async remove(key) { calls.push(["remove", key]); values.delete(key); },
  };
  const handler = new ProductSessionGatewayHttpHandler(registry, () => token(`introspection-handler-${sequence++}`));
  const gateway = new ProductSessionGatewayFetchAdapter({
    endpoint: "https://wallet-auth.ynxweb4.com", timeoutMs: 1000,
    walletInstalled: async () => { calls.push(["probe"]); return true; }, schemeRegistered: async () => { calls.push(["probe"]); return true; },
    async fetch(url, input) {
      const path = new URL(url).pathname; calls.push(["gateway", path]);
      if (path === "/v2/product-sessions/time") return new Response(canonicalJSON({ ok: true, requestId: input.headers["x-request-id"], result: { serverTime: time.now.toISOString() }, schemaVersion: 2 }), { headers: { "content-type": "application/json", "cache-control": "no-store", "x-request-id": input.headers["x-request-id"] } });
      const result = handler.handle({ requestId: input.headers["x-request-id"], method: input.method, path, contentType: input.headers["content-type"], body: input.body, proofHeader: input.headers["x-ynx-product-session-proof-v2"] ?? null, networkAvailable: true }, time.now);
      return new Response(result.body, { status: result.status, headers: result.headers });
    },
  });
  const device = {
    id: "introspection-fixture-device", key: Buffer.from(p256.getPublicKey(deviceSecret, true)).toString("base64url"), scopes, purpose: "Connect the fixed local introspection-proof fixture.",
    async sign(input) {
      calls.push(["sign", input.purpose]); if (hooks.sign) await hooks.sign(input);
      return Buffer.from(p256.sign(Buffer.from(input.payload, "base64url"), deviceSecret, { format: "der" })).toString("base64url");
    },
  };
  const client = new RecoverableProductSessionClient({ registry, productId: "social", platform: "android", storage, gateway, device, tokenFactory: () => token(`introspection-client-${sequence++}`), clock: () => { calls.push(["local-clock"]); return new Date("2040-01-01T00:00:00.000Z"); } });
  return { client, storage, values, calls, hooks, handler, gateway, device, time, key: client.storageKey };
}
async function connected() {
  const setup = harness(), pending = await setup.client.beginExplicit();
  const approval = signProductSessionApproval(registry, pending.request, { accountSecret, scopes, expiresAt: pending.request.expiresAt }, NOW);
  const state = await setup.client.handleReturn(createProductSessionReturnURL(registry, pending.request, { result: "approved", approval }, NOW));
  assert.equal(state.status, "connected");
  const raw = setup.values.get(setup.key); setup.calls.length = 0;
  return { ...setup, session: state.session, raw };
}
function assertNoSideEffects(setup) {
  assert.equal(setup.calls.some(([name, path]) => ["set", "remove", "local-clock", "probe"].includes(name) || name === "gateway" && path !== "/v2/product-sessions/time"), false, JSON.stringify(setup.calls));
}
function verifyResult(setup, result, requiredScopes) {
  assert.deepEqual(Object.keys(result).sort(), ["body", "proof", "proofHeader", "requestId"]);
  assert.equal(result.body, canonicalJSON({ requiredScopes }));
  assert.deepEqual(decodeProductSessionGatewayProofHeaderV2(result.proofHeader), result.proof);
  assert.match(result.requestId, /^req_[A-Za-z0-9_-]{8,124}$/);
  assert.deepEqual(verifyProductSessionProofV2(result.proof, setup.session, { method: "POST", path: "/v2/product-sessions/introspect", bodyDigest: httpBodyDigest(result.body) }, setup.time.now), result.proof);
}

test("public introspection proofs bind the exact body, stay unconsumed and each nonce is accepted only once", options, async () => {
  const setup = await connected(), snapshot = canonicalJSON(setup.handler.snapshot());
  const first = await setup.client.createIntrospectionProof(["account:read"]);
  const second = await setup.client.createIntrospectionProof(scopes);
  verifyResult(setup, first, ["account:read"]); verifyResult(setup, second, scopes);
  assert.equal(Date.parse(first.proof.expiresAt) - Date.parse(first.proof.issuedAt), 30_000);
  assert.notEqual(first.proof.nonce, second.proof.nonce); assert.notEqual(first.requestId, second.requestId);
  assert.equal(canonicalJSON(setup.handler.snapshot()), snapshot);
  assert.equal(setup.values.get(setup.key), setup.raw); assertNoSideEffects(setup);
  assert.throws(() => verifyProductSessionProofV2(first.proof, setup.session, { method: "POST", path: "/v2/product-sessions/introspect", bodyDigest: httpBodyDigest(canonicalJSON({ requiredScopes: ["profile:link"] })) }, NOW), { code: "HTTP_BINDING_MISMATCH" });
  for (const result of [first, second]) {
    const input = { sessionBinding: result.proof.sessionBinding, requiredScopes: JSON.parse(result.body).requiredScopes, proof: result.proof };
    assert.equal((await setup.gateway.introspect({ requestId: result.requestId, ...input })).active, true);
    await assert.rejects(setup.gateway.introspect({ requestId: `req_replay_${token(result.proof.nonce)}`, ...input }), { code: "REPLAY" });
  }
});

test("disconnected, Guest and merely connecting states cannot issue an API proof", options, async () => {
  const setup = harness();
  await assert.rejects(setup.client.createIntrospectionProof(["account:read"]), { code: "SESSION_INACTIVE" });
  setup.client.enterGuest();
  await assert.rejects(setup.client.createIntrospectionProof(["account:read"]), { code: "SESSION_INACTIVE" });
  await setup.client.beginExplicit(); setup.calls.length = 0;
  await assert.rejects(setup.client.createIntrospectionProof(["account:read"]), { code: "SESSION_INACTIVE" });
  assert.equal(setup.calls.some(([name]) => ["sign", "gateway"].includes(name)), false);
});

test("scopes must be a nonempty sorted unique granted subset before any signing", options, async () => {
  const setup = await connected();
  for (const required of [undefined, null, "account:read", [], ["account:read", "account:read"], ["profile:link", "account:read"], ["card:application:write"], [" account:read"], [42]]) {
    await assert.rejects(setup.client.createIntrospectionProof(required), { code: "SCOPE_WIDENING" });
  }
  assert.equal(setup.calls.some(([name]) => ["sign", "gateway"].includes(name)), false);
  assert.equal(setup.values.get(setup.key), setup.raw); assertNoSideEffects(setup);
});

test("proof expiry is clipped to the session and authority time outside that session is rejected", options, async () => {
  const setup = await connected();
  setup.time.now = new Date(Date.parse(setup.session.expiresAt) - 1000);
  const near = await setup.client.createIntrospectionProof(["account:read"]);
  verifyResult(setup, near, ["account:read"]); assert.equal(near.proof.expiresAt, setup.session.expiresAt);
  setup.time.now = new Date(setup.session.expiresAt);
  await assert.rejects(setup.client.createIntrospectionProof(["account:read"]), { code: "SESSION_EXPIRED" });
  setup.time.now = new Date(Date.parse(setup.session.issuedAt) - 1);
  await assert.rejects(setup.client.createIntrospectionProof(["account:read"]), { code: "SESSION_EXPIRED" });
  assert.equal(setup.values.get(setup.key), setup.raw); assertNoSideEffects(setup);
});

test("missing, invalid and failed authority clocks never fall back to local time or release a proof", options, async () => {
  const setup = await connected();
  for (const clock of [undefined, async () => new Date(NaN), async () => NOW.toISOString(), async () => { throw new WalletAuthError("CLOCK_UNAVAILABLE", "fixture unavailable"); }, async () => { throw new WalletAuthError("NETWORK_UNAVAILABLE", "fixture offline"); }]) {
    setup.gateway.currentTime = clock;
    await assert.rejects(setup.client.createIntrospectionProof(["account:read"]), error => ["CLOCK_UNAVAILABLE", "NETWORK_UNAVAILABLE"].includes(error.code));
  }
  assert.equal(setup.calls.some(([name]) => name === "sign"), false);
  assert.equal(setup.values.get(setup.key), setup.raw); assertNoSideEffects(setup);
});

test("missing or substituted stored session blocks authority even while memory still says connected", options, async () => {
  const setup = await connected();
  for (const raw of [null, "not-json", canonicalJSON({ ...setup.session, deviceId: "different-fixture-device" }), canonicalJSON({ ...setup.session, origin: "https://other.example" })]) {
    if (raw === null) setup.values.delete(setup.key); else setup.values.set(setup.key, raw);
    await assert.rejects(setup.client.createIntrospectionProof(["account:read"]));
    assert.equal(setup.values.get(setup.key) ?? null, raw);
  }
  assert.equal(setup.calls.some(([name]) => name === "sign"), false); assertNoSideEffects(setup);
});

test("a protected-storage read error is propagated without deleting the session or issuing proof", options, async () => {
  const setup = await connected(), error = new Error("fixture protected read unavailable");
  setup.hooks.get = (key, read) => { if (key === setup.key) throw error; return read(); };
  await assert.rejects(setup.client.createIntrospectionProof(["account:read"]), value => value === error || value.code === "INSECURE_STORAGE");
  assert.equal(setup.values.get(setup.key), setup.raw); assertNoSideEffects(setup);
  assert.equal(setup.calls.some(([name]) => name === "sign"), false);
});

function gateProof(setup, stage) {
  const entered = deferred(), release = deferred(); let first = true;
  if (stage === "clock") {
    setup.gateway.currentTime = async () => {
      if (first) { first = false; entered.resolve(); return release.promise; }
      return setup.time.now;
    };
  } else setup.hooks.sign = async input => {
    if (input.purpose === "http-proof" && first) { first = false; entered.resolve(); await release.promise; }
  };
  return { entered, release };
}

for (const stage of ["clock", "sign"]) test(`Guest during ${stage} awaits cannot release the old session proof`, options, async t => {
  const setup = await connected(), gate = gateProof(setup, stage); t.after(() => gate.release.resolve(NOW));
  const pending = setup.client.createIntrospectionProof(["account:read"]); await gate.entered.promise;
  setup.client.enterGuest(); gate.release.resolve(NOW);
  await assert.rejects(pending, { code: "SESSION_INACTIVE" });
  assert.equal(setup.client.current.status, "guest"); assert.equal(setup.values.get(setup.key), setup.raw); assertNoSideEffects(setup);
});

for (const stage of ["clock", "sign"]) test(`a newer begin during ${stage} awaits invalidates the captured connected session`, options, async t => {
  const setup = await connected(), gate = gateProof(setup, stage); t.after(() => gate.release.resolve(NOW));
  const pending = setup.client.createIntrospectionProof(["account:read"]); await gate.entered.promise;
  const newer = await setup.client.beginExplicit(); assert.equal(newer.status, "connecting");
  const newRaw = setup.values.get(`${setup.key}:pending`);
  gate.release.resolve(NOW); await assert.rejects(pending, { code: "SESSION_INACTIVE" });
  assert.equal(setup.client.current, newer); assert.equal(setup.values.get(`${setup.key}:pending`), newRaw);
  assert.equal(setup.calls.some(([name, path]) => name === "gateway" && path === "/v2/product-sessions/introspect"), false);
});

test("network loss and a down/up epoch change during clock or signing cannot release proof", options, async t => {
  for (const stage of ["clock", "sign"]) {
    const setup = await connected(), gate = gateProof(setup, stage); t.after(() => gate.release.resolve(NOW));
    const pending = setup.client.createIntrospectionProof(["account:read"]); await gate.entered.promise;
    setup.client.setNetworkAvailable(false); if (stage === "sign") setup.client.setNetworkAvailable(true);
    gate.release.resolve(NOW);
    await assert.rejects(pending, error => ["NETWORK_UNAVAILABLE", "SESSION_INACTIVE"].includes(error.code));
    assert.equal(setup.values.get(setup.key), setup.raw); assertNoSideEffects(setup);
  }
});

test("stored session changes during clock or signing survive intact and block proof release", options, async t => {
  for (const stage of ["clock", "sign"]) {
    const setup = await connected(), gate = gateProof(setup, stage); t.after(() => gate.release.resolve(NOW));
    const pending = setup.client.createIntrospectionProof(["account:read"]); await gate.entered.promise;
    const changed = canonicalJSON({ ...setup.session, scopes: ["account:read"] });
    setup.values.set(setup.key, changed); gate.release.resolve(NOW);
    await assert.rejects(pending, { code: "SESSION_INACTIVE" });
    assert.equal(setup.values.get(setup.key), changed); assertNoSideEffects(setup);
  }
});

test("a durable revocation marker appearing during clock or signing blocks proof without consuming it", options, async t => {
  for (const stage of ["clock", "sign"]) {
    const setup = await connected(), gate = gateProof(setup, stage); t.after(() => gate.release.resolve(NOW));
    const pending = setup.client.createIntrospectionProof(["account:read"]); await gate.entered.promise;
    const intent = createRevocationIntent(productPlatformBinding(registry, "social", "android"), setup.device, token(`revocation-${stage}`), setup.session);
    const raw = canonicalJSON(intent); setup.values.set(`${setup.key}:revoke`, raw); gate.release.resolve(NOW);
    await assert.rejects(pending, { code: "REVOCATION_PENDING" });
    assert.equal(setup.values.get(`${setup.key}:revoke`), raw); assert.equal(setup.values.get(setup.key), setup.raw); assertNoSideEffects(setup);
  }
});

test("local disconnect invalidates a proof whose authority clock is still pending", options, async t => {
  const setup = await connected(), gate = gateProof(setup, "clock"); t.after(() => gate.release.resolve(NOW));
  const pending = setup.client.createIntrospectionProof(["account:read"]); await gate.entered.promise;
  const logout = await setup.client.disconnect(); assert.equal(logout.status, "disconnected");
  gate.release.resolve(NOW);
  await assert.rejects(pending, error => ["SESSION_INACTIVE", "REVOCATION_PENDING"].includes(error.code));
  assert.equal(setup.client.current.status, "disconnected"); assert.equal(setup.values.has(setup.key), false);
});

test("scope getter values are snapshotted before validation so the signed body cannot gain an ungranted scope", options, async () => {
  const setup = await connected(), required = new Array(1); let reads = 0;
  Object.defineProperty(required, 0, { enumerable: true, get() { return ++reads === 1 ? "account:read" : "card:application:write"; } });
  const outcome = await setup.client.createIntrospectionProof(required).then(result => ({ result }), error => ({ error }));
  assert.ok(reads >= 1);
  if (outcome.error) assert.equal(outcome.error.code, "SCOPE_WIDENING");
  else verifyResult(setup, outcome.result, ["account:read"]);
  assert.equal(setup.values.get(setup.key), setup.raw); assertNoSideEffects(setup);
});

test("changing the caller's plain scopes array during authority time cannot change the original signed body", options, async t => {
  const setup = await connected(), gate = gateProof(setup, "clock"), required = ["account:read"];
  t.after(() => gate.release.resolve(NOW));
  const pending = setup.client.createIntrospectionProof(required); await gate.entered.promise;
  required[0] = "card:application:write"; required.push("profile:link");
  gate.release.resolve(NOW);
  verifyResult(setup, await pending, ["account:read"]);
  assert.equal(setup.values.get(setup.key), setup.raw); assertNoSideEffects(setup);
});
