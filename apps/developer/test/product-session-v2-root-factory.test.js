import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createProductWalletConnection, PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN } from "../vendor/wallet-auth/src/index.js";

const registry = JSON.parse(await readFile(new URL("../vendor/wallet-auth/product-session-registry.json", import.meta.url), "utf8"));

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
});
