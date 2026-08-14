import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  createProductWalletConnection, PRODUCT_SESSION_CLIENT_STATE,
  WALLET_CONNECTION_COORDINATOR_STATUS, WalletAuthError,
} from "../src/index.js";
import * as productConnectionSubpath from "@ynx-chain/wallet-auth/product-wallet-connection";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const secret = Buffer.alloc(32, 29);
const deviceKey = Buffer.from(p256.getPublicKey(secret, true)).toString("base64url");
const now = new Date("2026-08-15T00:00:00.000Z");
function token(value) { return createHash("sha256").update(value).digest("base64url"); }
function storage() { const values = new Map(); return { securityLevel: "os-protected", async get(key) { return values.get(key) ?? null; }, async set(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); } }; }
function config(overrides = {}) { let index = 0; return { registry, productId: "social", platform: "web", gatewayEndpoint: "https://gateway.test", fetch: async () => { throw new Error("not used"); }, walletInstalled: async () => true, schemeRegistered: async () => true, gatewayTimeoutMs: 5_000, storage: storage(), device: { id: "social-device-factory-001", key: deviceKey, secret: secret.toString("base64url"), scopes: ["account:read", "profile:link"], purpose: "Connect Social through the canonical public SDK factory." }, tokenFactory: () => token(`factory-${index++}`), clock: () => now, scope: {}, discoveryWaitMs: 0, openWallet: async () => ({ opened: true }), openTimeoutMs: 1_000, ...overrides }; }

test("public subpath exposes the single product connection factory", () => {
  assert.equal(productConnectionSubpath.createProductWalletConnection, createProductWalletConnection);
});

test("factory derives the exact registered callback and opens no product-supplied URL", async () => {
  const opened = [];
  const connection = createProductWalletConnection(config({ openWallet: async (input) => { opened.push(input); return { opened: true }; } }));
  assert.deepEqual(connection.connectionBinding, { productId: "social", platform: "web", applicationId: "com.ynx.social.web" });
  const result = await connection.beginYNX();
  assert.equal(result.status, WALLET_CONNECTION_COORDINATOR_STATUS.WALLET_OPENED);
  assert.equal(result.sessionState.status, PRODUCT_SESSION_CLIENT_STATE.CONNECTING);
  assert.match(result.url, /^ynxwallet:\/\/authorize\?request=/);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].url, result.url);
  assert.equal(Object.hasOwn(opened[0], "session"), false);
});

test("factory rejects callback, origin, session and unknown configuration injection", () => {
  for (const hostile of [
    { callback: "ynx-social" },
    { origin: "https://evil.example" },
    { session: { account: "fake" } },
    { walletUrl: "javascript:alert(1)" },
  ]) assert.throws(() => createProductWalletConnection(config(hostile)), code("UNKNOWN_OR_MISSING_FIELD"));
});

test("factory fails closed on unknown products, insecure storage and non-HTTPS Gateway", () => {
  assert.throws(() => createProductWalletConnection(config({ productId: "unknown" })), code("UNKNOWN_PRODUCT"));
  assert.throws(() => createProductWalletConnection(config({ storage: { securityLevel: "local", async get() { return null; }, async set() {}, async remove() {} } })), code("INSECURE_STORAGE"));
  assert.throws(() => createProductWalletConnection(config({ gatewayEndpoint: "http://gateway.test" })), code("INVALID_GATEWAY"));
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
