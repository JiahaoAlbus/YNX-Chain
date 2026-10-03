import assert from "node:assert/strict";
import test from "node:test";
import { productPlatformBinding, WalletAuthError } from "@ynx-chain/wallet-auth";
import registry from "../../../../packages/wallet-auth/product-session-registry.json";
import { PRODUCT_SESSION_REGISTRY } from "./registry";

test("Wallet uses the authoritative v2 registry and canonical platform identity", () => {
  assert.deepEqual(PRODUCT_SESSION_REGISTRY, registry);
  for (const product of registry.products) {
    for (const platform of ["android", "ios", "web"] as const) {
      if (product.platforms && !product.platforms.includes(platform)) {
        assert.throws(() => productPlatformBinding(PRODUCT_SESSION_REGISTRY, product.productId, platform),
          (error: unknown) => error instanceof WalletAuthError && error.code === "INVALID_PLATFORM");
        continue;
      }
      const binding = productPlatformBinding(PRODUCT_SESSION_REGISTRY, product.productId, platform);
      assert.equal(binding.applicationId, product.applicationId + (platform === "web" ? ".web" : ""));
      const declaredWebCallback = "webCallback" in product ? product.webCallback : product.webOrigin + "/wallet-auth/callback";
      assert.equal(binding.callback, platform === "web" ? declaredWebCallback : product.nativeCallback);
      assert.equal(binding.packageId, platform === "android" ? product.applicationId : null);
      assert.equal(binding.bundleId, platform === "ios" ? product.applicationId : null);
    }
  }
});

test("approved registry does not alias merchant authority or restore retired payer scopes and Web routes", () => {
  const payer = registry.products.find((product) => product.productId === "pay")!;
  const merchant = registry.products.find((product) => product.productId === "pay-merchant")!;
  const music = registry.products.find((product) => product.productId === "music")!;
  assert.deepEqual(payer.platforms, ["android", "ios", "linux", "macos", "windows"]);
  assert.deepEqual([...payer.scopes].sort(), ["account:read", "pay:case:create", "pay:settlement:submit"]);
  assert.deepEqual(merchant.platforms, ["web"]);
  assert.deepEqual([...merchant.scopes].sort(), ["account:read", "merchant:session:create"]);
  assert.deepEqual(music.platforms, ["android", "ios"]);
  for (const productId of ["pay", "music"]) {
    assert.throws(() => productPlatformBinding(PRODUCT_SESSION_REGISTRY, productId, "web"),
      (error: unknown) => error instanceof WalletAuthError && error.code === "INVALID_PLATFORM");
  }
});
