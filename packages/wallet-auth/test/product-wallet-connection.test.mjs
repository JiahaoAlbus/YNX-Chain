import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  createProductSessionReturnURL, createProductWalletConnection,
  PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN,
  PRODUCT_SESSION_CLIENT_STATE, PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2,
  ProductSessionGatewayHttpHandler, signProductSessionApproval,
  WALLET_CONNECTION_COORDINATOR_STATUS, WalletAuthError,
} from "../src/index.js";
import * as walletAuthRoot from "@ynx-chain/wallet-auth";

const registry = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const secret = Buffer.alloc(32, 29);
const deviceKey = Buffer.from(p256.getPublicKey(secret, true)).toString("base64url");
function token(value) { return createHash("sha256").update(value).digest("base64url"); }
function storage() { const values = new Map(); return { securityLevel: "os-protected", async get(key) { return values.get(key) ?? null; }, async set(key, value) { values.set(key, value); }, async remove(key) { values.delete(key); } }; }
function config(overrides = {}) { return { registry, productId: "social", platform: "web", walletInstalled: async () => true, schemeRegistered: async () => true, gatewayTimeoutMs: 5_000, storage: storage(), device: { id: "social-device-factory-001", key: deviceKey, async sign({ purpose, algorithm, deviceKey: requestedKey, payload }) { assert.ok(["challenge", "http-proof"].includes(purpose)); assert.equal(algorithm, "p256-sha256"); assert.equal(requestedKey, deviceKey); return Buffer.from(p256.sign(Buffer.from(payload, "base64url"), secret, { format: "der" })).toString("base64url"); }, scopes: ["account:read", "profile:link"], purpose: "Connect Social through the canonical public SDK factory." }, scope: {}, discoveryWaitMs: 0, openWallet: async () => ({ opened: true }), openTimeoutMs: 1_000, ...overrides }; }

test("public package root exposes the single product connection factory", () => {
  assert.equal(walletAuthRoot.createProductWalletConnection, createProductWalletConnection);
  assert.equal(PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN, "https://wallet-auth.ynxweb4.com");
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

test("factory completes the real Gateway lifecycle and restores it after a second launch", async () => {
  let gatewayToken = 0;
  const handler = new ProductSessionGatewayHttpHandler(registry, () => token(`factory-gateway-${gatewayToken++}`));
  const gatewayOrigins = [];
  const fetch = async (url, init) => {
    const parsed = new URL(url);
    gatewayOrigins.push(parsed.origin);
    const response = handler.handle({
      requestId: init.headers["x-request-id"], method: init.method, path: parsed.pathname,
      contentType: init.headers["content-type"], body: init.body,
      proofHeader: init.headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2] ?? null,
      networkAvailable: true,
    }, new Date());
    return new Response(response.body, { status: response.status, headers: response.headers });
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    const protectedStorage = storage();
    const opened = [];
    const signingPurposes = []; const secureDevice = config().device;
    const signingDevice = { ...secureDevice, async sign(input) { signingPurposes.push(input.purpose); return secureDevice.sign(input); } };
    const first = createProductWalletConnection(config({ storage: protectedStorage, device: signingDevice, openWallet: async (input) => { opened.push(input); return { opened: true }; } }));
    const pending = await first.beginYNX();
    const approvalTime = new Date(pending.sessionState.request.issuedAt);
    const approvalExpiresAt = new Date(approvalTime.getTime() + 180_000).toISOString();
    const approval = signProductSessionApproval(registry, pending.sessionState.request, {
      accountSecret: "1".padStart(64, "0"), scopes: pending.sessionState.request.scopes,
      expiresAt: approvalExpiresAt,
    }, approvalTime);
    const callback = createProductSessionReturnURL(registry, pending.sessionState.request, { result: "approved", approval }, approvalTime);
    const connected = await first.handleReturn(callback);
    assert.equal(connected.sessionState.status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
    assert.equal(connected.sessionState.session.productId, "social");
    assert.equal(handler.snapshot().authority.sessions.length, 1);
    assert.equal(opened.length, 1);
    assert.equal(gatewayOrigins.every((origin) => origin === PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN), true);
    assert.deepEqual(signingPurposes, ["challenge", "http-proof"]);

    const restarted = createProductWalletConnection(config({ storage: protectedStorage, device: signingDevice }));
    const restored = await restarted.restore(true);
    assert.equal(restored.status, WALLET_CONNECTION_COORDINATOR_STATUS.SESSION_STATE);
    assert.equal(restored.sessionState.status, PRODUCT_SESSION_CLIENT_STATE.CONNECTED);
    assert.equal(restored.sessionState.session.sessionBinding, connected.sessionState.session.sessionBinding);
    const disconnected = await restarted.disconnect();
    assert.equal(disconnected.sessionState.status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
    assert.deepEqual(handler.snapshot().authority.revokedSessions, [connected.sessionState.session.sessionBinding]);
    assert.deepEqual(signingPurposes, ["challenge", "http-proof", "http-proof", "http-proof"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("factory owns cryptographic nonce generation across 120 concurrent connections", async () => {
  const pending = await Promise.all(Array.from({ length: 120 }, () => createProductWalletConnection(config()).beginYNX()));
  const nonces = pending.map((item) => item.sessionState.request.nonce);
  const states = pending.map((item) => item.sessionState.request.state);
  assert.equal(new Set(nonces).size, 120);
  assert.equal(new Set(states).size, 120);
  assert.equal(nonces.every((value) => /^[A-Za-z0-9_-]{43}$/.test(value)), true);
  assert.equal(states.every((value) => /^[A-Za-z0-9_-]{43}$/.test(value)), true);
});

test("factory migrates only the registered product legacy scheme before opening", async () => {
  const opened = [];
  const connection = createProductWalletConnection(config({ platform: "android", openWallet: async (input) => { opened.push(input); return { opened: true }; } }));
  const unknown = await connection.beginLegacyYNX("ynx-unknown");
  assert.deepEqual(unknown, {
    status: WALLET_CONNECTION_COORDINATOR_STATUS.WALLET_OPEN_FAILED,
    code: "SCHEME_NOT_REGISTERED",
    message: "Wallet scheme is not registered",
    actions: ["download", "retry", "return-to-product"],
  });
  assert.equal(opened.length, 0);
  assert.equal(connection.current.status, PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED);
  const result = await connection.beginLegacyYNX("ynx-social");
  assert.equal(result.status, WALLET_CONNECTION_COORDINATOR_STATUS.WALLET_OPENED);
  assert.deepEqual(result.migration, {
    migrated: true, legacyValue: "ynx-social", callback: "ynx-social://com.ynx.social",
    productId: "social", clientId: "ynx-social-v1", platform: "android",
  });
  assert.match(opened[0].url, /^ynxwallet:\/\/authorize\?request=/);
  assert.equal(opened[0].url.includes("ynx-social"), false);
  assert.equal(opened.length, 1);
  assert.equal(connection.current.status, PRODUCT_SESSION_CLIENT_STATE.CONNECTING);
});

test("factory rejects callback, origin, session and unknown configuration injection", () => {
  for (const hostile of [
    { callback: "ynx-social" },
    { origin: "https://evil.example" },
    { session: { account: "fake" } },
    { walletUrl: "javascript:alert(1)" },
    { gatewayEndpoint: "https://attacker.example" },
    { fetch: async () => new Response("{}") },
    { device: { ...config().device, secret: secret.toString("base64url") } },
    { tokenFactory: () => "predictable" },
    { clock: () => new Date(0) },
  ]) assert.throws(() => createProductWalletConnection(config(hostile)), code("UNKNOWN_OR_MISSING_FIELD"));
});

test("factory fails closed on unknown products and insecure storage", () => {
  assert.throws(() => createProductWalletConnection(config({ productId: "unknown" })), code("UNKNOWN_PRODUCT"));
  assert.throws(() => createProductWalletConnection(config({ storage: { securityLevel: "local", async get() { return null; }, async set() {}, async remove() {} } })), code("INSECURE_STORAGE"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = undefined;
  try { assert.throws(() => createProductWalletConnection(config()), code("INVALID_GATEWAY")); }
  finally { globalThis.fetch = originalFetch; }
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
