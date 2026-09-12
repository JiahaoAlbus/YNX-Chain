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
      assert.equal(binding.callback, platform === "web" ? product.webOrigin + "/wallet-auth/callback" : product.nativeCallback);
      assert.equal(binding.packageId, platform === "android" ? product.applicationId : null);
      assert.equal(binding.bundleId, platform === "ios" ? product.applicationId : null);
    }
  }
});
