import assert from "node:assert/strict";
import test from "node:test";
import { migrateLegacyCallback, parsePrivateBusinessRegistrations, productPlatformBinding, WalletAuthError } from "@ynx-chain/wallet-auth";
import registry from "../../../../packages/wallet-auth/product-session-registry.json";
import { PRODUCT_SESSION_REGISTRY } from "./registry";

test("Wallet uses the authoritative v2 registry and canonical platform identity", () => {
  assert.deepEqual(PRODUCT_SESSION_REGISTRY, registry);
  for (const product of registry.products) {
    for (const platform of ["android", "ios", "linux", "macos", "windows", "web"] as const) {
      if (product.platforms && !product.platforms.includes(platform)) {
        assert.throws(() => productPlatformBinding(PRODUCT_SESSION_REGISTRY, product.productId, platform),
          (error: unknown) => error instanceof WalletAuthError && error.code === "INVALID_PLATFORM");
        continue;
      }
      const binding = productPlatformBinding(PRODUCT_SESSION_REGISTRY, product.productId, platform);
      assert.equal(binding.applicationId, product.applicationId + (platform === "web" ? ".web" : ""));
      const declaredWebCallback = "webCallback" in product ? product.webCallback : product.webOrigin + "/wallet-auth/callback";
      assert.equal(binding.callback, platform === "web" ? declaredWebCallback : product.nativeCallback);
      assert.equal(binding.packageId, ["android", "linux", "windows"].includes(platform) ? product.applicationId : null);
      assert.equal(binding.bundleId, ["ios", "macos"].includes(platform) ? product.applicationId : null);
    }
  }
});

test("matching registry does not alias merchant authority or restore retired payer scopes and Web route", () => {
  const payer = registry.products.find((product) => product.productId === "pay")!;
  const merchant = registry.products.find((product) => product.productId === "pay-merchant")!;
  assert.deepEqual(payer.platforms, ["android", "ios", "linux", "macos", "windows"]);
  assert.deepEqual([...payer.scopes].sort(), ["account:read", "pay:case:create", "pay:settlement:submit"]);
  assert.deepEqual(merchant.platforms, ["web"]);
  assert.deepEqual([...merchant.scopes].sort(), ["account:read", "merchant:session:create"]);
  assert.throws(() => productPlatformBinding(PRODUCT_SESSION_REGISTRY, "pay", "web"),
    (error: unknown) => error instanceof WalletAuthError && error.code === "INVALID_PLATFORM");
});

test("matching c5 Music contract has exact cross-platform identities without migrating a native callback to Web", () => {
  // The matching 1.2.0 input declares these clients. Registration does not
  // establish an installed client, private backend, key lease or live session.
  const music = registry.products.find(product => product.productId === "music")!;
  assert.deepEqual(music.platforms, ["android", "ios", "macos", "web"]);
  assert.deepEqual(music.scopes, ["music.creator", "music.library", "music.playback", "music.profile"]);
  const web = productPlatformBinding(PRODUCT_SESSION_REGISTRY, "music", "web");
  assert.equal(web.clientId, "ynx-music-v1");
  assert.equal(web.applicationId, "com.ynxweb4.music.web");
  assert.equal(web.origin, "https://music.ynxweb4.com");
  assert.equal(web.callback, "https://music.ynxweb4.com/wallet-auth/callback");
  assert.equal(web.packageId, null); assert.equal(web.bundleId, null);
  const mac = productPlatformBinding(PRODUCT_SESSION_REGISTRY, "music", "macos");
  assert.equal(mac.applicationId, "com.ynxweb4.music");
  assert.equal(mac.bundleId, "com.ynxweb4.music");
  assert.equal(mac.origin, "app://macos/com.ynxweb4.music");
  assert.equal(mac.callback, "ynxmusic://auth/callback");
  for (const platform of ["linux", "windows"] as const) {
    assert.throws(() => productPlatformBinding(PRODUCT_SESSION_REGISTRY, "music", platform),
      (error: unknown) => error instanceof WalletAuthError && error.code === "INVALID_PLATFORM");
  }
  assert.throws(() => migrateLegacyCallback(PRODUCT_SESSION_REGISTRY, music.nativeCallback!, {productId: "music", platform: "web"}),
    (error: unknown) => error instanceof WalletAuthError && error.code === "CALLBACK_MISMATCH");
});

test("Music registration cannot acquire payer merchant or invented private scopes", () => {
  const entry = {productId: "music", platform: "web" as const, keyId: "test-music-config", allowedScopes: ["music.library"]};
  const [parsed] = parsePrivateBusinessRegistrations(PRODUCT_SESSION_REGISTRY, [entry]);
  assert.equal(parsed!.backendClientId, "ynx-music-v1-business-web-v1");
  assert.deepEqual(parsed!.allowedScopes, ["music.library"]);
  assert.equal(parsed!.callback, "https://music.ynxweb4.com/wallet-auth/callback");
  for (const scope of ["pay:settlement:submit", "merchant:session:create", "music:invented"]) {
    assert.throws(() => parsePrivateBusinessRegistrations(PRODUCT_SESSION_REGISTRY, [{...entry, allowedScopes: [scope]}]),
      (error: unknown) => error instanceof WalletAuthError && error.code === "INVALID_PRIVATE_REGISTRATION");
  }
});
