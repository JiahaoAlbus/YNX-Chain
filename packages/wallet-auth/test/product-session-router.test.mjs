import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { p256 } from "@noble/curves/nist.js";
import {
  canonicalReturnTarget, createProductSessionRequest, createProductSessionReturnURL,
  migrateLegacyCallback, migrateLegacyProductSessionRequest, migrateProductSessionRegistryV1, parseProductSessionRegistry, parseProductSessionReturnURL,
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

test("registry defines exact registered platform return targets for the migration set", () => {
  assert.equal(registry.schemaVersion, 2);
  assert.equal(registry.products.length, 13);
  for (const product of registry.products) {
    const targets = product.platforms.map((platform) => canonicalReturnTarget(registry, product.productId, platform));
    const web = targets.find((target) => target.platform === "web");
    if (web) assert.equal(web.callback, product.webCallback);
    assert.equal(targets.every((item) => item.productId === product.productId), true);
    assert.deepEqual(targets.map((item) => [item.bundleId, item.packageId]), product.platforms.map((platform) => [
      ["ios", "macos"].includes(platform) ? product.applicationId : null,
      ["android", "windows"].includes(platform) ? product.applicationId : null,
    ]));
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
  const installedMetaMask = walletConnectionChoices(registry, "dex", { ynxWalletInstalled: false, metaMaskAvailable: true });
  assert.deepEqual(installedMetaMask.map((item) => item.id), ["download-ynx-wallet", "metamask", "guest"]);
  assert.equal(installedMetaMask[1].action, "open-evm");
  assert.equal(installedMetaMask[1].authoritative, true);
  assert.equal(installedMetaMask[1].connectionMode, "evm-only");
  assert.equal(installedMetaMask[1].authority, "eip-1193-provider-only");
  assert.equal(installedMetaMask[1].ynxProductSession, false);
  const missingMetaMask = walletConnectionChoices(registry, "dex", { ynxWalletInstalled: false, metaMaskAvailable: false });
  assert.deepEqual(missingMetaMask.map((item) => item.id), ["download-ynx-wallet", "metamask", "guest"]);
  assert.equal(missingMetaMask[1].action, "download-evm-wallet");
  assert.equal(missingMetaMask[1].url, "https://metamask.io/download");
  assert.equal(missingMetaMask[1].authoritative, true);
  assert.equal(missingMetaMask[1].authority, "none");
  assert.equal(missingMetaMask[1].ynxProductSession, false);
  const guest = missingMetaMask.at(-1);
  assert.deepEqual(guest.limitations, ["not-signed-in", "no-wallet-balance", "no-transactions", "no-chain-authority"]);
});

test("Wallet download registrations are pinned to the official allowlist", () => {
  assert.throws(() => parseProductSessionRegistry({ ...registrySource, wallet: { ...registrySource.wallet, downloadUrl: "https://attacker.example/wallet" } }), code("INVALID_ROUTER_REGISTRY"));
  assert.throws(() => parseProductSessionRegistry({ ...registrySource, wallet: { ...registrySource.wallet, metaMaskDownloadUrl: "https://attacker.example/metamask" } }), code("INVALID_ROUTER_REGISTRY"));
});

test("registry v1 migrates explicitly to v2 while modified or ambiguous legacy registries fail closed", () => {
  const legacy = { ...registrySource, schemaVersion: 1, wallet: { authorizeCallback: registrySource.wallet.authorizeCallback, downloadUrl: registrySource.wallet.downloadUrl } };
  assert.throws(() => parseProductSessionRegistry(legacy), code("INVALID_ROUTER_REGISTRY"));
  const migrated = migrateProductSessionRegistryV1(legacy);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.wallet.metaMaskDownloadUrl, "https://metamask.io/download");
  assert.throws(() => migrateProductSessionRegistryV1({ ...legacy, wallet: { ...legacy.wallet, unknown: true } }), code("UNKNOWN_OR_MISSING_FIELD"));
  assert.throws(() => migrateProductSessionRegistryV1({ ...legacy, wallet: { ...legacy.wallet, downloadUrl: "https://attacker.example/wallet" } }), code("INVALID_ROUTER_REGISTRY"));
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
