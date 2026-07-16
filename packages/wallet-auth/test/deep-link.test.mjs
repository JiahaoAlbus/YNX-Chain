import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeRequestDeepLink, parseWalletDeepLink, WalletAuthError } from "../src/index.js";
import { NOW, REGISTRY, request } from "./fixtures.mjs";

for (const platform of ["android", "ios"]) {
  test(`${platform} deep link parses the exact Wallet authorization route`, () => {
    const parsed = parseWalletDeepLink(encodeRequestDeepLink(request()), platform, { now: NOW, registry: REGISTRY });
    assert.equal(parsed.platform, platform);
    assert.equal(parsed.request.bundleId, "com.ynxweb4.social");
    assert.equal(parsed.request.productDeviceAlgorithm, "p256-sha256");
  });
}

test("deep links reject route, query and encoding tampering", () => {
  const valid = encodeRequestDeepLink(request());
  assert.throws(() => parseWalletDeepLink(valid.replace("authorize", "approve"), "android", { now: NOW, registry: REGISTRY }), WalletAuthError);
  assert.throws(() => parseWalletDeepLink(`${valid}&redirect=attacker`, "ios", { now: NOW, registry: REGISTRY }), WalletAuthError);
  assert.throws(() => parseWalletDeepLink("ynxwallet://authorize?request=%25", "android", { now: NOW, registry: REGISTRY }), WalletAuthError);
});
