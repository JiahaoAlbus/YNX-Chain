import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeRequestDeepLink, parseWalletDeepLink, WalletAuthError } from "../src/index.js";
import { NOW, REGISTRY, request } from "./fixtures.mjs";

for (const platform of ["android", "ios"]) {
  test(`${platform} deep link parses the exact Wallet authorization route`, () => {
    const parsed = parseWalletDeepLink(encodeRequestDeepLink(request()), platform, { now: NOW, registry: REGISTRY });
    assert.equal(parsed.platform, platform);
    assert.equal(parsed.request.bundleId, "com.ynx.social");
    assert.equal(parsed.request.productDeviceAlgorithm, "p256-sha256");
  });
}

test("deep links reject route, query and encoding tampering", () => {
  const valid = encodeRequestDeepLink(request());
  for (const [platform, candidate] of [
    ["android", valid.replace("authorize", "approve")],
    ["ios", `${valid}&redirect=attacker`],
    ["android", `${valid}&request=duplicate`],
    ["ios", `${valid}#fragment`],
    ["android", valid.replace("ynxwallet://", "ynxwallet://attacker@")],
    ["ios", valid.replace("authorize?", "authorize:443?")],
    ["android", valid.replace("authorize", "%61uthorize")],
    ["ios", valid.replace("ynxwallet:", "YNXWALLET:")],
    ["android", "ynxwallet://authorize?request=%25"],
  ]) assert.throws(
    () => parseWalletDeepLink(candidate, platform, { now: NOW, registry: REGISTRY }),
    (error) => error instanceof WalletAuthError && error.code === "INVALID_DEEP_LINK",
  );
});
