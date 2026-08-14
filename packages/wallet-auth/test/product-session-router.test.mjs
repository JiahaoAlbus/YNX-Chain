import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  canonicalReturnTarget, createProductSessionRequest, createProductSessionReturnURL,
  migrateLegacyCallback, migrateLegacyProductSessionRequest, parseProductSessionRegistry, parseProductSessionReturnURL,
  prepareWalletOpen, walletConnectionChoices, WalletAuthError, WALLET_ROUTE_STATUS,
} from "../src/index.js";

const registrySource = JSON.parse(readFileSync(new URL("../product-session-registry.json", import.meta.url), "utf8"));
const registry = parseProductSessionRegistry(registrySource);
const NOW = new Date("2026-08-14T01:00:00.000Z");
const secret = Buffer.alloc(32, 7);
const deviceKey = Buffer.from(p256.getPublicKey(secret, true)).toString("base64url");

function request(productId = "social", platform = "android") {
  const product = registry.products.find((item) => item.productId === productId);
  return createProductSessionRequest(registry, {
    productId, platform, deviceId: "device-router-001", deviceKey,
    scopes: product.scopes, purpose: `Connect ${product.displayName} to the selected YNX account.`,
    nonce: "nonce_router_abcdefghijklmnopqrstuvwxyz12", state: "state_router_abcdefghijklmnopqrstuvwxyz12",
  }, NOW);
}

test("registry defines exact Web, macOS, Windows, Android and iOS return targets for the migration set", () => {
  assert.equal(registry.products.length, 12);
  for (const product of registry.products) {
    const targets = ["web", "macos", "windows", "android", "ios"].map((platform) => canonicalReturnTarget(registry, product.productId, platform));
    assert.equal(targets[0].callback, `${product.webOrigin}/wallet-auth/callback`);
    assert.equal(new Set(targets.slice(1).map((item) => item.callback)).size, 1);
    assert.equal(targets.every((item) => item.productId === product.productId), true);
    assert.deepEqual(targets.map((item) => [item.bundleId, item.packageId]), [
      [null, null], [product.applicationId, null], [null, product.applicationId],
      [null, product.applicationId], [product.applicationId, null],
    ]);
  }
});

test("known ynx-social shorthand migrates to its registered URL while unknown schemes fail closed", () => {
  assert.deepEqual(migrateLegacyCallback(registry, "ynx-social", { productId: "social", platform: "android" }), {
    migrated: true, legacyValue: "ynx-social", callback: "ynx-social://com.ynx.social",
    productId: "social", clientId: "ynx-social-v1", platform: "android",
  });
  assert.throws(() => migrateLegacyCallback(registry, "unregistered-wallet", { productId: "social", platform: "android" }), code("UNKNOWN_LEGACY_SCHEME"));
  assert.throws(() => migrateLegacyCallback(registry, "ynx-social", { productId: "pay", platform: "android" }), code("UNKNOWN_LEGACY_SCHEME"));
});

test("known v1 requests migrate into fully bound v2 requests while callback injection is rejected", () => {
  const legacy = {
    version: "1", nonce: "nonce_router_abcdefghijklmnopqrstuvwxyz12", chainId: "ynx_6423-1",
    requestingProduct: "social", productClientId: "ynx-social-v1", bundleId: "com.ynx.social",
    productDeviceAlgorithm: "p256-sha256", productDeviceKey: deviceKey,
    callback: "ynx-social://com.ynx.social", scopes: ["account:read", "profile:link"],
    purpose: "Link this exact Social device.", issuedAt: NOW.toISOString(), expiresAt: "2026-08-14T01:05:00.000Z",
  };
  const migrated = migrateLegacyProductSessionRequest(registry, legacy, { productId: "social", platform: "android", deviceId: "device-router-001", state: "state_router_abcdefghijklmnopqrstuvwxyz12" }, NOW);
  assert.equal(migrated.version, "2");
  assert.equal(migrated.origin, "app://android/com.ynx.social");
  assert.equal(migrated.callback, "ynx-social://com.ynx.social");
  assert.equal(migrated.clientId, "ynx-social-v1");
  assert.equal(migrated.bundleId, null);
  assert.equal(migrated.packageId, "com.ynx.social");
  assert.throws(() => migrateLegacyProductSessionRequest(registry, { ...legacy, callback: "javascript://attacker" }, { productId: "social", platform: "android", deviceId: "device-router-001", state: "state_router_abcdefghijklmnopqrstuvwxyz12" }, NOW), code("LEGACY_BINDING_MISMATCH"));
});

test("Wallet selection prefers installed YNX Wallet and only offers MetaMask for compatible EVM products", () => {
  assert.deepEqual(walletConnectionChoices(registry, "social", { ynxWalletInstalled: true, metaMaskAvailable: true }).map((item) => item.id), ["ynx-wallet", "guest"]);
  const socialMissing = walletConnectionChoices(registry, "social", { ynxWalletInstalled: false, metaMaskAvailable: true });
  assert.deepEqual(socialMissing.map((item) => item.id), ["download-ynx-wallet", "guest"]);
  assert.equal(socialMissing[0].url, "https://www.ynxweb4.com/dapp/download");
  assert.deepEqual(walletConnectionChoices(registry, "dex", { ynxWalletInstalled: false, metaMaskAvailable: true }).map((item) => item.id), ["download-ynx-wallet", "metamask", "guest"]);
  const guest = walletConnectionChoices(registry, "dex", { ynxWalletInstalled: false, metaMaskAvailable: false }).at(-1);
  assert.deepEqual(guest.limitations, ["not-signed-in", "no-wallet-balance", "no-transactions", "no-chain-authority"]);
});

test("router returns actionable unavailable states and never opens an unregistered scheme", () => {
  const pending = request();
  assert.equal(prepareWalletOpen(registry, pending, { networkAvailable: false, walletInstalled: true, schemeRegistered: true }, NOW).status, WALLET_ROUTE_STATUS.NETWORK_UNAVAILABLE);
  assert.equal(prepareWalletOpen(registry, pending, { networkAvailable: true, walletInstalled: false, schemeRegistered: true }, NOW).status, WALLET_ROUTE_STATUS.WALLET_NOT_INSTALLED);
  assert.equal(prepareWalletOpen(registry, pending, { networkAvailable: true, walletInstalled: true, schemeRegistered: false }, NOW).status, WALLET_ROUTE_STATUS.SCHEME_NOT_REGISTERED);
  assert.match(prepareWalletOpen(registry, pending, { networkAvailable: true, walletInstalled: true, schemeRegistered: true }, NOW).url, /^ynxwallet:\/\/authorize\?request=/);
});

test("return router binds route, nonce and state and reports rejection without creating a session", () => {
  const pending = request();
  const rejected = createProductSessionReturnURL(registry, pending, { result: "rejected", reason: "user_rejected" }, NOW);
  assert.equal(parseProductSessionReturnURL(registry, pending, rejected, NOW).status, WALLET_ROUTE_STATUS.USER_REJECTED);
  assert.equal(parseProductSessionReturnURL(registry, pending, rejected.replace(pending.state, "state_attacker_abcdefghijklmnopqrstuvwxyz"), NOW).status, WALLET_ROUTE_STATUS.CALLBACK_MISMATCH);
  assert.equal(parseProductSessionReturnURL(registry, pending, rejected.replace("ynx-social://com.ynx.social", "ynxpay://wallet-auth/callback"), NOW).status, WALLET_ROUTE_STATUS.CALLBACK_MISMATCH);
});

function code(expected) { return (error) => error instanceof WalletAuthError && error.code === expected; }
