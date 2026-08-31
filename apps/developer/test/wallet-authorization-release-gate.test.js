import assert from "node:assert/strict";
import test from "node:test";
import { assertNoBareWalletAuthorization, assertNoBareWalletAuthorizationInReleaseSources } from "../scripts/check-wallet-authorization-links.mjs";
import { encodeRequestDeepLink, parseWalletDeepLink } from "../vendor/wallet-auth/src/index.js";

test("release gate rejects bare or placeholder YNX Wallet authorize links", async () => {
  assert.throws(() => assertNoBareWalletAuthorization('bridge.openAuthorization("ynxwallet://authorize")', "bare"), /BARE_WALLET_AUTHORIZE_URI/);
  assert.throws(() => assertNoBareWalletAuthorization('bridge.openAuthorization("ynxwallet://authorize?request=probe")', "probe"), /BARE_WALLET_AUTHORIZE_URI/);
  assert.throws(() => assertNoBareWalletAuthorization('const url = `ynxwallet://authorize?request=${encoded}`;', "manual-builder"), /BARE_WALLET_AUTHORIZE_URI/);
  const result = await assertNoBareWalletAuthorizationInReleaseSources();
  assert.ok(result.files > 10);
});

test("accepted root builder creates populated request links and rejects a bare authorization route", () => {
  const request = { version:"1", nonce:"A".repeat(43), chainId:"ynx_6423-1", requestingProduct:"developer", productClientId:"ynx-developer-v1", bundleId:"com.ynxweb4.developer.testnetpreview", productDeviceAlgorithm:"p256-sha256", productDeviceKey:"A".repeat(44), callback:"ynxdeveloper://wallet-auth/callback", scopes:["account:read","developer:deploy"], purpose:"Canonical Developer authorization test", issuedAt:"2026-08-21T00:00:00.000Z", expiresAt:"2026-08-21T00:05:00.000Z" };
  assert.match(encodeRequestDeepLink(request), /^ynxwallet:\/\/authorize\?request=[A-Za-z0-9_-]{80,8192}$/);
  assert.throws(() => parseWalletDeepLink("ynxwallet://authorize", "android", { now:new Date("2026-08-21T00:00:01.000Z"), registry:{} }), (error) => error.code === "MISSING_AUTHORIZATION_REQUEST");
});
