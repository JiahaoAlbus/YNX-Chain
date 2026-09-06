import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  canonicalJSON, createBrowserProductSessionClient, createProductSessionReturnURL,
  ProductSessionGatewayFetchAdapter, ProductSessionGatewayHttpHandler,
  RecoverableProductSessionClient, signProductSessionApproval,
} from "../src/index.js";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const NOW = new Date("2026-09-06T12:00:00.000Z");
const scopes = ["creator:account", "creator:publish", "creator:revenue"];
const token = label => createHash("sha256").update(label).digest("base64url");

function setup() {
  const indexedDB = fakeIndexedDB();
  const exports = [], generated = [], seen = [];
  const crypto = { getRandomValues: values => webcrypto.getRandomValues(values), subtle: new Proxy(webcrypto.subtle, { get(target, key) {
    if (key === "exportKey") return (format, value) => { exports.push({ format, type: value.type }); assert.equal(value.type, "public", "adapter must never attempt to export a private key"); return target.exportKey(format, value); };
    if (key === "generateKey") return async (...args) => { const pair = await target.generateKey(...args); generated.push(pair); return pair; };
    return typeof target[key] === "function" ? target[key].bind(target) : target[key];
  } }) };
  const environment = { crypto, indexedDB, isSecureContext: true, location: { origin: "https://creator.ynxweb4.com" } };
  let sequence = 0;
  const handler = new ProductSessionGatewayHttpHandler(registry, () => token(`browser-challenge-${sequence++}`));
  const gateway = new ProductSessionGatewayFetchAdapter({ endpoint: "https://wallet-auth.ynxweb4.com", walletInstalled: async () => true, schemeRegistered: async () => true, timeoutMs: 1000,
    async fetch(url, input) {
      seen.push({ url, headers: input.headers, body: input.body });
      const result = handler.handle({ requestId: input.headers["x-request-id"], method: input.method, path: new URL(url).pathname, contentType: input.headers["content-type"], body: input.body, proofHeader: input.headers["x-ynx-product-session-proof-v2"] ?? null, networkAvailable: true }, NOW);
      return new Response(result.body, { status: result.status, headers: result.headers });
    },
  });
  const config = { registry, productId: "creator-studio", scopes, purpose: "Sign in to Creator Studio.", gateway, environment, clock: () => NOW };
  return { config, environment, indexedDB, handler, gateway, generated, exports, seen };
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
  await assert.rejects(webcrypto.subtle.exportKey("jwk", persisted.privateKey), { name: "InvalidAccessError" });
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
  await assert.rejects(adapter.createIntrospectionProof(["creator:publish"]), { code: "DEVICE_SIGNING_FAILED" });
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

// A narrow IndexedDB transaction fake: request callbacks, structured-cloned values,
// serialized transactions and atomic commit/abort. Cryptography above is real WebCrypto.
function fakeIndexedDB() {
  const databases = new Map();
  const api = { failWrites: false, records(name) { return databases.values().next().value?.stores.get(name) ?? new Map(); }, open(name) {
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
                    if (operation === "get") req.result = structuredClone(values.get(key));
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
